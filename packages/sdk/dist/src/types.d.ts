declare const bindingValueBrand: unique symbol;
declare const componentBrand: unique symbol;
export type Env = {
    kind: "dev" | "staging" | "prod";
} | {
    kind: "preview";
    id: string;
};
export type EnvId = string;
export type ImageRef = {
    ref: string;
    digest: string;
};
export type BindingConvention = "httpUrl" | "publicUrl" | "host";
declare class BindingValueToken {
    readonly convention: BindingConvention;
    component?: string | undefined;
    readonly [bindingValueBrand] = true;
    constructor(convention: BindingConvention, component?: string | undefined);
}
export type BindingValue = BindingValueToken;
export type BindingShape = {
    [key: string]: BindingShape;
} | BindingValue | string | number | boolean;
export type Resolved<T> = T extends BindingValue ? string : T extends string | number | boolean ? T : {
    [K in keyof T]: Resolved<T[K]>;
};
export type BindingBuilder = {
    httpUrl(): BindingValue;
    publicUrl(): BindingValue;
    host(): BindingValue;
};
export type BuildContext = {
    env: Env;
    image: ImageRef;
    use<T extends BindingShape>(component: Component<T>): Resolved<T>;
    service(opts: {
        image: ImageRef;
        port: number;
        env?: Record<string, string | BindingValue>;
    }): void;
    postgres(name: string, opts: {
        previews: "clone" | "share-dev";
    }): {
        url: string;
    };
};
export type ComponentSpec<B extends BindingShape> = {
    binding: (builder: BindingBuilder) => B;
    build: (ctx: BuildContext, self: B) => void;
};
declare class ComponentDefinition<B extends BindingShape> {
    readonly name: string;
    readonly spec: ComponentSpec<B>;
    readonly [componentBrand] = true;
    constructor(name: string, spec: ComponentSpec<B>);
}
export type Component<B extends BindingShape> = ComponentDefinition<B>;
export type ServiceRecord = {
    kind: "service";
    component: string;
    image: ImageRef;
    port: number;
    env: Record<string, string>;
    namespace: string;
};
export type PostgresRecord = {
    kind: "postgres";
    component: string;
    name: string;
    previews: "clone" | "share-dev";
    url: string;
    namespace: string;
};
export type ResourceRecord = ServiceRecord | PostgresRecord;
export type TokenResolver = (token: BindingValue) => string;
export type DependencyResolver = <T extends BindingShape>(component: Component<T>) => Resolved<T>;
export declare function createBindingValue(convention: BindingConvention, component?: string): BindingValue;
export declare function isBindingValue(value: unknown): value is BindingValue;
export declare function isBindingValueLike(value: unknown): value is BindingValue;
export declare function createComponent<B extends BindingShape>(name: string, spec: ComponentSpec<B>): Component<B>;
export declare function isComponentLike(value: unknown): value is Component<BindingShape>;
export {};
//# sourceMappingURL=types.d.ts.map