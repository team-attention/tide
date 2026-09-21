# Spec: MSDF Font Memory

## Overview

### As-Is

The renderer's MSDF Font Store owns a separate `Vec<u8>` containing an entire
font file for every registered family/style key. The same `fontdb` face can be
registered under configured-family, `Monospace`, and `cosmic-{face_id}` keys,
so aliases and style fallbacks retain duplicate font-file buffers.

### To-Be

The MSDF Font Store retains only `fontdb` face identities. MSDF metrics and
glyph generation borrow font bytes from `cosmic-text`'s existing font cache,
so aliases and style keys do not create additional owned font-file copies.

### Approach

1. Store a `fontdb::ID` for each MSDF family/style key.
2. Resolve and validate each face through `cosmic-text::FontSystem` before
   registering it.
3. Keep the returned shared font alive while parsing metrics or glyph outlines.
4. Preserve the existing family, style, and glyph fallback order.

## Bounded Contexts

| Bounded Context | Responsibility |
|---|---|
| `renderer` | Maps MSDF family/style keys to shared font faces and generates glyphs. |

## Use Cases

### UC-1: RegisterSharedFontFace

- **Actor**: Renderer
- **Trigger**: Text shaping or fallback discovery resolves a `fontdb` face.
- **Precondition**: The face is available from `cosmic-text::FontSystem`.
- **Flow**:
  1. The renderer registers the face identity for a family/style key.
  2. Additional aliases or styles may register the same face identity.
  3. Metrics and glyph generation resolve bytes from the shared font cache.
- **Postcondition**: All keys resolve the intended face without the MSDF Font
  Store owning a font-file buffer.
- **Business Rules**:
  - BR-1: Multiple family/style keys may resolve to the same `fontdb` face ID
    and generate equivalent metrics and glyphs through that shared face.
  - BR-2: A face unavailable from `cosmic-text::FontSystem` is not registered.

## Invariants

1. The MSDF Font Store owns no font-file byte buffers.
2. Font family/style lookup behavior remains unchanged.
3. A shared font stays alive for the complete lifetime of every parsed face.

## Tests

| Use Case | Business Rule | Test |
|---|---|---|
| UC-1 | BR-1 | `font_aliases_share_the_same_registered_face` |
| UC-1 | BR-2 | `unavailable_font_face_is_not_registered` |

## Location

| Concern | Location |
|---|---|
| MSDF Font Store | `crates/tide-app/src/adapter/outward/renderer_adapter/msdf.rs` |
| Renderer registration and generation | `crates/tide-app/src/adapter/outward/renderer_adapter/font.rs` |
| Renderer initialization | `crates/tide-app/src/adapter/outward/renderer_adapter/init.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/msdf_font_memory.rs` |
