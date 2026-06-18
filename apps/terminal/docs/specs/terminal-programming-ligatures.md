# Terminal Programming Ligatures

## Goal

Render common programming ligatures in terminal output when the configured font
supports them, without changing terminal grid semantics.

## Scope

Ligature rendering is applied only to terminal grid rows. Editor and diff grid
rendering keep the existing cell-by-cell path.

The renderer scans same-style ASCII runs and only invokes advanced shaping when
the run contains a common programming ligature sequence such as:

- `=>`, `->`, `<-`
- `<=`, `>=`, `==`, `===`, `!=`, `!==`
- `::`, `:=`, `&&`, `||`
- `++`, `--`, `/*`, `*/`, `</`, `/>`, `..`, `...`

## Behavior

- Cell backgrounds are still rendered per terminal cell.
- Selection, cursor placement, URL hit testing, and copy behavior keep using the
  original terminal cells.
- If shaping or glyph-id MSDF generation fails, the renderer falls back to the
  existing per-cell glyph drawing for that run.
- Fonts without programming ligatures still render normally because cosmic-text
  returns ordinary glyphs for the shaped run.

## Rendering

OpenType shaping is delegated to cosmic-text using the configured font family
and the cell style's bold/italic attributes. The shaped glyph ids are cached in
the MSDF atlas separately from Unicode character glyphs because ligature glyphs
do not necessarily have a Unicode scalar value.
