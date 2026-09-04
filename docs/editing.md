# Editing and publishing

Run commands from the repository root. The [creation guide](editorial-notes.md) covers writing and literary review.

## Setup

Use [Bun](https://bun.sh/) 1.4+ for the TypeScript scripts and tests:

```sh
bun install --frozen-lockfile
bunx --bun playwright install chromium
```

On Linux, `bunx --bun playwright install --with-deps chromium` can install browser system dependencies too. The scripts run directly; no compilation step is needed.

The native TypeScript 7 CLI is installed as `@typescript/native`; `typescript` stays on 5 for tooling APIs. After changing either dependency, verify `bun tsc --version` still reports 7.

## Check a draft

A draft JSON object needs `rows` (five five-character strings) and `collection`: `rhyming_pair`, `same_poem_square`, `four_direction`, or `unrhymed_pair`. `directions` defaults to the form's readings. For a rhyming pair, also supply `rhyme` with `family`, five contextual pinyin readings in each of `across` and `down`, and `compliance` (`pass` or `conditional`). Conditional rhyme requires a `caveat` and cannot be Selected.

```sh
bun scripts/build.ts --draft path/to/draft.json
```

This checks one draft without changing the collection and prints its computed readings. English is optional at this stage. The checked endings in [poems/rhymes.json](../poems/rhymes.json) are an editable reference, not a complete pronunciation dictionary. Review new endings in context before adding their pronunciation and family; disclose ambiguity instead of choosing a convenient sound.

## Add it to the collection

[poems/poems.json](../poems/poems.json) contains a `poems` list; its order determines the order within each form. Keep stable `id` and `title`, the draft fields, and a `status` (`Selected`, `Reserve`, or `Workshop`). Add optional `punctuation` by direction without changing any characters or their order. Readings and mechanical results are calculated, not stored twice.

For cards, the draft also needs an `id`, Chinese `title`, and `english` with an export `slug`, English `title`, and `lines` keyed by **each unique unpunctuated Chinese line** across all supported directions. Repeated lines share translations. An optional `note` holds translation caveats. Add a `palette`: `beige`, `green`, `rose`, `blue`, `sage`, or `plum` (defaults to beige).

## Render the picture

```sh
bun run cards --input path/to/draft.json --output output/cards
bun run cards --poem P02 --output output/cards
```

The first command renders a translated draft; the second renders a collection entry. Use `--palette sage` to try another palette. Inspect every supported reading and the exported PNG. Symmetric cards share one stanza; reverse readings use a line-order note only when that shortcut is exact, otherwise they appear in full. Wrapping fails validation rather than silently shrinking the text.

Chinese type defaults to Songti SC / Noto Serif SC / SimSun; English uses Georgia / Times New Roman. Install a Chinese serif font if needed, or set `CJK_FONT` to its family name. Fonts and platforms affect exact pixels. `CHROMIUM_EXECUTABLE_PATH` optionally selects an installed browser.

## Publish and verify

Upload the PNG to GitHub and put its attachment URL in `imageUrl`. Rerender and reupload after changing the poem or translation; an existing uploaded image does not update itself.

```sh
bun run build
bun run check
bun test
bun run typecheck
```

The build writes only [more_poems.md](../more_poems.md); `--check` reports drift without writing. It does not inspect remote image contents or availability. These two guides are maintained by hand.

Edit the [README](../README.md) manually, preserving its copyable grids. If the featured selection changes, update `PUBLIC_GROUPS` in [scripts/build.ts](../scripts/build.ts), the README grids, and their inline image URLs together. Review the diff before committing and pushing.
