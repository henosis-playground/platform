import {
  definePlatform,
  h,
  type BuildContext as CoreBuildContext,
  type Environment as CoreEnvironment,
  type ParamsTable,
} from "@henosis/core";
import { withV1BuildCompatibility } from "./v1-compat.js";
import { PACKAGE_VERSION } from "./version.generated.js";

/** The stable environment kinds supported by the mock platform. */
export const stableEnvKinds = ["dev", "staging", "prod"] as const;

/** A stable environment kind supported by the mock platform. */
export type StableEnvKind = (typeof stableEnvKinds)[number];

/** A mock-platform environment, including previews with an id. */
export type Env = CoreEnvironment<StableEnvKind>;

/** The zero-capability context supplied by the mock platform. */
export type BuildContext = CoreBuildContext<Env>;

/** Optional homogeneous annotation for the mock platform's params table. */
export type Params<Row extends object> = ParamsTable<StableEnvKind, Row>;

const platform = definePlatform<typeof stableEnvKinds, BuildContext>({
  identity: {
    packageName: "@henosis/platform-mock",
    packageVersion: PACKAGE_VERSION,
    apiVersion: 2,
  },
  stableEnvKinds,
  createContext: ({ env, image }) => ({ env, image }),
});

/** Defines a mock-platform component with fully typed ctx and params. */
export const defineComponent = withV1BuildCompatibility(platform.defineComponent);

/** Formats a mock-platform environment name. */
export const envName = platform.formatEnvironment;

/** Parses a name using the mock platform's stable environment set. */
export const parseEnvironment = platform.parseEnvironment;

/** Constructors for Henosis output schemas. */
export { h };

export type {
  BuildValue,
  ComponentArtifact,
  ComponentDefinition,
  ComponentModule,
  ComponentSpecWithParams,
  ComponentSpecWithoutParams,
  ContextOutcome,
  DeferredJsonValue,
  EvaluationAbortStage,
  ExactParams,
  ImageRef,
  InferSchema,
  JsonValue,
  NumberSchema,
  ObjectSchema,
  OutputRole,
  ParamsByEnvironment,
  ParamsTable,
  PendingComponentRecord,
  RecordSink,
  Ref,
  RefObject,
  ReportedValidationIssue,
  ResolvedComponentRecord,
  Schema,
  SchemaBuilder,
  SchemaShape,
  StringSchema,
  UrlSchema,
  UrlSchemaOptions,
  ValidationIssue,
  WorldValidator,
} from "@henosis/core";

export type {
  PlatformMockDefineComponent,
  V1CompatibilityComponentSpec,
} from "./v1-compat.js";
