import { type ArtifactReference, type BuildContext, type EmittedResource } from "@henosis/core";
export interface SourceRef {
    /** Built worker module held in the workload artifact store. */
    readonly entry: ArtifactReference<"cloudflare-worker">;
    /** Optional built static-assets archive held in the workload artifact store. */
    readonly assets?: ArtifactReference<"static-assets">;
}
export interface WorkerBody {
    readonly source: SourceRef;
    readonly compatibilityDate?: string;
    readonly compatibilityFlags?: readonly string[];
    readonly vars?: Readonly<Record<string, string | number | boolean>>;
    /** Named Cloudflare service bindings keyed by the binding visible to the Worker. */
    readonly services?: Readonly<Record<string, string>>;
}
export declare const workerOutputs: {
    readonly url: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly workerName: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly deploymentId: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly versionId: import("@henosis/core").OutputDeclaration<string, false, "observed">;
};
export declare const worker: import("@henosis/core").ResourceDefinition<WorkerBody, {
    readonly url: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly workerName: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly deploymentId: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly versionId: import("@henosis/core").OutputDeclaration<string, false, "observed">;
}>;
export interface TunnelBody {
    readonly origin: {
        readonly host: string;
        readonly port: number;
    };
}
export declare const tunnelOutputs: {
    readonly tunnelId: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly tunnelName: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly privateHostname: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly tokenRef: import("@henosis/core").OutputDeclaration<string, false, "observed">;
};
export declare const tunnel: import("@henosis/core").ResourceDefinition<TunnelBody, {
    readonly tunnelId: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly tunnelName: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly privateHostname: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly tokenRef: import("@henosis/core").OutputDeclaration<string, false, "observed">;
}>;
export interface RouteBody {
    readonly pattern: string;
    readonly zone: string;
    readonly workerName: string;
}
export declare const routeOutputs: {
    readonly hostname: import("@henosis/core").OutputDeclaration<string, false, "observed">;
};
export declare const route: import("@henosis/core").ResourceDefinition<RouteBody, {
    readonly hostname: import("@henosis/core").OutputDeclaration<string, false, "observed">;
}>;
/** Emit a Worker while retaining its precise output-handle type. */
export declare function emitWorker(context: BuildContext, name: string, body: WorkerBody): EmittedResource<typeof workerOutputs>;
//# sourceMappingURL=index.d.ts.map