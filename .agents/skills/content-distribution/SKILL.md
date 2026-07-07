---
name: content-distribution
description: Turn one real idea, vault page, article, photo, screenshot, code diff, spec excerpt, or diagram into platform-native content for LinkedIn, X, Reddit, TikTok, Instagram Reels, YouTube Shorts, Medium, Substack, or a personal-site article. Use when creating or editing files in variants/, choosing a channel or platform for a page, republishing or updating content that already shipped, or figuring out what's currently live for a given page.
---

# Content Distribution

Use this skill when the user wants to make one piece of thinking travel farther across platforms without becoming a full-time creator.

Follow [writing-voice](../writing-voice/SKILL.md) for tone. Use [social-media](../social-media/SKILL.md) when drafting final LinkedIn, X, or Reddit post copy.

## Core Philosophy

The goal is not to become a full-time creator. The goal is to make existing thinking travel farther.

Use one markdown source. Use real artifacts. AI adapts, packages, resizes, rewrites, captions, and formats. AI does not pretend to be the author.

```txt
real idea
  -> pages/<slug>.md (the private draft)
  -> variants/<slug>-<channel>-<format>-<version>.md (the shaped artifact)
       placements: [{platform, published_at, url, caption}] (shipped facts)
  -> performance notes
  -> next ideas from replies
```

## Default Workflow

1. Identify the source artifact: a `pages/` note, article draft, photo, screenshot, code diff, ASCII diagram, spec excerpt, voice note, or product decision.
2. Distill one content atom: thesis, tension, proof, visual, audience, and desired reaction.
3. Choose renderers by platform, not by rewriting the idea from scratch.
4. Preserve the human thesis and concrete examples. Let AI adapt structure and phrasing.
5. Produce wrappers for each platform: hook, caption, title, CTA, and format.
6. Keep performance notes simple: hook, visual type, platform, replies, saves, shares, profile clicks, and next variant.

## Content Atom

Before rendering, reduce the source to this shape:

```txt
Thesis:
  The claim the post is making.

Tension:
  Why the claim matters or what common belief it pushes against.

Proof:
  Concrete artifact, example, diff, screenshot, metric, failure, or quote.

Visual:
  Real photo, screenshot, diagram, code, spec excerpt, or Marp slide.

Audience:
  Who should feel seen, challenged, or helped.

Desired reaction:
  save, argue, try, reply, share, click, subscribe.
```

## Renderer Decision Tree

```txt
Does the user need platform versions?
  -> Use references/platform-renderers.md.

Does the output need strong opening lines?
  -> Use references/hooks.md.

Does the output include carousels or short video?
  -> Use references/marp-remotion-pipeline.md.
```

## Platform Grouping

Treat TikTok, Instagram Reels, and YouTube Shorts as one short-video renderer with small platform wrappers:

```txt
Same:
  core idea, slides, photos, screenshots, voiceover, captions.

Different:
  first hook frame, title, caption, CTA, pacing if needed.
```

Treat Medium and Substack as one article renderer with different relationship posture:

```txt
Medium:
  discovery and searchable article.

Substack:
  relationship, continuity, and personal context.
```

Treat LinkedIn and X as related but not identical:

```txt
LinkedIn:
  canonical concise public argument with one strong visual.

X:
  fragments, threads, sharper hooks, higher frequency.
```

Treat Reddit separately:

```txt
Reddit:
  native subreddit post or comment. Rewrite around the community. Do not dump recycled promo.
```

## Source Of Truth

`pages/<slug>.md` is the source. `channel` is the content identity (`bradencodes`, `braden-essays`, `epicenter`, ...). In the sibling vault repo, channel promises live at `../vault/specs/20260609T010000-channel-promise-approval-ledger.md`; read that file before picking a channel for a page for the first time because each channel's "what belongs" and "what does not belong" sections are normative. `format` is `article | social-post | short-video`. A `social-post` body is one or more short written segments separated by `---`: one segment is a one-shot post, several are a thread. `platform` is the distribution surface, and each format ships only to its platform class (the lint enforces this matrix):

```txt
article      → personal-blog | medium | substack | newsletter
social-post  → x | linkedin | reddit
short-video  → instagram | tiktok | youtube
```

A variant's filename is `<page>-<channel>-<format>-<version>` where `version` is the `YYYY-MM-DD` checkpoint the variant was cut from the page:

```txt
pages/2026-06-15-my-page.md
  -> variants/2026-06-15-my-page-bradencodes-social-post-2026-06-20.md
       placements: [{platform: x, published_at, url}]
  -> variants/2026-06-15-my-page-braden-essays-article-2026-06-20.md
       placements: [{platform: personal-blog, published_at, url}]
```

### Freeze-on-supersede

The **latest** variant for a `(page, channel, format)` lineage is living: edit it in place to track the page. Cutting a new version freezes its predecessor — never touch a superseded variant again; it is the curated record of what shipped.

- Content changed enough to preserve the old checkpoint? Cut a **new variant** with today's date as its `version`; the old one freezes.
- Shipping the living variant somewhere (first ship, update, or repost)? Append a **placement** to its `placements[]` — one object per platform shipment.

**What's currently live** is derived, not stored: for a given platform, the current placement is the one with the latest `published_at` on the latest variant that carries that platform. Older variants and placements are history, not stale data to clean up.

Current vault schema: `pages/matter.json` requires `title`, `date`, `timezone`, and `status`; `variants/matter.json` requires `page`, `version`, `channel`, and `format`, with optional `subtitle` (a channel-specific dek; the page's own `title` stays private and canonical). `placements[]` is validated by `bun run publishing-lint`, not Matter: each object has `platform` plus optional `published_at`, `url`, and `caption`. Leave `published_at` off until content is actually live.

## Do Not

- Do not generate pure AI images or pure AI videos when the user asked for authentic content from existing materials.
- Do not turn every platform into a separate original writing task.
- Do not optimize for raw volume before a platform wrapper preserves the author's taste.
- Do not add fake vulnerability, fake lessons, fake metrics, or invented personal stories.
- Do not let platform advice override the source thesis.

## Vault References

- `../vault/specs/20260609T010000-channel-promise-approval-ledger.md`: channel promises and what belongs on each channel.
- `../vault/specs/20260611T230004-channel-routing-cheat-sheet.md`: quick channel routing decisions.
- `../vault/specs/20260613T181206-channel-routing-test-batch.md`: examples that test the routing rules against real pages.
