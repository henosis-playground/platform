import { h, type BuildContext as CoreBuildContext, type Environment as CoreEnvironment } from "@henosis/core";
/** The stable environment kinds supported by the mock platform. */
export declare const stableEnvKinds: readonly ["dev", "staging", "prod"];
/** A stable environment kind supported by the mock platform. */
export type StableEnvKind = (typeof stableEnvKinds)[number];
/** A mock-platform environment, including previews with an id. */
export type Env = CoreEnvironment<StableEnvKind>;
/** The zero-capability context supplied by the mock platform. */
export type BuildContext = CoreBuildContext<Env>;
/** Defines a mock-platform component with fully typed ctx and params. */
export declare const defineComponent: import("./v1-compat.js").PlatformMockDefineComponent;
/** Formats a mock-platform environment name. */
export declare const envName: (env: CoreEnvironment<"dev" | "staging" | "prod">) => string;
/** Parses a name using the mock platform's stable environment set. */
export declare const parseEnvironment: (name: string) => CoreEnvironment<"dev" | "staging" | "prod">;
/** Constructors for Henosis output schemas. */
export { h };
export type { BuildValue, ComponentArtifact, ComponentDefinition, ComponentModule, ComponentRecord, ComponentRecordValue, ComponentWithParamsSpec, ComponentWithoutParamsSpec, ContextOutcome, DeferredJsonValue, EvaluationAbortStage, ExactParams, ImageRef, InferSchema, JsonValue, NumberSchema, ObjectSchema, ParamsByEnv, ParamsByEnvironment, ParamsTable, PendingComponentRecord, RecordSink, Ref, RefObject, ReportedValidationIssue, ResolvedComponentRecord, Schema, SchemaBuilder, SchemaShape, StringSchema, UrlSchema, ValidationIssue, WorldValidator, } from "@henosis/core";
export type { PlatformMockDefineComponent, V1CompatibilityComponentSpec, } from "./v1-compat.js";
//# sourceMappingURL=index.d.ts.map