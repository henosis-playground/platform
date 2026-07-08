import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { ResolvedComponent } from "./assembler.js";
import type { GateFailure } from "./gate-report.js";
import type { SchemaData } from "./schema-data.js";

export type EnrichmentOptions = {
  scratchDir: string;
  components: readonly ResolvedComponent[];
  platformRef: string;
  localOverrides: Record<string, string>;
};

type SchemaCache = Map<string, Promise<SchemaData | null>>;

export async function enrichGateFailures(
  failures: readonly GateFailure[],
  opts: EnrichmentOptions,
): Promise<GateFailure[]> {
  const components = new Map(opts.components.map((component) => [component.name, component]));
  const schemaCache: SchemaCache = new Map();

  return Promise.all(
    failures.map(async (failure) => {
      if (failure.consumer === "unknown" || failure.producer === "unknown") {
        return failure;
      }

      const producer = components.get(failure.producer);
      const consumer = components.get(failure.consumer);
      const resolvedSha = producer?.ref ?? null;
      const pinnedSha = await readPinnedProducerSha({
        scratchDir: opts.scratchDir,
        consumer: failure.consumer,
        producer: failure.producer,
        consumerRepo: consumer?.repo,
        consumerRef: consumer?.ref,
      });
      const consumedPaths = uniqueSorted([
        ...failure.consumedPaths,
        ...(await inferConsumedPaths(
          opts.scratchDir,
          failure.consumer,
          failure.producer,
          failure.excerpt,
        )),
      ]);

      const outputsSchemaAtResolved =
        producer === undefined
          ? null
          : await schemaFromCache(schemaCache, `installed:${failure.producer}`, () =>
              extractInstalledOutputSchema(opts.scratchDir, failure.producer),
            );
      const outputsSchemaAtPinned =
        producer === undefined || pinnedSha === null
          ? null
          : pinnedSha === resolvedSha
            ? outputsSchemaAtResolved
            : await schemaFromCache(
                schemaCache,
                `git:${producer.repo}:${failure.producer}:${pinnedSha}`,
                () =>
                  extractGitOutputSchema({
                    scratchDir: opts.scratchDir,
                    component: failure.producer,
                    repo: producer.repo,
                    ref: pinnedSha,
                    platformRef: opts.platformRef,
                    localOverrides: opts.localOverrides,
                  }),
              );

      return {
        ...failure,
        pinnedSha,
        resolvedSha,
        outputsSchemaAtPinned,
        outputsSchemaAtResolved,
        consumedPaths,
      };
    }),
  );
}

export async function extractInstalledOutputSchema(
  scratchDir: string,
  component: string,
): Promise<SchemaData | null> {
  const packageDir = path.join(scratchDir, "node_modules", "@henosis", component);
  return extractOutputSchemaFromPackage(packageDir, component, scratchDir);
}

export async function extractOutputSchemaFromPackage(
  packageDir: string,
  component: string,
  scratchDir: string,
): Promise<SchemaData | null> {
  const modulePath = path.join(packageDir, "src", "index.ts");
  if (!existsSync(modulePath)) {
    return null;
  }

  const outputPath = path.join(
    scratchDir,
    `.henosis-schema-${component}-${process.pid}-${Date.now()}.json`,
  );
  const inputPath = `${outputPath}.input`;
  await writeFile(inputPath, `${JSON.stringify({ component, modulePath, outputPath })}\n`);

  const workerPath = schemaWorkerPath();
  const rendererPackageRoot = path.resolve(
    fileURLToPath(new URL("..", import.meta.url)),
  );

  await runCommand(process.execPath, ["--import", "tsx", workerPath, inputPath], {
    cwd: rendererPackageRoot,
  });

  const parsed: unknown = JSON.parse(await readFile(outputPath, "utf8"));
  await rm(inputPath, { force: true });
  await rm(outputPath, { force: true });
  return isSchemaData(parsed) ? parsed : null;
}

export function producerShaFromPnpmLock(
  lockfile: string,
  producer: string,
): string | null {
  const parsed: unknown = parseYaml(lockfile);
  const packageName = `@henosis/${producer}`;

  const importerSha = shaFromImporterDependency(parsed, packageName);
  if (importerSha !== null) {
    return importerSha;
  }

  return shaFromPackageEntries(parsed, packageName);
}

export function consumedSchemaChange(
  pinned: SchemaData | null,
  resolved: SchemaData | null,
  consumedPath: string,
): "removed" | "type-changed" | "unchanged" | "unknown" {
  const pinnedKind = schemaKindAtPath(pinned, consumedPath);
  const resolvedKind = schemaKindAtPath(resolved, consumedPath);
  if (pinnedKind === null || resolvedKind === null) {
    return pinnedKind !== null && resolvedKind === null ? "removed" : "unknown";
  }
  return pinnedKind === resolvedKind ? "unchanged" : "type-changed";
}

async function extractGitOutputSchema(opts: {
  scratchDir: string;
  component: string;
  repo: string;
  ref: string;
  platformRef: string;
  localOverrides: Record<string, string>;
}): Promise<SchemaData | null> {
  const workspace = path.join(
    opts.scratchDir,
    ".henosis-schema-workspaces",
    `${opts.component}-${opts.ref}`,
  );
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });

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
    [`@henosis/${opts.component}`]: `github:${opts.repo}#${opts.ref}&path:henosis`,
  };

  await writeFile(
    path.join(workspace, "package.json"),
    `${JSON.stringify(
      {
        name: "henosis-schema-extractor",
        private: true,
        type: "module",
        dependencies: {
          [`@henosis/${opts.component}`]: "*",
        },
        pnpm: { overrides },
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    path.join(workspace, "pnpm-workspace.yaml"),
    [
      "packages:",
      '  - "."',
      "settings:",
      "  blockExoticSubdeps: false",
      "  confirmModulesPurge: false",
      "overrides:",
      ...Object.entries(overrides).map(
        ([name, spec]) => `  "${name}": "${spec.replaceAll('"', '\\"')}"`,
      ),
      "",
    ].join("\n"),
  );
  await writeFile(
    path.join(workspace, ".npmrc"),
    "block-exotic-subdeps=false\nconfirm-modules-purge=false\nverify-deps-before-run=false\n",
  );

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
    {
      cwd: workspace,
      env: {
        ...process.env,
        CI: "true",
        npm_config_confirm_modules_purge: "false",
      },
    },
  );

  return extractOutputSchemaFromPackage(
    path.join(workspace, "node_modules", "@henosis", opts.component),
    opts.component,
    opts.scratchDir,
  );
}

async function readPinnedProducerSha(opts: {
  scratchDir: string;
  consumer: string;
  producer: string;
  consumerRepo?: string;
  consumerRef?: string;
}): Promise<string | null> {
  const lockPath = path.join(
    opts.scratchDir,
    "node_modules",
    "@henosis",
    opts.consumer,
    "pnpm-lock.yaml",
  );

  try {
    return producerShaFromPnpmLock(await readFile(lockPath, "utf8"), opts.producer);
  } catch {
    // pnpm git path dependencies do not reliably expose lockfiles in the
    // installed package; fall back to the consumer repo/ref that the manifest
    // resolved for this gate.
  }

  if (opts.consumerRepo === undefined || opts.consumerRef === undefined) {
    return null;
  }

  const lockfile = await readGitHubFile(
    opts.consumerRepo,
    opts.consumerRef,
    "henosis/pnpm-lock.yaml",
  );
  return lockfile === null
    ? null
    : producerShaFromPnpmLock(lockfile, opts.producer);
}

async function inferConsumedPaths(
  scratchDir: string,
  consumer: string,
  producer: string,
  excerpt: string,
): Promise<string[]> {
  const paths = new Set(pathsFromExcerpt(excerpt));
  const sourceDir = path.join(
    scratchDir,
    "node_modules",
    "@henosis",
    consumer,
    "src",
  );

  try {
    for (const filePath of await sourceFiles(sourceDir)) {
      const source = await readFile(filePath, "utf8");
      for (const alias of importedProducerAliases(source, producer)) {
        for (const consumedPath of consumedPathsForAlias(source, alias)) {
          paths.add(consumedPath);
        }
      }
    }
  } catch {
    // Keep the tsc/ref-derived paths if package source is unavailable.
  }

  return [...paths].sort();
}

function pathsFromExcerpt(excerpt: string): string[] {
  const paths = new Set<string>();
  for (const match of excerpt.matchAll(/Property '([^']+)' does not exist on type/g)) {
    const pathName = match[1];
    if (pathName !== undefined) {
      paths.add(pathName);
    }
  }
  return [...paths];
}

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(entryPath)));
    } else if (entry.isFile() && /\.(?:ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function importedProducerAliases(source: string, producer: string): string[] {
  const aliases = new Set<string>();
  const escapedProducer = escapeRegExp(`@henosis/${producer}`);
  const defaultImport = new RegExp(
    `import\\s+([A-Za-z_$][\\w$]*)\\s+from\\s+["']${escapedProducer}["']`,
    "g",
  );

  for (const match of source.matchAll(defaultImport)) {
    const alias = match[1];
    if (alias !== undefined) {
      aliases.add(alias);
    }
  }

  return [...aliases];
}

function consumedPathsForAlias(source: string, alias: string): string[] {
  const paths = new Set<string>();
  const access = new RegExp(
    `\\b${escapeRegExp(alias)}\\s*\\.\\s*([A-Za-z_$][\\w$]*(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*)`,
    "g",
  );

  for (const match of source.matchAll(access)) {
    const pathName = match[1];
    if (pathName !== undefined) {
      paths.add(pathName.replaceAll(/\s+/g, ""));
    }
  }

  return [...paths];
}

function schemaKindAtPath(schema: SchemaData | null, consumedPath: string): string | null {
  let current: SchemaData | undefined = schema ?? undefined;
  for (const part of consumedPath.split(".")) {
    if (!isObjectSchemaData(current)) {
      return null;
    }
    current = current.shape[part];
  }
  return current?.kind ?? null;
}

function shaFromImporterDependency(parsed: unknown, packageName: string): string | null {
  if (!isRecord(parsed) || !isRecord(parsed.importers)) {
    return null;
  }

  const importer = parsed.importers["."];
  if (!isRecord(importer) || !isRecord(importer.dependencies)) {
    return null;
  }

  const dependency = importer.dependencies[packageName];
  if (!isRecord(dependency) || typeof dependency.version !== "string") {
    return null;
  }

  return shaFromGitVersion(dependency.version);
}

function shaFromPackageEntries(parsed: unknown, packageName: string): string | null {
  if (!isRecord(parsed) || !isRecord(parsed.packages)) {
    return null;
  }

  const prefix = `${packageName}@`;
  for (const key of Object.keys(parsed.packages)) {
    if (key.startsWith(prefix)) {
      const sha = shaFromGitVersion(key);
      if (sha !== null) {
        return sha;
      }
    }
  }

  return null;
}

function shaFromGitVersion(value: string): string | null {
  const tarballMatch = /\/tar\.gz\/([0-9a-f]{40})(?:#|$)/i.exec(value);
  if (tarballMatch?.[1] !== undefined) {
    return tarballMatch[1];
  }

  const gitRefMatch = /#([0-9a-f]{40})(?:&|$)/i.exec(value);
  return gitRefMatch?.[1] ?? null;
}

function packageOverride(
  localOverrides: Record<string, string>,
  shortName: string,
  fallback: string,
): string {
  const scopedName = `@henosis/${shortName}`;
  const localOverride = localOverrides[shortName] ?? localOverrides[scopedName];
  return localOverride === undefined
    ? fallback
    : `file:${path.resolve(localOverride)}`;
}

async function schemaFromCache(
  cache: SchemaCache,
  key: string,
  load: () => Promise<SchemaData | null>,
): Promise<SchemaData | null> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const promise = load().catch(() => null);
  cache.set(key, promise);
  return promise;
}

async function runCommand(
  command: string,
  args: readonly string[],
  opts: { cwd: string; env?: NodeJS.ProcessEnv },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          [
            `${command} exited with status ${code ?? "unknown"}`,
            Buffer.concat(stdout).toString("utf8"),
            Buffer.concat(stderr).toString("utf8"),
          ]
            .filter((part) => part.length > 0)
            .join("\n"),
        ),
      );
    });
  });
}

async function readGitHubFile(
  repo: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  const [owner, name, extra] = repo.split("/");
  if (
    owner === undefined ||
    name === undefined ||
    extra !== undefined ||
    owner.length === 0 ||
    name.length === 0
  ) {
    return null;
  }

  const response = await fetch(
    `https://raw.githubusercontent.com/${owner}/${name}/${encodeURIComponent(ref)}/${filePath}`,
  );
  return response.ok ? response.text() : null;
}

function schemaWorkerPath(): string {
  const built = fileURLToPath(new URL("./schema-worker.js", import.meta.url));
  return existsSync(built)
    ? built
    : fileURLToPath(new URL("./schema-worker.ts", import.meta.url));
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))].sort();
}

function isSchemaData(value: unknown): value is SchemaData {
  if (!isRecord(value) || typeof value.kind !== "string") {
    return false;
  }
  if (value.kind === "object") {
    return isRecord(value.shape) && Object.values(value.shape).every(isSchemaData);
  }
  return true;
}

function isObjectSchemaData(
  value: SchemaData | undefined,
): value is Extract<SchemaData, { readonly kind: "object" }> {
  return value?.kind === "object" && "shape" in value && isRecord(value.shape);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
