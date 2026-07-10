import { stringify } from "yaml";
import {
  compareCodeUnits,
  definePlatform,
  h,
  isRef,
  type BuildContext as CoreBuildContext,
  type ComponentArtifact,
  type DeferredJsonValue,
  type Environment as CoreEnvironment,
  type JsonValue,
  type ParamsTable,
  type PlatformContextInput,
  type RecordSink,
  type Ref,
  type ResolvedComponentRecord,
  type ResolvedWorld,
  type ValidationIssue,
} from "@henosis/core";
import { PACKAGE_VERSION } from "./version.generated.js";

/** Stable environment kinds supported by the Kubernetes platform. */
export const stableEnvKinds = ["dev", "prod"] as const;

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
export const kubernetesRecordKind = "io.kubernetes.object" as const;

/** Exact Kubernetes OpenAPI version exercised in package CI. */
export const kubernetesSchemaVersion = "1.27.1" as const;

/** Derives a bounded DNS-label Namespace from logical name and environment. */
export function deriveNamespaceName(logicalName: string, env: Env): string {
  return fitDnsLabel(`${dnsLabel(logicalName)}-${dnsLabel(envName(env))}`);
}

/** Derives a bounded DNS-label Service/Deployment name. */
export function deriveServiceName(logicalName: string): string {
  return fitDnsLabel(dnsLabel(logicalName));
}

/** Derives the cluster-internal DNS host for a Service. */
export function deriveServiceHost(
  serviceName: string,
  namespaceName: string,
): string {
  return `${serviceName}.${namespaceName}.svc.cluster.local`;
}

/** Derives a URL, omitting only the scheme's conventional port. */
export function deriveServiceUrl(
  scheme: ServiceScheme,
  host: string,
  port: number,
): string {
  const conventional =
    (scheme === "http" && port === 80) ||
    (scheme === "https" && port === 443);
  return `${scheme}://${host}${conventional ? "" : `:${port}`}`;
}

/**
 * Projects canonical resolved Kubernetes records to byte-stable YAML.
 * Mapping keys and objects use code-unit ordering; arrays retain builder order.
 */
export function recordsToStableYaml(
  records: readonly ResolvedComponentRecord[],
): string {
  const objects = records
    .filter((record) => record.kind === kubernetesRecordKind)
    .map((record) => requireJsonObject(record.data))
    .map((object) => requireJsonObject(toKubernetesWire(object)))
    .sort((left, right) =>
      compareCodeUnits(objectSortKey(left), objectSortKey(right)),
    );
  if (objects.length === 0) return "";
  return `${objects
    .map((object) =>
      stringify(sortJson(object), { lineWidth: 0 }).trimEnd(),
    )
    .join("\n---\n")}\n`;
}

const platform = definePlatform<typeof stableEnvKinds, BuildContext>({
  identity: {
    packageName: "@henosis/platform-k8s",
    packageVersion: PACKAGE_VERSION,
    apiVersion: 2,
  },
  stableEnvKinds,
  createContext(input) {
    return createContext(input);
  },
  project(input): readonly ComponentArtifact[] {
    const contents = recordsToStableYaml(input.records);
    return contents.length === 0 ? [] : [{ path: "k8s.yaml", contents }];
  },
  validators: [
    {
      id: "k8s.hpa-semantics",
      validate: validateResolvedHpas,
    },
  ],
});

/** Kubernetes-bound component definition helper. */
export const defineComponent = platform.defineComponent;

/** Parses the strict Kubernetes environment grammar. */
export const parseEnvironment = platform.parseEnvironment;

/** Formats a Kubernetes environment canonically. */
export const envName = platform.formatEnvironment;

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
} from "@henosis/core";

function createContext(
  input: PlatformContextInput<StableEnvKind>,
): BuildContext {
  const namespaces = new Set<string>();
  const services = new Set<string>();
  return Object.freeze({
    env: input.env,
    image: input.image,
    namespace(logicalName: string): NamespaceHandle {
      input.records.assertOpen();
      const name = deriveNamespaceName(logicalName, input.env);
      if (namespaces.has(name)) {
        throw new Error(`Duplicate namespace ${JSON.stringify(name)}`);
      }
      namespaces.add(name);
      emit(input.records, {
        apiVersion: "v1",
        kind: "Namespace",
        metadata: { name, labels: environmentLabels(input.env) },
      });
      return namespaceHandle(input, name, services);
    },
  });
}

function namespaceHandle(
  input: PlatformContextInput<StableEnvKind>,
  namespace: string,
  services: Set<string>,
): NamespaceHandle {
  return Object.freeze({
    name: namespace,
    service(logicalName: string, spec: ServiceSpec): ServiceHandle {
      input.records.assertOpen();
      const name = deriveServiceName(logicalName);
      const key = `${namespace}/${name}`;
      if (services.has(key)) {
        throw new Error(`Duplicate service ${JSON.stringify(key)}`);
      }
      const servicePort = spec.servicePort ?? 80;
      const scheme = spec.scheme ?? "http";
      const replicas = spec.replicas ?? 1;
      assertPort(servicePort, "servicePort");
      if (typeof spec.targetPort === "number") {
        assertPort(spec.targetPort, "targetPort");
      }
      validateReplicas(replicas);
      services.add(key);
      addServiceObjects(
        input,
        namespace,
        name,
        { ...spec, replicas },
        servicePort,
      );
      const host = deriveServiceHost(name, namespace);
      return Object.freeze({
        name,
        host,
        port: servicePort,
        url: deriveServiceUrl(scheme, host, servicePort),
      });
    },
  });
}

function addServiceObjects(
  input: PlatformContextInput<StableEnvKind>,
  namespace: string,
  name: string,
  spec: ServiceSpec & { readonly replicas: Replicas },
  servicePort: number,
): void {
  const labels = {
    "app.kubernetes.io/name": name,
    ...environmentLabels(input.env),
  };
  const ranged = isReplicaRange(spec.replicas);
  const replicas = ranged ? spec.replicas.min : spec.replicas;
  const container: Record<string, DeferredJsonValue> = {
    name,
    // PARKED(image-identity): replace this unpullable reference when image identity work resumes.
    image: puntedImageReference(input.componentName, input.image.digest),
    ports: [{ name: "http", containerPort: spec.targetPort }],
    resources: resourcesRecord(spec.resources),
  };
  if (spec.env !== undefined) {
    container.env = Object.entries(spec.env)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([entryName, value]) => ({ name: entryName, value }));
  }

  emit(input.records, {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, namespace, labels },
    spec: {
      replicas,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: { containers: [container] },
      },
    },
  });
  emit(input.records, {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, namespace, labels },
    spec: {
      type: "ClusterIP",
      selector: labels,
      ports: [
        {
          name: "http",
          protocol: "TCP",
          port: servicePort,
          targetPort: spec.targetPort,
        },
      ],
    },
  });
  if (ranged) {
    emit(input.records, {
      apiVersion: "autoscaling/v2",
      kind: "HorizontalPodAutoscaler",
      metadata: { name, namespace, labels },
      spec: {
        minReplicas: spec.replicas.min,
        maxReplicas: spec.replicas.max,
        scaleTargetRef: {
          apiVersion: "apps/v1",
          kind: "Deployment",
          name,
        },
        metrics: [
          {
            type: "Resource",
            resource: {
              name: "cpu",
              target: {
                type: "Utilization",
                averageUtilization: spec.replicas.targetCpu,
              },
            },
          },
        ],
      },
    });
  }
  emit(input.records, {
    apiVersion: "policy/v1",
    kind: "PodDisruptionBudget",
    metadata: { name, namespace, labels },
    spec: {
      minAvailable:
        ranged ? spec.replicas.disruption?.minAvailable ?? 1 : 1,
      selector: { matchLabels: labels },
    },
  });
}

function resourcesRecord(resources: Resources): DeferredJsonValue {
  const result: Record<string, DeferredJsonValue> = {};
  if (resources.requests !== undefined) {
    result.requests = quantityRecord(resources.requests);
  }
  if (resources.limits !== undefined) {
    result.limits = quantityRecord(resources.limits);
  }
  return result;
}

function quantityRecord(
  quantities: ResourceQuantities,
): DeferredJsonValue {
  return Object.fromEntries(
    Object.entries(quantities).sort(([left], [right]) =>
      compareCodeUnits(left, right),
    ),
  );
}

function emit(records: RecordSink, object: DeferredJsonValue): void {
  records.write({ kind: kubernetesRecordKind, data: object });
}

function environmentLabels(env: Env): Readonly<Record<string, string>> {
  return { "henosis.dev/environment": envName(env) };
}

function validateReplicas(replicas: Replicas): void {
  if (typeof replicas === "number") {
    assertNonNegativeInteger(replicas, "replicas");
    return;
  }
  if (!isReplicaRange(replicas)) return;
  const issue = replicaRangeIssues(
    replicas.min,
    replicas.max,
    replicas.targetCpu,
  )[0];
  if (issue !== undefined) throw new Error(issue.message);
}

function validateResolvedHpas(
  world: ResolvedWorld<StableEnvKind>,
): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const [componentName, component] of Object.entries(world.components)) {
    component.records.forEach((record, index) => {
      if (record.kind !== kubernetesRecordKind || !isJsonObject(record.data)) {
        return;
      }
      if (record.data.kind !== "HorizontalPodAutoscaler") return;
      const spec = jsonObjectProperty(record.data, "spec");
      const metrics = spec === undefined ? undefined : spec.metrics;
      const firstMetric = Array.isArray(metrics) ? metrics[0] : undefined;
      const resource = isJsonObject(firstMetric)
        ? jsonObjectProperty(firstMetric, "resource")
        : undefined;
      const target = resource === undefined
        ? undefined
        : jsonObjectProperty(resource, "target");
      const targetCpu = target?.averageUtilization;
      for (const issue of replicaRangeIssues(
        spec?.minReplicas,
        spec?.maxReplicas,
        targetCpu,
      )) {
        issues.push({
          code: "k8s.hpa-invalid",
          message: issue.message,
          component: componentName,
          record: { index, path: issue.path },
        });
      }
    });
  }
  return issues;
}

function replicaRangeIssues(
  min: JsonValue | Ref<number> | undefined,
  max: JsonValue | Ref<number> | undefined,
  targetCpu: JsonValue | Ref<number> | undefined,
): readonly { readonly path: string; readonly message: string }[] {
  const issues: Array<{ path: string; message: string }> = [];
  const concreteMin = isRef(min) ? undefined : min;
  const concreteMax = isRef(max) ? undefined : max;
  const concreteTargetCpu = isRef(targetCpu) ? undefined : targetCpu;

  if (concreteMin !== undefined) {
    if (typeof concreteMin !== "number" || !Number.isInteger(concreteMin) || concreteMin < 0) {
      issues.push({
        path: "/spec/minReplicas",
        message: "replicas.min must be a non-negative integer",
      });
    }
  }
  if (
    concreteMax !== undefined &&
    (typeof concreteMax !== "number" ||
      !Number.isInteger(concreteMax) ||
      concreteMax < 1)
  ) {
    issues.push({
      path: "/spec/maxReplicas",
      message: "replicas.max must be a positive integer",
    });
  }
  if (
    typeof concreteMin === "number" &&
    Number.isInteger(concreteMin) &&
    typeof concreteMax === "number" &&
    Number.isInteger(concreteMax) &&
    concreteMin > concreteMax
  ) {
    issues.push({
      path: "/spec/maxReplicas",
      message: "replicas.min must not exceed replicas.max",
    });
  }
  if (concreteMin === 0) {
    issues.push({
      path: "/spec/minReplicas",
      message: "replicas.min must be at least 1 with the CPU Resource metric",
    });
  }
  if (
    concreteTargetCpu !== undefined &&
    (typeof concreteTargetCpu !== "number" ||
      !Number.isInteger(concreteTargetCpu) ||
      concreteTargetCpu <= 0)
  ) {
    issues.push({
      path: "/spec/metrics/0/resource/target/averageUtilization",
      message: "replicas.targetCpu must be a positive integer",
    });
  }
  return issues;
}

function puntedImageReference(componentName: string, digest: string): string {
  if (!/^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/.test(componentName)) {
    throw new Error(`Invalid image component name ${JSON.stringify(componentName)}`);
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(digest)) {
    throw new Error(`Invalid sha256 image digest ${JSON.stringify(digest)}`);
  }
  return `henosis-poc.invalid/${componentName}@${digest}`;
}

function isReplicaRange(value: Replicas): value is ReplicaRange {
  return (
    typeof value === "object" &&
    value !== null &&
    "min" in value &&
    "max" in value &&
    "targetCpu" in value
  );
}

function assertPort(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${field} must be an integer from 1 through 65535`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function dnsLabel(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (normalized.length === 0) {
    throw new Error(`Cannot derive a DNS label from ${JSON.stringify(value)}`);
  }
  return normalized;
}

function fitDnsLabel(value: string): string {
  if (value.length <= 63) return value;
  const suffix = fnv1a(value).toString(16).padStart(8, "0");
  return `${value.slice(0, 54).replace(/-+$/g, "")}-${suffix}`;
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function objectSortKey(object: Readonly<Record<string, JsonValue>>): string {
  const metadata = isJsonObject(object.metadata) ? object.metadata : {};
  return [
    typeof object.apiVersion === "string" ? object.apiVersion : "",
    typeof object.kind === "string" ? object.kind : "",
    typeof metadata.namespace === "string" ? metadata.namespace : "",
    typeof metadata.name === "string" ? metadata.name : "",
  ].join("\0");
}

function toKubernetesWire(
  value: JsonValue,
  pathParts: readonly string[] = [],
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((child, index) =>
      toKubernetesWire(child, [...pathParts, String(index)]),
    );
  }
  if (!isJsonObject(value)) {
    const envValue =
      pathParts.at(-1) === "value" && pathParts.at(-3) === "env";
    return envValue && typeof value === "number" ? String(value) : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      toKubernetesWire(child, [...pathParts, key]),
    ]),
  );
}

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => compareCodeUnits(left, right))
      .map(([key, child]) => [key, sortJson(child)]),
  );
}

function requireJsonObject(
  value: JsonValue,
): Readonly<Record<string, JsonValue>> {
  if (!isJsonObject(value)) {
    throw new Error("Kubernetes record data must be an object");
  }
  return value;
}

function isJsonObject(
  value: JsonValue | undefined,
): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonObjectProperty(
  value: Readonly<Record<string, JsonValue>>,
  key: string,
): Readonly<Record<string, JsonValue>> | undefined {
  const property = value[key];
  return isJsonObject(property) ? property : undefined;
}
