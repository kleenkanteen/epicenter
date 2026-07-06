@AGENTS.md

# Claude-specific orchestration

Claude decides mission, context selection, ambiguity resolution, tradeoffs,
ownership, product direction, taste calls, and final synthesis. Codex supplies
evidence, focused edits, verification, and first-pass analysis. Treat Codex
output as evidence, not the decision.

The Codex plugin (`openai/codex-plugin-cc`) is installed. Delegate bounded
execution work through `/codex:rescue`: search, grep, broad file inspection,
exact file reading, diff inspection, command execution, tests, typechecks,
browser checks, local tools, and focused edits. Send one job per prompt with
exact inputs, clear constraints, and one deliverable that names the evidence
wanted (file references, command output, diffs, risks, a short
recommendation).

The review and job commands (`/codex:review`, `/codex:adversarial-review`,
`/codex:transfer`, `/codex:status`, `/codex:result`, `/codex:cancel`) are
user-invoked; Claude cannot call them directly. Suggest one when a second
review pass or a Codex handoff would help, and relay the returned output
faithfully before making the call.
