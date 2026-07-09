import { definePlatform, h, } from "@henosis/core";
import { withV1BuildCompatibility } from "./v1-compat.js";
/** The stable environment kinds supported by the mock platform. */
export const stableEnvKinds = ["dev", "staging", "prod"];
const platform = definePlatform({
    stableEnvKinds,
    createContext: ({ env, image }) => ({ env, image }),
    finalize: () => { },
});
/** Defines a mock-platform component with fully typed ctx and params. */
export const defineComponent = withV1BuildCompatibility(platform.defineComponent);
/** Formats a mock-platform environment name. */
export const envName = platform.envName;
/** Parses a name using the mock platform's stable environment set. */
export const envFromName = platform.envFromName;
/** Constructors for Henosis output schemas. */
export { h };
//# sourceMappingURL=index.js.map