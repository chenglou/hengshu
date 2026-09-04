# Editing the collection

## Source and generated files

Edit [poems/poems.json](../poems/poems.json). Running `python3 scripts/build.py` updates:

- [More poems: all 18 grids](../more_poems.md)
- [Editorial notes: rankings, commentary, and review history](editorial-notes.md)

Edit the entire [README](../README.md) directly in Markdown. The build never rewrites it and requires no markers. It reads the fenced poem grids to check that they match the featured selection in the canonical data; ordinary prose edits do not affect that check.

Do not hand-edit `more_poems.md` or `editorial-notes.md`. `python3 scripts/build.py --check` validates without writing and reports missing or stale generated content. Check results are printed to the terminal, not stored in a separate file.

Python 3.9 or newer is required; there are no third-party dependencies. The seven featured IDs and the complete collection's category descriptions live in `PUBLIC_GROUPS` in [scripts/build.py](../scripts/build.py). If you change the featured selection, update both those IDs and the README by hand.

## Revising a poem

Keep each poem's stable `id`. Its `rows` are the five character strings forming the square. The explicit `readings`, optional `punctuation`, and `checks` describe that exact text; update them together. The validator recomputes the readings and rejects drift.

If a featured poem changes, update its README grid too before running the build. The build reports mismatches rather than silently repairing hand-edited text.

For a meaningful alternative to a preserved source-backed poem, add a new entry with a new ID and a revision note. Keep the earlier version in the archive. A `source` path means the current rows must still occur verbatim in that source document; do not silently break that promise.

When an ending changes, review its pronunciation in context. Update the poem's `rhyme` metadata and the reviewed pronunciation/family table in [scripts/build.py](../scripts/build.py) when necessary. Those tables are editorial inputs, not an automatic dictionary. Ambiguous pronunciation must be disclosed rather than forced to make a rhyme pass.

Ranks are the order of IDs in `sections`. Every current poem appears exactly once in the collection structure. `status` is the sole selection status; `curation.short` is the sole current short assessment. The fuller reasoning and reservations live beside it in `curation`. Earlier editorial judgments remain in the dated [archive](../archive/README.md).

## Selection is a separate judgment

The README features three selected rhyming pairs, three selected symmetric squares, and one selected four-direction poem. Its seven-poem selection is explicit, rather than automatically changing with the rankings. `more_poems.md` contains every grid once, including those seven and the two unrhymed pairs, while marking reserve and workshop entries. The editorial notes explain the choices and retain the review history.

Any rhyming pair marked `Selected` must have a passing rhyme check and different across/down readings, whether or not it is featured in the README. The explicitly conditional rhyme draft cannot be selected.

For editorial review, read each direction as a complete poem before comparing crossings. Attend first to the less fluent reading, then to specificity, progression, and what changes in meaning. Ordinary poetic ellipsis and metaphor are allowed; added backstories are not evidence that a line works.

The earlier forms have different rules. A symmetric square repeats one poem, while a reversible grid may rearrange already-used lines. Preserve those distinctions instead of inflating the number of independent poems.

Run both checks after editing:

```sh
python3 scripts/build.py
python3 scripts/build.py --check
python3 -m unittest discover -s tests
```

See the [publication checklist](publishing.md) for remaining release decisions.
