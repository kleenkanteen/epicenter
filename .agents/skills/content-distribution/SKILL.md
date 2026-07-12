---
name: content-distribution
description: Turn one real idea, vault page, article, photo, screenshot, code diff, spec excerpt, or diagram into platform-native artifacts for LinkedIn, X, Reddit, TikTok, Instagram Reels, YouTube Shorts, Medium, Substack, or a personal-site article. Use when defining or revising audience channels, creating or editing vault artifacts, choosing a recipe, preparing a platform payload, publishing or recording a public URL, or figuring out what is live for a page.
---

# Content Distribution

Follow [writing-voice](../writing-voice/SKILL.md) for tone. Use
[social-media](../social-media/SKILL.md) when drafting final LinkedIn, X, or
Reddit copy. In the vault, read `AGENTS.md` and `CONTEXT.md`; they own the current
publishing and rendering vocabulary.

## Product Sentence

One authored page can yield several deliberately shaped artifacts. A channel
names the audience promise, a recipe guides the collaboration, and the artifact
holds the durable payload plus its approved destination checklists.

```txt
channel/recipe prose ──agent proposes──► artifact ◄──N:1── page
                                           ├── publishing[target]
                                           └── sharing.targets[target]
```

The vault is curated and flows downward. It does not mirror every remote post,
import platform state, or maintain a provider synchronization engine.

## Channel Boundary Test

Define a channel from the follower's expectation of the next post:

```txt
I enjoyed this post. If I follow, will I enjoy the next one?
```

A channel is one predictable audience promise, not one topic, format, platform,
or level of technical depth. Split when the same follower would routinely reject
the next post because it serves a different desired outcome. Keep varied topics
together when the same person wants them for the same reason. Route by follower
promise before account name, and do not create an account merely because a
series has a good name.

## Default Workflow

1. Select one real `pages/` source and identify the public expression to shape.
2. Choose the channel and recipe for the desired audience promise and payload.
   Read their bodies; they are editable collaboration guidance, not persisted
   artifact provenance.
3. Create one artifact through the canonical publishing model or app. Its UUIDv7
   filename is opaque identity; its frontmatter points to exactly one `page`.
4. Work with the author until the artifact body is the complete platform-ready
   payload. The draft may select, condense, reorder, and frame page material while
   preserving the selected claim and representing its scope honestly. Keep
   incomplete drafts editable; do not invent status fields.
5. Invoke explicit deterministic tools only when the recipe calls for them.
6. For a `*/blog` target, suggest one lowercase-hyphenated artifact `slug`; let
   the author revise it before approval. Preview the actual delivery surface.
7. Approve the payload and exact publishing and sharing checklists. Approval is
   the freeze boundary.
8. Publish manually, through supervised computer use, or through the
   destination's own deployment command.
9. Record the verified public URL at its approved target. Resolve every other
   leaf by publishing, sharing, or deliberately skipping it.

## Drafting Shapes; Production Reproduces

Editorial adaptation ends at approval. The artifact body is the durable public
expression. After approval, destination tools and renderers reproduce that
artifact exactly; they do not summarize, rewrite, or silently select from it.

## Identity Follows the Frozen Expression

One unchanged expression sent to several declared platforms is one artifact with
several receipts. Sameness includes the body and every frozen production input,
including caption, renderer, kit, and authored slug when present. A meaningful
platform-specific rewrite or address change is another artifact.

```txt
same video.mp4 → Instagram + TikTok + YouTube
  one artifact, three receipts

LinkedIn argument ≠ X thread
  two artifacts, even when both begin from the same page
```

Do not duplicate an identical artifact just to attach another URL. Do not force
divergent frozen expressions into one artifact merely because they share an idea.

## Recipes Compose Tools; They Are Not Plugins

Recipes are Markdown playbooks. Some collaborations are conversational, some
copy prose almost directly, and some invoke deterministic tools. Do not create a
universal `executeRecipe()` interface or assume every recipe can be run unattended.

```txt
recipe prose
  ├── agent collaboration
  ├── vault video tools
  ├── destination preview/deploy command
  └── supervised browser action
```

Shared TypeScript and Remotion own correctness-sensitive mechanics. Recipe prose
owns editorial intent, questions, review, and handoff.

## Canonical Commands

From the vault:

```bash
bun run vault check
bun run vault page show <page>

bun run vault video plan <artifact-id>
infisical run --env prod --path /vault -- bun run vault video narrate <artifact-id>
bun run vault video preview <artifact-id>

bun run vault publication record <artifact-id> <target> <public-url>
```

`video preview` always builds the coherent short-video outputs: video, cover, and
review pack. Narration persists paid audio plus caption timing; storyboard cues
derive from current Markdown plus captions.

For a personal-site article, the blog repository owns its external workflow:

```bash
cd ../blog
bun run article preview <artifact-id> <channel/blog>
bun run article publish <artifact-id> <channel/blog>
```

Article publish deploys and verifies the expected public page, then asks the
vault to record the blog receipt. For manual platforms, copy or upload the payload,
capture the resulting URL, then run `vault publication record`.

The artifact slug is authored intent; the successful receipt URL is public fact.
A controlled blog derives the newest successful artifact for a page as canonical
and permanently redirects every earlier successful path directly to it. Do not
add page-derived slugs, alias lists, per-target vanity slugs, or a second canonical
pointer.

Sharing records that this artifact reached a person or group. It does not record
which public receipt was pasted or the exact outgoing message.

## What Is Live

Use the embedded receipts, never filenames or authored status:

```bash
bun run vault page show <page>
```

- No artifact: captured page, not in flight.
- Artifact without `approved_on`: editable draft.
- Approved artifact with unresolved leaves: frozen payload in flight.
- Approved artifact with every leaf terminal: resolved payload.
- A meaningful payload correction: create another artifact.

## Do Not

- Do not add a provider registry, OAuth layer, retry ledger, remote sync, or
  universal recipe runner.
- Do not generate fake vulnerability, lessons, metrics, or personal stories.
- Do not let platform advice override the source thesis.
- Do not publish or record a receipt before explicit approval and a verified
  public URL.
- Do not edit an approved artifact or an existing terminal fact; create a new
  artifact for a meaningful payload change.
