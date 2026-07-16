import { type BuildContext, type EmittedResource, type ResourceDefinition } from "@henosis/core";
export interface SourceRef {
    /** Repository-relative Worker entry module. Henosis builds and binds its digest. */
    readonly entry: string;
    /** Optional repository-relative static-assets directory. */
    readonly assets?: string;
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
export declare const worker: ResourceDefinition<WorkerBody, typeof workerOutputs>;
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
export declare const tunnel: ResourceDefinition<TunnelBody, {
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
export declare const route: ResourceDefinition<RouteBody, {
    readonly hostname: import("@henosis/core").OutputDeclaration<string, false, "observed">;
}>;
/** Emit a Worker while retaining its precise output-handle type. */
export declare function emitWorker(context: BuildContext, name: string, body: WorkerBody): EmittedResource<typeof workerOutputs>;
//# sourceMappingURL=index.d.ts.map