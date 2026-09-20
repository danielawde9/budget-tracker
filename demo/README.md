# Demo: expense categorisation, Jev vs Claude Haiku 4.5

A side-by-side comparison for a screen recording. Both models read the same expense
(payee, note, amount), get the same ten categories with the same descriptions, and must
answer with one of those labels. The script scores every answer against
`expenses.json`, and reports accuracy, latency and cost per 1,000 expenses.

**What this demo claims:** moving one small decision out of a general-purpose LLM and onto
a decision model changes cost and latency by a large factor, at a measured accuracy.
**What it does not claim:** it does not reduce Claude Code's token usage. Jev is not
connected to Claude Code, and nothing here changes what your coding agent sends.

## Setup (off camera)

1. Both keys go in `.env.local` at the repo root. Git ignores it. Keep it off screen.

   ```
   JEV_API_KEY=...
   ANTHROPIC_API_KEY=...
   ```

   `JEV_API_KEY` is from console.typesafe.ai. `ANTHROPIC_API_KEY` is from
   console.anthropic.com — a Claude subscription does not cover direct API calls.

2. Node 24 or newer (the script is TypeScript, run directly by Node). `node -v` to check.

3. Confirm both keys load and the dataset is valid. This sends no requests:

   ```bash
   pnpm demo:categorize --check
   ```

4. Rehearse once with a few rows, to be sure both halves answer:

   ```bash
   pnpm demo:categorize --limit 5
   ```

## Recording

Full run is 60 expenses and takes a couple of minutes. For the video, record 20 rows and
show the full table from a run you did beforehand.

```bash
pnpm demo:categorize --limit 20
```

Shot list, about 60–90 seconds:

1. **The app** (10 s) — open the add-expense screen, point at the payee and note fields.
   These are the only two things either model gets. The app itself is unchanged.
2. **The data** (5 s) — `demo/expenses.json`: 60 real-shaped expenses, half English, half
   Arabic, each with the category it should get.
3. **The run** (40 s) — the command above. Each row prints the expense, then each model's
   answer with ✓ or ✗ and how long it took.
4. **The table** (10 s) — accuracy, median latency and cost per 1,000 expenses per model.
5. **The code** (5 s) — `demo/categorize.ts`, the two `ask…` functions, about 20 lines each.

After the run, `demo/results.md` holds the table and every expense where the two models
disagreed. That file is the raw material for the post.

## Before you publish the numbers

- **Prices are hard-coded** in `categorize.ts` (`PRICE_PER_MTOK`), correct on 2026-09-20:
  Jev $0.042/M input with free output, Claude Haiku 4.5 $1/M input and $5/M output. Check
  they are still current before quoting a cost.
- **Haiku 4.5 is the fair comparison**, not Claude's most expensive model. TypeSafe's own
  "238× cheaper" figure compares against Fable 5.1. Your gap will be smaller and will hold
  up when someone checks it.
- **The dataset is written for the demo**, not sampled from real spending. Say so.
- **One run is not a benchmark.** Run it two or three times: latency moves a lot, and a
  model that gets 57/60 once may get 55/60 next time.
- **Jev also returns a confidence** per answer, which the app could use to auto-apply a
  category above a threshold and ask the user below it. That is the actual product idea
  behind the demo, if you want a second post.
