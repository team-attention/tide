// Spec: docs_v2/specs/provider-command-discovery.md
//
// Discovers the real provider slash-commands and skills for a cwd by reading the
// providers' command/skill files (no provider spawn). Covers Claude (.claude/
// commands/*.md), Codex (.codex/skills/*/SKILL.md, surfaced via `$`), and
// Antigravity (.gemini/commands/*.toml). The core is pure: filesystem access is
// injected so it can be unit-tested with a fake fs.

export type CommandTrigger = "/" | "$";

export interface ProviderCommandSuggestion {
  name: string;
  description: string;
  trigger: CommandTrigger;
  source: "project" | "user";
  agentId: "codex" | "claude" | "antigravity";
}

export interface CommandFs {
  listFiles(dir: string): string[];
  listDirs(dir: string): string[];
  readText(path: string): string | undefined;
}

// --- Pure parsers (given file contents) ---

// Claude command .md: YAML frontmatter `description:`; name is the filename.
export function parseClaudeCommand(fileName: string, content: string): { name: string; description: string } {
  return {
    name: stripExtension(fileName),
    description: frontmatterField(content, "description") ?? "",
  };
}

// Codex SKILL.md: YAML frontmatter `name:`/`description:`; falls back to the dir.
export function parseCodexSkill(dirName: string, content: string): { name: string; description: string } {
  return {
    name: frontmatterField(content, "name") ?? dirName,
    description: frontmatterField(content, "description") ?? "",
  };
}

// Antigravity command .toml: `description = "…"`; name is the filename.
export function parseAntigravityCommand(fileName: string, content: string): { name: string; description: string } {
  return {
    name: stripExtension(fileName),
    description: tomlString(content, "description") ?? "",
  };
}

// --- Discovery orchestrator (pure given injected fs) ---

export function discoverProviderCommands(input: {
  cwd: string;
  homeDir: string;
  agentId: string;
  fs: CommandFs;
}): ProviderCommandSuggestion[] {
  const out: ProviderCommandSuggestion[] = [];
  const seen = new Set<string>();
  // Project scope first so it wins on name collisions with the user scope.
  const scopes: { source: "project" | "user"; root: string }[] = [
    { source: "project", root: input.cwd },
    { source: "user", root: input.homeDir },
  ];

  const push = (s: ProviderCommandSuggestion): void => {
    const key = `${s.trigger}${s.name}`;
    if (s.name.length === 0 || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(s);
  };

  for (const { source, root } of scopes) {
    if (input.agentId === "claude") {
      const dir = join(root, ".claude", "commands");
      for (const file of input.fs.listFiles(dir)) {
        if (!file.endsWith(".md")) continue;
        const parsed = parseClaudeCommand(file, input.fs.readText(join(dir, file)) ?? "");
        push({ ...parsed, trigger: "/", source, agentId: "claude" });
      }
    } else if (input.agentId === "codex") {
      const dir = join(root, ".codex", "skills");
      for (const skillDir of input.fs.listDirs(dir)) {
        if (skillDir.startsWith(".")) continue; // skip hidden dirs (e.g. .system)
        const parsed = parseCodexSkill(skillDir, input.fs.readText(join(dir, skillDir, "SKILL.md")) ?? "");
        push({ ...parsed, trigger: "$", source, agentId: "codex" });
      }
    } else if (input.agentId === "antigravity") {
      const dir = join(root, ".gemini", "commands");
      for (const file of input.fs.listFiles(dir)) {
        if (!file.endsWith(".toml")) continue;
        const parsed = parseAntigravityCommand(file, input.fs.readText(join(dir, file)) ?? "");
        push({ ...parsed, trigger: "/", source, agentId: "antigravity" });
      }
    }
  }
  return out;
}

// --- helpers ---

function join(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

// Reads `key: value` from a leading `---` … `---` YAML frontmatter block.
function frontmatterField(content: string, key: string): string | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const region = match ? match[1] : content;
  const line = region.match(new RegExp(`^${key}\\s*:\\s*(.+)$`, "m"));
  if (line === null) {
    return undefined;
  }
  return unquote(line[1].trim());
}

// Reads `key = "value"` from TOML.
function tomlString(content: string, key: string): string | undefined {
  const line = content.match(new RegExp(`^${key}\\s*=\\s*(.+)$`, "m"));
  if (line === null) {
    return undefined;
  }
  return unquote(line[1].trim());
}

function unquote(value: string): string {
  const trimmed = value.trim().replace(/\s*#.*$/, "");
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
