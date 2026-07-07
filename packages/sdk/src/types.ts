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

export type BindingBuilder = {
  httpUrl(): BindingValue;
  publicUrl(): BindingValue;
  host(): BindingValue;
};

export type BuildContext = {
  env: Env;
  image: ImageRef;
  use<T extends BindingShape>(component: Component<T>): T;
  service(opts: {
    image: ImageRef;
    port: number;
    env?: Record<string, string | BindingValue>;
  }): void;
  postgres(
    name: string,
    opts: { previews: "clone" | "share-dev" },
  ): { url: BindingValue };
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
) => T;

export function createBindingValue(
  convention: BindingConvention,
  component?: string,
): BindingValue {
  return new BindingValueToken(convention, component);
}

export function isBindingValue(value: unknown): value is BindingValue {
  return value instanceof BindingValueToken;
}

export function createComponent<B extends BindingShape>(
  name: string,
  spec: ComponentSpec<B>,
): Component<B> {
  return new ComponentDefinition(name, spec);
}
