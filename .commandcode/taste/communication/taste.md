# Communication preferences

- Repeatedly asks "what's left / what do we have left in summary" — wants short, concrete status summaries of finished vs. remaining work at checkpoints. Confidence: 0.8
- Writes terse, informal messages with typos and minimal punctuation and expects intent to be inferred rather than asked back for clarification — sometimes as little as a single word (e.g. "check") or a bare file path (e.g. pasting a plan file path with no instruction, meaning "write this plan") that should be interpreted broadly. Confidence: 0.85
- Occasionally asks for a plain-language explanation of a feature before committing to it ("first explain simply this feature"). Confidence: 0.6
- Wants rigorously honest status reporting: never label a partially-run, timed-out, or failed suite as green, and don't infer success (e.g. "everything is pushed") from an indirect signal like a migration ledger. Confidence: 0.85
- Wants reports to distinguish levels of proof explicitly — e.g. Git push vs. deployment vs. authenticated browser verification — rather than conflating them. Confidence: 0.75
- Asks for plain, jargon-free communication ("talk simple" / "simple talk") — wants summaries and explanations in simple everyday language rather than dense technical prose. Confidence: 0.75
- Dislikes cryptic shorthand and symbol notation in explanations (e.g. slash separators like "v2/v3" or "slice 2/3/4") — wants things spelled out rather than compressed into abbreviations the reader must decode. Confidence: 0.7
- Prefers final reports structured as exhaustive enumerations (every branch/worktree and its outcome, exact SHAs, pass/fail counts) with a clear separation of release blockers vs. future backlog. Confidence: 0.7
- For high-stakes handoffs, writes long, prescriptive briefs — explicit ordered steps, forbidden operations, stop conditions, and the exact required contents of the final report — and expects them followed precisely. Confidence: 0.55
