import type { Schema } from "@henosis/core";

export type SchemaData =
  | {
      readonly kind: "object";
      readonly shape: Record<string, SchemaData>;
    }
  | {
      readonly kind: string;
    };

export function schemaDataFromSchema(schema: Schema<unknown>): SchemaData {
  const raw: unknown = schema;
  if (!isRecord(raw) || typeof raw.kind !== "string") {
    throw new Error("Invalid Henosis schema");
  }

  const kind = raw.kind;
  if (kind !== "object") {
    return { kind };
  }

  const shape = raw.shape;
  if (!isRecord(shape)) {
    throw new Error("Invalid Henosis object schema");
  }

  return {
    kind: "object",
    shape: Object.fromEntries(
      Object.entries(shape)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, schemaDataFromSchema(child as Schema<unknown>)]),
    ),
  };
}

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
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
