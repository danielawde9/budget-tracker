export interface SourceViolation {
  line: number;
  message: string;
}

const protectedTablePattern =
  String.raw`(?:space_memberships|household_invitations|household_membership_events)`;
const writeMethodPattern = String.raw`(?:insert|update|delete|upsert|truncate)`;
const sensitiveValuePattern = /\b(?:invitation_token|access_token|refresh_token|session_token)\b/i;
const sinkMethodPattern = String.raw`(?:log|info|debug|warn|error|trace|track|capture|event|send)`;
const sinkNamePattern = /(?:^|_)(?:console|log(?:ger)?|analytics|telemetry|tracker|audit|metrics?)(?:$|_)/i;

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectProtectedTableNames(source: string): Set<string> {
  const names = new Set<string>();
  const declaration = new RegExp(
    String.raw`\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"])${protectedTablePattern}\2\s*;`,
    'g',
  );
  for (const match of source.matchAll(declaration)) {
    if (match[1]) names.add(match[1]);
  }
  return names;
}

function collectProtectedAliases(source: string, tableNames: Set<string>): Set<string> {
  const aliases = new Set<string>();
  const declaration = new RegExp(
    String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]{0,500}?\.from\s*\(\s*(['"])${protectedTablePattern}\2\s*\)\s*;`,
    'g',
  );
  for (const match of source.matchAll(declaration)) {
    if (match[1]) aliases.add(match[1]);
  }
  for (const tableName of tableNames) {
    const namedDeclaration = new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*[^;]{0,500}?\.from\s*\(\s*${escapeRegExp(tableName)}\s*\)\s*;`,
      'g',
    );
    for (const match of source.matchAll(namedDeclaration)) {
      if (match[1]) aliases.add(match[1]);
    }
  }
  return aliases;
}

export function findHouseholdDirectWrites(source: string): SourceViolation[] {
  const violations: SourceViolation[] = [];
  const tableNames = collectProtectedTableNames(source);
  const directWrite = new RegExp(
    String.raw`\.from\s*\(\s*(['"])${protectedTablePattern}\1\s*\)[^;]{0,500}?\.\s*${writeMethodPattern}\s*\(`,
    'g',
  );
  for (const match of source.matchAll(directWrite)) {
    violations.push({ line: lineAt(source, match.index), message: 'direct household table mutation' });
  }
  for (const tableName of tableNames) {
    const namedDirectWrite = new RegExp(
      String.raw`\.from\s*\(\s*${escapeRegExp(tableName)}\s*\)[^;]{0,500}?\.\s*${writeMethodPattern}\s*\(`,
      'g',
    );
    for (const match of source.matchAll(namedDirectWrite)) {
      violations.push({ line: lineAt(source, match.index), message: 'direct household table mutation' });
    }
  }
  for (const alias of collectProtectedAliases(source, tableNames)) {
    const aliasWrite = new RegExp(
      String.raw`\b${escapeRegExp(alias)}\s*(?:\?\.)?\.\s*${writeMethodPattern}\s*\(`,
      'g',
    );
    for (const match of source.matchAll(aliasWrite)) {
      violations.push({ line: lineAt(source, match.index), message: 'aliased household table mutation' });
    }
  }
  return violations;
}

function collectSinkAliases(source: string): { functions: Set<string>; objects: Set<string> } {
  const objects = new Set<string>(['console']);
  const functions = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const objectAlias = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
    for (const match of source.matchAll(objectAlias)) {
      const alias = match[1];
      const target = match[2];
      if (alias && target && !objects.has(alias)
        && (objects.has(target) || sinkNamePattern.test(target))) {
        objects.add(alias);
        changed = true;
      }
      if (alias && target && functions.has(target) && !functions.has(alias)) {
        functions.add(alias);
        changed = true;
      }
    }
    const functionAlias = new RegExp(
      String.raw`\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*\.\s*${sinkMethodPattern}\s*;`,
      'g',
    );
    for (const match of source.matchAll(functionAlias)) {
      const alias = match[1];
      const target = match[2];
      if (alias && target && !functions.has(alias)
        && (objects.has(target) || sinkNamePattern.test(target))) {
        functions.add(alias);
        changed = true;
      }
    }
    const destructuredAlias = /\b(?:const|let|var)\s*\{([^}]{1,500})\}\s*=\s*([A-Za-z_$][\w$]*)\s*;/g;
    for (const match of source.matchAll(destructuredAlias)) {
      const target = match[2];
      if (!target || (!objects.has(target) && !sinkNamePattern.test(target))) continue;
      for (const binding of (match[1] ?? '').split(',').slice(0, 20)) {
        const parsed = binding.match(
          new RegExp(String.raw`^\s*(${sinkMethodPattern})(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*$`),
        );
        const alias = parsed?.[2] ?? parsed?.[1];
        if (alias && !functions.has(alias)) {
          functions.add(alias);
          changed = true;
        }
      }
    }
  }
  return { functions, objects };
}

function maskNonCodeText(source: string): string {
  const masked = [...source];
  let mode: 'code' | 'single' | 'double' | 'template' | 'lineComment' | 'blockComment' = 'code';
  let escaped = false;
  const templateDepths: number[] = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (mode === 'lineComment') {
      if (character === '\n') mode = 'code';
      else masked[index] = ' ';
      continue;
    }
    if (mode === 'blockComment') {
      masked[index] = ' ';
      if (character === '*' && next === '/') {
        masked[index + 1] = ' ';
        index += 1;
        mode = 'code';
      }
      continue;
    }
    if (mode === 'single' || mode === 'double') {
      masked[index] = ' ';
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if ((mode === 'single' && character === "'") || (mode === 'double' && character === '"')) {
        mode = 'code';
      }
      continue;
    }
    if (mode === 'template') {
      masked[index] = ' ';
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '`') mode = 'code';
      else if (character === '$' && next === '{') {
        masked[index + 1] = ' ';
        index += 1;
        templateDepths.push(1);
        mode = 'code';
      }
      continue;
    }
    if (character === '/' && next === '/') {
      masked[index] = masked[index + 1] = ' ';
      index += 1;
      mode = 'lineComment';
    } else if (character === '/' && next === '*') {
      masked[index] = masked[index + 1] = ' ';
      index += 1;
      mode = 'blockComment';
    } else if (character === "'" || character === '"' || character === '`') {
      masked[index] = ' ';
      mode = character === "'" ? 'single' : character === '"' ? 'double' : 'template';
    } else if (templateDepths.length > 0 && character === '{') {
      templateDepths[templateDepths.length - 1]! += 1;
    } else if (templateDepths.length > 0 && character === '}') {
      const depthIndex = templateDepths.length - 1;
      templateDepths[depthIndex]! -= 1;
      if (templateDepths[depthIndex] === 0) {
        templateDepths.pop();
        masked[index] = ' ';
        mode = 'template';
      }
    }
  }
  return masked.join('');
}

function callEnd(source: string, openingParenthesis: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  const bound = Math.min(source.length, openingParenthesis + 4_000);
  for (let index = openingParenthesis; index < bound; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character;
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return openingParenthesis + 1;
}

export function findSensitiveLogging(source: string): SourceViolation[] {
  const aliases = collectSinkAliases(source);
  const starts: Array<{ index: number; openingParenthesis: number }> = [];
  const methodCall = new RegExp(
    String.raw`\b([A-Za-z_$][\w$]*)\s*(?:\?\.)?\.\s*${sinkMethodPattern}\s*(\()`,
    'g',
  );
  for (const match of source.matchAll(methodCall)) {
    const object = match[1];
    const opening = match.index + match[0].lastIndexOf('(');
    if (object && (aliases.objects.has(object) || sinkNamePattern.test(object))) {
      starts.push({ index: match.index, openingParenthesis: opening });
    }
  }
  for (const alias of aliases.functions) {
    const functionCall = new RegExp(String.raw`\b${escapeRegExp(alias)}\s*(\()`, 'g');
    for (const match of source.matchAll(functionCall)) {
      starts.push({ index: match.index, openingParenthesis: match.index + match[0].lastIndexOf('(') });
    }
  }
  return starts
    .filter(({ openingParenthesis }) =>
      sensitiveValuePattern.test(
        maskNonCodeText(source.slice(openingParenthesis, callEnd(source, openingParenthesis))),
      ),
    )
    .map(({ index }) => ({ line: lineAt(source, index), message: 'sensitive value sent to log sink' }));
}
