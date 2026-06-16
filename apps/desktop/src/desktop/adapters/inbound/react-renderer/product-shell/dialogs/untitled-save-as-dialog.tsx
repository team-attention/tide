import { useState } from "react";
import type { ReactElement } from "react";
import { Save } from "lucide-react";
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
    <div
      className="worktree-create-backdrop"
      role="dialog"
      aria-label="Save file as"
      onMouseDown={(event: { target: EventTarget | null; currentTarget: EventTarget | null }) => {
        if (event.target === event.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div className="worktree-create">
        <div className="worktree-create__title">
          <Save size={15} strokeWidth={1.9} aria-hidden />
          {`Save ${props.title} as`}
        </div>
        <input
          className="worktree-create__input"
          autoFocus
          spellCheck={false}
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
        <div className="worktree-create__preview">{`Saving in ${scopeLabel}`}</div>
        {props.notice !== null ? <div className="worktree-delete__warn">{props.notice}</div> : null}
        <div className="worktree-create__actions">
          <button type="button" className="worktree-create__cancel" onClick={() => props.onClose()}>
            Cancel
          </button>
          <button
            type="button"
            className="worktree-create__confirm"
            disabled={path.trim().length === 0}
            onClick={submit}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
