import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  assembleWorkspace,
  readComponentDependencyGraph,
  resolveManifestComponents,
  type LocalOverrides,
  type ResolvedComponent,
} from "./assembler.js";
import { extractInstalledOutputSchema } from "./contract-diagnostics.js";
import { parseManifest } from "./manifest.js";
import { currentPlatformRef, defaultPlatformRoot } from "./render.js";
import type { SchemaData } from "./schema-data.js";

/** Static output schemas keyed by component name. */
export type OutputSchemas = Readonly<Record<string, SchemaData>>;

/** One connector-context location filled with a producer's immutable spec hash. */
export interface DependencySpecHashSlot {
  readonly component: string;
  readonly pointer: string;
}

/** One connector-owned component spec returned by repository inspection. */
export interface InspectedComponentSpec {
  readonly connector: string;
  readonly dependencies: readonly string[];
  readonly outputsSchema: string;
  readonly connectorContext: string;
  readonly dependencySpecHashSlots?: readonly DependencySpecHashSlot[];
}

/** Complete versioned component-spec inspection result. */
export interface ComponentSpecInspection {
  readonly apiVersion: "henosis.dev/component-spec-inspection/v1";
  readonly components: Readonly<Record<string, InspectedComponentSpec>>;
}

interface NativeDefinition {
  readonly kind?: string;
  readonly outputs?: unknown;
  readonly inputs?: Readonly<Record<string, NativeInputReference>>;
  readonly environments?: readonly string[];
  readonly migrationsDir?: string;
  readonly schema?: string;
  readonly api?: {
    readonly expose?: unknown;
    readonly anonAccess?: unknown;
  };
  readonly migrationInputs?: Readonly<
    Record<string, Readonly<Record<string, NativeInputReference>>>
  >;
}

interface NativeInputReference {
  readonly kind: "string" | "url" | "secret";
  readonly component: string;
  readonly output: string;
}

interface NativeCheckout {
  readonly name: string;
  readonly repo: string;
  readonly ref: string;
  readonly digest: string;
  readonly root: string;
}

/** Installs one fully resolved world and inspects its component defaults. */
export async function inspectOutputSchemas(
  manifestPath: string,
  scratchDir: string,
): Promise<OutputSchemas> {
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  const platformRoot = defaultPlatformRoot();
  const assembly = await assembleWorkspace({
    manifest,
    devManifest: manifest,
    stableManifests: {},
    scratchDir,
    platformRef: currentPlatformRef(platformRoot),
    localOverrides: {},
  });
  if (!assembly.ok) {
    throw new Error(assembly.compileOutput ?? "Output-schema workspace assembly failed");
  }

  const components = resolveManifestComponents({ manifest, stableManifests: {} });
  const schemas: Record<string, SchemaData> = {};
  for (const component of components) {
    const schema = await extractInstalledOutputSchema(scratchDir, component.name);
    if (schema === null) {
      throw new Error(`Component ${component.name} has no introspectable output schema`);
    }
    schemas[component.name] = schema;
  }
  return schemas;
}

/** Collects connector-owned component specs from one immutable world. */
export async function inspectComponentSpecs(
  manifestPath: string,
  scratchDir: string,
  localOverrides: LocalOverrides = {},
): Promise<ComponentSpecInspection> {
  const source = await readFile(manifestPath, "utf8");
  const manifest = parseManifest(source);
  const resolved = resolveManifestComponents({ manifest, stableManifests: {} });
  const checkouts = await checkoutComponents(resolved, scratchDir, localOverrides);

  const native = checkouts.filter((component) =>
    existsSync(path.join(component.root, "henosis.ts")),
  );
  const kubernetes = checkouts.filter(
    (component) => !native.includes(component),
  );
  const components: Record<string, InspectedComponentSpec> = {};

  if (kubernetes.length > 0) {
    Object.assign(
      components,
      await inspectKubernetesComponents(environmentName(manifest.environment), kubernetes, scratchDir),
    );
  }
  for (const component of native) {
    components[component.name] = await inspectNativeComponent(
      component,
      environmentName(manifest.environment),
    );
  }

  return {
    apiVersion: "henosis.dev/component-spec-inspection/v1",
    components,
  };
}

/** Executes and validates only per-repository native component definitions. */
export async function inspectNativeComponentSpecs(
  manifestPath: string,
  scratchDir: string,
  localOverrides: LocalOverrides = {},
): Promise<ComponentSpecInspection> {
  const manifest = parseManifest(await readFile(manifestPath, "utf8"));
  const resolved = resolveManifestComponents({ manifest, stableManifests: {} });
  const checkouts = await checkoutComponents(resolved, scratchDir, localOverrides);
  const components: Record<string, InspectedComponentSpec> = {};
  for (const component of checkouts) {
    if (existsSync(path.join(component.root, "henosis.ts"))) {
      components[component.name] = await inspectNativeComponent(
        component,
        environmentName(manifest.environment),
      );
    }
  }
  return {
    apiVersion: "henosis.dev/component-spec-inspection/v1",
    components,
  };
}

// === Kubernetes collection ===

async function inspectKubernetesComponents(
  environmentId: string,
  components: readonly NativeCheckout[],
  scratchDir: string,
): Promise<Record<string, InspectedComponentSpec>> {
  const manifestPath = path.join(scratchDir, "kubernetes-world.toml");
  await writeFile(manifestPath, kubernetesManifest(environmentId, components));
  const workspace = path.join(scratchDir, "kubernetes-workspace");
  const schemas = await inspectOutputSchemas(manifestPath, workspace);
  const dependencies = await readComponentDependencyGraph(
    workspace,
    components.map((component) => component.name),
  );
  const devRefs = await deployedDevRefs();
  const result: Record<string, InspectedComponentSpec> = {};
  const allUnchanged = components.every(
    (component) => devRefs[component.name] === component.ref,
  );

  for (const component of components) {
    const source = await readFile(
      path.join(
        workspace,
        "node_modules",
        "@henosis",
        component.name,
        "src",
        "index.ts",
      ),
      "utf8",
    );
    const borrow = borrowTarget(source);
    const unchanged = devRefs[component.name] === component.ref;
    const context = {
      apiVersion: "henosis.dev/k8s-component-context/v1",
      environment: { id: environmentId },
      source: { repository: component.repo, revision: component.ref },
      image: { digest: component.digest },
      ...(borrow !== undefined && unchanged && allUnchanged
        ? { borrow: { from: borrow, effectiveEnvironment: { id: borrow } } }
        : {}),
    };
    result[component.name] = {
      connector: "k8s",
      dependencies: dependencies[component.name] ?? [],
      outputsSchema: encodeJson(schemas[component.name]),
      connectorContext: encodeJson(context),
    };
  }
  return result;
}

function kubernetesManifest(
  environmentId: string,
  components: readonly NativeCheckout[],
): string {
  const lines = ["[environment]", `id = ${JSON.stringify(environmentId)}`, ""];
  for (const component of components) {
    lines.push(
      `[components.${component.name}]`,
      `repo = ${JSON.stringify(component.repo)}`,
      `ref = ${JSON.stringify(component.ref)}`,
      `digest = ${JSON.stringify(component.digest)}`,
      "",
    );
  }
  return `${lines.join("\n")}\n`;
}

function borrowTarget(source: string): string | undefined {
  return /borrowForPreview\s*:\s*["']([^"']+)["']/.exec(source)?.[1];
}

async function deployedDevRefs(): Promise<Record<string, string>> {
  const response = await fetch(
    "https://raw.githubusercontent.com/henosis-playground/deploy/main/worlds/dev.toml",
  );
  if (!response.ok) {
    throw new Error(`Cannot read deployed dev manifest: HTTP ${response.status}`);
  }
  const manifest = parseManifest(await response.text());
  return Object.fromEntries(
    resolveManifestComponents({ manifest, stableManifests: {} }).map((component) => [
      component.name,
      component.ref,
    ]),
  );
}

// === Per-repository TypeScript collection ===

async function inspectNativeComponent(
  component: NativeCheckout,
  environmentId: string,
): Promise<InspectedComponentSpec> {
  if (existsSync(path.join(component.root, "package.json"))) {
    await runCommand("pnpm", ["install", "--frozen-lockfile"], component.root);
  }
  const definition = await importNativeDefinition(component);
  return definition.kind === "supabase.database"
    ? inspectSupabaseComponent(component, definition)
    : inspectCloudflareComponent(component, environmentId, definition);
}

// === Cloudflare collection ===

async function inspectCloudflareComponent(
  component: NativeCheckout,
  environmentId: string,
  definition: NativeDefinition,
): Promise<InspectedComponentSpec> {
  if (!sameJson(definition.outputs, cloudflareOutputsSchema())) {
    throw new Error(
      `${component.name} must declare the connector-owned Cloudflare Worker outputs`,
    );
  }
  if (
    !Array.isArray(definition.environments) ||
    definition.environments.join(",") !== "dev,prod,preview"
  ) {
    throw new Error(
      `${component.name} must support exactly dev, prod, and preview environments`,
    );
  }
  const inputsDefinition = definition.inputs;
  if (inputsDefinition !== undefined && !isRecord(inputsDefinition)) {
    throw new Error(`${component.name} inputs must be an object`);
  }
  for (const [key, input] of Object.entries(inputsDefinition ?? {})) {
    assertNativeInputReference(component.name, key, input);
  }
  const wrangler = parseSimpleToml(
    await readFile(path.join(component.root, "wrangler.toml"), "utf8"),
  );
  const workerName = requiredString(wrangler.name, "wrangler.toml name");
  const entry = optionalString(wrangler.main) ?? "src/index.js";
  const assetsDirectory = nestedString(wrangler, "assets", "directory");
  const files = await projectFiles(component.root, entry, assetsDirectory);
  const inputs = Object.entries(definition.inputs ?? {}).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const dependencies = [...new Set(inputs.map(([, input]) => input.component))].sort();
  const slots = inputs.map(([key, input]) => ({
    key,
    producer: input.component,
    output: input.output,
    producerSpecHash: null,
  }));
  const dependencySpecHashSlots = slots.map((slot, index) => ({
    component: slot.producer,
    pointer: `/slots/${index}/producerSpecHash`,
  }));
  const context = {
    apiVersion: "henosis.dev/cloudflare-worker/v1",
    workerName,
    entry,
    assetsDirectory,
    environment: environmentId,
    files,
    slots,
    tunnel: null,
  };
  return {
    connector: "cloudflare",
    dependencies,
    outputsSchema: encodeJson(cloudflareOutputsSchema()),
    connectorContext: encodeJson(context),
    dependencySpecHashSlots,
  };
}

async function importNativeDefinition(
  component: NativeCheckout,
): Promise<NativeDefinition> {
  const moduleUrl = pathToFileURL(path.join(component.root, "henosis.ts")).href;
  const script = [
    "const imported = await import(process.argv[1]);",
    "process.stdout.write(JSON.stringify(imported.default));",
  ].join(" ");
  const rendererPackageRoot = path.resolve(
    fileURLToPath(new URL("..", import.meta.url)),
  );
  let encoded: string;
  try {
    encoded = await runCapture(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script, moduleUrl],
      rendererPackageRoot,
    );
  } catch (error) {
    throw new Error(
      `${component.name} henosis.ts failed: ${conciseCommandError(error)}`,
    );
  }
  const parsed: unknown = JSON.parse(
    encoded.trim().split("\n").at(-1) ?? "null",
  );
  const definition =
    isRecord(parsed) && isRecord(parsed.default) ? parsed.default : parsed;
  if (!isRecord(definition)) {
    throw new Error(`${component.name} henosis.ts must default-export a component definition`);
  }
  return definition as unknown as NativeDefinition;
}

async function projectFiles(
  root: string,
  entry: string,
  assetsDirectory: string | undefined,
): Promise<readonly { readonly path: string; readonly bytes: readonly number[] }[]> {
  const paths = ["wrangler.toml", entry];
  if (assetsDirectory !== undefined) {
    paths.push(...(await walkFiles(root, assetsDirectory)));
  }
  const unique = [...new Set(paths)].sort();
  return Promise.all(
    unique.map(async (relative) => ({
      path: relative.replaceAll("\\", "/"),
      bytes: [...(await readFile(path.join(root, relative)))],
    })),
  );
}

async function walkFiles(root: string, relative: string): Promise<string[]> {
  const directory = path.join(root, relative);
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, child)));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

// === Supabase collection ===

async function inspectSupabaseComponent(
  component: NativeCheckout,
  definition: NativeDefinition,
): Promise<InspectedComponentSpec> {
  if (!sameJson(definition.outputs, supabaseOutputsSchema())) {
    throw new Error(
      `${component.name} must declare the connector-owned Supabase database outputs`,
    );
  }
  if (
    !Array.isArray(definition.environments) ||
    definition.environments.join(",") !== "dev,prod,preview"
  ) {
    throw new Error(
      `${component.name} must support exactly dev, prod, and preview environments`,
    );
  }
  const migrationsDir = requiredString(
    definition.migrationsDir,
    `${component.name} migrationsDir`,
  );
  if (
    path.isAbsolute(migrationsDir) ||
    migrationsDir.split(/[\\/]/u).includes("..")
  ) {
    throw new Error(`${component.name} migrationsDir must stay within the repository`);
  }
  const schema = requiredString(definition.schema, `${component.name} schema`);
  if (!/^[a-z][a-z0-9_]{0,62}$/u.test(schema)) {
    throw new Error(`${component.name} schema must match [a-z][a-z0-9_]{0,62}`);
  }
  const api = definition.api;
  if (
    !isRecord(api) ||
    typeof api.expose !== "boolean" ||
    !["none", "read"].includes(String(api.anonAccess))
  ) {
    throw new Error(`${component.name} api must configure expose and anonAccess`);
  }

  const migrationDirectory = path.resolve(component.root, migrationsDir);
  const migrationNames = (await readdir(migrationDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort(compareCodeUnits);
  const configuredInputs = definition.migrationInputs ?? {};
  for (const migrationId of Object.keys(configuredInputs)) {
    if (!migrationNames.includes(`${migrationId}.sql`)) {
      throw new Error(
        `${component.name} configures inputs for missing migration ${JSON.stringify(migrationId)}`,
      );
    }
  }

  const dependencies = new Set<string>();
  const dependencySpecHashSlots: DependencySpecHashSlot[] = [];
  const migrations = await Promise.all(
    migrationNames.map(async (name, migrationIndex) => {
      const id = name.slice(0, -4);
      const sql = await readFile(path.join(migrationDirectory, name), "utf8");
      const values = configuredInputs[id] ?? {};
      const inputs = Object.entries(values)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([inputName, input], inputIndex) => {
          assertNativeInputReference(component.name, inputName, input);
          dependencies.add(input.component);
          dependencySpecHashSlots.push({
            component: input.component,
            pointer: `/migrations/${migrationIndex}/inputs/${inputIndex}/producerComponentSpecHash`,
          });
          return {
            name: inputName,
            producerComponentSpecHash: null,
            output: input.output,
            default: null,
          };
        });
      return {
        id,
        checksum: `sha256:${createHash("sha256").update(sql).digest("hex")}`,
        sql,
        inputs,
      };
    }),
  );
  const context = {
    apiVersion: "henosis.dev/supabase-component-context/v1",
    resourceId: schema,
    target: {
      stack: "local",
      project: "henosis-local",
      database: "postgres",
      schema,
    },
    migrations,
    api: { expose: api.expose, anonAccess: api.anonAccess },
  };
  return {
    connector: "supabase",
    dependencies: [...dependencies].sort(compareCodeUnits),
    outputsSchema: encodeJson(definition.outputs),
    connectorContext: encodeJson(context),
    ...(dependencySpecHashSlots.length === 0 ? {} : { dependencySpecHashSlots }),
  };
}

// === Process and format helpers ===

async function checkoutComponents(
  components: readonly ResolvedComponent[],
  scratchDir: string,
  localOverrides: LocalOverrides,
): Promise<NativeCheckout[]> {
  const checkoutsRoot = path.join(scratchDir, "checkouts");
  await mkdir(checkoutsRoot, { recursive: true });
  const checkouts: NativeCheckout[] = [];
  for (const component of components) {
    const root = path.join(checkoutsRoot, component.name);
    const local = localOverrides[component.name];
    if (local === undefined) {
      await checkout(component.repo, component.ref, root);
    } else {
      await cp(path.resolve(local), root, {
        recursive: true,
        filter: (source) =>
          !source.split(path.sep).some((part) =>
            part === ".git" || part === "node_modules" || part === ".wrangler"
          ),
      });
    }
    checkouts.push({
      name: component.name,
      repo: component.repo,
      ref: component.ref,
      digest: component.digest,
      root,
    });
  }
  return checkouts;
}

async function checkout(repo: string, ref: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  await runCommand("git", ["init", "--quiet"], target);
  await runCommand(
    "git",
    ["fetch", "--quiet", "--depth=1", `https://github.com/${repo}.git`, ref],
    target,
  );
  await runCommand("git", ["checkout", "--quiet", "FETCH_HEAD"], target);
}

async function runCapture(
  command: string,
  arguments_: readonly string[],
  cwd: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else {
        reject(
          new Error(
            `${command} failed (${code ?? "unknown"}): ${Buffer.concat(stderr).toString("utf8").trim()}`,
          ),
        );
      }
    });
  });
}

async function runCommand(
  command: string,
  arguments_: readonly string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, arguments_, {
      cwd,
      env: { ...process.env, CI: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `${command} failed (${code ?? "unknown"}): ${Buffer.concat([...stdout, ...stderr]).toString("utf8").trim()}`,
          ),
        );
      }
    });
  });
}

function environmentName(value: unknown): string {
  if (!isRecord(value)) throw new Error("Manifest environment must be an object");
  if (typeof value.id === "string") return value.id;
  if (typeof value.kind === "string") return value.kind;
  throw new Error("Manifest environment must contain id or kind");
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64");
}

function cloudflareOutputsSchema(): Readonly<Record<string, unknown>> {
  return {
    kind: "object",
    shape: {
      url: { kind: "url", role: "ui" },
      workerName: { kind: "string" },
      deploymentId: { kind: "string" },
      versionId: { kind: "string" },
      claimUrl: { kind: "url" },
    },
  };
}

function supabaseOutputsSchema(): Readonly<Record<string, unknown>> {
  return {
    kind: "object",
    shape: {
      restUrl: { kind: "url" },
      schema: { kind: "string" },
      anonKeyRef: { kind: "secret-ref" },
    },
  };
}

function assertNativeInputReference(
  component: string,
  key: string,
  input: NativeInputReference,
): void {
  if (
    !isRecord(input) ||
    !["string", "url", "secret"].includes(String(input.kind)) ||
    typeof input.component !== "string" ||
    typeof input.output !== "string" ||
    input.output.length === 0
  ) {
    throw new Error(`${component} input ${key} is not a typed output reference`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseSimpleToml(source: string): Record<string, unknown> {
  const sections: Record<string, Record<string, unknown>> = { "": {} };
  let current = sections[""];
  for (const rawLine of source.split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    if (line.length === 0) continue;
    const section = /^\[([^\]]+)\]$/.exec(line)?.[1];
    if (section !== undefined) {
      current = sections[section] ?? {};
      sections[section] = current;
      continue;
    }
    const assignment = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (assignment === null) continue;
    current[assignment[1]] = parseTomlValue(assignment[2]);
  }
  return { ...sections[""], ...sections };
}

function parseTomlValue(source: string): unknown {
  if (source === "true") return true;
  if (source === "false") return false;
  if (source.startsWith("\"") || source.startsWith("[")) return JSON.parse(source);
  const number = Number(source);
  return Number.isNaN(number) ? source : number;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nestedString(
  value: Record<string, unknown>,
  section: string,
  field: string,
): string | undefined {
  const nested = value[section];
  return isRecord(nested) ? optionalString(nested[field]) : undefined;
}

function conciseCommandError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const runtimeError = /^Error:\s+(.+)$/m.exec(message)?.[1];
  return runtimeError ?? message.split("\n")[0] ?? "unknown execution failure";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const manifestPath = args[0];
  const outputPath = optionValue(args, "--output");
  if (manifestPath === undefined || outputPath === undefined || args.includes("--help")) {
    console.error("Usage: henosis-inspect <manifest.toml> --output <component-specs.json>");
    process.exitCode = 1;
    return;
  }

  const scratchDir = await mkdtemp(path.join(os.tmpdir(), "henosis-inspect-"));
  try {
    const inspection = await inspectComponentSpecs(manifestPath, scratchDir);
    await writeFile(outputPath, `${JSON.stringify(inspection)}\n`);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
