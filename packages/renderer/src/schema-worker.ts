import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  bindComponentIdentity,
  getComponentDefinition,
  isComponentModule,
} from "@henosis/core";
import { schemaDataFromSchema } from "./schema-data.js";

type WorkerInput = {
  component: string;
  modulePath: string;
  outputPath?: string;
};

const inputPath = process.argv[2];
if (inputPath === undefined) {
  throw new Error("Missing schema worker input path");
}

const input = parseInput(readFileSync(inputPath, "utf8"));
const imported: unknown = await import(pathToFileURL(input.modulePath).href);
if (!isRecord(imported) || !isComponentModule(imported.default)) {
  throw new Error(`Package @henosis/${input.component} did not default-export a component`);
}

bindComponentIdentity(imported.default, input.component);
const schema = schemaDataFromSchema(getComponentDefinition(imported.default).outputs);
const serialized = `${JSON.stringify(schema)}\n`;
if (input.outputPath === undefined) {
  console.log(serialized.trimEnd());
} else {
  writeFileSync(input.outputPath, serialized);
}

function parseInput(source: string): WorkerInput {
  const parsed: unknown = JSON.parse(source);
  if (
    !isRecord(parsed) ||
    typeof parsed.component !== "string" ||
    typeof parsed.modulePath !== "string"
  ) {
    throw new Error("Invalid schema worker input");
  }

  return {
    component: parsed.component,
    modulePath: parsed.modulePath,
    outputPath:
      typeof parsed.outputPath === "string" ? parsed.outputPath : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
