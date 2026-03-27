# Tide — Codex Rules

This file adapts the project rules from `CLAUDE.md` for Codex in this repository.
If a higher-priority instruction conflicts with this file, follow the higher-priority instruction.

## Evidence First

Every factual claim about this codebase must be backed by evidence gathered in the current conversation.

- Read the relevant code before explaining behavior.
- Search before claiming something exists or does not exist.
- Check docs before describing architecture, rules, or workflow.
- If evidence is missing, say so and gather it first, or ask the user.

Do not answer first and verify later.

## Domain Language

Use the terms in [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md) for code, specs, commits, PR text, and explanations.
If a required term is missing, add it to the glossary before introducing it elsewhere.

Use glossary terms precisely, including:

- `Pane`
- `PaneKind`
- `Workspace`
- `TabGroup`
- `FocusArea`
- `SplitLayout`
- `ModalStack`
- `GlobalAction`
- `Generation`

## Source Of Truth

Use these documents before making terminology or architecture claims:

- [docs/glossary.md](/Users/eatnug/Workspace/tide/docs/glossary.md)
- [docs/context-map.md](/Users/eatnug/Workspace/tide/docs/context-map.md)
- [docs/testing/behavior-tests.md](/Users/eatnug/Workspace/tide/docs/testing/behavior-tests.md)
- [CLAUDE.md](/Users/eatnug/Workspace/tide/CLAUDE.md)

## Bounded Contexts

Treat the `tide-app` crate as the main implementation boundary and respect the documented bounded contexts in `CLAUDE.md` and the domain docs under [docs/domain](/Users/eatnug/Workspace/tide/docs/domain).

When describing or changing code, identify the affected bounded context explicitly.

## Required Delivery Order

For a feature or bug fix, follow this order:

1. Spec
2. Test
3. Code

Rules:

- Do not skip the spec.
- Do not implement before tests are updated or added.
- If requirements change during implementation, return to spec first, then tests, then code.
- Use glossary terms in specs and tests.

## Spec Rules

Store specs in `docs/specs/{feature}.md`.

Use this structure:

- `# Spec: {Name}`
- `## Overview`
- `### As-Is`
- `### To-Be`
- `### Approach`
- `## Bounded Contexts`
- `## Use Cases`
- `## Invariants`
- `## Tests`
- `## Location`

Current specs already live under [docs/specs](/Users/eatnug/Workspace/tide/docs/specs). Match their style and vocabulary.

## Behavior Test Rules

Behavior tests live under [crates/tide-app/src/behavior_tests](/Users/eatnug/Workspace/tide/crates/tide-app/src/behavior_tests).

Follow these conventions:

- Add the spec comment: `// Spec: docs/specs/{feature}.md`
- Mark each use-case section with `// --- UC-N: {Name} ---`
- Reference each business rule in the test comment: `// UC-N BR-M: ...`
- Use natural-language test names

Before changing behavior, read [docs/testing/behavior-tests.md](/Users/eatnug/Workspace/tide/docs/testing/behavior-tests.md).

## Architecture Invariants

Do not violate the invariants documented in [CLAUDE.md](/Users/eatnug/Workspace/tide/CLAUDE.md), especially:

- `PaneId` sync between `SplitLayout` and the app pane store
- single active `Workspace`
- `ModalStack` exclusivity
- input routing priority
- monotonic `Generation` behavior within a workspace session
- IME proxy lifecycle expectations
- hexagonal dependency direction

If a change requires altering an invariant, update the relevant spec and explain it explicitly.

## Hexagonal Rules

Respect the ports-and-adapters layering documented in `CLAUDE.md`.

- Inward adapters call inward ports; they do not directly mutate domain state.
- Application services own orchestration and may mutate app state.
- Domain code does not depend on adapter or application layers.
- Outward adapters implement outward ports and contain external I/O.

If an inward adapter needs new behavior, add or extend the appropriate port first.

## Commit And PR Text

Commit message format:

- `<verb> <what> in <module>`

Examples:

- `Add pane drag preview in tide-app`
- `Fix TabGroup active index after layout`

For PRs, use [.github/PULL_REQUEST_TEMPLATE.md](/Users/eatnug/Workspace/tide/.github/PULL_REQUEST_TEMPLATE.md) and include:

- affected spec and use case
- bounded context
- domain entities or aggregates changed
- invariants preserved or changed
- behavior tests added or updated

## Practical Codex Guidance

- Prefer repository evidence over memory.
- Preserve existing terminology and architectural boundaries.
- When making changes, keep explanations concrete and tied to files you read.
- If you find a mismatch between `CLAUDE.md` and the current code/docs, follow the current code/docs and call out the mismatch explicitly.
