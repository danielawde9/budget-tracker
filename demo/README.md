# Demo: expense categorisation, a decision model vs general-purpose LLMs

A side-by-side comparison for a screen recording. Every model reads the same expense
(payee, note, amount), gets the same ten categories with the same descriptions, and must
answer with one of those labels. The script scores every answer against `expenses.json`
and reports accuracy, latency and cost per 1,000 expenses.

Arms (each one runs only if its key is in `.env.local`):

| arm | model | key |
| --- | --- | --- |
| `jev` | `jev-latest` (TypeSafe AI) | `JEV_API_KEY` |
| `deepseek` | `deepseek-flash` | `DEEPSEEK_API_KEY` |
| `claude` | `claude-haiku-4-5` | `ANTHROPIC_API_KEY` |

**What this demo claims:** moving one small decision out of a general-purpose LLM and onto
a decision model changes cost and latency by a large factor, at a measured accuracy.
**What it does not claim:** it does not reduce Claude Code's token usage. Jev is not
connected to Claude Code, and nothing here changes what your coding agent sends.

## Setup (off camera)

1. Keys go in `.env.local` at the repo root. Git ignores it. Keep it off screen.

   ```
   JEV_API_KEY=...
   DEEPSEEK_API_KEY=...
   ANTHROPIC_API_KEY=...
   ```

   Claude is optional. A Claude subscription does not cover direct API calls, so that arm
   needs a key from console.anthropic.com; without it the script just runs the other arms.

2. Node 24 or newer (the script is TypeScript, run directly by Node). `node -v` to check.

3. Confirm the keys load and the dataset is valid. This sends no requests:

   ```bash
   pnpm demo:categorize --check
   ```

4. Rehearse with a few rows, to be sure every arm answers:

   ```bash
   pnpm demo:categorize --limit 5
   ```

   `--only jev,deepseek` restricts the arms; `--limit N` restricts the rows.

## Recording

The full run is 60 expenses and takes a few minutes. For the video, record 20 rows and
show the full table from a run you did beforehand.

```bash
pnpm demo:categorize --limit 20
```

Shot list, about 60–90 seconds:

1. **The app** (10 s) — open the add-expense screen, point at the payee and note fields.
   These are the only two things any model gets. The app itself is unchanged.
2. **The data** (5 s) — `demo/expenses.json`: 60 real-shaped expenses, half English, half
   Arabic, each with the category it should get.
3. **The run** (40 s) — the command above. Each row prints the expense, then each model's
   answer with ✓ or ✗ and how long it took.
4. **The table** (10 s) — accuracy, median latency and cost per 1,000 expenses per model.
5. **The code** (5 s) — `demo/categorize.ts`, the three `…Arm` functions, about 25 lines each.

After the run, `demo/results.md` holds the table and every expense any model got wrong.
That file is the raw material for the post.

## Before you publish the numbers

- **Prices are hard-coded** in `categorize.ts`, correct on 2026-09-20: Jev $0.042/M input
  with free output; DeepSeek `deepseek-flash` $0.15/M input on a cache miss, $0.003/M on a
  cache hit and $0.60/M output at off-peak rates, double that at peak; Claude Haiku 4.5
  $1/M input and $5/M output. Check they are still current before quoting a cost.
- **DeepSeek has two price windows.** Peak is 01:00–04:00 and 06:00–10:00 UTC on weekdays,
  and costs twice off-peak. The script picks the window from the clock when each request
  runs and names it in `results.md`. Run both arms in the same session or the comparison
  drifts. (The published rates also exclude Chinese public holidays; the script does not
  model those.)
- **DeepSeek reasons before it answers, and you pay for it.** `deepseek-flash` emits
  `reasoning_content` first; those tokens are billed as output and count against
  `max_tokens`. The cap is 512 here — at 64 the harder expenses were cut off mid-thought
  and returned nothing, which looked like wrong answers. If you lower it, check the run
  for `truncated` errors before trusting the accuracy column.
- **DeepSeek's cache makes later rows cheaper.** The shared system prompt is cached
  automatically after the first call, so cost per expense falls during a run and a repeat
  run starts cheaper. That is real production behaviour — just say which run you quoted.
- **The arms are not constrained identically.** Jev can only return a label; Claude is held
  to the label set by a schema; DeepSeek's JSON mode has no schema, so it is asked for a
  shape and validated afterwards — an invented label counts as a failure. That's a real
  platform difference, and worth one line in the post.
- **The cheap fast models are the fair comparison**, not a frontier model. TypeSafe's own
  "238× cheaper" figure compares against Claude Fable 5.1. Your gap will be smaller and
  will hold up when someone checks it.
- **The dataset is written for the demo**, not sampled from real spending. Say so.
- **One run is not a benchmark.** Run it two or three times: latency moves a lot, and a
  model that gets 57/60 once may get 55/60 next time.
- **Jev also returns a confidence** per answer, which the app could use to auto-apply a
  category above a threshold and ask the user below it. That is the actual product idea
  behind the demo, if you want a second post.
