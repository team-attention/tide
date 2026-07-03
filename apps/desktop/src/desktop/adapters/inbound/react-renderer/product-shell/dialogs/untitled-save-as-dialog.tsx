import { useState } from "react";
import type { ReactElement } from "react";
import { Save } from "lucide-react";
import {
  WorktreeDialogActions,
  WorktreeDialogBackdrop,
  WorktreeDialogCancelButton,
  WorktreeDialogConfirmButton,
  WorktreeDialogInput,
  WorktreeDialogPanel,
  WorktreeDialogPreview,
  WorktreeDialogTitle,
  WorktreeDialogWarning,
} from "./worktree-dialog.parts.tsx";
// Save As dialog for an untitled (blank) file: type the path to save under the
// workspace root, then it opens as a real file. Spec: workbench-filetree-file-operations.
export function UntitledSaveAsDialog(props: {
  title: string;
  // Absolute root the file saves under (shown as context).
  scopeCwd: string;
  // A transient error from the last attempt (e.g. a name collision), or null.
  notice: string | null;
  onSave: (relativePath: string) => void;
  onClose: () => void;
}): ReactElement {
  const [path, setPath] = useState("");
  // `||` (not `??`): a root cwd ("/") trims to "" then pops "", which `??` would keep.
  const scopeLabel = props.scopeCwd.replace(/\/+$/, "").split("/").pop() || props.scopeCwd;
  const submit = () => {
    if (path.trim().length > 0) {
      props.onSave(path);
    }
  };
  return (
    <WorktreeDialogBackdrop
      role="dialog"
      aria-label="Save file as"
      data-worktree-dialog="save-file-as"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <WorktreeDialogPanel>
        <WorktreeDialogTitle>
          <Save size={15} strokeWidth={1.9} aria-hidden />
          {`Save ${props.title} as`}
        </WorktreeDialogTitle>
        <WorktreeDialogInput
          autoFocus
          spellCheck={false}
          data-worktree-dialog-input="save-path"
          placeholder="path/to/file.ts"
          aria-label="File path"
          value={path}
          onChange={(event) => setPath(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              submit();
            } else if (event.key === "Escape") {
              event.preventDefault();
              props.onClose();
            }
          }}
        />
        <WorktreeDialogPreview>{`Saving in ${scopeLabel}`}</WorktreeDialogPreview>
        {props.notice !== null ? <WorktreeDialogWarning>{props.notice}</WorktreeDialogWarning> : null}
        <WorktreeDialogActions>
          <WorktreeDialogCancelButton type="button" onClick={() => props.onClose()}>
            Cancel
          </WorktreeDialogCancelButton>
          <WorktreeDialogConfirmButton
            type="button"
            data-worktree-create-confirm="true"
            disabled={path.trim().length === 0}
            onClick={submit}
          >
            Save
          </WorktreeDialogConfirmButton>
        </WorktreeDialogActions>
      </WorktreeDialogPanel>
    </WorktreeDialogBackdrop>
  );
}
