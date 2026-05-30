# Tide Codex Workbench Figma Transfer Notes

## Target

- Source design: `docs_v2/designs/tide-codex-workbench.pen`
- Target Figma file: `Thirdcommit`
- Target Figma page: `Tide` (`1192:2`)
- Current corrected Figma frame: `1223:2`

## Current Design Source

Figma is now the primary design source for Tide product UI.
See `docs_v2/designs/README.md` for the canonical Figma links and working rules.

## What Went Wrong

The first Figma transfer was not a faithful conversion from Pencil.
It was partly reconstructed from memory and Codex visual reference, so UI text that did not exist in Pencil was introduced.

Examples that were removed:

- Command shortcut labels such as `⌘N`, `⌘1`, `⌘2`
- Alternate composer labels such as `Auto-review` and `5.5 Extra High`
- Placeholder square icon markers

## Evidence Used

Pencil nodes read earlier in this session:

- `Y0HOg0`: main Workbench frame
- `iiAyQ`: Left Session Rail
- `XLiWE`: Agent Chat Thread
- `FTlBh`: Thread Stream
- `t7PR0`: Workbench Area
- `AqpwT`: Workbench Tab Bar
- `b8RbZp`: Tab Browser
- `m8yBze`: Tab CLAUDE.md active
- `LByNZ`: Tab Long Filename Ellipsis
- `I9ReU`: Partial Overflow Tab Preview

Important Pencil values observed:

- Thread Stream padding: `[22, 30, 126, 30]`
- Thread Stream gap: `14`
- Workbench Tab Bar height: `52`
- Inactive tabs: transparent fill and transparent stroke
- Active tab: white fill and `#D9D6CF` stroke in Pencil
- Partial overflow tab: opacity `0.58`

Important Figma corrections already made:

- Removed inaccurate generated Figma import nodes.
- Rebuilt current main frame as `1223:2`.
- Replaced 46 placeholder square icons with SVG icons.
- Removed invented command shortcut text.
- Changed tab treatment toward Codex reference:
  - tab bar fill `#FBFAF7`
  - active tab fill `#F1F0ED`
  - active/inactive tab stroke removed
  - bottom rule retained
- Fixed Agent Chat Thread alignment:
  - `FTlBh / Thread Stream` changed from centered auto-layout to explicit layout.
  - Status/tool rows moved back to left padding.
  - User bubbles aligned to the right side of the stream.
  - Composer restored to `x=30`, `y=970`, `604x90`.

## Current Risk

At the time this note was written, Pencil's active editor was not the Tide `.pen` file.
It was `/Users/eatnug/Workspace/slice/slice`, so new Pencil reads against the target file were not safe.

Before continuing, reopen or focus:

`/Users/eatnug/Workspace/tide/docs_v2/designs/tide-codex-workbench.pen`

Then re-read the target with Pencil before making further claims or changes.

## Transfer Rules Going Forward

1. Do not invent UI text.
2. Do not infer shortcut labels unless they exist in Pencil.
3. Treat Pencil node data as source of truth.
4. Use Codex screenshots only for visual comparison, not for adding content.
5. If changing visual style away from Pencil, name it explicitly as a Codex-reference adjustment.
6. For Figma imports, verify:
   - no placeholder icon markers remain
   - no invented shortcut text remains
   - chat stream alignment is not centered unless Pencil says so
   - tabs do not read as heavy button pills

## Next Cleanup Pass

- Reopen the Tide `.pen` file in Pencil.
- Re-read `Y0HOg0`, `XLiWE`, `FTlBh`, and `AqpwT`.
- Compare current Figma `1223:2` against the fresh Pencil read.
- Decide explicitly whether the target is:
  - faithful Pencil transfer, or
  - Codex-reference polish based on Pencil content.
