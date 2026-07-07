# @epicenter/cli

> Run Epicenter headlessly for one folder so it stays synchronized and materialized.

Each verb is a shell shortcut for one workspace or lifecycle job:

```txt
                 +------------+---------------------------------------------+
                 | Verb       | Job                                         |
                 +------------+---------------------------------------------+
   Watch         | daemon up  | open mount, sync, materialize, stay alive  |
   Stop          | daemon down| signal the recorded watcher pid            |
   Inspect       | daemon ps  | list watcher metadata and pid liveness     |
   Logs          | daemon logs| read the watcher log file                  |
                 +------------+---------------------------------------------+

 Supporting systems: auth (machine session), init (root creation), blobs, matter
```

The resident process is not a callable action server. Workspace actions remain
in-process for apps and local tools.

## Targeting an environment

When you iterate on `apps/api`, you want CLI commands hitting your local server,
not prod. The CLI reads `EPICENTER_API_URL` from the environment; named scripts
wrap the two real workflows so the target is always explicit.

| I want to...                                          | I run...                                                               |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| Develop against my local API server                   | `bun run cli:local auth login`                                         |
| Run from source against prod (rare: bug repro, demos) | `bun run cli auth login`                                               |
| Use the published binary (end user)                   | `epicenter auth login`                                                 |
| Override the target anywhere                          | `EPICENTER_API_URL=https://staging.example.com bun run cli auth login` |

Tokens are stored per API target so prod and local sessions coexist. Each target
writes one file at `<dataDir>/auth/<host>.json`, where `<dataDir>` is the
platform user-data directory from `env-paths('epicenter')` and `<host>` is the
API host with `:` replaced by `_`. A fresh `cli:local auth login` will not
overwrite your prod session. The daemon freezes its target at boot; to retarget,
`daemon down` then `daemon up` again.

`EPICENTER_DATA_DIR=<path>` overrides `<dataDir>` itself. Today the only
global user state stored there is cached credentials. This is the escape hatch
for Nix, snap, ephemeral homes, and the test suite.

The same env var and scripts apply to every command that talks to the API,
including `daemon`, not just `auth`.

## Commands

`epicenter daemon up` opens the mount declared by the Epicenter root's
`epicenter.config.ts`. It runs in the foreground, owns the root's lease, joins
sync when signed in, and keeps materializers alive until it receives SIGINT or
SIGTERM.

```bash
epicenter auth login

epicenter daemon up -C ~/workspace
epicenter daemon ps
epicenter daemon logs -C ~/workspace
epicenter daemon down -C ~/workspace
```

`-C` is a start directory for Epicenter-root discovery. Discovery walks upward
until it finds `epicenter.config.ts`, then the daemon opens the mount that config
declares. Discovery is upward-only and never scans down, so run from inside your
Epicenter folder (or any directory under it) or pass `-C <epicenter-root>`. From
a repo whose Epicenter folder lives at `repo/apps`, that is
`epicenter daemon up -C apps`.

## Exit codes

`daemon up` exits `1` on startup failure (already running, bad config, auth) and
`0` on clean shutdown. `daemon down`, `ps`, and `logs` exit `0`: a missing daemon
or an empty log is reported, not treated as an error.

Error text goes to stderr. Human-readable command output goes to stdout.

## Epicenter roots and mounts

`epicenter.config.ts` marks the Epicenter root and declares its mount. One folder
is one app is one mount: the default export is a single `Mount`. The folder that
holds `epicenter.config.ts` is your Epicenter folder. Epicenter owns its direct
children, so the mount's visible markdown projection is a direct child folder.

```ts
import notes from './workspaces/notes/mount';

export default notes;
```

The folder that holds `epicenter.config.ts` is your Epicenter folder.
`.epicenter/` and the generated projection are direct children:

```txt
repo/                        unreserved repo root
└── my-notes/                 Epicenter root (folder name is your choice)
    ├── epicenter.config.ts   tracked, marks the Epicenter root
    ├── .epicenter/           ignored, machine state for this root
    └── notes/                generated Markdown projection (one folder per table)
```

Put `epicenter.config.ts` in a folder dedicated to one app. The marker is the
config file, not the folder name. Run several apps by giving each its own folder,
each its own root.

Writing a custom mount inline uses `defineMount` from
`@epicenter/workspace/daemon`:

```ts
import { defineMount } from '@epicenter/workspace/daemon';

export default defineMount({
  name: 'notes',
  async open({ epicenterRoot, mount, session }) {
    // Open the long-lived runtime.
    // `mount` is the canonical mount name carried on the Mount object.
    // Return { actions, [Symbol.asyncDispose] }, or `inactive(reason)`.
  },
});
```

`.epicenter/` holds the Epicenter root's generated machine state such as SQLite
materializers, Yjs update logs, markdown materializers, and its generated
`.gitignore`. It is not a registry. Runtime metadata uses the OS runtime
directory, while daemon logs use the platform log directory from `env-paths`.

## Scripting

Scripts should read materialized files or SQLite directly. Generic off-process
action invocation is deliberately not part of the CLI surface. When a real write
workflow needs shell access, add an explicit app command for that workflow rather
than a generic action bus.

## Public API

```ts
import { createCLI } from '@epicenter/cli';
```
