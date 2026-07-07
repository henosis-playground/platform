import type { EnvId } from "./types.js";
export declare function namespaceFor(envId: EnvId): string;
export declare function serviceHost(component: string, envId: EnvId): string;
export declare function httpUrl(component: string, envId: EnvId): string;
export declare function publicUrl(component: string, envId: EnvId): string;
export declare function postgresUrl(component: string, dbName: string, envId: EnvId): string;
//# sourceMappingURL=conventions.d.ts.map