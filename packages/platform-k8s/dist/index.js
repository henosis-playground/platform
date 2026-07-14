import { defineResource, } from "@henosis/core";
export const object = defineResource({
    kind: "k8s/object@1",
    outputs: {},
});
/** Emit one native Kubernetes object without translating its vocabulary. */
export function emitObject(context, name, body) {
    return context.emit(object.create(name, body));
}
/**
 * Optional sugar over k8s/object@1. Emits a Deployment and ClusterIP Service;
 * callers can always drop down to emitObject for unsupported fields or CRDs.
 */
export function emitServicePair(context, name, spec) {
    assertDnsLabel(name, "service name");
    assertDnsLabel(spec.namespace, "namespace");
    assertPort(spec.targetPort, "targetPort");
    const servicePort = spec.servicePort ?? 80;
    assertPort(servicePort, "servicePort");
    const labels = { "app.kubernetes.io/name": name };
    const env = spec.env === undefined
        ? undefined
        : Object.entries(spec.env)
            .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
            .map(([entryName, entryValue]) => ({ name: entryName, value: String(entryValue) }));
    emitObject(context, `${name}-deployment`, {
        apiVersion: "apps/v1",
        kind: "Deployment",
        metadata: { name, namespace: spec.namespace },
        spec: {
            replicas: spec.replicas ?? 1,
            selector: { matchLabels: labels },
            template: {
                metadata: { labels },
                spec: {
                    containers: [{
                            name,
                            image: spec.image,
                            ports: [{ name: "http", containerPort: spec.targetPort }],
                            resources: spec.resources,
                            ...(env === undefined ? {} : { env }),
                        }],
                },
            },
        },
    });
    emitObject(context, `${name}-service`, {
        apiVersion: "v1",
        kind: "Service",
        metadata: { name, namespace: spec.namespace },
        spec: {
            type: "ClusterIP",
            selector: labels,
            ports: [{ name: "http", protocol: "TCP", port: servicePort, targetPort: spec.targetPort }],
        },
    });
    const host = `${name}.${spec.namespace}.svc.cluster.local`;
    return Object.freeze({ host, port: servicePort, url: `http://${host}${servicePort === 80 ? "" : `:${servicePort}`}` });
}
function assertPort(port, label) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new Error(`${label} must be an integer from 1 through 65535`);
    }
}
function assertDnsLabel(name, label) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(name)) {
        throw new Error(`${label} must be a lowercase Kubernetes DNS label`);
    }
}
//# sourceMappingURL=index.js.map