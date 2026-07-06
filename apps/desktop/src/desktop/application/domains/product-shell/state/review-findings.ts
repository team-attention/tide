export type ReviewFindingSeverity = "critical" | "high" | "medium" | "low" | "info";

export interface ReviewFinding {
  findingId: string;
  severity?: ReviewFindingSeverity;
  file?: string;
  line?: number;
  title: string;
  body: string;
  confidence?: "high" | "medium" | "low";
}

export function parseReviewFindings(rawText: string): ReviewFinding[] {
  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^([-*]|\d+[.)])\s+/.test(line))
    .map((line) => line.replace(/^([-*]|\d+[.)])\s+/, ""))
    .filter((line) => line.length > 12)
    .map((body, index) => ({
      findingId: `finding-${index + 1}`,
      ...extractFindingSeverity(body),
      ...extractFindingLocation(body),
      title: body,
      body,
    }))
    .slice(0, 12);
}

function extractFindingSeverity(text: string): Pick<ReviewFinding, "severity"> {
  const match = /^(critical|high|medium|low|info)\b\s*:/i.exec(text);
  if (match === null || match[1] === undefined) {
    return {};
  }
  return { severity: match[1].toLowerCase() as ReviewFindingSeverity };
}

function extractFindingLocation(text: string): Pick<ReviewFinding, "file" | "line"> {
  const match = /(?:^|\s)([A-Za-z0-9._/@-][A-Za-z0-9._/@-]*(?:\/[A-Za-z0-9._@-]+)*):(\d+)/.exec(text);
  if (match === null || match[1] === undefined || match[2] === undefined || match[1].startsWith("http")) {
    return {};
  }
  return { file: match[1].replace(/^\.\//, ""), line: Number(match[2]) };
}
