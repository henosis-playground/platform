import { parse } from "smol-toml";
import {
  formatEnvironment,
  parseEnvironmentName,
  type RuntimeEnv,
} from "@henosis/core";

/** Unchanged direct manifest pin. */
export type PinnedEntry = {
  kind: "pinned";
  repo: string;
  ref: string;
  digest: string;
};

/** Symbolic source-version follower targeting one stable manifest. */
export type FollowerEntry = {
  kind: "follower";
  follow: string;
};

/** Direct or follower component entry in the unchanged manifest schema. */
export type ManifestEntry = PinnedEntry | FollowerEntry;

/** Strictly parsed environment manifest. */
export type EnvironmentManifest = {
  environment: RuntimeEnv;
  components: Record<string, ManifestEntry>;
};

const pinnedKeys = new Set(["repo", "ref", "digest"]);

/** Parses strict TOML without changing the ratified manifest shape. */
export function parseManifest(toml: string): EnvironmentManifest {
  let parsed: unknown;
  try {
    parsed = parse(toml);
  } catch (error) {
    throw new Error(`Invalid manifest TOML: ${errorMessage(error)}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid manifest: expected a TOML table");
  }

  for (const key of Object.keys(parsed)) {
    if (key !== "environment" && key !== "components") {
      throw new Error(`Invalid manifest: unexpected top-level key "${key}"`);
    }
  }

  const environment = parsed.environment;
  if (!isRecord(environment)) {
    throw new Error("Invalid manifest: missing [environment] table");
  }

  const environmentKeys = Object.keys(environment);
  for (const key of environmentKeys) {
    if (key !== "id") {
      throw new Error(`Invalid manifest: unexpected environment key "${key}"`);
    }
  }

  if (typeof environment.id !== "string") {
    throw new Error("Invalid manifest: environment.id must be a string");
  }

  const componentsValue = parsed.components ?? {};
  if (!isRecord(componentsValue)) {
    throw new Error("Invalid manifest: components must be a table");
  }

  const manifestEnv = environmentFromManifestName(environment.id);
  const components: Record<string, ManifestEntry> = {};
  for (const [name, value] of Object.entries(componentsValue)) {
    components[name] = parseComponentEntry(name, value, manifestEnv);
  }

  return {
    environment: manifestEnv,
    components,
  };
}

/** Tests whether a manifest entry directly supplies repo/ref/digest. */
export function isPinned(entry: ManifestEntry): entry is PinnedEntry {
  return entry.kind === "pinned";
}

function parseComponentEntry(
  componentName: string,
  value: unknown,
  manifestEnv: RuntimeEnv,
): ManifestEntry {
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

    if (typeof value.follow !== "string") {
      throw new Error(
        `Invalid component "${componentName}": follow must be a stable environment name`,
      );
    }
    const followed = parseEnvironmentName([value.follow], value.follow);
    if (followed.kind === "preview") {
      throw new Error(
        `Invalid component "${componentName}": follow must name a stable environment`,
      );
    }

    if (manifestEnv.kind !== "preview") {
      throw new Error(
        `Invalid component "${componentName}": follower entries are invalid in ${formatEnvironment(manifestEnv)}`,
      );
    }

    return { kind: "follower", follow: value.follow };
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

function environmentFromManifestName(name: string): RuntimeEnv {
  if (name.startsWith("preview_") || name.startsWith("preview-")) {
    return parseEnvironmentName(["dev"], name);
  }
  return parseEnvironmentName([name], name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
