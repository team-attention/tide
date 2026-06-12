# Spec: Composer Image Attachments

## Scope

Let the user attach images to a Composer message by paste (clipboard) and see a
preview before sending, for all three provider CLIs (codex, claude, antigravity).
On send, Tide materializes each image to a file inside the Thread workspace and
references its absolute path in the message text so the Agent can read it.

In scope:
- Clipboard image paste into the Composer (Start and Follow-up).
- Preview chips (thumbnail + remove) shown above the textarea.
- Carrying attachments through `composer.sendInput` to Backend.
- Backend materializing attachments to files + appending path references to the
  message text, for the initial-prompt path and the follow-up writeInput path.

## Evidence

- `codex --help` exposes `-i, --image <FILE>...` ("attach to the initial prompt"),
  but Tide keeps one long-running PTY session and delivers follow-ups by typing
  into the TUI (`thread-runtime-service.ts` `writeInput`), so a launch-only flag
  cannot serve follow-up turns.
- `claude --help` has `--file file_id:relative_path` (startup download), not a
  per-turn image input.
- All three are agentic coding tools whose own file-read surface renders images;
  the one mechanism that works uniformly for initial + follow-up across providers
  is to write the image to a real file and tell the Agent its absolute path in the
  message text. (`thread-runtime-service.ts:984-1011` initial via launch
  `initialPrompt`; `:1095` follow-up via `writeInput` of `input.input`.)
- Composer state lives in `agent-chat-shell-state.ts` `AgentChatComposerState`;
  `composer.sendInput` payload is `{ threadId; input; launchOptions? }`
  (`shared/contracts/commands.ts`).

## Decisions

- A **Composer Attachment** is `{ name; mediaType; dataBase64 }` at the contract
  boundary. Preview uses a `data:` URL built from those fields (no extra dep).
- Backend writes attachments to `<cwd>/.tide/attachments/<ms>-<n>-<safeName>` and
  appends one `[Attached image: <abs path>]` line per file after the message text.
  Uniform for initial prompt and follow-up; no provider-specific image flag.
- Attachments are cleared from the Composer on a successful send.

## Out Of Scope

- Drag-and-drop and file-picker attach (paste only for this slice).
- Non-image attachments (gate paste to `image/*`).
- Provider-native image-paste TUI protocols and codex `-i` (path-in-text only).
- End-to-end proof the Agent actually consumed the image (cannot spawn a provider
  here); verified by unit tests on materialization + message composition and a UI
  screenshot of the preview.

## Domain Model

- **Composer Attachment** (glossary): an image the user attaches to the next
  Composer message via paste, shown as a preview chip; on send Tide materializes
  it to a file in the Thread workspace and references its path in the message.

## Contracts

- `ComposerAttachment = { name: string; mediaType: string; dataBase64: string }`.
- `composer.sendInput` payload gains `attachments?: ComposerAttachment[]`.
- `thread.start` payload gains `attachments?: ComposerAttachment[]`.

## Flow

1. User pastes an image into the Composer textarea.
2. Renderer reads the `image/*` clipboard item as base64, adds a draft attachment;
   a preview chip (thumbnail + ×) renders above the textarea.
3. On send, the `composer.sendInput` intent carries `attachments`; Composer draft
   attachments clear.
4. Backend `sendComposerInput` / `startThread` materialize attachments under
   `<cwd>/.tide/attachments/` and compose `text + "\n\n" + path lines`.
5. The composed message is delivered via launch initialPrompt or writeInput.

## Invariants

- Attachments are gated to `image/*`.
- A message with no text but with attachments still sends (path lines only).
- Materialized files live inside the Thread scope cwd (never outside).
- Composer attachments clear only after a successful (non-error) send.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 Materialize | BR-1 writes each image under `<cwd>/.tide/attachments/` | `materializes_pasted_images_into_the_thread_workspace` |
| UC-1 Materialize | BR-2 appends one path line per attachment to the message | `appends_attachment_path_references_to_the_message_text` |
| UC-1 Materialize | BR-3 text-empty message still carries the path lines | `sends_attachment_paths_when_the_message_text_is_empty` |
| UC-2 Compose state | BR-4 add/remove attachment in Composer draft | `adds_and_removes_composer_image_attachments` |
| UC-2 Compose state | BR-5 send clears Composer attachments | `clears_composer_attachments_after_send` |

## Implementation Notes

- Contract: `shared/contracts/commands.ts` (+ preload/renderer global types).
- Backend: `thread-runtime-service.ts` — a `materializeAttachments(cwd, atts)` +
  `composeMessage(text, paths)` helper used by both entry points.
- Renderer: `agent-chat-shell-state.ts` attachment state + reducers; composer
  paste handler + preview chips in `agent-chat-shell.ts`.

## Location

- `src/shared/contracts/commands.ts`
- `src/backend/application/services/thread-runtime-service.ts`
- `src/desktop/application/domains/agent-chat/agent-chat-shell-state.ts`
- `src/desktop/adapters/inbound/react-renderer/agent-chat/agent-chat.ts`
