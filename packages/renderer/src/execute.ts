import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { namespaceFor, type ResourceRecord } from "@henosis/sdk";
import {
  readComponentDependencyGraph,
  resolveLockfileComponents,
  topologicalOrder,
  type LocalOverrides,
} from "./assembler.js";
import type { Lockfile } from "./lockfile.js";

export type MaterialisedBinding =
  | string
  | number
  | boolean
  | { [key: string]: MaterialisedBinding };

export type RenderedExecutionComponent = {
  disposition: "render";
  ref: string;
  digest: string;
  namespace: string;
  binding: MaterialisedBinding;
  resources: ResourceRecord[];
};

export type FollowExecutionComponent = {
  disposition: "follow";
  followsEnvId: "dev";
  binding: MaterialisedBinding;
};

export type ExecutionComponent =
  | RenderedExecutionComponent
  | FollowExecutionComponent;

export type ExecutionResult = {
  envId: string;
  components: Record<string, ExecutionComponent>;
};

type WorkerComponentInfo = {
  isRender: boolean;
  envId: string;
  ref: string;
  digest: string;
};

type WorkerInput = {
  components: Record<string, WorkerComponentInfo>;
  order: string[];
  scratchDir: string;
};

type WorkerOutput = {
  bindings: Record<string, MaterialisedBinding>;
  resources: Record<string, ResourceRecord[]>;
};

export async function executeComponents(opts: {
  lockfile: Lockfile;
  devLockfile: Lockfile;
  scratchDir: string;
  platformRoot: string;
  localOverrides?: LocalOverrides;
}): Promise<ExecutionResult> {
  void opts.localOverrides;
  const resolved = resolveLockfileComponents({
    lockfile: opts.lockfile,
    devLockfile: opts.devLockfile,
  });
  const componentNames = resolved.map((component) => component.name);
  const graph = await readComponentDependencyGraph(opts.scratchDir, componentNames);
  const order = topologicalOrder(graph, componentNames);
  const inputPath = path.join(opts.scratchDir, ".henosis-execute-input.json");

  const workerInput: WorkerInput = {
    scratchDir: opts.scratchDir,
    order,
    components: Object.fromEntries(
      resolved.map((component) => [
        component.name,
        {
          isRender: component.disposition === "render",
          envId: component.envId,
          ref: component.ref,
          digest: component.digest,
        },
      ]),
    ),
  };

  await writeFile(inputPath, `${JSON.stringify(workerInput)}\n`);

  const builtWorkerPath = fileURLToPath(
    new URL("./execute-worker.js", import.meta.url),
  );
  const workerPath = existsSync(builtWorkerPath)
    ? builtWorkerPath
    : fileURLToPath(new URL("./execute-worker.ts", import.meta.url));
  const rendererPackageRoot = path.resolve(
    fileURLToPath(new URL("..", import.meta.url)),
  );
  const stdout = execFileSync(
    process.execPath,
    ["--import", "tsx", workerPath, inputPath],
    {
      cwd: rendererPackageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const workerOutput = parseWorkerOutput(stdout);

  return {
    envId: opts.lockfile.environment.id,
    components: Object.fromEntries(
      resolved.map((component) => {
        const binding = workerOutput.bindings[component.name];
        if (binding === undefined) {
          throw new Error(`Worker did not return binding for ${component.name}`);
        }

        if (component.disposition === "follow") {
          return [
            component.name,
            {
              disposition: "follow",
              followsEnvId: "dev",
              binding,
            } satisfies FollowExecutionComponent,
          ];
      }

        return [
          component.name,
          {
            disposition: "render",
            ref: component.ref,
            digest: component.digest,
            namespace: namespaceFor(component.envId),
            binding,
            resources: workerOutput.resources[component.name] ?? [],
          } satisfies RenderedExecutionComponent,
        ];
      }),
    ),
  };
}

function parseWorkerOutput(stdout: string): WorkerOutput {
  const parsed: unknown = JSON.parse(stdout);
  if (!isRecord(parsed) || !isRecord(parsed.bindings) || !isRecord(parsed.resources)) {
    throw new Error("Worker returned malformed output");
  }

  return {
    bindings: parsed.bindings as Record<string, MaterialisedBinding>,
    resources: parsed.resources as Record<string, ResourceRecord[]>,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
