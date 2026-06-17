// Pure semver comparison for the agent CLI update advisory (spec:
// version-management.md, Lane 2). Tide owns no semver dependency, and the only
// question it asks is "is the installed CLI older than the latest published
// one?" — so this is a deliberately small, total comparison, not a full semver
// implementation.
//
// A version is parsed as `major.minor.patch` with an optional `-prerelease`
// suffix. Release > prerelease of the same core (1.2.3 > 1.2.3-beta). Numeric
// identifiers compare numerically; build metadata (`+...`) is ignored. Anything
// that does not parse as at least one numeric core component is treated as
// uncomparable, which the caller turns into "no advisory" rather than a guess.

interface ParsedVersion {
  core: number[];
  prerelease: string[] | undefined; // undefined = a release (ranks above any prerelease)
}

function parseVersion(raw: string): ParsedVersion | undefined {
  const trimmed = raw.trim().replace(/^v/i, "");
  if (trimmed.length === 0) {
    return undefined;
  }
  const [withoutBuild] = trimmed.split("+", 1);
  const dashIndex = withoutBuild.indexOf("-");
  const corePart = dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prePart = dashIndex === -1 ? undefined : withoutBuild.slice(dashIndex + 1);

  const segments = corePart.split(".");
  // Reject empty / non-numeric segments before Number(): Number("") and Number(" ")
  // are 0, which would let "1..3" or "1. .3" masquerade as a valid version.
  if (segments.some((segment) => !/^\d+$/.test(segment))) {
    return undefined;
  }
  const core = segments.map((segment) => Number(segment));
  const prerelease =
    prePart === undefined || prePart.length === 0 ? undefined : prePart.split(".");
  return { core, prerelease };
}

function compareCore(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

function comparePrerelease(a: string[] | undefined, b: string[] | undefined): number {
  // A release outranks any prerelease of the same core (1.2.3 > 1.2.3-rc.1).
  if (a === undefined && b === undefined) {
    return 0;
  }
  if (a === undefined) {
    return 1;
  }
  if (b === undefined) {
    return -1;
  }
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    // Fewer prerelease identifiers ranks lower when otherwise equal (rc < rc.1).
    if (i >= a.length) {
      return -1;
    }
    if (i >= b.length) {
      return 1;
    }
    const left = a[i];
    const right = b[i];
    const leftNum = /^\d+$/.test(left);
    const rightNum = /^\d+$/.test(right);
    if (leftNum && rightNum) {
      const diff = Number(left) - Number(right);
      if (diff !== 0) {
        return diff < 0 ? -1 : 1;
      }
      continue;
    }
    // Numeric identifiers always rank lower than alphanumeric ones.
    if (leftNum !== rightNum) {
      return leftNum ? -1 : 1;
    }
    if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

// True iff `installed` is a strictly-lower version than `latest`. Returns false
// when either side is uncomparable (so the caller shows no false "update
// available" advisory) and when they are equal.
export function semverLess(installed: string, latest: string): boolean {
  const a = parseVersion(installed);
  const b = parseVersion(latest);
  if (a === undefined || b === undefined) {
    return false;
  }
  const coreCmp = compareCore(a.core, b.core);
  if (coreCmp !== 0) {
    return coreCmp < 0;
  }
  return comparePrerelease(a.prerelease, b.prerelease) < 0;
}
