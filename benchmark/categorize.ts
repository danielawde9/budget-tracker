/**
 * Expense categorisation: Jev (TypeSafe AI) vs general-purpose LLMs.
 *
 * Every arm gets the same expense, the same ten categories and the same
 * descriptions, and must answer with one label from that list. We record the
 * label, the latency and the cost each request actually incurred, then score
 * every answer against the dataset's expected label.
 *
 * Arms run only when their key is present in .env.local:
 *   JEV_API_KEY, ANTHROPIC_API_KEY, DEEPSEEK_API_KEY
 *
 * Run:  pnpm categorize [--check] [--limit N] [--only jev,deepseek]
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import OpenAI from 'openai';
import { TypeSafeClient, choice } from '@typesafe-ai/sdk';
import { z } from 'zod';
import { cascade, deepSeekRates, median, parseDeepSeekAnswer, tally, type CascadeEntry, type Tally } from './answer.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Published list prices per million tokens, read 2026-09-20. */
const CLAUDE_MODEL = 'claude-haiku-4-5';
const CLAUDE_PRICE = { input: 1.0, output: 5.0 } as const;
const JEV_INPUT_PRICE = 0.042; // output tokens are free on Jev
const DEEPSEEK_MODEL = 'deepseek-flash';
/** deepseek-flash reasons before it answers, and that reasoning is billed as
 *  output and counted against this cap. 64 truncated the harder expenses. */
const DEEPSEEK_MAX_TOKENS = 512;

const REQUEST_TIMEOUT_MS = 20_000;
const QUESTION = 'Which budget category does this expense belong to?';

type Expense = {
  readonly id: number;
  readonly payee: string;
  readonly note: string;
  readonly amount: string;
  readonly expected: string;
  /** "clean" for tidy entries, "messy" for bank-statement noise. */
  readonly tier: string;
};

type Attempt = {
  readonly label: string | null;
  readonly confidence: number | null;
  readonly ms: number;
  readonly cost: number;
  readonly error: string | null;
};

type Arm = {
  readonly name: string;
  readonly model: string;
  readonly classify: (expense: Expense) => Promise<Attempt>;
};

type Row = { readonly expense: Expense; readonly attempts: ReadonlyMap<string, Attempt> };

type Options = {
  readonly check: boolean;
  readonly limit: number;
  readonly only: readonly string[] | null;
  readonly tier: string | null;
};

function parseArgs(argv: readonly string[]): Options {
  const value = (flag: string): string | undefined =>
    argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
  const onlyArg = value('--only');
  const limitArg = value('--limit');
  const limit = limitArg === undefined ? Number.MAX_SAFE_INTEGER : Number.parseInt(limitArg, 10);
  if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit takes a positive integer, got "${limitArg}"`);
  return {
    check: argv.includes('--check'),
    limit,
    only: onlyArg === undefined ? null : onlyArg.split(',').map((name) => name.trim()),
    tier: value('--tier') ?? null,
  };
}

function loadDataset(): { expenses: readonly Expense[]; criteria: Readonly<Record<string, string>> } {
  const read = (name: string): unknown => JSON.parse(readFileSync(join(HERE, name), 'utf8'));
  const criteria = read('categories.json') as Record<string, string>;
  const expenses = read('expenses.json') as Expense[];
  const labels = new Set(Object.keys(criteria));
  const ids = new Set<number>();
  for (const expense of expenses) {
    if (!labels.has(expense.expected)) throw new Error(`expense ${expense.id}: unknown label "${expense.expected}"`);
    if (ids.has(expense.id)) throw new Error(`duplicate expense id ${expense.id}`);
    if (typeof expense.tier !== 'string' || expense.tier === '') throw new Error(`expense ${expense.id}: missing tier`);
    ids.add(expense.id);
  }
  return { expenses, criteria };
}

/** The only thing any model is told about an expense. */
function stateOf(expense: Expense): Record<string, string> {
  return { payee: expense.payee, note: expense.note, amount: expense.amount };
}

function categoryList(criteria: Readonly<Record<string, string>>): string {
  return Object.entries(criteria)
    .map(([label, description]) => `- ${label}: ${description}`)
    .join('\n');
}

function failed(error: unknown, ms: number): Attempt {
  return {
    label: null,
    confidence: null,
    ms,
    cost: 0,
    error: error instanceof Error ? error.message : String(error),
  };
}

function jevArm(apiKey: string, criteria: Readonly<Record<string, string>>): Arm {
  const client = new TypeSafeClient({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  return {
    name: 'jev',
    model: 'jev-latest',
    classify: async (expense) => {
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
          cost: ((response.usage?.input_tokens ?? 0) * JEV_INPUT_PRICE) / 1_000_000,
          error: null,
        };
      } catch (error) {
        return failed(error, performance.now() - started);
      }
    },
  };
}

function claudeArm(apiKey: string, criteria: Readonly<Record<string, string>>): Arm {
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  const labels = Object.keys(criteria) as [string, ...string[]];
  const system = `${QUESTION}\n\nCategories:\n${categoryList(criteria)}`;
  return {
    name: 'claude',
    model: CLAUDE_MODEL,
    classify: async (expense) => {
      const started = performance.now();
      try {
        const response = await client.messages.parse({
          model: CLAUDE_MODEL,
          max_tokens: 256,
          system,
          messages: [{ role: 'user', content: JSON.stringify(stateOf(expense)) }],
          output_config: { format: zodOutputFormat(z.object({ category: z.enum(labels) })) },
        });
        const cost =
          (response.usage.input_tokens * CLAUDE_PRICE.input + response.usage.output_tokens * CLAUDE_PRICE.output) /
          1_000_000;
        return {
          label: response.parsed_output?.category ?? null,
          confidence: null,
          ms: performance.now() - started,
          cost,
          error: response.parsed_output === null ? 'no parsed output' : null,
        };
      } catch (error) {
        return failed(error, performance.now() - started);
      }
    },
  };
}

function deepSeekArm(apiKey: string, criteria: Readonly<Record<string, string>>): Arm {
  const client = new OpenAI({ apiKey, baseURL: 'https://api.deepseek.com', timeout: REQUEST_TIMEOUT_MS });
  const labels = new Set(Object.keys(criteria));
  // DeepSeek's JSON mode has no schema, so the prompt must show the shape and
  // the answer is validated here instead of by the API.
  const system = `${QUESTION}\n\nCategories:\n${categoryList(criteria)}\n\nAnswer with json in exactly this shape, using one label from the list above:\n{"category": "groceries"}`;
  return {
    name: 'deepseek',
    model: DEEPSEEK_MODEL,
    classify: async (expense) => {
      const started = performance.now();
      try {
        const completion = await client.chat.completions.create({
          model: DEEPSEEK_MODEL,
          max_tokens: DEEPSEEK_MAX_TOKENS,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: JSON.stringify(stateOf(expense)) },
          ],
          response_format: { type: 'json_object' },
        });
        const ms = performance.now() - started;
        // Cache fields are DeepSeek extensions, absent from the OpenAI types.
        const usage = completion.usage as
          | (OpenAI.CompletionUsage & { prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number })
          | undefined;
        const rates = deepSeekRates(new Date());
        const hit = usage?.prompt_cache_hit_tokens ?? 0;
        const miss = usage?.prompt_cache_miss_tokens ?? usage?.prompt_tokens ?? 0;
        const cost = (hit * rates.hit + miss * rates.miss + (usage?.completion_tokens ?? 0) * rates.output) / 1_000_000;
        const answer = parseDeepSeekAnswer(
          completion.choices[0]?.message?.content,
          completion.choices[0]?.finish_reason,
          labels,
        );
        return { label: answer.label, confidence: null, ms, cost, error: answer.error };
      } catch (error) {
        return failed(error, performance.now() - started);
      }
    },
  };
}

function buildArms(criteria: Readonly<Record<string, string>>, only: readonly string[] | null): readonly Arm[] {
  const keys = {
    jev: process.env.JEV_API_KEY ?? process.env.TYPESAFE_API_KEY,
    claude: process.env.ANTHROPIC_API_KEY,
    deepseek: process.env.DEEPSEEK_API_KEY,
  };
  const builders: Record<string, (key: string) => Arm> = {
    jev: (key) => jevArm(key, criteria),
    claude: (key) => claudeArm(key, criteria),
    deepseek: (key) => deepSeekArm(key, criteria),
  };
  const wanted = only ?? Object.keys(builders);
  const arms: Arm[] = [];
  for (const name of wanted) {
    const build = builders[name];
    if (build === undefined) throw new Error(`unknown arm "${name}" (jev, claude, deepseek)`);
    const key = keys[name as keyof typeof keys];
    if (key === undefined) {
      if (only !== null) throw new Error(`${name.toUpperCase()}_API_KEY is not set (put it in .env.local)`);
      continue;
    }
    arms.push(build(key));
  }
  if (arms.length === 0) throw new Error('no API keys found in .env.local');
  return arms;
}

/** Pads to `width` characters, always leaving one space before the next column. */
function pad(text: string, width: number): string {
  const trimmed = [...text].slice(0, width - 1).join('');
  return trimmed + ' '.repeat(Math.max(1, width - [...trimmed].length));
}

function cell(attempt: Attempt | undefined, expected: string): string {
  if (attempt === undefined) return pad('-', 22);
  if (attempt.error !== null) return pad('error', 22);
  return pad(`${attempt.label} ${attempt.label === expected ? '✓' : '✗'} ${(attempt.ms / 1000).toFixed(2)}s`, 22);
}

type Summary = {
  readonly model: string;
  readonly all: Tally;
  readonly byTier: ReadonlyMap<string, Tally>;
  readonly medianMs: number;
  readonly slowestMs: number;
  readonly costPerThousand: number;
};

function summarise(arm: Arm, rows: readonly Row[]): Summary {
  const attempts = rows.map((row) => row.attempts.get(arm.name)).filter((a): a is Attempt => a !== undefined);
  const latencies = attempts.map((a) => a.ms);
  const cost = attempts.reduce((total, a) => total + a.cost, 0);
  const scored = rows.map((row) => ({
    tier: row.expense.tier,
    expected: row.expense.expected,
    label: row.attempts.get(arm.name)?.label ?? null,
  }));
  const counted = tally(scored);
  return {
    model: arm.model,
    all: counted.all,
    byTier: counted.byTier,
    medianMs: median(latencies),
    slowestMs: Math.max(0, ...latencies),
    costPerThousand: attempts.length === 0 ? 0 : (cost / attempts.length) * 1000,
  };
}

function accuracy(counted: Tally | undefined): string {
  if (counted === undefined || counted.total === 0) return '-';
  return `${counted.correct}/${counted.total} (${((counted.correct / counted.total) * 100).toFixed(0)}%)`;
}

type Table = { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[] };

/** One accuracy column per tier; an overall column only when there is more than one. */
function summaryCells(summaries: readonly Summary[], tiers: readonly string[]): Table {
  const withOverall = tiers.length > 1;
  return {
    headers: ['model', ...(withOverall ? ['overall'] : []), ...tiers, 'median', 'slowest', 'cost / 1,000'],
    rows: summaries.map((s) => [
      s.model,
      ...(withOverall ? [accuracy(s.all)] : []),
      ...tiers.map((tier) => accuracy(s.byTier.get(tier))),
      `${(s.medianMs / 1000).toFixed(2)}s`,
      `${(s.slowestMs / 1000).toFixed(2)}s`,
      `$${s.costPerThousand.toFixed(4)}`,
    ]),
  };
}

/** Aligned columns for the terminal; markdown pipes are for the file, not the screen. */
function consoleTable(table: Table): string {
  const widths = table.headers.map((header, column) =>
    Math.max([...header].length, ...table.rows.map((row) => [...(row[column] ?? '')].length)),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => pad(cell, (widths[column] ?? 0) + 3))
      .join('')
      .trimEnd();
  return [line(table.headers), ...table.rows.map(line)].join('\n');
}

function markdownTable(table: Table): string {
  return [
    `| ${table.headers.join(' | ')} |`,
    `| ${table.headers.map(() => '---').join(' | ')} |`,
    ...table.rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function disagreements(rows: readonly Row[], arms: readonly Arm[]): string {
  const interesting = rows.filter((row) => arms.some((arm) => row.attempts.get(arm.name)?.label !== row.expense.expected));
  if (interesting.length === 0) return '_Every model matched the dataset on every expense._';
  const header = `| # | expense | expected | ${arms.map((a) => a.name).join(' | ')} |`;
  const divider = `| --- | --- | --- | ${arms.map(() => '---').join(' | ')} |`;
  const lines = interesting.map((row) => {
    const cells = arms.map((arm) => {
      const attempt = row.attempts.get(arm.name);
      if (attempt === undefined) return '-';
      const label = attempt.label ?? `error: ${attempt.error ?? 'unknown'}`;
      // A confidence next to a wrong answer is the interesting part: it says
      // whether the model knew it was guessing.
      return attempt.confidence === null ? label : `${label} (${(attempt.confidence * 100).toFixed(0)}%)`;
    });
    return `| ${row.expense.id} | ${row.expense.payee} — ${row.expense.note} | ${row.expense.expected} | ${cells.join(' | ')} |`;
  });
  return [header, divider, ...lines].join('\n');
}

/** Ask the fallback model whenever the decision model is less sure than this. */
const CASCADE_THRESHOLD = 0.7;

function cascadeEntries(rows: readonly Row[], primary: Arm, fallback: Arm): readonly (CascadeEntry & { tier: string })[] {
  return rows.map((row) => {
    const first = row.attempts.get(primary.name);
    const second = row.attempts.get(fallback.name);
    return {
      tier: row.expense.tier,
      expected: row.expense.expected,
      primaryLabel: first?.label ?? null,
      primaryConfidence: first?.confidence ?? null,
      primaryCost: first?.cost ?? 0,
      primaryMs: first?.ms ?? 0,
      fallbackLabel: second?.label ?? null,
      fallbackCost: second?.cost ?? 0,
      fallbackMs: second?.ms ?? 0,
    };
  });
}

/** A blended arm, scored from answers both models already gave in this run. */
function cascadeSummary(rows: readonly Row[], primary: Arm, fallback: Arm): { summary: Summary; routed: number } {
  const entries = cascadeEntries(rows, primary, fallback);
  const overall = cascade(entries, CASCADE_THRESHOLD);
  const byTier = new Map<string, Tally>();
  for (const tier of tiersOf(rows)) {
    const scoped = cascade(entries.filter((entry) => entry.tier === tier), CASCADE_THRESHOLD);
    byTier.set(tier, { correct: scoped.correct, total: scoped.total });
  }
  return {
    routed: overall.routed,
    summary: {
      model: `${primary.model} → ${fallback.model} under ${CASCADE_THRESHOLD * 100}%`,
      all: { correct: overall.correct, total: overall.total },
      byTier,
      medianMs: median(overall.latencies),
      slowestMs: Math.max(0, ...overall.latencies),
      costPerThousand: overall.total === 0 ? 0 : (overall.cost / overall.total) * 1000,
    },
  };
}

function tiersOf(rows: readonly Row[]): readonly string[] {
  return [...new Set(rows.map((row) => row.expense.tier))];
}

function writeResults(rows: readonly Row[], arms: readonly Arm[], summaries: readonly Summary[]): string {
  const path = join(HERE, 'results.md');
  const rates = deepSeekRates(new Date());
  const body = [
    '# Expense categorisation: a decision model vs general-purpose LLMs',
    '',
    `Run on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC over ${rows.length} expenses (English and Arabic).`,
    'Same expense, same ten categories, same descriptions for every model.',
    '`clean` rows are tidy entries; `messy` rows are bank-statement noise: abbreviated merchants,',
    'POS codes, transliterated Arabic, French, and empty notes.',
    '',
    markdownTable(summaryCells(summaries, tiersOf(rows))),
    '',
    '## Prices used',
    '',
    `- Jev: $${JEV_INPUT_PRICE}/M input tokens, output free.`,
    `- Claude Haiku 4.5: $${CLAUDE_PRICE.input}/M input, $${CLAUDE_PRICE.output}/M output.`,
    `- DeepSeek ${DEEPSEEK_MODEL} (${rates.window} rates): $${rates.miss}/M input on a cache miss, $${rates.hit}/M on a cache hit, $${rates.output}/M output.`,
    '',
    '## Where they differed',
    '',
    disagreements(rows, arms),
    '',
  ].join('\n');
  writeFileSync(path, body);
  return path;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const { expenses, criteria } = loadDataset();
  console.log(`${expenses.length} expenses, ${Object.keys(criteria).length} categories, dataset valid.`);
  for (const [name, variable] of [
    ['jev', 'JEV_API_KEY'],
    ['claude', 'ANTHROPIC_API_KEY'],
    ['deepseek', 'DEEPSEEK_API_KEY'],
  ] as const) {
    console.log(`  ${pad(name, 9)} ${variable}: ${process.env[variable] === undefined ? 'MISSING' : 'found'}`);
  }
  if (options.check) {
    buildArms(criteria, options.only);
    console.log('\n--check only: no requests sent.');
    return;
  }

  const arms = buildArms(criteria, options.only);
  const inTier = options.tier === null ? expenses : expenses.filter((expense) => expense.tier === options.tier);
  if (inTier.length === 0) throw new Error(`no expenses in tier "${options.tier}"`);
  const selected = inTier.slice(0, options.limit);
  const errors: string[] = [];
  console.log(`\n ${pad('#', 3)}${pad('expense', 30)}${pad('expected', 14)}${arms.map((a) => pad(a.name, 22)).join('')}`);

  const rows: Row[] = [];
  for (const expense of selected) {
    const attempts = new Map<string, Attempt>();
    for (const arm of arms) {
      const attempt = await arm.classify(expense);
      attempts.set(arm.name, attempt);
      if (attempt.error !== null) errors.push(`#${expense.id} ${arm.name}: ${attempt.error}`);
    }
    rows.push({ expense, attempts });
    const label = `${expense.payee} — ${expense.note}`;
    const cells = arms.map((arm) => cell(attempts.get(arm.name), expense.expected)).join('');
    console.log(` ${pad(String(expense.id), 3)}${pad(label, 30)}${pad(expense.expected, 14)}${cells}`);
  }

  const summaries = arms.map((arm) => summarise(arm, rows));
  // With a decision model and at least one LLM in the run, the blend is free to
  // compute: both answers already exist for every row.
  const primary = arms.find((arm) => arm.name === 'jev');
  const fallback = arms.find((arm) => arm.name !== 'jev');
  const blended = primary !== undefined && fallback !== undefined ? cascadeSummary(rows, primary, fallback) : null;
  const all = blended === null ? summaries : [...summaries, blended.summary];
  console.log(`\n${consoleTable(summaryCells(all, tiersOf(rows)))}`);
  if (blended !== null) {
    console.log(`\n${blended.routed} of ${rows.length} expenses fell below ${CASCADE_THRESHOLD * 100}% confidence and were sent to ${fallback?.model}.`);
  }
  if (errors.length > 0) console.log(`\n${errors.length} failed request(s):\n${errors.slice(0, 10).join('\n')}`);
  console.log(`\nWrote ${writeResults(rows, arms, all)}`);
}

await main();
