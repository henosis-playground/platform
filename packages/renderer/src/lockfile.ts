import { parse } from "smol-toml";

export type PinnedEntry = {
  kind: "pinned";
  repo: string;
  ref: string;
  digest: string;
};

export type FollowerEntry = {
  kind: "follower";
  follow: "dev";
};

export type LockfileEntry = PinnedEntry | FollowerEntry;

export type Lockfile = {
  environment: { id: string };
  components: Record<string, LockfileEntry>;
};

const stableEnvironmentIds = new Set(["dev", "staging", "prod"]);
const pinnedKeys = new Set(["repo", "ref", "digest"]);

export function parseLockfile(toml: string): Lockfile {
  let parsed: unknown;
  try {
    parsed = parse(toml);
  } catch (error) {
    throw new Error(`Invalid lockfile TOML: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid lockfile: expected a TOML table");
  }

  for (const key of Object.keys(parsed)) {
    if (key !== "environment" && key !== "components") {
      throw new Error(`Invalid lockfile: unexpected top-level key "${key}"`);
    }
  }

  const environment = parsed.environment;
  if (!isRecord(environment)) {
    throw new Error("Invalid lockfile: missing [environment] table");
  }

  const environmentKeys = Object.keys(environment);
  for (const key of environmentKeys) {
    if (key !== "id") {
      throw new Error(`Invalid lockfile: unexpected environment key "${key}"`);
    }
  }

  if (typeof environment.id !== "string") {
    throw new Error("Invalid lockfile: environment.id must be a string");
  }

  const componentsValue = parsed.components ?? {};
  if (!isRecord(componentsValue)) {
    throw new Error("Invalid lockfile: components must be a table");
  }

  const components: Record<string, LockfileEntry> = {};
  for (const [name, value] of Object.entries(componentsValue)) {
    components[name] = parseComponentEntry(name, value, environment.id);
  }

  return {
    environment: { id: environment.id },
    components,
  };
}

export function isPinned(entry: LockfileEntry): entry is PinnedEntry {
  return entry.kind === "pinned";
}

function parseComponentEntry(
  componentName: string,
  value: unknown,
  envId: string,
): LockfileEntry {
  if (!isRecord(value)) {
    throw new Error(
      `Invalid component "${componentName}": expected a TOML table`,
    );
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    throw new Error(
      `Invalid component "${componentName}": expected repo/ref/digest or follow`,
    );
  }

  if (keys.includes("follow")) {
    const unexpected = keys.find((key) => key !== "follow");
    if (unexpected !== undefined) {
      throw new Error(
        `Invalid component "${componentName}": unexpected key "${unexpected}"`,
      );
    }

    if (value.follow !== "dev") {
      throw new Error(
        `Invalid component "${componentName}": follow must be "dev"`,
      );
    }

    if (stableEnvironmentIds.has(envId)) {
      throw new Error(
        `Invalid component "${componentName}": follower entries are invalid in ${envId}`,
      );
    }

    return { kind: "follower", follow: "dev" };
  }

  const unexpected = keys.find((key) => !pinnedKeys.has(key));
  if (unexpected !== undefined) {
    throw new Error(
      `Invalid component "${componentName}": unexpected key "${unexpected}"`,
    );
  }

  for (const key of pinnedKeys) {
    if (!keys.includes(key)) {
      throw new Error(
        `Invalid component "${componentName}": missing required key "${key}"`,
      );
    }
  }

  if (
    typeof value.repo !== "string" ||
    typeof value.ref !== "string" ||
    typeof value.digest !== "string"
  ) {
    throw new Error(
      `Invalid component "${componentName}": repo, ref, and digest must be strings`,
    );
  }

  return {
    kind: "pinned",
    repo: value.repo,
    ref: value.ref,
    digest: value.digest,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
