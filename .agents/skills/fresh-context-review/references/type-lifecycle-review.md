# Type And Lifecycle Review

Load this when a fresh-context review centers on type protocols, state machines,
lifecycle transitions, or helper boundaries.

## Type Shape Rules

Prefer existing project conventions before inventing a local protocol.

- Use `Result<T, E>` for success or failure.
- Use `defineErrors` for typed failure modes.
- Use a custom discriminated union when every variant is a successful domain
  state, or when the union models runtime state rather than operation failure.
- Do not wrap `Result` in another success/error union unless there is a clear
  third state that is not success and not failure.
- Do not create a named type alias just to make a short return annotation unless
  the alias names a real contract.

Healthy examples:

```ts
type RuntimeAuthState =
	| { status: 'signed-out' }
	| { status: 'signed-in'; networkAccess: NetworkAccess };

type ApiSessionRequestResult = Result<
	ApiSessionResponse,
	ApiSessionRequestError
>;
```

Suspicious example:

```ts
type ApiSessionResult =
	| { status: 'ok'; session: ApiSessionResponse }
	| { status: 'auth-rejected'; error: AuthError }
	| { status: 'unavailable'; error: AuthError };
```

The suspicious version makes a second result protocol. Prefer `Result` unless
the extra state is genuinely not an error.

## Lifecycle Review

For state machines, write the lifecycle before reviewing code:

```txt
boot
  -> state A
  -> state B

network request
  -> gate
  -> verification
  -> success or refusal

teardown
  -> stop trust
  -> clear durable state
  -> discard stale work
```

Then challenge every transition:

- What starts this transition?
- What async work can still be in flight?
- What object identity or version gate prevents stale work from winning?
- What state is public, and what state is only internal?
- What happens if durable storage fails?
- What happens if the network lies, times out, or returns stale identity?

If a transition cannot be explained in one short line, it needs a better name,
a better invariant, or fewer states.

## Helper Boundary Review

Count callers before judging helpers.

```txt
helper                           callers  decision
currentThing                     6        keep
makeInitialState                 1        keep if it names boot semantics
normalizeResult                  1        inline unless it isolates unsafe input
```

Keep one-caller helpers only when they do one of these jobs:

- name a lifecycle transition
- isolate a parse or network boundary
- prevent stale async work
- keep a long method readable
- match a deliberate family of operations

Inline helpers that only rename simple control flow.
