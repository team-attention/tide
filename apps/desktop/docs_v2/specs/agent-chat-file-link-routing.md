# Spec: Agent Chat File Link Routing

## Scope

Agent Chat markdown links that point at local files should open the file in the
Thread Workbench Editor Pane instead of rendering as inert browser-style anchors.

In scope:

- `file:///absolute/path` links.
- POSIX absolute path links such as `/Users/me/repo/src/file.ts`.
- Optional `:line` or `:line:column` suffixes produced by Codex-style file links.

Out of scope:

- Cursor movement to the linked line.
- Windows drive-letter path parsing.
- Opening files outside the active Thread root.

## Evidence

- Agent Chat markdown currently marks only `file://` hrefs with `data-open-file`.
- Codex-style final answers render local file links as `/absolute/path:line`.
- `createAgentSession` opens only anchors carrying `data-open-file`.
- Backend `open_editor` already validates paths through the Thread-root scoped
  `WorkspaceFilePort`, so the renderer should only normalize the link target.

## Decisions

- D1. The Agent Chat markdown renderer owns link-shape normalization.
- D2. Absolute local paths are rendered as `href="#"` plus `data-open-file`.
- D3. A trailing `:line` or `:line:column` suffix is stripped before `data-open-file`
  is emitted. Line navigation is a later Editor Pane contract.
- D4. Backend root validation remains authoritative; the renderer does not decide
  whether the path is allowed.

## Domain Model

```ts
interface AgentChatFileLinkTarget {
  path: string;
}
```

## Contracts

- Input markdown:
  - `[x](file:///Users/me/repo/a.ts)`
  - `[x](/Users/me/repo/a.ts:12)`
- Rendered anchor:
  - `href="#"`
  - `class="md-file-link"`
  - `data-open-file="/Users/me/repo/a.ts"`

## Flow

1. Agent Chat renders an agent message body as markdown.
2. The link renderer detects a local file href.
3. It decodes the path and strips an optional line/column suffix.
4. It writes `data-open-file` and replaces the href with `#`.
5. The session click delegate prevents anchor navigation and calls `onOpenFile(path)`.
6. Product Shell emits `workbench.command open_editor`.
7. Backend validates the path against the Thread root and opens or rejects it.

## Invariants

- Local file links never navigate the app window.
- Link parsing never bypasses Backend path validation.
- Unsupported links keep their normal markdown rendering.

## Tests

- `file://` links still render with `data-open-file`.
- POSIX absolute links with `:line` render with `data-open-file` stripped to the
  file path.
- Clicking a `data-open-file` link calls the file-open handler and prevents
  default anchor navigation.

## Implementation Notes

- Keep parsing local to `agent-chat/transcript/markdown.tsx`.
- Do not add line navigation until Editor Pane open commands accept a cursor target.
