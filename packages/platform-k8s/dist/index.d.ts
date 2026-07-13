import { h, type BuildContext as CoreBuildContext, type Environment as CoreEnvironment, type JsonValue, type ParamsTable, type Ref, type ResolvedComponentRecord } from "@henosis/core";
/** Stable environment kinds supported by the Kubernetes platform. */
export declare const stableEnvKinds: readonly ["dev", "prod"];
/** Stable environment kind supported by the Kubernetes platform. */
export type StableEnvKind = (typeof stableEnvKinds)[number];
/** Kubernetes environment, including an id-carrying preview. */
export type Env = CoreEnvironment<StableEnvKind>;
/** Optional homogeneous annotation for the platform's one params mechanism. */
export type Params<Row extends object> = ParamsTable<StableEnvKind, Row>;
/** A concrete JSON value or a symbolic copied output value. */
export type InputValue<Value extends JsonValue> = Value | Ref<Value>;
/** Value accepted for a Kubernetes container environment variable. */
export type EnvValue = string | number | Ref<string> | Ref<number>;
/** Kubernetes resource quantity names and string quantities. */
export type ResourceQuantities = Readonly<Record<string, InputValue<string>>>;
/** Kubernetes container resource requests and limits. */
export interface Resources {
    /** Requested resources used for scheduling. */
    readonly requests?: ResourceQuantities;
    /** Enforced resource limits. */
    readonly limits?: ResourceQuantities;
}
/** Pod disruption settings for an autoscaled replica range. */
export interface Disruption {
    /** Minimum pods that must remain available; defaults to one. */
    readonly minAvailable?: InputValue<number>;
}
/** HPA-backed replica bounds and CPU utilization target. */
export interface ReplicaRange {
    /** Minimum desired replicas. */
    readonly min: InputValue<number>;
    /** Maximum desired replicas. */
    readonly max: InputValue<number>;
    /** Target average CPU utilization percentage. */
    readonly targetCpu: InputValue<number>;
    /** Optional PodDisruptionBudget tuning. */
    readonly disruption?: Disruption;
}
/** Fixed/symbolic replicas or an autoscaled range. */
export type Replicas = number | Ref<number> | ReplicaRange;
/** URL schemes supported by the v1 service capability. */
export type ServiceScheme = "http" | "https";
/** Input for one Deployment, Service, PDB, and optional HPA. */
export interface ServiceSpec {
    /** Pod/container port copied into records, so a Ref is legal. */
    readonly targetPort: number | Ref<number>;
    /** Concrete cluster-facing port; defaults to 80. */
    readonly servicePort?: number;
    /** Concrete URL scheme; defaults to http. */
    readonly scheme?: ServiceScheme;
    /** Fixed or ranged policy; defaults to one fixed replica. */
    readonly replicas?: Replicas;
    /** Required application-specific resource requirements. */
    readonly resources: Resources;
    /** Optional container environment variables. */
    readonly env?: Readonly<Record<string, EnvValue>>;
}
/** Concrete cluster-local values returned for one Service. */
export interface ServiceHandle {
    /** Derived physical Service and Deployment name. */
    readonly name: string;
    /** Cluster-internal Service DNS name. */
    readonly host: string;
    /** Concrete Service port. */
    readonly port: number;
    /** Cluster-internal HTTP(S) URL. */
    readonly url: string;
}
/** Namespace-scoped Kubernetes capability handle. */
export interface NamespaceHandle {
    /** Derived physical Namespace name. */
    readonly name: string;
    /** Declares one namespace-scoped HTTP service. */
    service(name: string, spec: ServiceSpec): ServiceHandle;
}
/** Complete context visible to Kubernetes component authors. */
export interface BuildContext extends CoreBuildContext<Env> {
    /** Declares a Namespace and returns its scoped capabilities. */
    namespace(name: string): NamespaceHandle;
}
/** Canonical record discriminator for hand-owned Kubernetes objects. */
export declare const kubernetesRecordKind: "io.kubernetes.object";
/** Exact Kubernetes OpenAPI version exercised in package CI. */
export declare const kubernetesSchemaVersion: "1.27.1";
/** Derives a bounded DNS-label Namespace from logical name and environment. */
export declare function deriveNamespaceName(logicalName: string, env: Env): string;
/** Derives a bounded DNS-label Service/Deployment name. */
export declare function deriveServiceName(logicalName: string): string;
/** Derives the cluster-internal DNS host for a Service. */
export declare function deriveServiceHost(serviceName: string, namespaceName: string): string;
/** Derives a URL, omitting only the scheme's conventional port. */
export declare function deriveServiceUrl(scheme: ServiceScheme, host: string, port: number): string;
/**
 * Projects canonical resolved Kubernetes records to byte-stable YAML.
 * Mapping keys and objects use code-unit ordering; arrays retain builder order.
 */
export declare function recordsToStableYaml(records: readonly ResolvedComponentRecord[]): string;
/** Kubernetes-bound component definition helper. */
export declare const defineComponent: import("@henosis/core").DefineComponent<"dev" | "prod", BuildContext>;
/** Parses the strict Kubernetes environment grammar. */
export declare const parseEnvironment: (name: string) => CoreEnvironment<"dev" | "prod">;
/** Formats a Kubernetes environment canonically. */
export declare const envName: (env: CoreEnvironment<"dev" | "prod">) => string;
/** Output schema constructors re-exported for component authors. */
export { h };
export type { 
/** A build result recursively permitting typed output refs. */
BuildValue, 
/** Default component package export shape. */
ComponentModule, 
/** Infers a value represented by an output schema. */
InferSchema, 
/** Number output schema. */
NumberSchema, 
/** Object output schema. */
ObjectSchema, 
/** Semantic role attached to a published output. */
OutputRole,
/** Typed symbolic component output reference. */
Ref, 
/** Public output-ref object derived from a schema. */
RefObject, 
/** Runtime-introspectable output schema. */
Schema, 
/** Output schema construction vocabulary. */
SchemaBuilder, 
/** Named child schemas accepted by an object schema. */
SchemaShape, 
/** String output schema. */
StringSchema, 
/** URL output schema. */
UrlSchema,
/** Metadata accepted when defining a URL output schema. */
UrlSchemaOptions, } from "@henosis/core";
//# sourceMappingURL=index.d.ts.map
