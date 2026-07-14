export type AnonymousAccess = "none" | "read";
/** Native SQL remains in repository files; the bundle records content identity, not wrapped SQL. */
export interface MigrationRef {
    readonly id: string;
    readonly path: string;
    readonly sha256: `sha256:${string}`;
}
export interface SchemaBody {
    readonly stack: "local";
    readonly project: "henosis-local";
    readonly database: "postgres";
    readonly schema: string;
    readonly migrations: readonly MigrationRef[];
    readonly api: {
        readonly expose: boolean;
        readonly anonAccess: AnonymousAccess;
    };
}
export declare const schemaOutputs: {
    readonly project: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly database: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly schema: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly apiUrl: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly restUrl: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly databaseUrlRef: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly anonKeyRef: import("@henosis/core").OutputDeclaration<string, false, "observed">;
};
export declare const schema: import("@henosis/core").ResourceDefinition<SchemaBody, {
    readonly project: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly database: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly schema: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly apiUrl: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly restUrl: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly databaseUrlRef: import("@henosis/core").OutputDeclaration<string, false, "observed">;
    readonly anonKeyRef: import("@henosis/core").OutputDeclaration<string, false, "observed">;
}>;
/** Create a checked native-file migration reference. */
export declare function migration(id: string, path: string, sha256: `sha256:${string}`): MigrationRef;
//# sourceMappingURL=index.d.ts.map