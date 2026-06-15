import { addProductShellComposerAttachment, addProductShellComposerContextChip, answerProductShellPromptText, editProductShellQueuedInput, interruptProductShellRuntime, refreshStartPageFileTree, removeProductShellComposerAttachment, removeProductShellComposerContextChip, removeProductShellQueuedInput, resolveProductShellComposerNewWorktree, selectProductShellChoiceSurfaceRow, setProductShellComposerActiveSurface, setProductShellComposerContextChipComment, setProductShellRegisteredProjects, submitProductShellComposerDraft, updateProductShellComposerDraft } from "../../../../../application/domains/product-shell/product-shell.ts";
import { resolveWorktreeName } from "../../../../../../shared/worktree/name.ts";
import { makeWorktreeHash } from "../dialogs/worktree-name-input.tsx";
// Extracted from product-shell.ts (entry-module rule follow-up).

import type { ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

export function createComposerHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onDraftChange" | "onAddContentToChat" | "onRemoveContextChip" | "onSetContextChipComment" | "onAnswerPromptText" | "onSubmit" | "onInterrupt" | "onEditQueued" | "onRemoveQueued" | "onResend" | "onQuote" | "onComposerSurfaceChange" | "onChoiceSurfaceRowSelect" | "onOpencodeConnectApiKey" | "onAddAttachment" | "onRemoveAttachment"> {
  const { props, shellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, startColumnResize } = ctx;
  return {
    onDraftChange: (draft) => setShellState((state) => updateProductShellComposerDraft(state, draft)),
    // The on-ramp panel's in-app API-key field → set the vendor key the 정석 way
    // (backend PUTs it to opencode's own server, then re-lists so the panel updates).
    onOpencodeConnectApiKey: (vendorId, key) =>
      dispatchBackendCommand({ kind: "provider.opencodeConnectApiKey", payload: { vendorId, key } }),
    onAddContentToChat: (chip) =>
      setShellState((state) =>
        addProductShellComposerContextChip(state, {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `chip-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          kind: chip.kind,
          label: chip.label,
          text: chip.text,
        }),
      ),
    onRemoveContextChip: (id) =>
      setShellState((state) => removeProductShellComposerContextChip(state, id)),
    onSetContextChipComment: (id, comment) =>
      setShellState((state) => setProductShellComposerContextChipComment(state, id, comment)),
    onAnswerPromptText: (value) =>
      setShellState((state) => {
        const result = answerProductShellPromptText(state, value);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onSubmit: () => {
      // Throttle to swallow accidental double-clicks / double Enter so the same
      // draft is never submitted twice in quick succession.
      const now = Date.now();
      if (now - lastSubmitAtRef.current < 700) {
        return;
      }
      lastSubmitAtRef.current = now;

      // Deferred "New worktree": create the worktree first (name derived from the
      // first message when not typed), then submit the draft scoped to it. The
      // worktree/branch name is decided once, here, so no live directory is moved.
      const composer = shellState.agentChat.composer;
      const launch = composer.startOptions.launchOptions ?? {};
      const scope = composer.startOptions.scope;
      const bridge = props.projectBridge;
      if (launch.worktree === "new" && scope?.kind === "project" && bridge !== undefined) {
        const typedName = typeof launch.newWorktreeName === "string" ? launch.newWorktreeName : "";
        const baseBranch = typeof launch.branch === "string" ? launch.branch : undefined;
        const name = resolveWorktreeName({
          typedName,
          firstMessage: composer.draft,
          makeHash: makeWorktreeHash,
        });
        const { baseDirPattern, copyFiles } = shellState.worktreeSettings;
        bridge
          .createWorktree(scope.cwd, name, { baseDirPattern, copyFiles, baseBranch })
          .then((result) => {
            if (result.createdCwd === null) {
              // Creation failed (e.g. the branch already exists). Keep the draft +
              // intent so the user can rename and retry; allow an immediate resend.
              lastSubmitAtRef.current = 0;
              return;
            }
            setShellState((state) => {
              let next = setProductShellRegisteredProjects(state, result.entries);
              next = resolveProductShellComposerNewWorktree(next, {
                cwd: result.createdCwd as string,
                branch: name,
              });
              const submitted = submitProductShellComposerDraft(next);
              dispatchBackendCommand(submitted.command);
              dispatchBackendCommand(refreshStartPageFileTree(submitted.state));
              return submitted.state;
            });
          })
          .catch(() => {
            lastSubmitAtRef.current = 0;
          });
        return;
      }

      setShellState((state) => {
        const result = submitProductShellComposerDraft(state);
        dispatchBackendCommand(result.command);
        return result.state;
      });
    },
    onInterrupt: () =>
      setShellState((state) => {
        const result = interruptProductShellRuntime(state);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onEditQueued: (index) =>
      setShellState((state) => {
        const result = editProductShellQueuedInput(state, index);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onRemoveQueued: (index) =>
      setShellState((state) => {
        const result = removeProductShellQueuedInput(state, index);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onResend: (text) =>
      setShellState((state) => {
        const drafted = updateProductShellComposerDraft(state, text);
        const result = submitProductShellComposerDraft(drafted);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onQuote: (text) =>
      setShellState((state) =>
        addProductShellComposerContextChip(state, {
          id:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `chip-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          kind: "message",
          label: text.length > 32 ? `${text.slice(0, 32)}…` : text,
          text: text
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n"),
        }),
      ),
    onComposerSurfaceChange: (surface) =>
      setShellState((state) => setProductShellComposerActiveSurface(state, surface)),
    onChoiceSurfaceRowSelect: (surfaceKind, rowId) => {
      // "Open folder" in the chip only scopes the Start Composer to the picked
      // folder (Execution Context). It is NOT registered as a persisted project
      // here — registration/left-list appearance happens via the Projects "+"
      // button or when a Thread is actually started in the folder.
      if (surfaceKind === "project_menu" && rowId === "open-folder") {
        openFolderForScope();
        setShellState((state) => setProductShellComposerActiveSurface(state, null));
        return;
      }
      // The trailing trash on a worktree row opens the delete dialog for that
      // worktree (the cwd is carried in the rowId). See
      // docs_v2/specs/worktree-branch-deletion.md.
      if (surfaceKind === "worktree_menu" && rowId.startsWith("delete-worktree:")) {
        const cwd = rowId.slice("delete-worktree:".length);
        setShellState((state) => setProductShellComposerActiveSurface(state, null));
        openWorktreeDeleteByCwd(cwd);
        return;
      }
      // "New worktree" / "Create new branch" open an inline name input; creation
      // runs on submit and re-scopes the composer to the new worktree.
      if (
        (surfaceKind === "worktree_menu" && rowId === "new-worktree") ||
        (surfaceKind === "branch_menu" && rowId === "create-branch")
      ) {
        const scope = shellState.agentChat.composer.startOptions.scope;
        const baseCwd =
          scope === undefined
            ? undefined
            : scope.kind === "project"
            ? scope.cwd
            : scope.scratchCwd;
        if (baseCwd !== undefined) {
          setWorktreeCreate({ baseCwd });
        }
        setShellState((state) => setProductShellComposerActiveSurface(state, null));
        return;
      }
      setShellState((state) => {
        const result = selectProductShellChoiceSurfaceRow(state, surfaceKind, rowId);
        dispatchBackendCommand(result.command);
        // Changing the start-page scope chip reloads the file tree for that directory.
        dispatchBackendCommand(refreshStartPageFileTree(result.state));
        return result.state;
      });
    },
    onAddAttachment: (attachment) =>
      setShellState((state) => {
        const id =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `attachment-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return addProductShellComposerAttachment(state, { id, ...attachment });
      }),
    onRemoveAttachment: (attachmentId) =>
      setShellState((state) =>
        removeProductShellComposerAttachment(state, attachmentId),
      ),
  };
}
