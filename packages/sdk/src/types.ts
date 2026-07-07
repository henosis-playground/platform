const bindingValueBrand: unique symbol = Symbol("henosis.bindingValue");
const componentBrand: unique symbol = Symbol("henosis.component");

export type Env =
  | { kind: "dev" | "staging" | "prod" }
  | { kind: "preview"; id: string };

export type EnvId = string;

export type ImageRef = {
  ref: string;
  digest: string;
};

export type BindingConvention = "httpUrl" | "publicUrl" | "host";

class BindingValueToken {
  readonly [bindingValueBrand] = true;

  constructor(
    public readonly convention: BindingConvention,
    public component?: string,
  ) {}
}

export type BindingValue = BindingValueToken;

export type BindingShape =
  | { [key: string]: BindingShape }
  | BindingValue
  | string
  | number
  | boolean;

export type Resolved<T> = T extends BindingValue
  ? string
  : T extends string | number | boolean
    ? T
    : { [K in keyof T]: Resolved<T[K]> };

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
  postgres(
    name: string,
    opts: { previews: "clone" | "share-dev" },
  ): { url: string };
};

export type ComponentSpec<B extends BindingShape> = {
  binding: (builder: BindingBuilder) => B;
  build: (ctx: BuildContext, self: B) => void;
};

class ComponentDefinition<B extends BindingShape> {
  readonly [componentBrand] = true;

  constructor(
    public readonly name: string,
    public readonly spec: ComponentSpec<B>,
  ) {}
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

export type DependencyResolver = <T extends BindingShape>(
  component: Component<T>,
) => Resolved<T>;

export function createBindingValue(
  convention: BindingConvention,
  component?: string,
): BindingValue {
  return new BindingValueToken(convention, component);
}

export function isBindingValue(value: unknown): value is BindingValue {
  return value instanceof BindingValueToken || isBindingValueLike(value);
}

export function isBindingValueLike(value: unknown): value is BindingValue {
  return (
    isRecord(value) &&
    (value.convention === "httpUrl" ||
      value.convention === "publicUrl" ||
      value.convention === "host") &&
    (value.component === undefined || typeof value.component === "string")
  );
}

export function createComponent<B extends BindingShape>(
  name: string,
  spec: ComponentSpec<B>,
): Component<B> {
  return new ComponentDefinition(name, spec);
}

export function isComponentLike(value: unknown): value is Component<BindingShape> {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    isRecord(value.spec) &&
    typeof value.spec.binding === "function" &&
    typeof value.spec.build === "function"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
