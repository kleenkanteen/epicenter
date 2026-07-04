---
'@epicenter/workspace': minor
---

Breaking (pre-1.0): stop exporting the daemon-side child-doc host loop from the root barrel. `attachChildDocWorker` and its type family (`ChildDocWorker`, `ChildDocWorkerContext`, `ChildDocWorkerFactory`, `ChildDocWorkerHandle`, `ConnectedChildDoc`, `ObservableChildDocLayout`) were public but consumed only inside the package, by `workspace.ts`'s mount composition. Apps enter this seam through the `MountWorker*` types, never the raw loop. Removing them shrinks the browser-facing surface to what a consumer actually uses; the loop and its types stay intact internally. If a mount author outside the package ever needs to name one, it should be re-exported from `@epicenter/workspace/daemon` (the node-only surface), not the root barrel.
