# Spec: Workbench Header — Layout-Aware Control Cluster & Pane Click Targets

## Scope

The fixed top-right window cluster (Stacked⇄Split · Fullscreen · New Pane · Workbench ·
FileTree) floats over whichever column/pane reaches the window's right edge. In **Split**
mode each pane owns its own 52px header, so the cluster floated over the (narrow) top-right
*pane* and its icons collided with that pane's tab title and close button. Two fixes,
delivered together:

### A. Pane-selection click targets

- **Stacked tab** — the tab label fills the full 52px tab height (`align-self: stretch`),
  so clicking anywhere up/down the tab focuses the pane, not just the icon+text strip.
- **Split pane header** — clicking anywhere on the header bar (the empty drag grip, not
  just the chip label) focuses the pane. Implemented in the pointer drag handler: a
  pointer-up with no drag (`!active`) calls `onFocusWorkbenchPane`. The close button stops
  propagation on pointerdown, so a close never starts a drag and never focuses.

### B. Layout-aware cluster — never collides with a pane header

The cluster always floats over the **rightmost** column/pane, so only that one header must
reserve the cluster's footprint. The form of the cluster is chosen by what it floats over:

| Situation | Cluster floats over | Cluster form | Reservation |
|-----------|--------------------|--------------|-------------|
| Stacked, roomy (col ≥ 400px) | tab strip | inline trio + 2 toggles | 210px on `.column-top-row` |
| Stacked, narrow (col < 400px) | tab strip | `…` (trio) + 2 toggles | 124px on `.column-top-row` |
| Split + filetree **open** | filetree column header | `…` (trio) + 2 toggles | 124px on `.column-top-row` |
| Split + filetree **closed** | the ~140px top-right **pane** | **single `…`** (trio **and** panel toggles inside) | 48px on the corner pane header |

- The renderer tags only the **top-right corner leaf** of the split tree
  (`data-corner="top-right"`; row node → right child, col node → top child) and reserves
  right-padding on *that* pane's header.
- A 3-button cluster (~124px) cannot coexist with a ~140px pane's chip+close (the chip
  overflows onto the cluster — the close button landed 31px *inside* it). So when the
  cluster floats over a split pane (`data-workbench-controls="dots"`) the **whole** cluster
  — chrome trio **and** the Workbench/FileTree toggles — collapses into one `…`, reserving
  only ~48px. The Split⇄Stacked toggle therefore stays reachable inside that `…` instead
  of being buried under the pane's close button.

## Verification

- Live (built app, Playwright): 3-pane split + filetree, and a 1080px window (corner pane
  138px). Corner pane reserves the cluster footprint; corner chip title clears the cluster;
  close button no longer overlaps the `…` (`gap −31px → +14px`); `…` → "Switch to Stacked"
  clicks through. Stacked tab label height == 52px.
- `npm run typecheck`, `npm test` (875 pass / 0 fail), `npm run build` green.
