import {
  definePlatform,
  h,
  type BuildContext as CoreBuildContext,
  type Env as CoreEnv,
} from "@henosis/core";
import { withV1BuildCompatibility } from "./v1-compat.js";

/** The stable environment kinds supported by the mock platform. */
export const stableEnvKinds = ["dev", "staging", "prod"] as const;

/** A stable environment kind supported by the mock platform. */
export type StableEnvKind = (typeof stableEnvKinds)[number];

/** A mock-platform environment, including previews with an id. */
export type Env = CoreEnv<StableEnvKind>;

/** The zero-capability context supplied by the mock platform. */
export type BuildContext = CoreBuildContext<Env>;

const platform = definePlatform<StableEnvKind, BuildContext>({
  stableEnvKinds,
  createContext: ({ env, image }) => ({ env, image }),
  finalize: () => {},
});

/** Defines a mock-platform component with fully typed ctx and params. */
export const defineComponent = withV1BuildCompatibility(platform.defineComponent);

/** Formats a mock-platform environment name. */
export const envName = platform.envName;

/** Parses a name using the mock platform's stable environment set. */
export const envFromName = platform.envFromName;

/** Constructors for Henosis output schemas. */
export { h };

export type {
  ArtifactWriter,
  BuildValue,
  ComponentArtifact,
  ComponentDefinition,
  ComponentModule,
  ComponentRecord,
  ComponentWriters,
  ComponentWithParamsSpec,
  ComponentWithoutParamsSpec,
  ImageRef,
  InferSchema,
  JsonValue,
  NumberSchema,
  ObjectSchema,
  ParamsByEnv,
  RecordWriter,
  Ref,
  RefObject,
  Schema,
  SchemaBuilder,
  SchemaShape,
  StringSchema,
  UrlSchema,
} from "@henosis/core";

export type {
  PlatformMockDefineComponent,
  V1CompatibilityComponentSpec,
} from "./v1-compat.js";
