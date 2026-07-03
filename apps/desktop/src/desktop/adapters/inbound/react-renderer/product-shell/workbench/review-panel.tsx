import { useMemo, useState, type ReactElement } from "react";
import { styled } from "styled-components";
import { CheckCircle2, ClipboardCheck, Loader2, Send, TriangleAlert } from "lucide-react";
import type {
  ProductShellHandlers,
  ReviewProvider,
  ReviewRunResult,
  ReviewTarget,
} from "../support/types.ts";
import { parseReviewFindings } from "../../../../../application/domains/product-shell/state/review-findings.ts";

type ReviewTargetKind = ReviewTarget["kind"];

export function ReviewPanel(props: {
  cwd: string;
  agentId?: ReviewProvider;
  handlers: ProductShellHandlers;
}): ReactElement {
  const { cwd, handlers } = props;
  const [provider, setProvider] = useState<ReviewProvider>(props.agentId ?? "codex");
  const [targetKind, setTargetKind] = useState<ReviewTargetKind>("uncommitted");
  const [baseBranch, setBaseBranch] = useState("main");
  const [commitSha, setCommitSha] = useState("");
  const [commitTitle, setCommitTitle] = useState("");
  const [customInstructions, setCustomInstructions] = useState("");
  const [customDiff, setCustomDiff] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ReviewRunResult | null>(null);

  const target = useMemo<ReviewTarget | null>(() => {
    switch (targetKind) {
      case "uncommitted":
        return { kind: "uncommitted" };
      case "base_branch":
        return baseBranch.trim().length > 0 ? { kind: "base_branch", baseBranch: baseBranch.trim() } : null;
      case "commit":
        return commitSha.trim().length > 0
          ? {
              kind: "commit",
              sha: commitSha.trim(),
              ...(commitTitle.trim().length > 0 ? { title: commitTitle.trim() } : {}),
            }
          : null;
      case "custom":
        return customInstructions.trim().length > 0
          ? {
              kind: "custom",
              instructions: customInstructions.trim(),
              ...(customDiff.trim().length > 0 ? { diff: customDiff } : {}),
            }
          : null;
    }
  }, [baseBranch, commitSha, commitTitle, customDiff, customInstructions, targetKind]);

  const findings = useMemo(() => {
    if (result === null) {
      return [];
    }
    return result.findings.length > 0 ? result.findings : parseReviewFindings(result.rawText);
  }, [result]);

  async function runReview(): Promise<void> {
    if (target === null || running) {
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      setResult(await handlers.onRunReview(cwd, provider, target));
    } finally {
      setRunning(false);
    }
  }

  function askAgentToFix(): void {
    if (result === null || result.rawText.trim().length === 0) {
      return;
    }
    handlers.onAddContentToChat({
      kind: "message",
      label: "Review findings",
      text: result.rawText,
    });
    handlers.onDraftChange("Please fix the review findings I attached. Keep the changes focused and explain what you changed.");
  }

  return (
    <ReviewPaneFrame role="group" aria-label="Code review">
      <ReviewHeader>
        <ReviewTitle>
          <ClipboardCheck size={16} strokeWidth={1.9} aria-hidden />
          <span>Review</span>
        </ReviewTitle>
        <ReviewHeaderMeta>{providerLabel(provider)} - {sourceLabel(result?.source)}</ReviewHeaderMeta>
      </ReviewHeader>
      <ReviewControls>
        <ReviewField>
          <ReviewLabel htmlFor="review-provider">Provider</ReviewLabel>
          <ReviewSelect
            id="review-provider"
            value={provider}
            onChange={(event) => setProvider(event.currentTarget.value as ReviewProvider)}
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude</option>
            <option value="opencode">opencode</option>
          </ReviewSelect>
        </ReviewField>
        <ReviewField>
          <ReviewLabel htmlFor="review-target">Target</ReviewLabel>
          <ReviewSelect
            id="review-target"
            value={targetKind}
            onChange={(event) => setTargetKind(event.currentTarget.value as ReviewTargetKind)}
          >
            <option value="uncommitted">Uncommitted</option>
            <option value="base_branch">Base branch</option>
            <option value="commit">Commit</option>
            <option value="custom">Custom</option>
          </ReviewSelect>
        </ReviewField>
        {targetKind === "base_branch" ? (
          <ReviewField>
            <ReviewLabel htmlFor="review-base">Base</ReviewLabel>
            <ReviewInput
              id="review-base"
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.currentTarget.value)}
              spellCheck={false}
            />
          </ReviewField>
        ) : null}
        {targetKind === "commit" ? (
          <>
            <ReviewField>
              <ReviewLabel htmlFor="review-commit">Commit</ReviewLabel>
              <ReviewInput
                id="review-commit"
                value={commitSha}
                onChange={(event) => setCommitSha(event.currentTarget.value)}
                spellCheck={false}
              />
            </ReviewField>
            <ReviewField>
              <ReviewLabel htmlFor="review-title">Title</ReviewLabel>
              <ReviewInput
                id="review-title"
                value={commitTitle}
                onChange={(event) => setCommitTitle(event.currentTarget.value)}
                spellCheck={false}
              />
            </ReviewField>
          </>
        ) : null}
        <ReviewRunButton
          type="button"
          disabled={running || target === null}
          onClick={() => void runReview()}
        >
          {running ? <Loader2 size={14} strokeWidth={1.9} aria-hidden /> : <ClipboardCheck size={14} strokeWidth={1.9} aria-hidden />}
          <span>{running ? "Running" : "Run review"}</span>
        </ReviewRunButton>
      </ReviewControls>
      {targetKind === "custom" ? (
        <ReviewCustomGrid>
          <ReviewTextArea
            aria-label="Custom review instructions"
            placeholder="Custom review instructions"
            value={customInstructions}
            onChange={(event) => setCustomInstructions(event.currentTarget.value)}
          />
          <ReviewTextArea
            aria-label="Optional custom diff"
            placeholder="Optional diff/context"
            value={customDiff}
            onChange={(event) => setCustomDiff(event.currentTarget.value)}
            spellCheck={false}
          />
        </ReviewCustomGrid>
      ) : null}
      <ReviewBody>
        <ReviewFindingsPane>
          <ReviewSectionTitle>Findings</ReviewSectionTitle>
          {running ? (
            <ReviewEmpty>Review is running.</ReviewEmpty>
          ) : result === null ? (
            <ReviewEmpty>Run a review to collect findings.</ReviewEmpty>
          ) : result.ok && findings.length === 0 ? (
            <ReviewEmpty>No structured findings parsed. Check raw output.</ReviewEmpty>
          ) : findings.length > 0 ? (
            <ReviewFindingList>
              {findings.map((finding, index) => (
                <li key={finding.findingId}>
                  {finding.file !== undefined && finding.line !== undefined ? (
                    <ReviewFindingButton
                      type="button"
                      title={`Open ${finding.file}:${finding.line}`}
                      onClick={() => handlers.onOpenFile(finding.file!, {
                        line: finding.line!,
                        character: 1,
                        label: finding.title,
                      })}
                    >
                      {finding.title}
                    </ReviewFindingButton>
                  ) : (
                    finding.title
                  )}
                </li>
              ))}
            </ReviewFindingList>
          ) : (
            <ReviewError>
              <TriangleAlert size={15} strokeWidth={1.9} aria-hidden />
              <span>{result.message ?? "Review failed."}</span>
            </ReviewError>
          )}
        </ReviewFindingsPane>
        <ReviewRawPane>
          <ReviewRawHeader>
            <ReviewSectionTitle>Raw Output</ReviewSectionTitle>
            {result !== null ? (
              <ReviewStatus data-ok={result.ok ? "true" : "false"}>
                {result.ok ? <CheckCircle2 size={13} strokeWidth={1.9} aria-hidden /> : <TriangleAlert size={13} strokeWidth={1.9} aria-hidden />}
                <span>{result.ok ? "Completed" : "Failed"}</span>
              </ReviewStatus>
            ) : null}
          </ReviewRawHeader>
          <ReviewCommand title={result?.command}>{result?.command ?? cwd}</ReviewCommand>
          <ReviewRawText>
            {result?.rawText.trim() || (running ? "Waiting for provider output..." : "No output yet.")}
          </ReviewRawText>
          <ReviewActions>
            <ReviewRunButton
              type="button"
              disabled={result === null || result.rawText.trim().length === 0}
              onClick={askAgentToFix}
            >
              <Send size={14} strokeWidth={1.9} aria-hidden />
              <span>Ask agent to fix</span>
            </ReviewRunButton>
          </ReviewActions>
        </ReviewRawPane>
      </ReviewBody>
    </ReviewPaneFrame>
  );
}

function providerLabel(provider: ReviewProvider): string {
  switch (provider) {
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "opencode":
      return "opencode";
  }
}

function sourceLabel(source: ReviewRunResult["source"] | undefined): string {
  switch (source) {
    case "codex_cli":
      return "CLI review";
    case "claude_ultrareview":
      return "cloud review";
    case "claude_prompt":
    case "opencode_prompt":
      return "prompt review";
    default:
      return "not run";
  }
}

const ReviewPaneFrame = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--tide-bg);
`;

const ReviewHeader = styled.header`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--tide-line);
`;

const ReviewTitle = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--tide-text);
  font-size: 14px;
  font-weight: 700;
`;

const ReviewHeaderMeta = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--tide-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ReviewControls = styled.div`
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--tide-line);
`;

const ReviewField = styled.div`
  min-width: 132px;
  display: grid;
  gap: 5px;
`;

const ReviewLabel = styled.label`
  color: var(--tide-muted);
  font-size: 11px;
  font-weight: 600;
`;

const controlCss = `
  height: 30px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-surface);
  color: var(--tide-text);
  font-size: 12.5px;
  outline: none;
`;

const ReviewSelect = styled.select`
  ${controlCss}
  padding: 0 8px;
`;

const ReviewInput = styled.input`
  ${controlCss}
  padding: 0 9px;
`;

const ReviewRunButton = styled.button`
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-surface);
  color: var(--tide-text);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;

  svg {
    flex: 0 0 auto;
  }

  &:hover:not(:disabled) {
    background: var(--tide-selection);
    color: var(--tide-action);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const ReviewCustomGrid = styled.div`
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;
  padding: 0 14px 12px;
  border-bottom: 1px solid var(--tide-line);
`;

const ReviewTextArea = styled.textarea`
  min-width: 0;
  min-height: 76px;
  resize: vertical;
  padding: 9px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-surface);
  color: var(--tide-text);
  font: 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  outline: none;
`;

const ReviewBody = styled.div`
  min-height: 0;
  flex: 1 1 auto;
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.2fr);
`;

const ReviewFindingsPane = styled.section`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border-right: 1px solid var(--tide-line);
`;

const ReviewRawPane = styled.section`
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 14px;
`;

const ReviewSectionTitle = styled.h3`
  margin: 0;
  color: var(--tide-text);
  font-size: 12px;
  font-weight: 700;
`;

const ReviewEmpty = styled.p`
  margin: 12px 0 0;
  color: var(--tide-muted);
  font-size: 12.5px;
`;

const ReviewFindingList = styled.ol`
  margin: 12px 0 0;
  padding-left: 18px;
  color: var(--tide-text);
  font-size: 12.5px;
  line-height: 1.45;
`;

const ReviewFindingButton = styled.button`
  display: inline;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;

  &:hover {
    color: var(--tide-action);
    text-decoration: underline;
  }
`;

const ReviewError = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-top: 12px;
  color: var(--tide-danger);
  font-size: 12.5px;
`;

const ReviewRawHeader = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const ReviewStatus = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--tide-danger);
  font-size: 12px;
  font-weight: 600;

  &[data-ok="true"] {
    color: var(--tide-diff-add);
  }
`;

const ReviewCommand = styled.div`
  flex: 0 0 auto;
  min-width: 0;
  overflow: hidden;
  margin-top: 8px;
  color: var(--tide-muted);
  font: 11.5px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ReviewRawText = styled.pre`
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  margin: 12px 0 0;
  padding: 12px;
  border: 1px solid var(--tide-line);
  border-radius: 7px;
  background: var(--tide-surface);
  color: var(--tide-text);
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  white-space: pre-wrap;
`;

const ReviewActions = styled.div`
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  padding-top: 10px;
`;
