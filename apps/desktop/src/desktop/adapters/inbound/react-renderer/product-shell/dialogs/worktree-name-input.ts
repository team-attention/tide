import { createElement, useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { computeWorktreePath } from "../../../../../../shared/worktree-path.ts";
import { GitBranchPlus } from "lucide-react";
// Extracted from tide-product-shell.ts (spec: navigable-source-structure).

// A short random worktree name, used when there is no typed name and the first
// message yields no usable ASCII slug (e.g. an all-Korean message). crypto-backed
// so repeats don't collide. See docs_v2/specs/worktree-start-experience.md.
export function makeWorktreeHash(): string {
  const bytes = new Uint8Array(3);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `wt-${hex}`;
}

// Inline "new worktree" form (opened from the composer worktree menu). The name
// is OPTIONAL: leaving it blank defers naming to send time, where the
// worktree/branch name is derived from the first message (or a hash). A base
// branch picker chooses what the new worktree branches off (default: current).
// The worktree is created on send, not here. Shows a live path preview when named.
export function WorktreeNameInput(props: {
  baseCwd: string;
  baseDirPattern: string;
  branches: { name: string; kind: "local" | "remote"; current: boolean }[];
  onSubmit: (name: string, baseBranch: string) => void;
  onClose: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  // Local branches before remote; default to the repo's current branch.
  const orderedBranches = [...props.branches].sort(
    (a, b) => Number(a.kind === "remote") - Number(b.kind === "remote"),
  );
  const [baseBranch, setBaseBranch] = useState(
    () => props.branches.find((branch) => branch.current)?.name ?? "",
  );
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const preview =
    name.trim().length > 0
      ? computeWorktreePath(props.baseCwd, name, { baseDirPattern: props.baseDirPattern })
      : "";
  return createElement(
    "div",
    {
      className: "worktree-create-backdrop",
      role: "dialog",
      "aria-label": "New worktree",
      onMouseDown: (event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      },
    },
    createElement(
      "div",
      { className: "worktree-create" },
      createElement(
        "div",
        { className: "worktree-create__title" },
        createElement(GitBranchPlus, { size: 15, strokeWidth: 1.9, "aria-hidden": true }),
        "New worktree",
      ),
      createElement("input", {
        ref: inputRef,
        className: "worktree-create__input",
        placeholder: "name (optional — auto-named from your first message)",
        value: name,
        spellCheck: false,
        "aria-label": "Worktree branch name (optional)",
        onChange: (event: ChangeEvent<HTMLInputElement>) => setName(event.currentTarget.value),
        onKeyDown: (event: ReactKeyboardEvent<HTMLInputElement>) => {
          if (event.key === "Enter") {
            event.preventDefault();
            props.onSubmit(name, baseBranch);
          } else if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
          }
        },
      }),
      orderedBranches.length > 0
        ? createElement(
            "label",
            { className: "worktree-create__field" },
            createElement("span", { className: "worktree-create__field-label" }, "Branch from"),
            createElement(
              "select",
              {
                className: "worktree-create__select",
                value: baseBranch,
                "aria-label": "Base branch for the new worktree",
                onChange: (event: ChangeEvent<HTMLSelectElement>) => setBaseBranch(event.currentTarget.value),
              },
              orderedBranches.map((branch) =>
                createElement(
                  "option",
                  { key: `${branch.kind}:${branch.name}`, value: branch.name },
                  branch.current ? `${branch.name} (current)` : branch.kind === "remote" ? `${branch.name} (remote)` : branch.name,
                ),
              ),
            ),
          )
        : null,
      createElement(
        "div",
        { className: "worktree-create__preview" },
        preview.length > 0
          ? `${preview}${baseBranch.length > 0 ? ` · off ${baseBranch}` : ""}`
          : `Created on send · named from your first message, or a short hash${baseBranch.length > 0 ? ` · off ${baseBranch}` : ""}`,
      ),
      createElement(
        "div",
        { className: "worktree-create__actions" },
        createElement(
          "button",
          { type: "button", className: "worktree-create__cancel", onClick: () => props.onClose() },
          "Cancel",
        ),
        createElement(
          "button",
          {
            type: "button",
            className: "worktree-create__confirm",
            onClick: () => props.onSubmit(name, baseBranch),
          },
          "Use worktree",
        ),
      ),
    ),
  );
}
