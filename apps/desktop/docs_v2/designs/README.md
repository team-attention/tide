# Tide Design Registry

## Source of Truth

Tide design work is managed in Figma from now on.

- Figma file: [Thirdcommit](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit)
- Tide page: [Tide page](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1192-2)
- Canonical design board: [1472:52](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1472-52), `Tide Canonical Design Board / All Edge States`
- Current Workbench frame: [1223:2](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1223-2), inside the canonical board
- Current color scheme frame: [1268:2](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1268-2), `Tide Comprehensive Palette / Canonical`
- Left rail row state frame: [1288:2](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1288-2), inside the canonical board
- Main UI layout state frame: [1303:55](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1303-55), inside the canonical board
- New Thread Start variants inside Main UI layout:
  [1531:53](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1531-53), left rail open;
  [1531:468](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1531-468), left rail closed.
- Agent Session edge frame: [1338:56](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1338-56), `Agent Session Edge UI / Composer Delegated`, inside the canonical board
- Canonical Composer state map: [1357:2](https://www.figma.com/design/xGdklVljCkVjA8L9ZzLYxj/Thirdcommit?node-id=1357-2), `Composer Canonical State Map / Provider + Prompt Edges`, inside the canonical board
- File key: `xGdklVljCkVjA8L9ZzLYxj`

## Color Scheme

The current direction is reduced and restrained. Product UI surfaces should use the canonical 8-color set in the Figma palette frame, not one-off beige, gray, or dark-mode variants.

- `bg`: `#FCFCFB`
- `surface`: `#F7F7F5`
- `selection`: `#EEEDEA`
- `line`: `#E4E2DE`
- `text`: `#242424`
- `muted`: `#8A8781`
- `action`: `#343038`
- `danger`: `#BA322F`

Type roles:

- `title`: Inter Semi Bold 16
- `body`: Inter Regular 14
- `label`: Inter Medium 12
- `meta`: Inter Regular 12
- `composerInput`: Inter Regular 18

Elevation:

- Inline surfaces use no shadow.
- Popovers use one shadow only: `0 8 18 -10`, `#343038` at 12%.
- Composer input may use a softer shadow: `0 6 14 -12`, `#343038` at 6%.

## Local Files

- `tide-codex-workbench.pen`: legacy Pencil exploration/reference. Do not treat it as the primary design source after the Figma migration.
- `tide-codex-workbench-figma-transfer.md`: notes from the Pencil-to-Figma transfer and known correction rules.
- `image.png`: local visual reference asset.

## Working Rules

1. New Tide product UI design decisions should be made in Figma first.
2. Implementation specs and code work should reference the relevant Figma page or frame when design behavior matters.
3. Pencil files may be used only as historical reference unless explicitly promoted again.
4. Never invent UI text or shortcut labels during design transfer. Use the Figma frame as the current source.
5. If a Figma frame is adjusted away from legacy Pencil, record whether the change is a Codex-reference polish or a product decision.
6. The Composer Agent chip is visually singular, but design annotations must distinguish the selected Provider CLI Agent when model, permission, or setup behavior depends on source.
7. Composer shell states, source-aware menus, Prompt State surfaces, and Provider Readiness composer behavior live in the canonical Composer state map. Other frames may reference that map, but should not duplicate Composer drawings.
8. New Thread Start screens show only the Start Composer launch context and title. Do not add fake cue, prompt queue, or recent task rows below the Composer.
