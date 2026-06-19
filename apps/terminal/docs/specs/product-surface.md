# Product Surface

This spec covers the first-run product surface that makes Tide's model legible
without blocking normal terminal work.

## UC-1: Explain The Workbench Model

Business rules:

- BR-1: A fresh profile shows a compact first-run guide.
- BR-2: The guide names the task boundary, live terminal stage, terminal context
  surface, and reviewed Context Artifact handoff.
- BR-3: Clicking the guide body does not dismiss it.
- BR-4: Clicking the dismiss control persists the onboarding setting, requests a
  redraw, and broadcasts the settings change to other windows.
- BR-5: The guide hides while other Tide modal or popup surfaces are open.
