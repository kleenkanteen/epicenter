---
name: handoff
description: 'Draft a compact, cold-start prompt to paste into Claude Code, with Claude as orchestrator and the Codex plugin available through /codex:rescue for bounded evidence, commands, verification, and focused edits. Use when the user says "hand this off", "wrap up for the next session", "resume this later", "continue in a new chat", "write a continuation prompt", "make a prompt I can copy-paste", "create a delegation brief", "prompt for an orchestrator", or invokes /handoff. Not for /goal lines (use agent-goal) or prompts that ship inside product code.'
argument-hint: "What should the next agent accomplish?"
metadata:
  author: epicenter
  version: '4.2'
---

# Claude Code Handoff

Write one copy-paste prompt for Claude Code. It must be cold-start: Claude Code can continue the work without this thread and can use the Codex plugin for bounded execution work.

Return only the prompt. Do not launch, supervise, or automate the recipient.

## Operating Model

State this as fact, not a choice:

- Address the prompt to Claude Code as the continuing agent.
- Claude owns orchestration: mission, context selection, ambiguity, tradeoffs, ownership calls, implementation direction, taste calls, and final synthesis.
- The Codex plugin supports bounded execution through `/codex:rescue`: search, grep, broad file inspection, exact file reading, diff inspection, command execution, tests, typechecks, browser checks, local tools, focused edits, verification, cleanup, and first-pass analysis.
- Codex returns evidence packets: file references, command output, diffs, risks, short summaries, and recommendations. Claude consumes the evidence, makes the calls, and writes the final answer.

Use Codex for mechanical excavation and focused execution. Keep judgment, ownership, product direction, and final synthesis with Claude.

## Required Content

Include only live context. A small handoff should fit in 12 to 20 lines; a large continuation may need short sections.

Cover:

1. Mission: one outcome and the exact artifact wanted.
2. State: branch, dirty versus committed work, checks run, and what remains open.
3. Reading list: exact paths, commands, or snippets to inspect first, with why each matters.
4. Decisions: settled facts, recommendations, open questions, and whose call they are.
5. Boundaries: what may change, what must not change, and what is out of scope.
6. `/codex:rescue` jobs: bounded tasks with one question, exact inputs, constraints, and one evidence packet.
7. Proof and stop: verification commands, expected evidence in the final answer, and where to stop.

## Grounding Pass

Before writing the prompt, gather the evidence a cold-start agent cannot infer:

- `git status --short`: dirty files, staged files, and unrelated user changes.
- Relevant diffs or file excerpts: only the parts the next agent must trust.
- Commands already run: include pass/fail status and the important output line.
- Current decisions: what is settled, what is still a hypothesis, and what was
  deliberately refused.
- Exact source-of-truth paths: ADRs, specs, skills, package files, tests, or
  docs the next agent should read first.

Do not hand off vibes. If a claim matters, point at the file, command, or
decision record that grounds it.

## Rules

- Prefer dense bullets over prose. Use headings only when they make the prompt easier to scan.
- Paste real code or command output when it is shorter than explaining it. Use real paths, never vague references.
- Do not duplicate specs, plans, commits, or diffs. Link the stable path and summarize the decision it carries.
- Use absolute dates. "Today", "yesterday", and "recently" rot.
- Keep each `/codex:rescue` task bounded: one job, bounded sources, one deliverable.
- Enumerate the useful Codex capability in the job when it matters: search, grep, broad file inspection, exact file reading, diff inspection, command execution, tests, typechecks, browser checks, local tools, focused edits, verification, cleanup, or first-pass analysis.
- Ask Codex for evidence packets: command output, file references, short summaries, diffs, risks, and verification results.
- Avoid chatty delegation loops. Codex compresses aggressively; Claude should not receive a second transcript.
- Bound the phase. If the recipient should not implement, say so. If implementation may follow, ask for a separate execution handoff.
- Name the active skills or conventions only when they change behavior. Do not
  list every skill loaded in this chat.
- Preserve dirty-worktree ownership. If a file was already modified by the
  user, say so and tell the next agent not to overwrite it casually.
- Include enough refusal context that the next agent does not reopen settled
  branches without new evidence.

## Codex Plugin Commands

Name `/codex:rescue` directly when the next Claude Code session should delegate execution work. Shape each rescue prompt as one job with exact inputs, clear constraints, and one evidence packet.

Mention the user-invoked commands as suggestions for the human running Claude Code:

- `/codex:review`: second review pass.
- `/codex:adversarial-review`: adversarial challenge pass.
- `/codex:transfer`: hand work or context to Codex.
- `/codex:status`: inspect job status.
- `/codex:result`: retrieve job output.
- `/codex:cancel`: cancel a job.

If the handoff suggests one of these commands, tell Claude Code to relay the returned output faithfully before making the final call.

## Task Defaults

- Edits: Claude Code uses `/codex:rescue` in a disposable git worktree on its own branch, asks for commit-sized waves, then reviews the final diff.
- Review: Claude Code uses `/codex:rescue` for one concrete evidence-gathering question, then reports findings, risks, and gaps.
- Adversarial rework: Claude states what would falsify the current direction and names refusals with the value each gives up.

For a `/goal` one-liner, use [agent-goal](../agent-goal/SKILL.md). For a human-facing progress summary, use [progress-summary](../progress-summary/SKILL.md).
