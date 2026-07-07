import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPinned, type Lockfile, type PinnedEntry } from "./lockfile.js";

export type LocalOverrides = Record<string, string>;

export type AssemblyResult = {
  ok: boolean;
  compileOutput?: string;
};

export type ComponentDisposition = "render" | "follow";

export type ResolvedComponent = {
  name: string;
  packageName: string;
  repo: string;
  ref: string;
  digest: string;
  disposition: ComponentDisposition;
  envId: string;
  followsEnvId?: "dev";
};

export type ComponentDependencyGraph = Record<string, string[]>;

export async function assembleAndCheck(opts: {
  lockfile: Lockfile;
  devLockfile: Lockfile;
  scratchDir: string;
  platformRef: string;
  localOverrides?: LocalOverrides;
}): Promise<AssemblyResult> {
  try {
    const resolved = resolveLockfileComponents({
      lockfile: opts.lockfile,
      devLockfile: opts.devLockfile,
    });

    await writeScratchWorkspace({
      scratchDir: opts.scratchDir,
      components: resolved,
      platformRef: opts.platformRef,
      localOverrides: opts.localOverrides ?? {},
    });

    execFileSync(
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
      {
        cwd: opts.scratchDir,
        encoding: "utf8",
        env: {
          ...process.env,
          CI: "true",
          npm_config_confirm_modules_purge: "false",
        },
        stdio: "pipe",
      },
    );

    execFileSync(tscBin(opts.scratchDir), ["--noEmit", "--pretty", "false"], {
      cwd: path.join(opts.scratchDir, "packages", "gate-workspace"),
      encoding: "utf8",
      stdio: "pipe",
    });

    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      compileOutput: execErrorOutput(error),
    };
  }
}

export function resolveLockfileComponents(opts: {
  lockfile: Lockfile;
  devLockfile: Lockfile;
}): ResolvedComponent[] {
  return Object.entries(opts.lockfile.components).map(([name, entry]) => {
    if (isPinned(entry)) {
      return resolvedComponentFromPinned(
        name,
        entry,
        "render",
        opts.lockfile.environment.id,
      );
    }

    const devEntry = opts.devLockfile.components[name];
    if (devEntry === undefined || !isPinned(devEntry)) {
      throw new Error(
        `Cannot resolve follower component "${name}": dev lockfile must contain a pinned entry`,
      );
    }

    return {
      ...resolvedComponentFromPinned(name, devEntry, "follow", "dev"),
      followsEnvId: "dev",
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
      .filter((dependencyName) => dependencyName !== "sdk")
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
  envId: string,
): ResolvedComponent {
  return {
    name,
    packageName: `@henosis/${name}`,
    repo: entry.repo,
    ref: entry.ref,
    digest: entry.digest,
    disposition,
    envId,
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
    "@henosis/sdk": `github:henosis-playground/platform#${opts.platformRef}&path:packages/sdk`,
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

  await writeJson(path.join(scratchDir, "package.json"), {
    name: "henosis-gate-workspace-root",
    private: true,
    packageManager: "pnpm@11.3.0",
    devDependencies: {
      typescript: "5.9.3",
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
        typescript: "5.9.3",
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
