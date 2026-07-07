import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  executeBinding,
  executeBuild,
  materialiseToken,
  type BindingShape,
  type BindingValue,
  type Component,
  type Env,
  type ResourceRecord,
} from "@henosis/sdk";

type MaterialisedBinding =
  | string
  | number
  | boolean
  | { [key: string]: MaterialisedBinding };

type ComponentInfo = {
  isRender: boolean;
  envId: string;
  ref: string;
  digest: string;
};

type WorkerInput = {
  components: Record<string, ComponentInfo>;
  order: string[];
  scratchDir: string;
};

type WorkerOutput = {
  bindings: Record<string, MaterialisedBinding>;
  resources: Record<string, ResourceRecord[]>;
};

const inputPath = process.argv[2];
if (inputPath === undefined) {
  throw new Error("Missing worker input path");
}

const input = parseInput(readFileSync(inputPath, "utf8"));
const bindings: Record<string, MaterialisedBinding> = {};
const resources: Record<string, ResourceRecord[]> = {};

for (const name of input.order) {
  const info = input.components[name];
  if (info === undefined) {
    throw new Error(`Missing component info for ${name}`);
  }

  const component = await importComponent(input.scratchDir, name);
  const rawBinding = executeBinding(component, info.envId);
  bindings[name] = materialiseShape(rawBinding, info.envId);

  if (info.isRender) {
    resources[name] = executeBuild(component, {
      env: envFromId(info.envId),
      image: { ref: info.ref, digest: info.digest },
      envId: info.envId,
      depResolver: <T extends BindingShape>(depComponent: Component<T>): T => {
        const depInfo = input.components[depComponent.name];
        if (depInfo === undefined) {
          throw new Error(
            `Component ${component.name} depends on ${depComponent.name}, which is not in the lockfile`,
          );
        }

        return executeBinding(depComponent, depInfo.envId);
      },
    });
  }
}

const output: WorkerOutput = { bindings, resources };
process.stdout.write(JSON.stringify(output));

async function importComponent(
  scratchDir: string,
  name: string,
): Promise<Component<BindingShape>> {
  const modulePath = path.join(
    scratchDir,
    "node_modules",
    "@henosis",
    name,
    "src",
    "index.ts",
  );
  const imported: unknown = await import(pathToFileURL(modulePath).href);
  if (!isRecord(imported) || !isComponent(imported.default)) {
    throw new Error(`Package @henosis/${name} did not default-export a component`);
  }
  return imported.default;
}

function parseInput(source: string): WorkerInput {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed) || !isRecord(parsed.components) || !Array.isArray(parsed.order)) {
    throw new Error("Invalid worker input");
  }

  if (typeof parsed.scratchDir !== "string") {
    throw new Error("Invalid worker input: scratchDir must be a string");
  }

  const components: Record<string, ComponentInfo> = {};
  for (const [name, value] of Object.entries(parsed.components)) {
    if (
      !isRecord(value) ||
      typeof value.isRender !== "boolean" ||
      typeof value.envId !== "string" ||
      typeof value.ref !== "string" ||
      typeof value.digest !== "string"
    ) {
      throw new Error(`Invalid worker input for component ${name}`);
    }

    components[name] = {
      isRender: value.isRender,
      envId: value.envId,
      ref: value.ref,
      digest: value.digest,
    };
  }

  return {
    scratchDir: parsed.scratchDir,
    components,
    order: parsed.order.map((value) => {
      if (typeof value !== "string") {
        throw new Error("Invalid worker input: order entries must be strings");
      }
      return value;
    }),
  };
}

function envFromId(envId: string): Env {
  if (envId === "dev" || envId === "staging" || envId === "prod") {
    return { kind: envId };
  }

  return { kind: "preview", id: envId };
}

function materialiseShape(
  shape: BindingShape,
  envId: string,
): MaterialisedBinding {
  if (isBindingToken(shape)) {
    return materialiseToken(shape, envId);
  }

  if (
    typeof shape === "string" ||
    typeof shape === "number" ||
    typeof shape === "boolean"
  ) {
    return shape;
  }

  if (!isRecord(shape)) {
    throw new Error("Unsupported binding shape");
  }

  return Object.fromEntries(
    Object.entries(shape).map(([key, value]) => [
      key,
      materialiseShape(value as BindingShape, envId),
    ]),
  );
}

function isBindingToken(value: unknown): value is BindingValue {
  return (
    isRecord(value) &&
    (value.convention === "httpUrl" ||
      value.convention === "publicUrl" ||
      value.convention === "host") &&
    (value.component === undefined || typeof value.component === "string")
  );
}

function isComponent(value: unknown): value is Component<BindingShape> {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isRecord(value.spec) &&
    typeof value.spec.binding === "function" &&
    typeof value.spec.build === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
