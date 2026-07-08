import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, unlinkSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Env } from "@henosis/core";
import {
  isPinned,
  type EnvironmentManifest,
  type PinnedEntry,
} from "./manifest.js";

export type LocalOverrides = Record<string, string>;

export type AssemblyResult = {
  ok: boolean;
  compileOutput?: string;
};

export type ComponentDisposition = "pinned" | "follow";

export type ResolvedComponent = {
  name: string;
  packageName: string;
  repo: string;
  ref: string;
  digest: string;
  disposition: ComponentDisposition;
  env: Env;
  follows?: Env;
};

export type ComponentDependencyGraph = Record<string, string[]>;

export async function assembleAndCheck(opts: {
  manifest: EnvironmentManifest;
  devManifest: EnvironmentManifest;
  scratchDir: string;
  platformRef: string;
  localOverrides?: LocalOverrides;
}): Promise<AssemblyResult> {
  try {
    const resolved = resolveManifestComponents({
      manifest: opts.manifest,
      devManifest: opts.devManifest,
    });

    await writeScratchWorkspace({
      scratchDir: opts.scratchDir,
      components: resolved,
      platformRef: opts.platformRef,
      localOverrides: opts.localOverrides ?? {},
    });

    await runCommand(
      "pnpm",
      [
        "install",
        "--shamefully-hoist",
        "--force",
        "--config.blockExoticSubdeps=false",
        "--config.confirmModulesPurge=false",
        "--config.verifyDepsBeforeRun=false",
        "--store-dir",
        path.join(opts.scratchDir, ".pnpm-store"),
      ],
      opts.scratchDir,
      {
        ...process.env,
        CI: "true",
        npm_config_confirm_modules_purge: "false",
      },
    );

    await runCommand(
      tscBin(opts.scratchDir),
      ["--noEmit", "--pretty", "false"],
      path.join(opts.scratchDir, "packages", "gate-workspace"),
      process.env,
    );

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      compileOutput: execErrorOutput(error),
    };
  }
}

async function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const capture = commandCaptureFiles(cwd);
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["ignore", capture.stdoutFd, capture.stderrFd],
    });

    child.on("error", (error) => {
      const output = readCommandCapture(capture);
      reject(new CommandError(error.message, output.stdout, output.stderr));
    });
    child.on("close", (code) => {
      const output = readCommandCapture(capture);
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new CommandError(
          `${command} exited with status ${code ?? "unknown"}`,
          output.stdout,
          output.stderr,
        ),
      );
    });
  });
}

type CommandCapture = {
  stdoutPath: string;
  stderrPath: string;
  stdoutFd: number;
  stderrFd: number;
};

function commandCaptureFiles(cwd: string): CommandCapture {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stdoutPath = path.join(cwd, `.henosis-command-${token}.stdout`);
  const stderrPath = path.join(cwd, `.henosis-command-${token}.stderr`);
  return {
    stdoutPath,
    stderrPath,
    stdoutFd: openSync(stdoutPath, "w"),
    stderrFd: openSync(stderrPath, "w"),
  };
}

function readCommandCapture(capture: CommandCapture): {
  stdout: string;
  stderr: string;
} {
  closeSync(capture.stdoutFd);
  closeSync(capture.stderrFd);
  const stdout = readFileSync(capture.stdoutPath, "utf8");
  const stderr = readFileSync(capture.stderrPath, "utf8");
  unlinkSync(capture.stdoutPath);
  unlinkSync(capture.stderrPath);
  return { stdout, stderr };
}

class CommandError extends Error {
  constructor(
    message: string,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export function resolveManifestComponents(opts: {
  manifest: EnvironmentManifest;
  devManifest: EnvironmentManifest;
}): ResolvedComponent[] {
  return Object.entries(opts.manifest.components).map(([name, entry]) => {
    if (isPinned(entry)) {
      return resolvedComponentFromPinned(
        name,
        entry,
        "pinned",
        opts.manifest.environment,
      );
    }

    const devEntry = opts.devManifest.components[name];
    if (devEntry === undefined || !isPinned(devEntry)) {
      throw new Error(
        `Cannot resolve follower component "${name}": dev manifest must contain a pinned entry`,
      );
    }

    return {
      ...resolvedComponentFromPinned(name, devEntry, "follow", { kind: "dev" }),
      follows: { kind: "dev" },
    };
  });
}

export async function readComponentDependencyGraph(
  scratchDir: string,
  componentNames: readonly string[],
): Promise<ComponentDependencyGraph> {
  const componentNameSet = new Set(componentNames);
  const graph: ComponentDependencyGraph = {};

  for (const name of componentNames) {
    const packageJsonPath = path.join(
      scratchDir,
      "node_modules",
      "@henosis",
      name,
      "package.json",
    );
    const packageJson = parseJsonObject(await readFile(packageJsonPath, "utf8"));
    const dependencies = isRecord(packageJson.dependencies)
      ? packageJson.dependencies
      : {};

    graph[name] = Object.keys(dependencies)
      .filter((dependencyName) => dependencyName.startsWith("@henosis/"))
      .map((dependencyName) => dependencyName.slice("@henosis/".length))
      .filter((dependencyName) => componentNameSet.has(dependencyName))
      .sort();
  }

  return graph;
}

export function topologicalOrder(
  graph: ComponentDependencyGraph,
  componentNames: readonly string[],
): string[] {
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (name: string): void => {
    if (visited.has(name)) {
      return;
    }

    if (visiting.has(name)) {
      throw new Error(`Component dependency cycle detected at "${name}"`);
    }

    visiting.add(name);
    for (const dependency of graph[name] ?? []) {
      visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  };

  for (const name of componentNames) {
    visit(name);
  }

  return order;
}

function resolvedComponentFromPinned(
  name: string,
  entry: PinnedEntry,
  disposition: ComponentDisposition,
  env: Env,
): ResolvedComponent {
  return {
    name,
    packageName: `@henosis/${name}`,
    repo: entry.repo,
    ref: entry.ref,
    digest: entry.digest,
    disposition,
    env,
  };
}

async function writeScratchWorkspace(opts: {
  scratchDir: string;
  components: readonly ResolvedComponent[];
  platformRef: string;
  localOverrides: LocalOverrides;
}): Promise<void> {
  const scratchDir = path.resolve(opts.scratchDir);
  if (scratchDir === path.parse(scratchDir).root) {
    throw new Error("Refusing to use filesystem root as scratch directory");
  }

  await rm(scratchDir, { recursive: true, force: true });
  await mkdir(path.join(scratchDir, "packages", "gate-workspace", "src"), {
    recursive: true,
  });

  const overrides: Record<string, string> = {
    "@henosis/core": packageOverride(
      opts.localOverrides,
      "core",
      `github:henosis-playground/platform#${opts.platformRef}&path:packages/core`,
    ),
    "@henosis/platform-mock": packageOverride(
      opts.localOverrides,
      "platform-mock",
      `github:henosis-playground/platform#${opts.platformRef}&path:packages/platform-mock`,
    ),
  };

  for (const component of opts.components) {
    const localOverride = opts.localOverrides[component.name];
    overrides[component.packageName] =
      localOverride === undefined
        ? `github:${component.repo}#${component.ref}&path:henosis`
        : `file:${path.resolve(localOverride)}`;
  }

  const dependencies = Object.fromEntries(
    opts.components.map((component) => [component.packageName, "*"]),
  );
  const typescriptDependency = localDependency(
    opts.localOverrides,
    "typescript",
    "5.9.3",
  );

  await writeJson(path.join(scratchDir, "package.json"), {
    name: "henosis-gate-workspace-root",
    private: true,
    packageManager: "pnpm@11.3.0",
    devDependencies: {
      typescript: typescriptDependency,
    },
    pnpm: { overrides },
  });

  await writeFile(
    path.join(scratchDir, "pnpm-workspace.yaml"),
    formatPnpmWorkspaceYaml(overrides),
  );
  await writeFile(
    path.join(scratchDir, ".npmrc"),
    "block-exotic-subdeps=false\nconfirm-modules-purge=false\nverify-deps-before-run=false\n",
  );

  await writeJson(path.join(scratchDir, "tsconfig.json"), {
    files: [],
    references: [{ path: "./packages/gate-workspace" }],
  });

  await writeJson(
    path.join(scratchDir, "packages", "gate-workspace", "package.json"),
    {
      name: "@henosis/gate-workspace",
      private: true,
      type: "module",
      dependencies,
      devDependencies: {
        typescript: typescriptDependency,
      },
    },
  );

  await writeJson(
    path.join(scratchDir, "packages", "gate-workspace", "tsconfig.json"),
    {
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src"],
    },
  );

  await writeFile(
    path.join(scratchDir, "packages", "gate-workspace", "src", "index.ts"),
    `${opts.components
      .map((component) => `import "${component.packageName}";`)
      .join("\n")}\n`,
  );
}

function packageOverride(
  localOverrides: LocalOverrides,
  shortName: string,
  fallback: string,
): string {
  const scopedName = `@henosis/${shortName}`;
  const localOverride = localOverrides[shortName] ?? localOverrides[scopedName];
  return localOverride === undefined
    ? fallback
    : `file:${path.resolve(localOverride)}`;
}

function localDependency(
  localOverrides: LocalOverrides,
  name: string,
  fallback: string,
): string {
  const localOverride = localOverrides[name];
  return localOverride === undefined
    ? fallback
    : `file:${path.resolve(localOverride)}`;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function formatPnpmWorkspaceYaml(overrides: Record<string, string>): string {
  return [
    "packages:",
    '  - "packages/*"',
    "settings:",
    "  blockExoticSubdeps: false",
    "  confirmModulesPurge: false",
    "overrides:",
    ...Object.entries(overrides).map(
      ([name, spec]) => `  "${name}": "${spec.replaceAll('"', '\\"')}"`,
    ),
    "",
  ].join("\n");
}

function tscBin(scratchDir: string): string {
  return path.join(
    scratchDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.CMD" : "tsc",
  );
}

function parseJsonObject(source: string): Record<string, unknown> {
  const value: unknown = JSON.parse(source);
  if (!isRecord(value)) {
    throw new Error("Expected JSON object");
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function execErrorOutput(error: unknown): string {
  if (error instanceof CommandError) {
    const output = [error.stdout, error.stderr]
      .filter((part) => part.length > 0)
      .join("\n");
    return output.length > 0 ? output : error.message;
  }

  const stdout = stringErrorProperty(error, "stdout");
  const stderr = stringErrorProperty(error, "stderr");
  const output = [stdout, stderr].filter((part) => part.length > 0).join("\n");
  if (output.length > 0) {
    return output;
  }
  return error instanceof Error ? error.message : String(error);
}

function stringErrorProperty(error: unknown, key: "stdout" | "stderr"): string {
  if (!isRecord(error)) {
    return "";
  }

  const value = error[key];
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Buffer) {
    return value.toString("utf8");
  }

  return "";
}
