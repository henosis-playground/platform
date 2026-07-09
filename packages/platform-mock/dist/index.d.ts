import { h, type BuildContext as CoreBuildContext, type Env as CoreEnv } from "@henosis/core";
/** The stable environment kinds supported by the mock platform. */
export declare const stableEnvKinds: readonly ["dev", "staging", "prod"];
/** A stable environment kind supported by the mock platform. */
export type StableEnvKind = (typeof stableEnvKinds)[number];
/** A mock-platform environment, including previews with an id. */
export type Env = CoreEnv<StableEnvKind>;
/** The zero-capability context supplied by the mock platform. */
export type BuildContext = CoreBuildContext<Env>;
/** Defines a mock-platform component with fully typed ctx and params. */
export declare const defineComponent: import("./v1-compat.js").PlatformMockDefineComponent;
/** Formats a mock-platform environment name. */
export declare const envName: (env: CoreEnv<"dev" | "staging" | "prod">) => string;
/** Parses a name using the mock platform's stable environment set. */
export declare const envFromName: (name: string) => CoreEnv<"dev" | "staging" | "prod">;
/** Constructors for Henosis output schemas. */
export { h };
export type { ArtifactWriter, BuildValue, ComponentArtifact, ComponentDefinition, ComponentModule, ComponentRecord, ComponentRecordValue, ComponentWriters, ComponentWithParamsSpec, ComponentWithoutParamsSpec, ImageRef, InferSchema, JsonValue, NumberSchema, ObjectSchema, ParamsByEnv, RecordWriter, Ref, RefObject, ResolvedComponentRecord, Schema, SchemaBuilder, SchemaShape, StringSchema, UrlSchema, } from "@henosis/core";
export type { PlatformMockDefineComponent, V1CompatibilityComponentSpec, } from "./v1-compat.js";
//# sourceMappingURL=index.d.ts.map