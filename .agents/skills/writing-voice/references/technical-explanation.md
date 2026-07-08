# Technical Explanation Voice

Load this reference when writing a longer explanation, tutorial, architecture note, onboarding doc, or conceptual section.

## Lead With The Point

Every paragraph should open with its conclusion. Setup comes after, not before. The reader should know where you are going before you take them there.

Bad:

> After investigating several approaches to conflict resolution, including CRDTs, operational transforms, and manual merge strategies, we found that Yjs with LWW timestamps gave us the best combination of correctness and simplicity.

Good:

> Yjs with LWW timestamps gave us the best conflict resolution. We tried CRDTs without timestamps, operational transforms, and manual merge strategies; none matched it for correctness with this little code.

## Vary Sentence Length

Monotone sentence length sounds robotic. Mix short declarative sentences with longer explanatory ones. Short sentences punch. Longer ones carry nuance and connect ideas that need to live together.

Bad:

> The system processes incoming events. It validates each event against the schema. It then routes the event to the appropriate handler. The handler updates the database accordingly.

Good:

> The system validates incoming events against the schema and routes them to the right handler. Simple enough. But the handler has to update the database, notify subscribers, and maintain the audit log in a single transaction. That is where it gets interesting.

## Use Concrete Language

Abstract language forces the reader to translate. Concrete language lets them see it immediately.

Bad:

> This approach provides significant performance improvements for data retrieval operations.

Good:

> Row lookups dropped from O(n) to O(1). On a 10,000-row table, that is the difference between scanning every cell and a single hash lookup.

## Connect Ideas Without Too Many Headers

Not every transition needs a section heading. Use bridge sentences: one sentence at the end of a paragraph that sets up the next topic, or one sentence at the start that links back. Headers are for major shifts, not every new thought.

Bad:

> ## The Problem
> Sessions were timing out.
>
> ## The Root Cause
> The refresh only triggered on navigation.
>
> ## The Solution
> We added a keepalive to background activity.

Good:

> Sessions were timing out during file uploads. The refresh logic only triggered on navigation events, so any background activity (uploads, sync, long-running mutations) would silently lose the session.
>
> The fix was a keepalive that fires on any authenticated request, not just page transitions.

## Show The Mechanism

Bad:

> The key insight here is that by leveraging Yjs's built-in conflict resolution mechanism, we can effectively handle concurrent edits in a way that seamlessly maintains consistency across all connected clients.

Good:

> Yjs resolves conflicts automatically. Two users edit the same field, both edits survive in the CRDT, and the LWW timestamp picks the winner. No manual merge logic needed.

Bad:

> The factory function pattern provides a clean separation of concerns by encapsulating the client creation logic and exposing a well-defined interface for consumers.

Good:

> `createSync()` takes a Y.Doc and returns three methods: `connect()`, `disconnect()`, and `status()`. The consumer never touches WebSocket setup, reconnection logic, or auth token refresh. They call `connect()` and it works.

## Empathy For The Reader

Technical writing works when the reader feels understood, not lectured.

- Acknowledge frustration before offering the fix. `This warning is confusing` costs nothing and builds trust.
- Show the path they likely walked. `You probably tried X, then Y, and ended up here.`
- Lead with the answer. Do not make readers wade through context to find the fix.
- Assume competence. If someone is reading about `$derived` vs `$state`, they already know what reactivity is.
- Present trade-offs honestly. Saying a solution is perfect when it has caveats will lose trust.
- Write from beside them, not above them. `Here is what worked` treats the reader as a peer.
