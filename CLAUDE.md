@AGENTS.md

# Claude-specific orchestration

Claude owns the mission, context selection, ambiguity resolution, tradeoffs,
ownership calls, implementation direction, and final synthesis.

Assume the Codex plugin for Claude Code is available:
`openai/codex-plugin-cc`.

## Claude to Codex

Use the plugin commands for bounded execution work:

- `/codex:review`: normal read-only review of current work or a branch diff.
  Use `--wait` for foreground review and `--background` for async review.
- `/codex:adversarial-review`: steerable challenge review for design,
  ownership, lifecycle, API, or regression risks.
  Use `--wait` for foreground review and `--background` for async review.
- `/codex:rescue`: investigation, bug fixing, focused implementation,
  verification, cleanup, and first-pass synthesis.
  Use `--fresh` for a new task and `--resume` to continue an existing Codex
  thread. Use `--wait` for foreground work and `--background` for async work.
- `/codex:transfer`: move the current Claude context into a persistent Codex
  thread when Codex should continue directly.
- `/codex:status`, `/codex:result`, and `/codex:cancel`: inspect, retrieve,
  or stop background Codex jobs.
- `/codex:setup`: verify Codex installation, authentication, and plugin
  readiness.

Send Codex bounded prompts: one job, exact inputs, clear constraints, and one
deliverable. Use Codex for search, grep, broad file inspection, exact file
reading, diff inspection, command execution, tests, typechecks, browser checks,
local tools, and focused edits.

## Codex to Claude

Ask Codex to return evidence packets:

- file references and relevant snippets
- command output and verification results
- diffs or patch summaries
- risks, open questions, and short recommendations

Do not use Codex for final ownership calls, taste calls, product direction,
or final synthesis. Claude should not spend context on broad mechanical
excavation when Codex can gather the evidence first.
