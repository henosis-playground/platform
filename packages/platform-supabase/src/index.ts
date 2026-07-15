import { defineResource, output, value } from "@henosis/core";

export type AnonymousAccess = "none" | "read";

/** SQL is configuration content carried and verified in the component evaluation closure. */
export interface MigrationRef {
  readonly id: string;
  readonly path: string;
  readonly sha256?: `sha256:${string}`;
}

export interface SchemaBody {
  readonly stack: "local";
  readonly project: "henosis-local";
  readonly database: "postgres";
  readonly schema: string;
  readonly migrations: readonly MigrationRef[];
  readonly api: {
    readonly expose: boolean;
    readonly anonAccess: AnonymousAccess;
  };
}

export const schemaOutputs = {
  project: output.observed(value.string()),
  database: output.observed(value.string()),
  schema: output.observed(value.string()),
  apiUrl: output.observed(value.url()),
  restUrl: output.observed(value.url()),
  databaseUrlRef: output.observed(value.string()),
  anonKeyRef: output.observed(value.string()),
} as const;

export const schema = defineResource<SchemaBody, typeof schemaOutputs>({
  kind: "supabase/schema@1",
  outputs: schemaOutputs,
  configFiles: [{
    references: "/migrations/*",
    pathField: "path",
    digestField: "sha256",
  }],
});

/** Create a checked configuration-file migration reference. */
export function migration(
  id: string,
  path: string,
  sha256?: `sha256:${string}`,
): MigrationRef {
  if (!/^[a-z0-9][a-z0-9_-]{0,95}$/u.test(id)) {
    throw new Error("migration id must match [a-z0-9][a-z0-9_-]{0,95}");
  }
  if (path.length === 0 || path.startsWith("/") || path.split(/[\\/]/u).includes("..")) {
    throw new Error("migration path must be repository-relative without parent traversal");
  }
  if (sha256 !== undefined && !/^sha256:[0-9a-f]{64}$/u.test(sha256)) {
    throw new Error("migration sha256 must contain 64 lowercase hexadecimal digits");
  }
  return Object.freeze({ id, path, ...(sha256 === undefined ? {} : { sha256 }) });
}
