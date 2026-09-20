/**
 * Expense categorisation: Jev (TypeSafe AI) vs Claude Haiku 4.5.
 *
 * Both models get the same expense, the same category list and the same
 * descriptions, and both are constrained to return one label from that list.
 * We record the label, the latency, and the tokens each one reports, then
 * score every answer against the dataset's expected label.
 *
 * Run:  pnpm demo:categorize [--check] [--limit N] [--only jev|claude]
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { z } from 'zod';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Published list prices, 2026-09-20. Output tokens are free on Jev. */
const PRICE_PER_MTOK = {
  jev: { input: 0.042, output: 0 },
  claude: { input: 1.0, output: 5.0 },
} as const;

const CLAUDE_MODEL = 'claude-haiku-4-5';
const REQUEST_TIMEOUT_MS = 20_000;
const QUESTION = 'Which budget category does this expense belong to?';

type Expense = {
  readonly id: number;
  readonly payee: string;
  readonly note: string;
  readonly amount: string;
  readonly expected: string;
};

type Attempt = {
  readonly label: string | null;
  readonly confidence: number | null;
  readonly ms: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly error: string | null;
};

type Row = { readonly expense: Expense; readonly jev: Attempt | null; readonly claude: Attempt | null };

type Options = { readonly check: boolean; readonly limit: number; readonly arms: readonly string[] };

function parseArgs(argv: readonly string[]): Options {
  const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : undefined;
  if (only !== undefined && only !== 'jev' && only !== 'claude') {
    throw new Error(`--only takes "jev" or "claude", got "${only}"`);
  }
  const limitArg = argv.includes('--limit') ? argv[argv.indexOf('--limit') + 1] : undefined;
  const limit = limitArg === undefined ? Number.MAX_SAFE_INTEGER : Number.parseInt(limitArg, 10);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit takes a positive integer, got "${limitArg}"`);
  return { check: argv.includes('--check'), limit, arms: only === undefined ? ['jev', 'claude'] : [only] };
}

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(HERE, name), 'utf8'));
}

function loadDataset(): { expenses: readonly Expense[]; criteria: Readonly<Record<string, string>> } {
  const criteria = readJson('categories.json') as Record<string, string>;
  const expenses = readJson('expenses.json') as Expense[];
  const labels = new Set(Object.keys(criteria));
  const ids = new Set<number>();
  for (const expense of expenses) {
    if (!labels.has(expense.expected)) throw new Error(`expense ${expense.id}: unknown label "${expense.expected}"`);
    if (ids.has(expense.id)) throw new Error(`duplicate expense id ${expense.id}`);
    ids.add(expense.id);
  }
  return { expenses, criteria };
}

/** The only thing either model is told about an expense. */
function stateOf(expense: Expense): Record<string, string> {
  return { payee: expense.payee, note: expense.note, amount: expense.amount };
}

async function askJev(
  client: TypeSafeClient,
  expense: Expense,
  criteria: Readonly<Record<string, string>>,
): Promise<Attempt> {
  const started = performance.now();
  try {
    const response = await client.systemOne({
      state: stateOf(expense),
      questions: { category: choice(QUESTION, criteria) },
    });
    const answer = response.answers.category;
    return {
      label: answer.choice,
      confidence: answer.confidence,
      ms: performance.now() - started,
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      error: null,
    };
  } catch (error) {
    return failed(error, performance.now() - started);
  }
}

async function askClaude(client: Anthropic, expense: Expense, criteria: Readonly<Record<string, string>>): Promise<Attempt> {
  const labels = Object.keys(criteria) as [string, ...string[]];
  const started = performance.now();
  try {
    const response = await client.messages.parse({
      model: CLAUDE_MODEL,
      max_tokens: 256,
      system: `${QUESTION}\n\nCategories:\n${labels.map((l) => `- ${l}: ${criteria[l]}`).join('\n')}`,
      messages: [{ role: 'user', content: JSON.stringify(stateOf(expense)) }],
      output_config: { format: zodOutputFormat(z.object({ category: z.enum(labels) })) },
    });
    return {
      label: response.parsed_output?.category ?? null,
      confidence: null,
      ms: performance.now() - started,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      error: response.parsed_output === null ? 'no parsed output' : null,
    };
  } catch (error) {
    return failed(error, performance.now() - started);
  }
}

function failed(error: unknown, ms: number): Attempt {
  return {
    label: null,
    confidence: null,
    ms,
    inputTokens: 0,
    outputTokens: 0,
    error: error instanceof Error ? error.message : String(error),
  };
}

function pad(text: string, width: number): string {
  const trimmed = [...text].slice(0, width).join('');
  return trimmed + ' '.repeat(Math.max(0, width - [...trimmed].length));
}

function cell(attempt: Attempt | null, expected: string): string {
  if (attempt === null) return pad('-', 22);
  if (attempt.error !== null) return pad(`error: ${attempt.error}`, 22);
  const mark = attempt.label === expected ? '✓' : '✗';
  return pad(`${attempt.label} ${mark} ${(attempt.ms / 1000).toFixed(2)}s`, 22);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0;
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

type Summary = {
  readonly name: string;
  readonly model: string;
  readonly correct: number;
  readonly total: number;
  readonly medianMs: number;
  readonly slowestMs: number;
  readonly costPerThousand: number;
};

function summarise(name: 'jev' | 'claude', model: string, rows: readonly Row[]): Summary {
  const attempts = rows.map((row) => (name === 'jev' ? row.jev : row.claude)).filter((a): a is Attempt => a !== null);
  const price = PRICE_PER_MTOK[name];
  const cost = attempts.reduce(
    (total, a) => total + (a.inputTokens * price.input + a.outputTokens * price.output) / 1_000_000,
    0,
  );
  const latencies = attempts.map((a) => a.ms);
  return {
    name,
    model,
    correct: rows.filter((row) => (name === 'jev' ? row.jev : row.claude)?.label === row.expense.expected).length,
    total: attempts.length,
    medianMs: median(latencies),
    slowestMs: Math.max(0, ...latencies),
    costPerThousand: attempts.length === 0 ? 0 : (cost / attempts.length) * 1000,
  };
}

function summaryTable(summaries: readonly Summary[]): string {
  const header = `| model | accuracy | median | slowest | cost / 1,000 expenses |\n| --- | --- | --- | --- | --- |`;
  const lines = summaries.map((s) => {
    const accuracy = s.total === 0 ? '-' : `${s.correct}/${s.total} (${((s.correct / s.total) * 100).toFixed(1)}%)`;
    return `| \`${s.model}\` | ${accuracy} | ${(s.medianMs / 1000).toFixed(2)}s | ${(s.slowestMs / 1000).toFixed(2)}s | $${s.costPerThousand.toFixed(4)} |`;
  });
  return [header, ...lines].join('\n');
}

function disagreements(rows: readonly Row[]): string {
  const interesting = rows.filter(
    (row) => row.jev?.label !== row.claude?.label || row.jev?.label !== row.expense.expected,
  );
  if (interesting.length === 0) return '_Both models matched the dataset on every expense._';
  const header = `| # | expense | expected | jev | claude |\n| --- | --- | --- | --- | --- |`;
  const lines = interesting.map(
    (row) =>
      `| ${row.expense.id} | ${row.expense.payee} — ${row.expense.note} | ${row.expense.expected} | ${row.jev?.label ?? '-'} | ${row.claude?.label ?? '-'} |`,
  );
  return [header, ...lines].join('\n');
}

function writeResults(rows: readonly Row[], summaries: readonly Summary[]): string {
  const path = join(HERE, 'results.md');
  const body = [
    '# Expense categorisation: Jev vs Claude Haiku 4.5',
    '',
    `Run on ${new Date().toISOString().slice(0, 10)} over ${rows.length} expenses (English and Arabic), same prompt and same category list for both.`,
    '',
    summaryTable(summaries),
    '',
    `Prices used: Jev $${PRICE_PER_MTOK.jev.input}/M input tokens (output free), Claude Haiku 4.5 $${PRICE_PER_MTOK.claude.input}/M input and $${PRICE_PER_MTOK.claude.output}/M output.`,
    '',
    '## Where they differed',
    '',
    disagreements(rows),
    '',
  ].join('\n');
  writeFileSync(path, body);
  return path;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { expenses, criteria } = loadDataset();
  const selected = expenses.slice(0, options.limit);
  const jevKey = process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY;
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const wantJev = options.arms.includes('jev');
  const wantClaude = options.arms.includes('claude');

  console.log(`${expenses.length} expenses, ${Object.keys(criteria).length} categories, dataset valid.`);
  console.log(`JEV_API_KEY: ${jevKey === undefined ? 'MISSING' : 'found'}`);
  console.log(`ANTHROPIC_API_KEY: ${claudeKey === undefined ? 'MISSING' : 'found'}`);
  if (options.check) {
    console.log('\n--check only: no requests sent.');
    return;
  }
  if (wantJev && jevKey === undefined) throw new Error('JEV_API_KEY is not set (put it in .env.local)');
  if (wantClaude && claudeKey === undefined) throw new Error('ANTHROPIC_API_KEY is not set (put it in .env.local)');

  const jevClient = new TypeSafeClient({ apiKey: jevKey ?? '', timeout: REQUEST_TIMEOUT_MS });
  const claudeClient = new Anthropic({ apiKey: claudeKey ?? '', timeout: REQUEST_TIMEOUT_MS });

  console.log(`\n ${pad('#', 3)}${pad('expense', 40)}${pad('expected', 15)}${pad('jev', 22)}claude`);
  const rows: Row[] = [];
  for (const expense of selected) {
    const jev = wantJev ? await askJev(jevClient, expense, criteria) : null;
    const claude = wantClaude ? await askClaude(claudeClient, expense, criteria) : null;
    rows.push({ expense, jev, claude });
    const label = `${expense.payee} — ${expense.note}`;
    console.log(
      ` ${pad(String(expense.id), 3)}${pad(label, 40)}${pad(expense.expected, 15)}${cell(jev, expense.expected)}${cell(claude, expense.expected)}`,
    );
  }

  const summaries = [
    ...(wantJev ? [summarise('jev', 'jev-latest', rows)] : []),
    ...(wantClaude ? [summarise('claude', CLAUDE_MODEL, rows)] : []),
  ];
  console.log(`\n${summaryTable(summaries)}`);
  console.log(`\nWrote ${writeResults(rows, summaries)}`);
}

await main();
