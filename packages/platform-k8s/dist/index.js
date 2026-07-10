import { stringify } from "yaml";
import { compareCodeUnits, definePlatform, h, } from "@henosis/core";
import { PACKAGE_VERSION } from "./version.generated.js";
/** Stable environment kinds supported by the Kubernetes platform. */
export const stableEnvKinds = ["dev", "prod"];
/** Canonical record discriminator for hand-owned Kubernetes objects. */
export const kubernetesRecordKind = "io.kubernetes.object";
/** Exact Kubernetes OpenAPI version exercised in package CI. */
export const kubernetesSchemaVersion = "1.27.1";
/** Derives a bounded DNS-label Namespace from logical name and environment. */
export function deriveNamespaceName(logicalName, env) {
    return fitDnsLabel(`${dnsLabel(logicalName)}-${dnsLabel(envName(env))}`);
}
/** Derives a bounded DNS-label Service/Deployment name. */
export function deriveServiceName(logicalName) {
    return fitDnsLabel(dnsLabel(logicalName));
}
/** Derives the cluster-internal DNS host for a Service. */
export function deriveServiceHost(serviceName, namespaceName) {
    return `${serviceName}.${namespaceName}.svc.cluster.local`;
}
/** Derives a URL, omitting only the scheme's conventional port. */
export function deriveServiceUrl(scheme, host, port) {
    const conventional = (scheme === "http" && port === 80) ||
        (scheme === "https" && port === 443);
    return `${scheme}://${host}${conventional ? "" : `:${port}`}`;
}
/**
 * Projects canonical resolved Kubernetes records to byte-stable YAML.
 * Mapping keys and objects use code-unit ordering; arrays retain builder order.
 */
export function recordsToStableYaml(records) {
    const objects = records
        .filter((record) => record.kind === kubernetesRecordKind)
        .map((record) => requireJsonObject(record.data))
        .map((object) => requireJsonObject(toKubernetesWire(object)))
        .sort((left, right) => compareCodeUnits(objectSortKey(left), objectSortKey(right)));
    if (objects.length === 0)
        return "";
    return `${objects
        .map((object) => stringify(sortJson(object), { lineWidth: 0 }).trimEnd())
        .join("\n---\n")}\n`;
}
const platform = definePlatform({
    identity: {
        packageName: "@henosis/platform-k8s",
        packageVersion: PACKAGE_VERSION,
        apiVersion: 2,
    },
    stableEnvKinds,
    createContext(input) {
        return createContext(input);
    },
    project(input) {
        const contents = recordsToStableYaml(input.records);
        return contents.length === 0 ? [] : [{ path: "k8s.yaml", contents }];
    },
    validators: [],
});
/** Kubernetes-bound component definition helper. */
export const defineComponent = platform.defineComponent;
/** Parses the strict Kubernetes environment grammar. */
export const parseEnvironment = platform.parseEnvironment;
/** Formats a Kubernetes environment canonically. */
export const envName = platform.formatEnvironment;
/** Output schema constructors re-exported for component authors. */
export { h };
function createContext(input) {
    const namespaces = new Set();
    const services = new Set();
    return Object.freeze({
        env: input.env,
        image: input.image,
        namespace(logicalName) {
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
function namespaceHandle(input, namespace, services) {
    return Object.freeze({
        name: namespace,
        service(logicalName, spec) {
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
            addServiceObjects(input, namespace, name, { ...spec, replicas }, servicePort);
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
function addServiceObjects(input, namespace, name, spec, servicePort) {
    const labels = {
        "app.kubernetes.io/name": name,
        ...environmentLabels(input.env),
    };
    const ranged = isReplicaRange(spec.replicas);
    const replicas = ranged ? spec.replicas.min : spec.replicas;
    const container = {
        name,
        image: input.image.digest,
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
            minAvailable: ranged ? spec.replicas.disruption?.minAvailable ?? 1 : 1,
            selector: { matchLabels: labels },
        },
    });
}
function resourcesRecord(resources) {
    const result = {};
    if (resources.requests !== undefined) {
        result.requests = quantityRecord(resources.requests);
    }
    if (resources.limits !== undefined) {
        result.limits = quantityRecord(resources.limits);
    }
    return result;
}
function quantityRecord(quantities) {
    return Object.fromEntries(Object.entries(quantities).sort(([left], [right]) => compareCodeUnits(left, right)));
}
function emit(records, object) {
    records.write({ kind: kubernetesRecordKind, data: object });
}
function environmentLabels(env) {
    return { "henosis.dev/environment": envName(env) };
}
function validateReplicas(replicas) {
    if (typeof replicas === "number") {
        assertNonNegativeInteger(replicas, "replicas");
        return;
    }
    if (!isReplicaRange(replicas))
        return;
    if (typeof replicas.min === "number") {
        assertNonNegativeInteger(replicas.min, "replicas.min");
    }
    if (typeof replicas.max === "number") {
        assertNonNegativeInteger(replicas.max, "replicas.max");
    }
    if (typeof replicas.min === "number" &&
        typeof replicas.max === "number" &&
        replicas.min > replicas.max) {
        throw new Error("replicas.min must not exceed replicas.max");
    }
    if (typeof replicas.targetCpu === "number") {
        if (!Number.isInteger(replicas.targetCpu) ||
            replicas.targetCpu < 1 ||
            replicas.targetCpu > 100) {
            throw new Error("replicas.targetCpu must be an integer from 1 through 100");
        }
    }
}
function isReplicaRange(value) {
    return (typeof value === "object" &&
        value !== null &&
        "min" in value &&
        "max" in value &&
        "targetCpu" in value);
}
function assertPort(value, field) {
    if (!Number.isInteger(value) || value < 1 || value > 65_535) {
        throw new Error(`${field} must be an integer from 1 through 65535`);
    }
}
function assertNonNegativeInteger(value, field) {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(`${field} must be a non-negative integer`);
    }
}
function dnsLabel(value) {
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
function fitDnsLabel(value) {
    if (value.length <= 63)
        return value;
    const suffix = fnv1a(value).toString(16).padStart(8, "0");
    return `${value.slice(0, 54).replace(/-+$/g, "")}-${suffix}`;
}
function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}
function objectSortKey(object) {
    const metadata = isJsonObject(object.metadata) ? object.metadata : {};
    return [
        typeof object.apiVersion === "string" ? object.apiVersion : "",
        typeof object.kind === "string" ? object.kind : "",
        typeof metadata.namespace === "string" ? metadata.namespace : "",
        typeof metadata.name === "string" ? metadata.name : "",
    ].join("\0");
}
function toKubernetesWire(value, pathParts = []) {
    if (Array.isArray(value)) {
        return value.map((child, index) => toKubernetesWire(child, [...pathParts, String(index)]));
    }
    if (!isJsonObject(value)) {
        const envValue = pathParts.at(-1) === "value" && pathParts.at(-3) === "env";
        return envValue && typeof value === "number" ? String(value) : value;
    }
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        toKubernetesWire(child, [...pathParts, key]),
    ]));
}
function sortJson(value) {
    if (Array.isArray(value))
        return value.map(sortJson);
    if (!isJsonObject(value))
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => compareCodeUnits(left, right))
        .map(([key, child]) => [key, sortJson(child)]));
}
function requireJsonObject(value) {
    if (!isJsonObject(value)) {
        throw new Error("Kubernetes record data must be an object");
    }
    return value;
}
function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=index.js.map