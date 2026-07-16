// === VALUES ===

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const schemaSymbol: unique symbol = Symbol("henosis.schema") as never;
declare const schemaValue: unique symbol;

export type SchemaWire =
  | { readonly kind: "string" | "url" | "number" | "boolean" | "json" | "artifact" }
  | { readonly kind: "array"; readonly element: SchemaWire }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, SchemaWire>> };

export interface Schema<Value> {
  readonly kind: SchemaWire["kind"];
  readonly [schemaValue]?: Value;
  readonly [schemaSymbol]: SchemaWire;
  default(value: Value): ConfigDeclaration<Value>;
}

export interface ConfigDeclaration<Value> {
  readonly schema: Schema<Value>;
  readonly default: Value;
}

export type InferSchema<S extends Schema<unknown>> = S extends Schema<infer Value> ? Value : never;
export type SchemaFields = Readonly<Record<string, Schema<unknown>>>;
export type ConfigDeclarations = Readonly<Record<string, Schema<unknown> | ConfigDeclaration<unknown>>>;

function makeSchema<Value>(wire: SchemaWire): Schema<Value> {
  const schema = {
    kind: wire.kind,
    [schemaSymbol]: wire,
    default(value: Value): ConfigDeclaration<Value> {
      return Object.freeze({ schema: schema as Schema<Value>, default: value });
    },
  };
  return Object.freeze(schema);
}

export const value = Object.freeze({
  string: (): Schema<string> => makeSchema({ kind: "string" }),
  url: (): Schema<string> => makeSchema({ kind: "url" }),
  number: (): Schema<number> => makeSchema({ kind: "number" }),
  boolean: (): Schema<boolean> => makeSchema({ kind: "boolean" }),
  json: (): Schema<JsonValue> => makeSchema({ kind: "json" }),
  array: <Element extends Schema<unknown>>(element: Element): Schema<readonly InferSchema<Element>[]> =>
    makeSchema({ kind: "array", element: schemaWire(element) }),
  object: <const Fields extends SchemaFields>(fields: Fields): Schema<{ readonly [Key in keyof Fields]: InferSchema<Fields[Key]> }> =>
    makeSchema({
      kind: "object",
      fields: Object.freeze(Object.fromEntries(
        Object.entries(fields)
          .sort(([left], [right]) => compareCodeUnits(left, right))
          .map(([name, field]) => [name, schemaWire(field)]),
      )),
    }),
});

export function schemaWire(schema: Schema<unknown>): SchemaWire {
  return schema[schemaSymbol];
}

// === DECLARATIONS ===

export type OutputAvailability = "static" | "observed";

export interface OutputDeclaration<
  Value,
  Optional extends boolean = false,
  Availability extends OutputAvailability = OutputAvailability,
> {
  readonly availability: Availability;
  readonly schema: Schema<Value>;
  readonly optional: Optional;
}

export type OutputDeclarations = Readonly<Record<string, OutputDeclaration<unknown, boolean, OutputAvailability>>>;

export const output = Object.freeze({
  static<Value>(schema: Schema<Value>): OutputDeclaration<Value, false, "static"> {
    return Object.freeze({ availability: "static", schema, optional: false });
  },
  optionalStatic<Value>(schema: Schema<Value>): OutputDeclaration<Value, true, "static"> {
    return Object.freeze({ availability: "static", schema, optional: true });
  },
  observed<Value>(schema: Schema<Value>): OutputDeclaration<Value, false, "observed"> {
    return Object.freeze({ availability: "observed", schema, optional: false });
  },
  optionalObserved<Value>(schema: Schema<Value>): OutputDeclaration<Value, true, "observed"> {
    return Object.freeze({ availability: "observed", schema, optional: true });
  },
});

const componentSymbol: unique symbol = Symbol.for("henosis.component.v1") as never;
const outputHandleSymbol: unique symbol = Symbol.for("henosis.output-handle.v1") as never;
const inputValueSymbol: unique symbol = Symbol("henosis.input-value") as never;
const bindingSymbol: unique symbol = Symbol("henosis.output-binding") as never;
const artifactSourceSymbol: unique symbol = Symbol.for("henosis.artifact-source.v1") as never;
declare const outputValue: unique symbol;

export type OutputHandle<Value, Optional extends boolean = false> = {
  readonly component: string;
  readonly output: string;
  readonly optional: Optional;
  readonly schema: Schema<Value>;
  readonly value: Value;
  readonly [outputValue]?: Value;
  readonly [outputHandleSymbol]: true;
} & (Optional extends true ? { readonly present: boolean } : object);

export type ComponentOutputs<Declarations extends OutputDeclarations> = {
  readonly [Key in keyof Declarations]: Declarations[Key] extends OutputDeclaration<infer Value, infer Optional>
    ? OutputHandle<Value, Optional>
    : never;
};

export interface InputValue<Value> { readonly value: Value; }

export type BuildConfig<Declarations extends ConfigDeclarations> = {
  readonly [Key in keyof Declarations]: Declarations[Key] extends ConfigDeclaration<infer Value>
    ? InputValue<Value>
    : Declarations[Key] extends Schema<infer Value>
      ? InputValue<Value>
      : never;
};

// === CONFIGURATION CLOSURE ===

export type ArtifactDigest = `sha256:${string}`;

export interface ConfigFileDeclaration {
  readonly path: string;
  /** Optional author assertion. The bundler always computes the closure digest. */
  readonly sha256?: ArtifactDigest;
}

export interface ClosureFile {
  readonly path: string;
  readonly sha256: ArtifactDigest;
}

export const config = Object.freeze({
  file(path: string, sha256?: ArtifactDigest): ConfigFileDeclaration {
    assertRepositoryPath(path, "configuration file");
    if (sha256 !== undefined) assertArtifactDigest(sha256, `configuration file ${quoted(path)}`);
    return Object.freeze({ path, ...(sha256 === undefined ? {} : { sha256 }) });
  },
});

// === RESOURCES ===

export interface ConfigFileField {
  /** RFC 6901-like path to each object containing a configuration-file reference. */
  readonly references: string;
  readonly pathField: string;
  readonly digestField: string;
}

export interface ResourceIntent<Outputs extends OutputDeclarations> {
  readonly kind: string;
  readonly name: string;
  readonly body: unknown;
  readonly outputs: Outputs;
  readonly configFiles: readonly ConfigFileField[];
}

export interface ResourceDefinition<Body extends object, Outputs extends OutputDeclarations> {
  readonly kind: string;
  readonly outputs: Outputs;
  readonly configFiles: readonly ConfigFileField[];
  create(name: string, body: Body): ResourceIntent<Outputs>;
}

export interface ObservedOutputBinding<Value> {
  readonly resource: string;
  readonly output: string;
  readonly [bindingSymbol]: Value;
}

export interface EmittedResource<Outputs extends OutputDeclarations> {
  readonly address: string;
  readonly outputs: {
    readonly [Key in keyof Outputs]: Outputs[Key] extends OutputDeclaration<infer Value>
      ? ObservedOutputBinding<Value>
      : never;
  };
}

export function defineResource<Body extends object, const Outputs extends OutputDeclarations>(spec: {
  readonly kind: string;
  readonly outputs: Outputs;
  readonly configFiles?: readonly ConfigFileField[];
}): ResourceDefinition<Body, Outputs> {
  assertKind(spec.kind);
  const outputs = freezeOutputs(spec.outputs);
  const configFiles = Object.freeze([...(spec.configFiles ?? [])]);
  return Object.freeze({
    kind: spec.kind,
    outputs,
    configFiles,
    create(name: string, body: Body): ResourceIntent<Outputs> {
      assertTargetName(name, "resource name");
      return Object.freeze({ kind: spec.kind, name, body, outputs, configFiles });
    },
  });
}

export interface ResourceEmission {
  readonly address: string;
  readonly kind: string;
  readonly name: string;
  readonly body: JsonValue;
  readonly canonical: string;
}

export interface BuildContext<Config extends ConfigDeclarations = Record<never, never>> {
  readonly config: BuildConfig<Config>;
  emit<Outputs extends OutputDeclarations>(intent: ResourceIntent<Outputs>): EmittedResource<Outputs>;
}

// === COMPONENTS ===

export type BuildOutputs<Declarations extends OutputDeclarations> = {
  readonly [Key in keyof Declarations]: Declarations[Key] extends OutputDeclaration<
    infer Value,
    infer Optional,
    infer Availability
  >
    ? Availability extends "observed"
      ? Optional extends true ? ObservedOutputBinding<Value> | undefined : ObservedOutputBinding<Value>
      : Optional extends true ? Value | undefined : Value
    : never;
};

export interface ComponentSpec<Config extends ConfigDeclarations, Outputs extends OutputDeclarations> {
  readonly name: string;
  readonly config?: Config;
  /** Configuration content carried in the hermetic evaluation closure. */
  readonly files?: readonly ConfigFileDeclaration[];
  readonly outputs: Outputs;
  readonly build: (context: BuildContext<Config>) => BuildOutputs<Outputs>;
}

export interface ComponentDefinition<Config extends ConfigDeclarations = ConfigDeclarations, Outputs extends OutputDeclarations = OutputDeclarations> {
  readonly protocolVersion: 1;
  readonly name: string;
  readonly config: Config;
  readonly files: readonly ConfigFileDeclaration[];
  readonly outputs: Outputs;
  readonly build: ComponentSpec<Config, Outputs>["build"];
}

export interface ComponentModule<Config extends ConfigDeclarations, Outputs extends OutputDeclarations> {
  readonly name: string;
  readonly outputs: ComponentOutputs<Outputs>;
  readonly [componentSymbol]: ComponentDefinition<Config, Outputs>;
}

export function defineComponent<
  const Config extends ConfigDeclarations = Record<never, never>,
  const Outputs extends OutputDeclarations = OutputDeclarations,
>(spec: ComponentSpec<Config, Outputs>): ComponentModule<Config, Outputs> {
  assertTargetName(spec.name, "component name");
  const declarations = Object.freeze({ ...(spec.config ?? {}) }) as Config;
  const files = Object.freeze([...(spec.files ?? [])]);
  const outputs = freezeOutputs(spec.outputs);
  for (const [name, declaration] of Object.entries(declarations)) {
    assertApiName(name, "config name");
    const normalized = normalizeConfigDeclaration(declaration);
    if (normalized.default !== undefined) {
      const defaultValue = snapshotJson(normalized.default, `default for config input ${name}`);
      assertSchemaValue(normalized.schema, defaultValue, `default for config input ${name}`);
    }
  }
  const definition = Object.freeze({ protocolVersion: 1 as const, name: spec.name, config: declarations, files, outputs, build: spec.build });
  const handles = Object.freeze(Object.fromEntries(Object.entries(outputs).map(([name, declaration]) => [
    name,
    makeOutputHandle(spec.name, name, declaration),
  ]))) as ComponentOutputs<Outputs>;
  return Object.freeze({ name: spec.name, outputs: handles, [componentSymbol]: definition });
}

export function getComponentDefinition<Config extends ConfigDeclarations, Outputs extends OutputDeclarations>(
  component: ComponentModule<Config, Outputs>,
): ComponentDefinition<Config, Outputs> {
  return component[componentSymbol];
}

// === BUNDLER INPUT DERIVATION ===

export type ArtifactKind = "cloudflare-worker" | "static-assets";

export interface ArtifactInputSource {
  readonly source: "artifact";
  readonly kind: ArtifactKind;
  readonly path: string;
}

export type BundleInputSource = OutputHandle<unknown, boolean> | ArtifactInputSource;
export type BundleInputSources = Readonly<Record<string, BundleInputSource>>;

// === HOST PROTOCOL ===

export type InputSnapshotCell =
  | { readonly state: "available"; readonly value: JsonValue }
  | { readonly state: "blocked" }
  | { readonly state: "absent" };

export interface EvaluationSnapshot {
  readonly protocolVersion: 1;
  readonly inputs: Readonly<Record<string, InputSnapshotCell>>;
}

export interface OutputBindingWire { readonly resource: string; readonly output: string; }
export type InputMetadataWire =
  | { readonly component: string; readonly output: string; readonly optional: boolean }
  | { readonly source: "config"; readonly schema: SchemaWire; readonly default?: { readonly value: JsonValue } };
export interface OutputMetadataWire { readonly availability: OutputAvailability; readonly optional: boolean; readonly schema: SchemaWire; }
export interface CompiledDependencyWire {
  readonly component: string;
  readonly revision: string;
  readonly outputs: Readonly<Record<string, OutputMetadataWire>>;
  readonly consumedOutputs: readonly string[];
}

export interface ComponentMetadataWire {
  readonly name: string;
  readonly inputs: Readonly<Record<string, InputMetadataWire>>;
  readonly outputs: Readonly<Record<string, OutputMetadataWire>>;
  readonly compiledDependencies: readonly CompiledDependencyWire[];
  readonly files: readonly ClosureFile[];
}

/** Bundler-derived facts from the actual producer modules in the resolved esbuild graph. */
export interface BundleCompiledDependency {
  readonly component: ComponentModule<ConfigDeclarations, OutputDeclarations>;
  readonly revision: string;
  readonly consumedOutputs: readonly string[];
}

export interface EvaluationSuccess {
  readonly protocolVersion: 1;
  readonly status: "complete";
  readonly resources: readonly ResourceEmission[];
  readonly outputs: Readonly<Record<string, JsonValue>>;
  readonly observedOutputs: Readonly<Record<string, OutputBindingWire>>;
  readonly reads: readonly string[];
}

export interface EvaluationBlocked {
  readonly protocolVersion: 1;
  readonly status: "blocked";
  readonly resources: readonly ResourceEmission[];
  readonly blocked: BlockedWire;
  readonly reads: readonly string[];
}

export type EvaluationResult = EvaluationSuccess | EvaluationBlocked;

export interface BundleModule {
  readonly protocolVersion: 1;
  readonly component: ComponentMetadataWire;
  evaluate(snapshot: EvaluationSnapshot): EvaluationResult;
}

export function createBundle<Config extends ConfigDeclarations, Outputs extends OutputDeclarations>(
  component: ComponentModule<Config, Outputs>,
  closureFiles: readonly ClosureFile[] = [],
  derivedInputs: BundleInputSources = {},
  compiledDependencies: readonly BundleCompiledDependency[] = [],
): BundleModule {
  const definition = getComponentDefinition(component);
  const verifiedFiles = verifyClosureFiles(definition.files, closureFiles);
  const inputs = verifyDerivedInputs(definition, derivedInputs);
  return Object.freeze({
    protocolVersion: 1 as const,
    component: metadata(definition, inputs, verifiedFiles, compiledDependencies),
    evaluate: (snapshot: EvaluationSnapshot) => executeComponent(component, snapshot, verifiedFiles, inputs),
  });
}

export function executeComponent<Config extends ConfigDeclarations, Outputs extends OutputDeclarations>(
  component: ComponentModule<Config, Outputs>,
  snapshot: EvaluationSnapshot,
  closureFiles: readonly ClosureFile[] = [],
  derivedInputs: BundleInputSources = {},
): EvaluationResult {
  if (snapshot.protocolVersion !== 1) {
    throw diagnostic("HENOSIS_PROTOCOL_VERSION", `Unsupported snapshot protocol ${String(snapshot.protocolVersion)}.`, "Use the same HOST-PROTOCOL.md version on both sides of the isolate boundary.");
  }
  const definition = getComponentDefinition(component);
  const inputs = verifyDerivedInputs(definition, derivedInputs);
  const reads = new Set<string>();
  const runtime = materializeInputs(definition.config, inputs, snapshot.inputs, reads);
  const sink = new ResourceSink(closureFiles);
  const context = Object.freeze({
    config: runtime.config,
    emit: sink.emit.bind(sink),
  }) as BuildContext<Config>;
  const previousEvaluation = activeEvaluation;
  activeEvaluation = runtime;
  try {
    const result = guardDeterminism(() => definition.build(context));
    const encoded = encodeOutputs(definition.outputs, result, sink.addresses());
    return Object.freeze({
      protocolVersion: 1 as const,
      status: "complete" as const,
      resources: sink.seal(),
      outputs: encoded.staticOutputs,
      observedOutputs: encoded.observedOutputs,
      reads: sorted(reads),
    });
  } catch (error) {
    if (error instanceof Blocked) {
      return Object.freeze({ protocolVersion: 1 as const, status: "blocked" as const, resources: sink.seal(), blocked: error.toWire(), reads: sorted(reads) });
    }
    sink.abort();
    throw error;
  } finally {
    activeEvaluation = previousEvaluation;
  }
}

// === DIAGNOSTICS ===

export class AuthoringError extends Error {
  constructor(readonly code: string, readonly summary: string, readonly help: string) {
    super(`error[${code}]: ${summary}\n  |\n  = help: ${help}`);
    this.name = "AuthoringError";
  }
}

export interface HostBlockedDetail {
  readonly input: string;
  readonly source: string;
  readonly operation: string;
  readonly message: string;
}

export interface BlockedWire extends HostBlockedDetail {
  readonly code: "HENOSIS_BLOCKED";
}

export class Blocked extends Error {
  readonly code = "HENOSIS_BLOCKED" as const;
  constructor(readonly input: string, readonly source: string, readonly operation: string) {
    super(`blocked[HENOSIS_BLOCKED]: input ${quoted(input)} from ${source} is not available\n  |\n  = note: ${operation} requires its concrete value\n  = help: Henosis recorded this read and will re-run the component when the producer publishes it`);
    this.name = "Blocked";
  }
  toWire(): BlockedWire {
    return Object.freeze({ code: this.code, input: this.input, source: this.source, operation: this.operation, message: this.message });
  }
}

function throwBlocked(input: string, source: string, operation: string): never {
  const blocked = new Blocked(input, source, operation);
  const marker = (globalThis as typeof globalThis & {
    readonly __henosis_mark_blocked?: (detail: HostBlockedDetail) => void;
  }).__henosis_mark_blocked;
  marker?.(Object.freeze({ input, source, operation, message: blocked.message }));
  throw blocked;
}

// === CANONICALIZATION ===

export function compareCodeUnits(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
export function canonicalStringify(input: JsonValue): string { return JSON.stringify(canonicalize(input)); }
export function canonicalize(input: JsonValue): JsonValue {
  if (Array.isArray(input)) return Object.freeze(input.map(canonicalize));
  if (input !== null && typeof input === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(input).sort(([a], [b]) => compareCodeUnits(a, b)).map(([key, child]) => [key, canonicalize(child)])));
  }
  return input;
}

// === EXECUTION INTERNALS ===

interface RuntimeInput {
  readonly name: string;
  readonly source: string;
  readonly cell: InputSnapshotCell;
  readonly reads: Set<string>;
}

interface ActiveEvaluation {
  readonly config: Readonly<Record<string, InputValue<unknown>>>;
  readonly outputs: ReadonlyMap<string, RuntimeInput>;
  readonly artifacts: ReadonlyMap<string, RuntimeInput>;
}

let activeEvaluation: ActiveEvaluation | undefined;

class ResourceSink {
  private state: "open" | "sealed" | "aborted" = "open";
  private readonly resources: ResourceEmission[] = [];
  private readonly seen = new Set<string>();
  private readonly closureFiles: ReadonlyMap<string, ClosureFile>;

  constructor(closureFiles: readonly ClosureFile[]) {
    this.closureFiles = new Map(closureFiles.map((file) => [file.path, file]));
  }

  emit<Outputs extends OutputDeclarations>(intent: ResourceIntent<Outputs>): EmittedResource<Outputs> {
    if (this.state !== "open") throw diagnostic("HENOSIS_CLOSED_EMITTER", `The resource emitter is already ${this.state}.`, "Emit synchronously while build is running.");
    const address = `${intent.kind}/${intent.name}`;
    if (this.seen.has(address)) throw diagnostic("HENOSIS_DUPLICATE_RESOURCE", `Resource ${quoted(address)} was emitted more than once.`, "Give each resource of a kind a stable unique logical name.");
    const snapshot = snapshotJson(intent.body, `resource ${address}`);
    const body = resolveConfigFileReferences(snapshot, intent.configFiles, this.closureFiles, address);
    this.resources.push(Object.freeze({ address, kind: intent.kind, name: intent.name, body, canonical: canonicalStringify(body) }));
    this.seen.add(address);
    const outputs = Object.freeze(Object.fromEntries(Object.keys(intent.outputs).map((name) => [
      name,
      Object.freeze({ resource: address, output: name, [bindingSymbol]: undefined }),
    ]))) as EmittedResource<Outputs>["outputs"];
    return Object.freeze({ address, outputs });
  }
  addresses(): ReadonlySet<string> { return this.seen; }
  seal(): readonly ResourceEmission[] {
    if (this.state !== "open") throw diagnostic("HENOSIS_CLOSED_EMITTER", `The resource emitter is already ${this.state}.`, "The host seals an evaluation exactly once.");
    this.state = "sealed";
    return Object.freeze([...this.resources]);
  }
  abort(): void { this.state = "aborted"; this.resources.length = 0; this.seen.clear(); }
}

function makeOutputHandle<Value>(
  component: string,
  name: string,
  declaration: OutputDeclaration<Value, boolean>,
): OutputHandle<Value, boolean> {
  const handle: Record<PropertyKey, unknown> = {
    component,
    output: name,
    optional: declaration.optional,
    schema: declaration.schema,
    [outputHandleSymbol]: true,
  };
  Object.defineProperty(handle, "value", {
    enumerable: true,
    get: () => readOutput(component, name, "reading `.value`"),
  });
  if (declaration.optional) {
    Object.defineProperty(handle, "present", {
      enumerable: true,
      get: () => outputPresent(component, name),
    });
  }
  return Object.freeze(handle) as OutputHandle<Value, boolean>;
}

function readOutput(component: string, outputName: string, operation: string): unknown {
  const runtime = activeEvaluation?.outputs.get(sourceKey(component, outputName));
  if (runtime === undefined) {
    throw diagnostic("HENOSIS_UNDECLARED_IMPORT", `Build inspected ${component}.outputs.${outputName}, but the bundle did not declare that imported output.`, "Rebuild with the Henosis bundler so imported output references are derived into component.inputs metadata.");
  }
  return readRuntimeInput(runtime, operation);
}

function outputPresent(component: string, outputName: string): boolean {
  const runtime = activeEvaluation?.outputs.get(sourceKey(component, outputName));
  if (runtime === undefined) {
    throw diagnostic("HENOSIS_UNDECLARED_IMPORT", `Build inspected ${component}.outputs.${outputName}.present, but the bundle did not declare that imported output.`, "Rebuild with the Henosis bundler so imported output references are derived into component.inputs metadata.");
  }
  return runtime.cell.state !== "absent";
}

function readRuntimeInput(runtime: RuntimeInput, operation: string): JsonValue {
  runtime.reads.add(runtime.name);
  if (runtime.cell.state === "blocked") throwBlocked(runtime.name, runtime.source, operation);
  if (runtime.cell.state === "absent") throw diagnostic("HENOSIS_ABSENT_INPUT_READ", `Optional input ${quoted(runtime.name)} is absent, but its .value was read.`, "Branch on the imported output's .present fact before reading .value.");
  return runtime.cell.value;
}

function materializeInputs<Config extends ConfigDeclarations>(
  configDeclarations: Config,
  derivedInputs: BundleInputSources,
  snapshot: Readonly<Record<string, InputSnapshotCell>>,
  reads: Set<string>,
): ActiveEvaluation & { readonly config: BuildConfig<Config> } {
  const configValues: Record<string, InputValue<unknown>> = {};
  const outputs = new Map<string, RuntimeInput>();
  const artifacts = new Map<string, RuntimeInput>();

  for (const [name, declaration] of Object.entries(configDeclarations)) {
    const normalized = normalizeConfigDeclaration(declaration);
    const cell = snapshot[name];
    if (cell === undefined) throw diagnostic("HENOSIS_SNAPSHOT_MISSING_INPUT", `The host omitted declared input ${quoted(name)}.`, "Provide exactly one available cell for every graph config input.");
    if (cell.state !== "available") throw diagnostic("HENOSIS_REQUIRED_INPUT_ABSENT", `Graph config input ${quoted(name)} is ${cell.state}.`, "Config inputs must always be concrete after graph bindings and defaults are applied.");
    const runtime = Object.freeze({ name, source: `graph config ${name}`, cell, reads });
    const handle = {
      get value(): unknown { return readRuntimeInput(runtime, "reading `.value`"); },
      [inputValueSymbol]: runtime,
    };
    configValues[name] = Object.freeze(handle);
    assertSchemaValue(normalized.schema, cell.value, `graph config input ${name}`);
  }

  for (const [name, source] of Object.entries(derivedInputs)) {
    const cell = snapshot[name];
    if (cell === undefined) throw diagnostic("HENOSIS_SNAPSHOT_MISSING_INPUT", `The host omitted declared input ${quoted(name)}.`, "Build snapshots from this bundle revision's metadata.");
    if (isOutputHandle(source)) {
      if (cell.state === "absent" && !source.optional) throw diagnostic("HENOSIS_REQUIRED_INPUT_ABSENT", `Required input ${quoted(name)} (${source.component}.${source.output}) is absent.`, "Only optional producer outputs may be absent.");
      outputs.set(sourceKey(source.component, source.output), Object.freeze({ name, source: `${source.component}.${source.output}`, cell, reads }));
    } else {
      if (cell.state !== "available") throw diagnostic("HENOSIS_REQUIRED_INPUT_ABSENT", `Artifact input ${quoted(name)} is ${cell.state}.`, "The frontend must build and bind workload artifacts before evaluation.");
      assertSchemaValue(makeSchema({ kind: "artifact" }), cell.value, `artifact input ${name}`);
      artifacts.set(artifactKey(source.kind, source.path), Object.freeze({ name, source: `artifact ${source.path}`, cell, reads }));
    }
  }

  for (const extra of Object.keys(snapshot)) {
    if (!(extra in configDeclarations) && !(extra in derivedInputs)) throw diagnostic("HENOSIS_SNAPSHOT_EXTRA_INPUT", `The host supplied undeclared input ${quoted(extra)}.`, "Build snapshots from this bundle revision's metadata.");
  }

  return Object.freeze({ config: Object.freeze(configValues) as BuildConfig<Config>, outputs, artifacts });
}

function encodeOutputs(
  declarations: OutputDeclarations,
  result: Readonly<Record<string, unknown>>,
  emitted: ReadonlySet<string>,
): { readonly staticOutputs: Readonly<Record<string, JsonValue>>; readonly observedOutputs: Readonly<Record<string, OutputBindingWire>> } {
  if (!isRecord(result)) throw diagnostic("HENOSIS_OUTPUT_OBJECT", "A component build must return an output object.", "Return static values and observed bindings keyed by declared output name.");
  const staticOutputs: Record<string, JsonValue> = {};
  const observedOutputs: Record<string, OutputBindingWire> = {};
  for (const [name, declaration] of Object.entries(declarations)) {
    const candidate = result[name];
    if (candidate === undefined && declaration.optional) continue;
    if (candidate === undefined) throw diagnostic("HENOSIS_OUTPUT_MISSING", `Build did not return required ${declaration.availability} output ${quoted(name)}.`, "Return every required output or use an optional declaration.");
    if (declaration.availability === "observed") {
      if (!isBinding(candidate)) throw diagnostic("HENOSIS_OBSERVED_OUTPUT_BINDING", `Observed output ${quoted(name)} is not bound to an emitted resource output.`, "Use context.emit(resource).outputs.<name>; authors cannot invent observations.");
      if (!emitted.has(candidate.resource)) throw diagnostic("HENOSIS_UNEMITTED_OUTPUT_BINDING", `Observed output ${quoted(name)} refers to un-emitted resource ${quoted(candidate.resource)}.`, "Bind outputs only from this build's emitted resources.");
      observedOutputs[name] = Object.freeze({ resource: candidate.resource, output: candidate.output });
    } else {
      const json = snapshotJson(candidate, `static output ${name}`);
      assertSchemaValue(declaration.schema, json, `static output ${name}`);
      staticOutputs[name] = json;
    }
  }
  for (const extra of Object.keys(result)) {
    if (!(extra in declarations)) throw diagnostic("HENOSIS_OUTPUT_EXTRA", `Build returned undeclared output ${quoted(extra)}.`, "Declare the output or remove it.");
  }
  return Object.freeze({ staticOutputs: Object.freeze(staticOutputs), observedOutputs: Object.freeze(observedOutputs) });
}

function snapshotJson(candidate: unknown, location: string): JsonValue {
  const ancestors = new Set<object>();
  const visit = (current: unknown, path: string): JsonValue => {
    if (isRecord(current) && outputHandleSymbol in current) {
      const handle = current as unknown as OutputHandle<unknown, boolean>;
      readOutput(handle.component, handle.output, `serializing ${path}`);
      throw diagnostic("HENOSIS_INPUT_HANDLE_SERIALIZED", `Imported output handle ${handle.component}.outputs.${handle.output} was placed into ${path}.`, `Use ${handle.component}.outputs.${handle.output}.value. Resources are total and cannot contain handles.`);
    }
    if (isRecord(current) && inputValueSymbol in current) {
      const runtime = current[inputValueSymbol] as RuntimeInput;
      readRuntimeInput(runtime, `serializing ${path}`);
      throw diagnostic("HENOSIS_INPUT_HANDLE_SERIALIZED", `Config handle ${quoted(runtime.name)} was placed into ${path}.`, `Use context.config.${runtime.name}.value. Resources are total and cannot contain handles.`);
    }
    if (isRecord(current) && artifactSourceSymbol in current) {
      const source = current[artifactSourceSymbol] as { readonly kind: ArtifactKind; readonly path: string };
      const runtime = activeEvaluation?.artifacts.get(artifactKey(source.kind, source.path));
      if (runtime === undefined) throw diagnostic("HENOSIS_UNDECLARED_ARTIFACT", `Resource references workload source ${quoted(source.path)}, but the bundle did not declare its artifact input.`, "Rebuild with the Henosis bundler so source.entry and source.assets are built and bound automatically.");
      return Object.freeze({ kind: source.kind, digest: readRuntimeInput(runtime, `serializing ${path}`) as string });
    }
    if (current === null || typeof current === "string" || typeof current === "boolean") return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw diagnostic("HENOSIS_NONFINITE_NUMBER", `${path} contains ${String(current)}.`, "Use a finite JSON number.");
      return current;
    }
    if (typeof current !== "object") throw diagnostic("HENOSIS_NON_JSON_VALUE", `${path} contains ${typeof current}.`, "Use only JSON values in resources and static outputs.");
    if (ancestors.has(current)) throw diagnostic("HENOSIS_CYCLIC_VALUE", `${path} contains a cycle.`, "Return an acyclic JSON value.");
    ancestors.add(current);
    try {
      if (Array.isArray(current)) return Object.freeze(current.map((child, index) => visit(child, `${path}[${index}]`)));
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) throw diagnostic("HENOSIS_NON_PLAIN_OBJECT", `${path} contains a class instance.`, "Convert Dates, Maps, Sets, and classes to explicit plain JSON.");
      return Object.freeze(Object.fromEntries(Object.entries(current).sort(([a], [b]) => compareCodeUnits(a, b)).map(([key, child]) => [key, visit(child, `${path}.${key}`)])));
    } finally { ancestors.delete(current); }
  };
  return visit(candidate, location);
}

function guardDeterminism<Result>(run: () => Result): Result {
  const now = Date.now;
  const random = Math.random;
  const forbidden = (name: string): never => { throw diagnostic("HENOSIS_NONDETERMINISTIC_API", `${name} is unavailable while evaluating a component.`, "Derive desire only from declared config, imported outputs, and source constants."); };
  Date.now = () => forbidden("Date.now()");
  Math.random = () => forbidden("Math.random()");
  try { return run(); } finally { Date.now = now; Math.random = random; }
}

function verifyDerivedInputs(
  definition: { readonly config: ConfigDeclarations },
  derivedInputs: BundleInputSources,
): BundleInputSources {
  const seenOutputs = new Set<string>();
  const seenArtifacts = new Set<string>();
  const verified: Record<string, BundleInputSource> = {};
  for (const [name, source] of Object.entries(derivedInputs).sort(([left], [right]) => compareCodeUnits(left, right))) {
    assertApiName(name, "derived input name");
    if (name in definition.config) throw diagnostic("HENOSIS_INPUT_NAME_COLLISION", `Derived input ${quoted(name)} collides with graph config of the same name.`, "Rename the imported component alias or config field.");
    if (isOutputHandle(source)) {
      const key = sourceKey(source.component, source.output);
      if (seenOutputs.has(key)) continue;
      seenOutputs.add(key);
    } else {
      assertRepositoryPath(source.path, "workload artifact source");
      const key = artifactKey(source.kind, source.path);
      if (seenArtifacts.has(key)) continue;
      seenArtifacts.add(key);
    }
    verified[name] = source;
  }
  return Object.freeze(verified);
}

function verifyClosureFiles(
  declarations: readonly ConfigFileDeclaration[],
  closureFiles: readonly ClosureFile[],
): readonly ClosureFile[] {
  const sortedFiles = [...closureFiles].sort((left, right) => compareCodeUnits(left.path, right.path));
  const byPath = new Map(sortedFiles.map((file) => [file.path, file]));
  for (const declaration of declarations) {
    const file = byPath.get(declaration.path);
    if (file === undefined) {
      throw diagnostic("HENOSIS_FILE_CLOSURE", `Bundler omitted declared configuration file ${quoted(declaration.path)} from the closure.`, "Rebuild the bundle from the repository root and include every component files declaration.");
    }
    if (declaration.sha256 !== undefined && file.sha256 !== declaration.sha256) {
      throw diagnostic("HENOSIS_FILE_DIGEST", `Configuration file ${quoted(declaration.path)} expected ${declaration.sha256}, but the closure contains ${file.sha256}.`, "Update the expected digest or restore the intended file bytes.");
    }
  }
  if (byPath.size !== declarations.length) {
    throw diagnostic("HENOSIS_FILE_CLOSURE", "The bundler supplied configuration files not declared by the component.", "Rebuild the bundle from the current component source.");
  }
  return Object.freeze(sortedFiles.map((file) => Object.freeze({ ...file })));
}

function resolveConfigFileReferences(
  body: JsonValue,
  fields: readonly ConfigFileField[],
  closureFiles: ReadonlyMap<string, ClosureFile>,
  address: string,
): JsonValue {
  if (fields.length === 0) return body;
  const resolved = JSON.parse(JSON.stringify(body)) as JsonValue;
  for (const field of fields) {
    for (const reference of objectsAtPath(resolved, field.references)) {
      const candidate = reference[field.pathField];
      if (typeof candidate !== "string") {
        throw diagnostic("HENOSIS_RESOURCE_FILE_REF", `Resource ${quoted(address)} configuration-file field ${quoted(field.pathField)} is not a string.`, "Supply a declared repository-relative configuration-file path.");
      }
      assertRepositoryPath(candidate, `resource ${address} configuration file`);
      const closure = closureFiles.get(candidate);
      if (closure === undefined) {
        throw diagnostic("HENOSIS_RESOURCE_FILE_REF", `Resource ${quoted(address)} references configuration file ${quoted(candidate)}, but that file is not in its evaluation closure.`, "Add config.file(path) to the component files declaration.");
      }
      const expected = reference[field.digestField];
      if (expected !== undefined) {
        if (typeof expected !== "string") {
          throw diagnostic("HENOSIS_FILE_DIGEST", `Resource ${quoted(address)} has a non-string digest for ${quoted(candidate)}.`, "Use sha256 followed by 64 lowercase hexadecimal digits, or omit the digest.");
        }
        assertArtifactDigest(expected, `resource ${quoted(address)} configuration file ${quoted(candidate)}`);
        if (expected !== closure.sha256) {
          throw diagnostic("HENOSIS_FILE_DIGEST", `Resource ${quoted(address)} expected ${expected} for ${quoted(candidate)}, but the closure contains ${closure.sha256}.`, "Update the expected digest or restore the intended file bytes.");
        }
      }
      (reference as Record<string, JsonValue>)[field.digestField] = closure.sha256;
    }
  }
  return canonicalize(resolved);
}

function objectsAtPath(root: JsonValue, pointer: string): Record<string, JsonValue>[] {
  const segments = pointer.split("/").slice(1).map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
  let values: JsonValue[] = [root];
  for (const segment of segments) {
    const next: JsonValue[] = [];
    for (const current of values) {
      if (segment === "*") {
        if (Array.isArray(current)) next.push(...current);
      } else if (current !== null && typeof current === "object" && !Array.isArray(current) && segment in current) {
        next.push((current as Record<string, JsonValue>)[segment] as JsonValue);
      }
    }
    values = next;
  }
  return values.filter((entry): entry is Record<string, JsonValue> => entry !== null && typeof entry === "object" && !Array.isArray(entry));
}

function metadata(
  definition: {
    readonly name: string;
    readonly config: ConfigDeclarations;
    readonly outputs: OutputDeclarations;
  },
  derivedInputs: BundleInputSources,
  files: readonly ClosureFile[],
  compiledDependencies: readonly BundleCompiledDependency[],
): ComponentMetadataWire {
  const inputs: Record<string, InputMetadataWire> = {};
  for (const [name, declaration] of Object.entries(definition.config).sort(([left], [right]) => compareCodeUnits(left, right))) {
    const normalized = normalizeConfigDeclaration(declaration);
    inputs[name] = Object.freeze({
      source: "config" as const,
      schema: schemaWire(normalized.schema),
      ...(normalized.default === undefined ? {} : { default: Object.freeze({ value: snapshotJson(normalized.default, `default for config input ${name}`) }) }),
    });
  }
  for (const [name, source] of Object.entries(derivedInputs)) {
    inputs[name] = isOutputHandle(source)
      ? Object.freeze({ component: source.component, output: source.output, optional: source.optional })
      : Object.freeze({ source: "config" as const, schema: Object.freeze({ kind: "artifact" as const }) });
  }
  const dependencies = compiledDependencies
    .map((dependency): CompiledDependencyWire => {
      const producer = getComponentDefinition(dependency.component);
      const consumedOutputs = [...new Set(dependency.consumedOutputs)].sort(compareCodeUnits);
      for (const outputName of consumedOutputs) {
        if (!(outputName in producer.outputs)) {
          throw diagnostic(
            "HENOSIS_BUNDLE_CONTRACT_OUTPUT",
            `Bundler recorded ${producer.name}.outputs.${outputName}, but the resolved producer does not declare it.`,
            "Rebuild after updating the consumer to use an output declared by the resolved producer.",
          );
        }
      }
      return Object.freeze({
        component: producer.name,
        revision: dependency.revision,
        outputs: outputMetadata(producer.outputs),
        consumedOutputs: Object.freeze(consumedOutputs),
      });
    })
    .sort((left, right) => compareCodeUnits(left.component, right.component));
  for (let index = 1; index < dependencies.length; index += 1) {
    if (dependencies[index - 1]?.component === dependencies[index]?.component) {
      throw diagnostic(
        "HENOSIS_BUNDLE_CONTRACT_DUPLICATE",
        `Bundler supplied contract facts for ${dependencies[index]?.component} more than once.`,
        "Aggregate consumed outputs per producer before calling createBundle().",
      );
    }
  }
  return Object.freeze({
    name: definition.name,
    inputs: Object.freeze(inputs),
    outputs: outputMetadata(definition.outputs),
    compiledDependencies: Object.freeze(dependencies),
    files,
  });
}

function outputMetadata(outputs: OutputDeclarations): Readonly<Record<string, OutputMetadataWire>> {
  return Object.freeze(Object.fromEntries(
    Object.entries(outputs)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([name, declaration]) => [name, Object.freeze({
        availability: declaration.availability,
        optional: declaration.optional,
        schema: schemaWire(declaration.schema),
      })]),
  ));
}

function normalizeConfigDeclaration(declaration: Schema<unknown> | ConfigDeclaration<unknown>): {
  readonly schema: Schema<unknown>;
  readonly default: unknown;
} {
  return schemaSymbol in declaration
    ? { schema: declaration as Schema<unknown>, default: undefined }
    : { schema: declaration.schema, default: declaration.default };
}

function freezeOutputs<Outputs extends OutputDeclarations>(outputs: Outputs): Outputs {
  for (const [name, declaration] of Object.entries(outputs)) {
    assertApiName(name, "output name");
    if (declaration.availability !== "static" && declaration.availability !== "observed") throw diagnostic("HENOSIS_OUTPUT_AVAILABILITY", `Output ${quoted(name)} has invalid availability.`, "Use output.static(), output.observed(), or an optional form.");
  }
  return Object.freeze({ ...outputs });
}

function assertSchemaValue(schema: Schema<unknown>, candidate: JsonValue, label: string): void {
  const wire = schemaWire(schema);
  const fail = (expected: string): never => { throw diagnostic("HENOSIS_OUTPUT_TYPE", `${label} expected ${expected}, received ${jsonKind(candidate)}.`, "Return a value matching the declared schema."); };
  switch (wire.kind) {
    case "string": if (typeof candidate !== "string") fail("string"); return;
    case "url": if (typeof candidate !== "string" || !/^https?:\/\//u.test(candidate)) fail("absolute HTTP(S) URL"); return;
    case "number": if (typeof candidate !== "number") fail("number"); return;
    case "boolean": if (typeof candidate !== "boolean") fail("boolean"); return;
    case "json": return;
    case "artifact": if (typeof candidate !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(candidate)) fail("artifact digest"); return;
    case "array": {
      if (!Array.isArray(candidate)) fail("array");
      for (const child of candidate as readonly JsonValue[]) assertSchemaValue(makeSchema(wire.element), child, label);
      return;
    }
    case "object": {
      if (!isRecord(candidate) || Array.isArray(candidate)) fail("object");
      const object = candidate as Readonly<Record<string, JsonValue>>;
      for (const [name, child] of Object.entries(wire.fields)) {
        if (!(name in object)) fail(`object with field ${name}`);
        assertSchemaValue(makeSchema(child), object[name] as JsonValue, `${label}.${name}`);
      }
      return;
    }
  }
}

function isOutputHandle(candidate: unknown): candidate is OutputHandle<unknown, boolean> { return isRecord(candidate) && candidate[outputHandleSymbol] === true; }
function isBinding(candidate: unknown): candidate is ObservedOutputBinding<unknown> { return isRecord(candidate) && bindingSymbol in candidate; }
function sourceKey(component: string, outputName: string): string { return `${component}\0${outputName}`; }
function artifactKey(kind: ArtifactKind, path: string): string { return `${kind}\0${path}`; }
function assertKind(kind: string): void { if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*@[1-9][0-9]*$/u.test(kind)) throw diagnostic("HENOSIS_RESOURCE_KIND", `Invalid resource kind ${quoted(kind)}.`, "Use a versioned kind such as cloudflare/worker@1."); }
function assertRepositoryPath(path: string, label: string): void {
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw diagnostic("HENOSIS_FILE_PATH", `Invalid ${label} path ${quoted(path)}.`, "Use a normalized repository-relative path without empty, dot, parent, or backslash segments.");
  }
}
function assertArtifactDigest(digest: string, label: string): asserts digest is ArtifactDigest {
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest)) throw diagnostic("HENOSIS_ARTIFACT_DIGEST", `Invalid ${label} digest ${quoted(digest)}.`, "Use sha256 followed by 64 lowercase hexadecimal digits.");
}
function assertTargetName(name: string, label: string): void { if (!/^[a-z][a-z0-9_-]{0,62}$/u.test(name)) throw diagnostic("HENOSIS_LOGICAL_NAME", `Invalid ${label} ${quoted(name)}.`, "Resource logical names and component names flow into target identifiers. Use 1-63 lowercase letters, digits, underscores, or hyphens, beginning with a letter."); }
function assertApiName(name: string, label: string): void { if (!/^[A-Za-z][A-Za-z0-9]{0,62}$/u.test(name)) throw diagnostic("HENOSIS_API_NAME", `Invalid ${label} ${quoted(name)}.`, "Config, derived input, and output names are TypeScript API surface. Use 1-63 ASCII letters or digits, beginning with a letter; idiomatic camelCase is recommended."); }
function diagnostic(code: string, summary: string, help: string): AuthoringError { return new AuthoringError(code, summary, help); }
function quoted(input: string): string { return JSON.stringify(input); }
function jsonKind(input: JsonValue): string { return input === null ? "null" : Array.isArray(input) ? "array" : typeof input; }
function isRecord(input: unknown): input is Record<PropertyKey, unknown> { return typeof input === "object" && input !== null; }
function sorted(values: ReadonlySet<string>): readonly string[] { return Object.freeze([...values].sort(compareCodeUnits)); }
