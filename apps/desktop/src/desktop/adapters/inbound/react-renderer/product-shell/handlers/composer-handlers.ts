import { addProductShellComposerAttachment, addProductShellComposerContextChip, answerProductShellPromptSteps, answerProductShellPromptText, discardProductShellDraftThread, editProductShellQueuedInput, interruptProductShellRuntime, localBranchCheckoutRequest, planLocalBranchCheckout, refreshStartPageFileTree, removeProductShellComposerAttachment, removeProductShellComposerContextChip, removeProductShellQueuedInput, resolveProductShellComposerNewWorktree, selectProductShellChoiceSurfaceRow, setProductShellComposerActiveSurface, setProductShellComposerContextChipComment, setProductShellGitContext, setProductShellRegisteredProjects, submitProductShellComposerDraft, updateProductShellComposerDraft, ensureComposerDraftThreadActive, type LocalBranchCheckoutTarget, type ProductShellState } from "../../../../../application/domains/product-shell/product-shell.ts";
import type { AgentChatThreadScope } from "../../../../../application/domains/agent-chat/agent-chat.ts";
import { resolveWorktreeName } from "../../../../../../shared/worktree/name.ts";
import { makeWorktreeHash } from "../dialogs/worktree-name-input.tsx";
import type { GitContextResult, ProductShellHandlers } from "../support/types.ts";
import type { ProductShellHandlerContext } from "./context.ts";

// The Execution Context cwd a Composer scope points at — used to detect a project/worktree
// switch (which must discard the Composer's Draft Thread, whose panes belong to the old cwd).
function composerScopeCwd(scope: AgentChatThreadScope | undefined): string | undefined {
  if (scope === undefined) return undefined;
  return scope.kind === "project" ? scope.cwd : scope.scratchCwd;
}

function selectedBranchForNewWorktree(state: ProductShellState): string {
  const branches = state.gitBranches ?? [];
  const value = state.agentChat.thread
    ? state.agentChat.thread.launchOptions?.branch
    : state.agentChat.composer.startOptions.launchOptions?.branch;
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  for (const candidate of ["main", "master", "trunk"]) {
    if (branches.some((branch) => branch.name === candidate)) {
      return candidate;
    }
  }
  return branches.find((branch) => branch.current && branch.kind === "local")?.name ?? "main";
}
// Extracted from product-shell.ts (entry-module rule follow-up).

export function createComposerHandlers(ctx: ProductShellHandlerContext): Pick<ProductShellHandlers, "onDraftChange" | "onAddContentToChat" | "onRemoveContextChip" | "onSetContextChipComment" | "onAnswerPromptText" | "onAnswerPromptSteps" | "onSubmit" | "onBranchCheckoutConfirm" | "onBranchCheckoutCancel" | "onInterrupt" | "onEditQueued" | "onRemoveQueued" | "onResend" | "onQuote" | "onComposerSurfaceChange" | "onChoiceSurfaceRowSelect" | "onChoiceSurfaceInputSubmit" | "onOpencodeConnectApiKey" | "onAddAttachment" | "onRemoveAttachment" | "onSetGoal"> {
  const { props, shellState, getShellState, setShellState, viewModel, dispatchBackendCommand, applyBackendEvents, themePref, setThemePref, menuAnchor, setMenuAnchor, collapsedSections, setCollapsedSections, columnWidths, setColumnWidths, setIsResizing, quickOpenVisible, setQuickOpenVisible, contentSearchVisible, setContentSearchVisible, worktreeCreate, setWorktreeCreate, worktreeDelete, setWorktreeDelete, branchCheckout, setBranchCheckout, setBranchCheckoutBusy, windowWidth, bodyRef, lastSubmitAtRef, openFolderAsProject, openFolderForScope, submitWorktreeCreate, openWorktreeDeleteByCwd, confirmWorktreeDelete, openBranchDeleteByName, startColumnResize } = ctx;
  const submitDraftNow = (gitContext?: GitContextResult): void => {
    setShellState((state) => {
      const stateWithGit =
        gitContext !== undefined && gitContext.isGitRepo
          ? setProductShellGitContext(state, {
              branches: gitContext.branches,
              worktrees: gitContext.worktrees,
            })
          : state;
      const result = submitProductShellComposerDraft(stateWithGit);
      dispatchBackendCommand(result.command);
      return result.state;
    });
  };

  const showBranchCheckoutFailure = (
    target: LocalBranchCheckoutTarget,
    fallbackMessage: string,
  ): void => {
    setBranchCheckout({
      ...target,
      error: target.error ?? fallbackMessage,
    });
    setBranchCheckoutBusy(false);
    lastSubmitAtRef.current = 0;
  };

  const submitAfterLocalBranchCheckout = (allowRunningCheckout = false): void => {
    const bridge = props.projectBridge;
    const request = localBranchCheckoutRequest(getShellState());
    const checkoutBranch = bridge?.checkoutBranch;
    if (bridge === undefined || typeof checkoutBranch !== "function" || request === null) {
      submitDraftNow();
      return;
    }

    bridge
      .gitContext(request.cwd)
      .then((context) => {
        const plan = planLocalBranchCheckout({
          state: getShellState(),
          request,
          gitContext: context,
          allowRunningCheckout,
        });
        if (plan.kind === "none") {
          setBranchCheckout(null);
          setBranchCheckoutBusy(false);
          submitDraftNow(context);
          return;
        }
        if (plan.kind === "blocked") {
          showBranchCheckoutFailure(plan.target, `Couldn't switch to ${plan.target.branch}.`);
          return;
        }
        if (plan.kind === "warn_running") {
          setBranchCheckout(plan.target);
          setBranchCheckoutBusy(false);
          lastSubmitAtRef.current = 0;
          return;
        }

        if (branchCheckout !== null) {
          setBranchCheckoutBusy(true);
        }
        checkoutBranch(plan.target.cwd, plan.target.branch)
          .then((result) => {
            if (!result.checkedOut) {
              showBranchCheckoutFailure(
                {
                  ...plan.target,
                  currentBranch: result.currentBranch ?? plan.target.currentBranch,
                  error: result.error,
                },
                `Couldn't switch to ${plan.target.branch}.`,
              );
              return;
            }
            bridge
              .gitContext(plan.target.cwd)
              .catch(() => context)
              .then((freshContext) => {
                setBranchCheckout(null);
                setBranchCheckoutBusy(false);
                submitDraftNow(freshContext);
              });
          })
          .catch(() => {
            showBranchCheckoutFailure(plan.target, `Couldn't switch to ${plan.target.branch}.`);
          });
      })
      .catch(() => {
        submitDraftNow();
      });
  };

  return {
    onDraftChange: (draft) => setShellState((state) => updateProductShellComposerDraft(state, draft)),
    // Set/clear the active thread's goal from the Goal & Checklist panel. The backend
    // persists it and pushes it to the provider's native goal mechanism, then echoes
    // thread.goalSet to update the panel. See thread-goal-and-checklist-panel.md.
    onSetGoal: (goal) => {
      const threadId = getShellState().agentChat.thread?.threadId;
      if (threadId !== undefined) {
        dispatchBackendCommand({ kind: "thread.setGoal", payload: { threadId, goal } });
      }
    },
    // The on-ramp panel's in-app API-key field → set the vendor key the canonical way
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
    onAnswerPromptText: (value, notes) =>
      setShellState((state) => {
        const result = answerProductShellPromptText(state, value, notes);
        dispatchBackendCommand(result.command);
        return result.state;
      }),
    onAnswerPromptSteps: (stepAnswers) =>
      setShellState((state) => {
        const result = answerProductShellPromptSteps(state, stepAnswers);
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
      const currentState = getShellState();
      const composer = currentState.agentChat.composer;
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
        const { baseDirPattern, copyFiles } = currentState.worktreeSettings;
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

      submitAfterLocalBranchCheckout(false);
    },
    onBranchCheckoutConfirm: () => submitAfterLocalBranchCheckout(true),
    onBranchCheckoutCancel: () => {
      setBranchCheckout(null);
      setBranchCheckoutBusy(false);
      lastSubmitAtRef.current = 0;
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
    onChoiceSurfaceInputSubmit: (surfaceKind, rowId, value) => {
      if (surfaceKind === "branch_menu" && rowId === "create-branch") {
        submitWorktreeCreate(value, selectedBranchForNewWorktree(shellState));
      }
    },
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
      // The trailing trash on a branch row opens the branch-delete dialog (the
      // branch name is in the rowId; the repo cwd comes from the active scope).
      // See docs_v2/specs/branch-deletion-from-picker.md.
      if (surfaceKind === "branch_menu" && rowId.startsWith("delete-branch:")) {
        const branch = rowId.slice("delete-branch:".length);
        const scope = shellState.agentChat.thread?.scope ?? shellState.agentChat.composer.startOptions.scope;
        const cwd =
          scope === undefined
            ? undefined
            : scope.kind === "project"
            ? scope.cwd
            : scope.scratchCwd;
        setShellState((state) => setProductShellComposerActiveSurface(state, null));
        if (cwd !== undefined) {
          openBranchDeleteByName(cwd, branch);
        }
        return;
      }
      // Selecting an agent slot: select it, ensure a Draft Thread to host any readiness terminal,
      // and run Provider Readiness so a not-installed / not-signed-in agent surfaces its
      // install / sign-in card immediately (not only on Send). Spec: provider-cli-setup-handoff.md.
      if (surfaceKind === "agent_menu") {
        const selected = selectProductShellChoiceSurfaceRow(getShellState(), surfaceKind, rowId);
        const ensured = ensureComposerDraftThreadActive(selected.state);
        const threadId = ensured.state.draftThreadId;
        setShellState(ensured.state);
        if (selected.command !== null) dispatchBackendCommand(selected.command);
        if (ensured.command !== null) dispatchBackendCommand(ensured.command);
        if (threadId !== null) {
          dispatchBackendCommand({
            kind: "provider.checkReadiness",
            payload: {
              threadId,
              agentId: ensured.state.agentChat.composer.startOptions.agentBinding.agentId,
            },
          });
        }
        return;
      }
      setShellState((state) => {
        const result = selectProductShellChoiceSurfaceRow(state, surfaceKind, rowId);
        // A project/worktree switch changes the Execution Context cwd → discard the
        // Composer's Draft Thread so its panes (Terminal etc., bound to the old cwd) close,
        // like every other pane. A branch switch keeps the cwd → no discard. (composer-draft-thread)
        let next = result.state;
        if (composerScopeCwd(state.agentChat.composer.startOptions.scope) !== composerScopeCwd(next.agentChat.composer.startOptions.scope)) {
          const discarded = discardProductShellDraftThread(next);
          if (discarded.command !== null) dispatchBackendCommand(discarded.command);
          next = discarded.state;
        }
        dispatchBackendCommand(result.command);
        // Changing the start-page scope chip reloads the file tree for that directory.
        dispatchBackendCommand(refreshStartPageFileTree(next));
        return next;
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
