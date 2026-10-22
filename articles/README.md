# Writing

Every article on imtani.dev is a folder. This file is the format's
specification, and the contract any tool that reads or writes articles — the
build, the dev server, the block editor — is held to. Where this file and the
code disagree, `tools/writing/articles.ts` (the checks) and
`tools/writing/frontmatter.ts` (the parser) are what actually run; fix
whichever is wrong.

## Where articles live

```
site/articles/<slug>/              published — this public repo; CI builds and deploys it
  article.md
  media/
articles/drafts/<slug>/            drafts — the private parent repo (potpolio); same layout
site/writing/<slug>.html           generated pages — never edit, never commit
```

- **The folder name is the URL.** `articles/rise-and-shine/` is served at
  `https://imtani.dev/writing/rise-and-shine`. Lower-case letters, digits and
  single hyphens.
- **Media is flattened into the URL.** `media/door-scene-2.webp` is served at
  `/writing/<slug>/door-scene-2.webp`. `media/` is flat: no subfolders.
- **Drafts are seen only by `npm run dev` and `npm run writing:drafts`,** and only
  if the drafts folder exists — it never does in CI or a clean clone. A
  production build (`npm run build`, `vite build`) never reads it, so a draft
  is not in `dist/`, not in the sitemap, and not deployed.
- **Publishing is moving the folder** from the private repo's
  `articles/drafts/<slug>/` to `site/articles/<slug>/` and committing it here.
- `draft: true` in the front matter is the belt to the folder's braces: a
  published folder that says it is a draft is skipped by the build (with a
  warning, so it cannot stop the six-hourly deploy).
- The roots are set in one place, `tools/writing/config.ts`.
  `WRITING_DRAFTS_DIR` overrides the drafts root; the editor alone also takes
  `WRITING_PUBLISHED_DIR`, for testing against a copy.

Every file in a published article's `media/` must be used by the article — a
stray file would be deployed, so the build fails on one. (Drafts only warn.)

## `article.md`

A front matter block, then Markdown.

```markdown
---
title: Rise&Shine Devlog
author: Tanishk Narula
date: 2024-06-19 .. 2024-06-28
description: A day-by-day account of building Rise&Shine …
---

The first paragraph is the standfirst.

# Day 1 | June 19
…
```

### Front matter syntax

A small, hand-parsed subset of YAML. Every value is read as a string; the
fields below say what each one means. Exactly this, and anything else is an
error naming its line:

| Shape | Written |
| --- | --- |
| scalar | `key: value` |
| list of scalars | `key:` then lines `  - item` (two spaces) |
| one-level map | `key:` then lines `  name: value` (two spaces) |
| comment | a line whose first non-space character is `#` |

- The block opens on line 1 with `---` and closes with `---`.
- Keys are `[A-Za-z][A-Za-z0-9_-]*`. A key may appear once.
- A value is everything after `: ` to the end of the line, trimmed. `#`
  mid-line is part of the value (URLs have fragments); there are no inline
  comments.
- Quote a value to keep edge spaces, to start it with a quote or `#`, or to make
  it empty: `"…"` (escapes `\"` and `\\` only) or `'…'` (`''` for a quote).
- No nesting below one level, no `[a, b]` inline lists, no multi-line values,
  no tabs. `key:` with nothing under it is an empty value, which every field
  treats as absent.
- **Comments and blank lines are part of the article** — the devlog's banner
  settings carry their reasoning in them. `parse()` keeps each run of them
  against the key or item that follows (`comments['banner.travel']`), and
  `serialize()` writes them back. For a block in canonical form —
  two-space indent, values quoted only when needed — `serialize(parse(text))`
  is `text`, byte for byte; the devlog is tested to round-trip. A tool that
  edits one value must leave every other line as it was.

### Front matter fields

Unknown keys are an error. Dates are `YYYY-MM-DD` and are checked to be real.

| Key | Required | Meaning |
| --- | --- | --- |
| `title` | yes | Masthead title, `<title>` (as `Title — Author`), og:title, JSON-LD headline. |
| `author` | yes | Byline (`by Author`), meta author, JSON-LD author name. |
| `date` | yes | What the piece covers or was written on: one day, or `start .. end`. Shown on the masthead record as `June 19 – June 28, 2024`. |
| `description` | yes | Meta and og description, JSON-LD description. |
| `deck` | | The line under the title. Omitted if absent. |
| `handle` | | Shown after the byline: `by Tanishk Narula (infiniTani)`. |
| `kind` | | The record row's label and the skip link's noun (`Devlog` → "Skip to the devlog"). Default `Article`. |
| `published` | | JSON-LD datePublished. Default: the end of `date`. |
| `updated` | | JSON-LD dateModified. Default: `published`. Not before it. |
| `image` | | A media path (`media/cover.webp`): og:image and JSON-LD image, and the large Twitter card. Without it the card is `summary`. |
| `keywords` | | List. JSON-LD keywords. |
| `about` | | Map: `type` (schema.org type, e.g. `VideoGame`), `name`, optional `url`. JSON-LD about. |
| `award` | | Map: `text` (required), `event`, `url`. Adds the Award row — `text · event`, the event linked to `url` (or `text` linked, with no event) — puts `text` in the phone brief, and JSON-LD award `text, event`. |
| `elsewhere` | | List of `label \| url`, after the built-in `imtani.dev` link in the rail's Elsewhere group (new tab). Split on the last ` \| `. |
| `colophon` | | List of `label \| url`, after `imtani.dev` in the footer. |
| `canonical` | | Absolute URL, for an article republished from elsewhere (Medium, AiHello). Default `https://imtani.dev/writing/<slug>`. Used for `<link rel=canonical>`, og:url and JSON-LD url. An article whose canonical is elsewhere is left out of the sitemap. |
| `toc` | | `true` (default) or `false`. With `false` there is no contents rail; below the gutters the menu still holds the record and the rail's two groups. |
| `draft` | | `true` or `false` (default). See above. |
| `banner` | | Map. Without it the page has no masthead band and ships no banner script. See below. |

#### `banner`

```yaml
banner:
  art: media/banner-art-635.png
  plateLight: media/banner-plate-860-light.png
  plateDark: media/banner-plate-860-dark.png
  grain: 0.85
  travel: 120
  rampSpace: art
```

- `art`, `plateLight`, `plateDark` (required): media paths. The art is any
  8-bit PNG; the plates are what a reader without JavaScript sees and are baked
  from the art and these settings by `npm run writing:banner -- <slug>`.
- Everything else is a `createBannerScreen` option by its own name — `grain`,
  `levels`, `cell`, `ramp`, `rampWidth`, `rampSpace` (`band`/`art`),
  `artScale` (number or `cover`), `anchorX`, `focus`, `travel` (number or
  `null`), `direction`, `feather`, `follow`, `wiggle`, `wiggleSign`, `fps`
  (number or `null`). What each does is the OPTIONS block at the top of
  `tools/writing/banner.js`; anything left out takes that file's DEFAULTS.
  The live band and the baked plates are made from the same merge.
- The plates are served `immutable` (see below): after re-baking, rename them.

### Body

CommonMark (markdown-it, raw HTML allowed), plus the following. The first
paragraph is the standfirst.

**Headings.** `#` is a *part*: drawn rule, big label, optional date line, and a
top-level entry in the contents. Everything after the first ` | ` is the date
line and the contents' date: `# Day 1 | June 19`, `# Epilogue | 21 July 2026`,
`# Further reading`. `##` and `###` nest under the part before them; headings
before the first `#` are top-level entries. Any heading may end with
`{#an-id}` to fix its anchor; otherwise the id is made from its words
(`Day 1` → `day-1`). Use one where a link to a section should survive a
rewording.

**Figures.** An image that is a paragraph of its own becomes a mounted figure.
An image inside a sentence is an error.

```markdown
![](media/door-scene-2.webp "Door Scene")
![](media/jittery-camera.mp4 "Character moving around with a *jittery* camera.")
![The player walks into the checkpoint flag and it raises.](media/checkpoint-animation.mp4)
![](figure:sine "Sine Wave")
![](https://media1.giphy.com/…/giphy.gif "IT’S ALIVE!"){width=480 height=269 animated}
```

- **The title is the caption**, and it is Markdown (emphasis, code). One
  caption syntax, written once.
- **Alt is the description for someone who cannot see the picture,** and on a
  captioned figure it is normally left empty, on purpose: a screen reader reads
  the caption as the figure's name, so alt repeating it is heard twice. Write
  alt where it says what the caption does not — or where there is no caption.
- **Stills:** `.webp`, `.png`, `.jpg`/`.jpeg` in `media/`. The size is read
  from the file's own header. A local GIF is refused: transcode it into a clip.
- **Clips:** reference the `.mp4`. Beside it `media/` must hold the poster,
  `<name>.webp` (what a reader without JavaScript sees, and where the clip's
  size is read from), and may hold `<name>.webm` (offered first). They are
  muted, looping, start when on screen, and stop with the page's motion control.
- **Drawn figures:** `figure:<name>` from the shared registry in
  `tools/writing/figures.ts` — `interpolation`, `sine`, `grid-explore`,
  `grid-demo`, `inheritance`, `composition`. Alt is ignored; each drawing
  carries its own description. A figure that owes a credit (the grid's Godot
  logo) adds it to the footer.
- **Remote images** are left on their host and need their size in
  `{width=… height=…}` straight after them; `animated` marks a GIF so the
  motion control can stop it. The build checks each one still answers as an
  image. Local files take no attributes.

**Asides** — a torn-paper note. A line `<aside>`, Markdown, a line `</aside>`.
An emoji at the start of the body is the note's icon.

```markdown
<aside>
🤔 Did you know that prefixing a Wikipedia URL with ‘simple' …
</aside>
```

**Code.** Fenced blocks with a language: `gdscript` is highlighted; any other
language is shown plain, labelled with its name (`python` → Python); untagged
is labelled "Code". Each block gets a copy button.

**Screen-dependent words.** `[[wide: …]]`, `[[menu: …]]`, `[[band: …]]` on one
line: the page shows the one that is true for where the contents is on that
screen (right gutter / behind the menu button / a band above the article).
`[[phone: …]]` is an alias for `menu`. The text inside is Markdown.

**Word count and reading time** are computed: the words of the headings, prose,
lists, asides and captions — not code, not alt text, and of the screen
variants only `band` — at 220 words a minute.

## Media and caching

Every published article's media is served `immutable` for a year: `_headers` is
generated at build time from the published list (`tools/writing/headers.ts`),
one `/writing/<slug>/*` rule per article. The names are not content-hashed, so **a file
whose bytes change gets a new name**, and the article's reference changes with
it. The devlog's `-2` suffixes are that rule applied.

Transcoding is by hand, never in the build:

```
npm run writing:media -- <originals-dir> <slug> [--only name,name]
```

reads `<originals-dir>/media-map.json` (`{ "original file": "published-name" }`)
and writes stills as `<name>.webp` and GIFs as clips (`.mp4`, `.webm`, `.webp`
poster) into the article's `media/`. The devlog's originals — the Notion
export — stay in the private repo as the archive, with their map;
`npm run devlog:media` is that command for the devlog.

## Editing

`npm run write` opens the block editor at `http://127.0.0.1:4300` — a local
tool (`tools/writing/write/`), bound to this machine only, never built or
deployed. It lists every published article and draft, makes new drafts (a
`drafts/<slug>/` with this format's required fields filled in, the optional
ones as comments, and an empty `media/`), and opens one as:

- **The page.** The masthead and every top-level block, drawn by `build.ts`
  with the page's own stylesheet. Click a block to edit its Markdown; Escape or
  clicking away draws it again. Blocks are inserted, duplicated, deleted and
  moved (drag handle, or Alt+↑/↓); Ctrl+Z undoes. Images come from `media/`, or
  are dropped in and copied there under a slugified name — WebP, PNG and JPEG
  only; GIFs and video go through `npm run writing:media`.
- **The front matter** as a form, one control per field above. Comments are
  kept, unknown keys are shown and left alone, and a block that will not parse
  can be edited as text.
- **Problems:** this file's checks, run on what is on screen.

**Save** writes `article.md` and nothing else: temp file and rename, with the
old file copied into `.edit-backups/` beside it first (ignored by git in both
repositories). A block that was not edited or moved is written back byte for
byte, with the blank lines around it, and the file keeps its line endings and
BOM; opening an article and saving it unchanged writes nothing. A published
article that would fail the build can still be saved, after a warning that
the deploy would fail. **Preview** opens the whole page, unsaved changes
included, as `renderArticle` builds it. **Publish** (drafts only) moves the
folder into `site/articles/` after showing what will move; it refuses if the
slug is taken or the article would fail as published, and it does not commit.

## Commands

| | |
| --- | --- |
| `npm run writing` | Build every published article to `writing/<slug>.html` (generated, ignored). Part of `npm run build`. |
| `npm run writing:drafts` | The same, plus drafts. `npm run dev` runs it first, then rebuilds on any change to an article, its media or `tools/writing/`. |
| `npm run writing:media -- …` | Transcode originals into an article's `media/`. Needs ffmpeg. |
| `npm run writing:banner -- <slug>` | Bake an article's banner plates. |
| `npm run write` | The block editor; see Editing. |
| `npm run devlog`, `devlog:media`, `devlog:edit` | The old names: an alias, the devlog's media, and the editor (now `npm run write`). |

The sitemap and `_headers` are generated at build time from the published list;
drafts never appear in either.
