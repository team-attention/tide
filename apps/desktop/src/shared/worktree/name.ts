// Pure rules for deriving a git-safe worktree name at send time.
// See docs_v2/specs/worktree-start-experience.md.
//
// A worktree's generated name is a safe ASCII slug/hash. Tide-created git
// branches are namespaced as `tide/<name>`; the directory path flattens that
// slash later through computeWorktreePath. Process-agnostic.

// Auto-derived slugs below this many usable chars are discarded (a 1-2 char
// auto name is not useful); a name the user typed is respected at any length.
const MIN_USABLE_SLUG = 3;
const MAX_TOKENS = 6;
const MAX_LENGTH = 40;
const WORKTREE_BRANCH_PREFIX = "tide";

// ASCII slug of free text: lowercase, every run of non-`[a-z0-9]` becomes a
// boundary, capped at MAX_TOKENS words / MAX_LENGTH chars. Returns "" when
// nothing usable remains (e.g. an all-Korean message → all chars are non-ASCII).
export function slugFromMessage(message: string): string {
  const base = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (base.length === 0) {
    return "";
  }
  const tokens = base.split("-").filter((token) => token.length > 0);
  let slug = tokens.slice(0, MAX_TOKENS).join("-");
  if (slug.length > MAX_LENGTH) {
    slug = slug.slice(0, MAX_LENGTH).replace(/-+$/, "");
  }
  return slug;
}

// Resolve the final worktree branch name from the fixed priority:
//   1. user-typed name (ASCII-slugged), if non-empty
//   2. ASCII slug of the first message, if >= MIN_USABLE_SLUG chars
//   3. a random hash (terminal fallback — always valid)
// `makeHash` is injected so this rule stays pure/testable; production passes a
// real random generator (e.g. () => `wt-${randomHex(6)}`).
export function resolveWorktreeName(input: {
  typedName?: string;
  firstMessage?: string;
  makeHash: () => string;
}): string {
  const typed = slugFromMessage(withoutWorktreeBranchPrefix(input.typedName ?? ""));
  if (typed.length > 0) {
    return withWorktreeBranchPrefix(typed);
  }
  const slug = slugFromMessage(input.firstMessage ?? "");
  if (slug.length >= MIN_USABLE_SLUG) {
    return withWorktreeBranchPrefix(slug);
  }
  return withWorktreeBranchPrefix(input.makeHash());
}

function withoutWorktreeBranchPrefix(value: string): string {
  const trimmed = value.trim();
  const prefix = `${WORKTREE_BRANCH_PREFIX}/`;
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function withWorktreeBranchPrefix(name: string): string {
  return `${WORKTREE_BRANCH_PREFIX}/${withoutWorktreeBranchPrefix(name)}`;
}

// If `name` already exists (path or branch), append `-<suffix>` so a repeated
// message/name never fails `git worktree add`. `makeSuffix` is injected for
// determinism in tests; production passes a short random hex generator.
export function disambiguateWorktreeName(
  name: string,
  exists: (candidate: string) => boolean,
  makeSuffix: () => string,
): string {
  if (!exists(name)) {
    return name;
  }
  let candidate = `${name}-${makeSuffix()}`;
  let guard = 0;
  while (exists(candidate) && guard < 16) {
    candidate = `${name}-${makeSuffix()}`;
    guard += 1;
  }
  return candidate;
}
