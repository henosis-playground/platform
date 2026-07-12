import type { OutputRole, Schema } from "@henosis/core";

/** Stable JSON representation of an introspectable output schema. */
export type SchemaData =
  | {
      readonly kind: "object";
      readonly shape: Record<string, SchemaData>;
    }
  | {
      readonly kind: string;
      readonly role?: OutputRole;
    };

/** Converts a runtime schema to code-unit-sorted diagnostic data. */
export function schemaDataFromSchema(schema: Schema<unknown>): SchemaData {
  const raw: unknown = schema;
  if (!isRecord(raw) || typeof raw.kind !== "string") {
    throw new Error("Invalid Henosis schema");
  }

  const kind = raw.kind;
  if (kind !== "object") {
    const role = outputRole(raw.role);
    return role === undefined ? { kind } : { kind, role };
  }

  const shape = raw.shape;
  if (!isRecord(shape)) {
    throw new Error("Invalid Henosis object schema");
  }

  return {
    kind: "object",
    shape: Object.fromEntries(
      Object.entries(shape)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, schemaDataFromSchema(child as Schema<unknown>)]),
    ),
  };
}

function outputRole(value: unknown): OutputRole | undefined {
  if (value === undefined) return undefined;
  if (value === "ui") return value;
  throw new Error(`Invalid Henosis output role: ${String(value)}`);
}

/** Serializes arbitrary diagnostic JSON with recursively stable key order. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value), null, 2);
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (!isRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
