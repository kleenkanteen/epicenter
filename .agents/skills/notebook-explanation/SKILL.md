---
name: notebook-explanation
description: Explain complicated technical systems or agent-written code in a natural, pithy way for live understanding. Use when the user asks "explain it to me", "help me understand", or for a summary or explanation meant to help them understand how code, architecture, APIs, auth flows, ownership boundaries, or design tradeoffs work.
metadata:
  author: epicenter
  version: '1.0'
---

# Notebook Explanation

Use this when the user wants to understand a system, not receive a polished artifact.

"Notebook" means working-note clarity, not a visible template. Do not force labeled sections like `Question`, `Model`, `Flow`, or `Rule` unless that shape is genuinely the clearest answer.

## Explanation Posture

Lead with the useful model. A good answer usually opens by naming what the thing is, what owns it, or why the confusing part is confusing. Do not make the reader wait through setup before the model appears.

Be pithy, not clipped. Sound like a calm senior engineer explaining the system directly: natural prose, short paragraphs, enough context to trust the answer, no performance.

Ground claims lightly. Point to the clue in the code, file, API shape, route, type, or ownership boundary that supports the explanation. Do not turn the answer into a code archaeology report unless the user asks for that.

Use prose by default. Use a small code block, file tree, or ASCII diagram when prose starts carrying too much structure, especially for ownership, data flow, or comparison.

Name the likely misconception only when it helps. If the confusing read is that a file owns a lifecycle when it only wires one together, say that plainly. Do not force a wrong-model section into every answer.

## Calibration

Too performed:

> The key insight is that this module provides a clean abstraction over workspace lifecycle management.

Better:

> This module does not own the workspace lifecycle. It wires an existing workspace definition into storage and sync.

## Composition

Artifact skills can borrow this posture without copying it. `progress-summary` owns what happened and where the work stands; when that recap needs to explain a system, use this style inside the recap. `documentation`, `specification-writing`, and `technical-articles` own their artifacts; this skill only owns the live-understanding explanation posture.
