import {
  h,
  type ObjectSchema,
  type OutputRole,
  type SchemaShape,
  type StringSchema,
  type UrlSchema,
  type UrlSchemaOptions,
} from "@henosis/core";

/** Stable environment kinds supported by the Cloudflare connector. */
export const stableEnvKinds = ["dev", "prod"] as const;

/** Stable environment kind supported by the Cloudflare connector. */
export type StableEnvKind = (typeof stableEnvKinds)[number];

/** Cloudflare environment, including an id-carrying preview. */
export type Env =
  | { readonly kind: StableEnvKind }
  | { readonly kind: "preview"; readonly id: string };

/** Runtime binding treatment applied to a referenced producer output. */
export type InputKind = "string" | "url" | "secret";

/** A typed reference to one declared output of another component. */
export interface OutputReference<Value, Kind extends InputKind> {
  /** Binding treatment used by the Cloudflare connector. */
  readonly kind: Kind;
  /** Declared producer component. */
  readonly component: string;
  /** Declared producer output property. */
  readonly output: string;
  /** Compile-time value carried by this reference. */
  readonly __value?: Value;
}

/** Output schemas that can feed a Cloudflare Worker variable. */
export type VariableOutputSchema = StringSchema | UrlSchema;

/** Flat declared output contract for a referenced component. */
export type VariableOutputShape = Readonly<Record<string, VariableOutputSchema>>;

/** Typed output references derived from a declared producer contract. */
export type DeclaredOutputs<Shape extends VariableOutputShape> = {
  readonly [Key in keyof Shape]: Shape[Key] extends UrlSchema
    ? OutputReference<string, "url">
    : OutputReference<string, "string">;
};

/** Worker variables keyed by their exact Wrangler binding names. */
export type WorkerVars = Readonly<
  Record<string, OutputReference<string, InputKind>>
>;

/** Author-facing Worker definition. */
export interface WorkerSpec<Vars extends WorkerVars> {
  /** Connector-owned outputs published after a successful deployment. */
  readonly outputs: typeof workerOutputs;
  /** Runtime variables populated from typed upstream outputs. */
  readonly vars?: Vars;
}

/** Serializable Worker definition consumed by Henosis authoring. */
export interface WorkerDefinition<Vars extends WorkerVars> {
  /** Connector-owned outputs published after a successful deployment. */
  readonly outputs: typeof workerOutputs;
  /** Runtime variables in the deployed connector's input-slot format. */
  readonly inputs?: Vars;
  /** Exact environment kinds accepted by the deployed connector. */
  readonly environments: readonly ["dev", "prod", "preview"];
}

/** Static outputs published by every Cloudflare Worker component. */
export const workerOutputs = h.object({
  url: h.url({ role: "ui" }),
  workerName: h.string(),
  deploymentId: h.string(),
  versionId: h.string(),
  claimUrl: h.url(),
});

/**
 * Declares another component's output contract and returns completed typed refs.
 *
 * This is the hand-declared bridge until registry-generated declarations can be
 * imported directly from producer packages.
 */
export function declareOutputs<Shape extends VariableOutputShape>(
  component: string,
  outputs: ObjectSchema<Shape>,
): DeclaredOutputs<Shape> {
  assertComponentName(component);
  const references = Object.fromEntries(
    Object.entries(outputs.shape).map(([output, schema]) => [
      output,
      reference(schema.kind, component, output),
    ]),
  );
  return Object.freeze(references) as DeclaredOutputs<Shape>;
}

/** Marks a referenced string output for secret binding at the target boundary. */
export function secret(
  output: OutputReference<string, "string">,
): OutputReference<string, "secret"> {
  return reference("secret", output.component, output.output);
}

/** Defines one immutable Worker spec for separate per-repository execution. */
export function defineWorker<const Vars extends WorkerVars>(
  spec: WorkerSpec<Vars>,
): WorkerDefinition<Vars> {
  if (spec.outputs !== workerOutputs) {
    throw new Error("Cloudflare Workers must publish workerOutputs");
  }
  return Object.freeze({
    outputs: spec.outputs,
    ...(spec.vars === undefined ? {} : { inputs: Object.freeze(spec.vars) }),
    environments: ["dev", "prod", "preview"] as const,
  });
}

/** Parses the exact environment grammar accepted by the Cloudflare connector. */
export function parseEnvironment(name: string): Env {
  if (name === "dev" || name === "prod") return { kind: name };
  if (/^preview_[0-9a-hjkmnp-tv-z]{26}$/.test(name)) {
    return { kind: "preview", id: name };
  }
  throw new Error(`Unsupported Cloudflare environment ${JSON.stringify(name)}`);
}

/** Formats a Cloudflare environment canonically. */
export function envName(env: Env): string {
  return env.kind === "preview" ? env.id : env.kind;
}

/** Output schema constructors re-exported for component authors. */
export { h };

export type {
  /** Semantic role attached to a published output. */
  OutputRole,
  /** Named child schemas accepted by an object schema. */
  SchemaShape,
  /** String output schema. */
  StringSchema,
  /** URL output schema. */
  UrlSchema,
  /** Metadata accepted when defining a URL output schema. */
  UrlSchemaOptions,
};

function reference<Kind extends InputKind>(
  kind: Kind,
  component: string,
  output: string,
): OutputReference<string, Kind> {
  assertComponentName(component);
  if (output.length === 0) throw new Error("Output name must not be empty");
  return Object.freeze({ kind, component, output });
}

function assertComponentName(component: string): void {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(component)) {
    throw new Error(`Invalid component name ${JSON.stringify(component)}`);
  }
}
