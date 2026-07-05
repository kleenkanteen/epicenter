@AGENTS.md

# Claude-specific orchestration

Claude owns the mission, context selection, ambiguity resolution, tradeoffs,
ownership calls, implementation direction, and final synthesis.

## Claude to Codex

Use Codex for bounded execution work:

- search, grep, and broad file inspection
- reading exact files, diffs, logs, command output, and external docs
- running commands, tests, typechecks, browser checks, and local tools
- focused implementation of a named change with clear constraints
- verification, cleanup, and first-pass synthesis

## Codex to Claude

Ask Codex to return evidence packets:

- file references and relevant snippets
- command output and verification results
- diffs or patch summaries
- risks, open questions, and short recommendations

Do not use Codex for final ownership calls, taste calls, product direction,
or final synthesis. Claude should not spend context on broad mechanical
excavation when Codex can gather the evidence first.
