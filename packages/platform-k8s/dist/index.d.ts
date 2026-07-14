import { type BuildContext, type EmittedResource, type JsonValue } from "@henosis/core";
/** Any Kubernetes object, preserved verbatim except for canonical object-key order on the wire. */
export interface KubernetesObject {
    readonly apiVersion: string;
    readonly kind: string;
    readonly metadata?: Readonly<Record<string, JsonValue>>;
    readonly [field: string]: JsonValue | undefined;
}
export declare const object: import("@henosis/core").ResourceDefinition<KubernetesObject, Record<never, never>>;
/** Emit one native Kubernetes object without translating its vocabulary. */
export declare function emitObject(context: BuildContext, name: string, body: KubernetesObject): EmittedResource<Record<never, never>>;
export interface ServicePairSpec {
    readonly namespace: string;
    readonly image: string;
    readonly targetPort: number;
    readonly servicePort?: number;
    readonly replicas?: number;
    readonly env?: Readonly<Record<string, string | number | boolean>>;
    readonly resources: {
        readonly requests?: Readonly<Record<string, string>>;
        readonly limits?: Readonly<Record<string, string>>;
    };
}
/**
 * Optional sugar over k8s/object@1. Emits a Deployment and ClusterIP Service;
 * callers can always drop down to emitObject for unsupported fields or CRDs.
 */
export declare function emitServicePair(context: BuildContext, name: string, spec: ServicePairSpec): {
    readonly host: string;
    readonly port: number;
    readonly url: string;
};
//# sourceMappingURL=index.d.ts.map