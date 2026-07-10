import { definePlatform, h, } from "@henosis/core";
import { withV1BuildCompatibility } from "./v1-compat.js";
import { PACKAGE_VERSION } from "./version.generated.js";
/** The stable environment kinds supported by the mock platform. */
export const stableEnvKinds = ["dev", "staging", "prod"];
const platform = definePlatform({
    identity: {
        packageName: "@henosis/platform-mock",
        packageVersion: PACKAGE_VERSION,
        apiVersion: 2,
    },
    stableEnvKinds,
    createContext: ({ env, image }) => ({ env, image }),
});
/** Defines a mock-platform component with fully typed ctx and params. */
export const defineComponent = withV1BuildCompatibility(platform.defineComponent);
/** Formats a mock-platform environment name. */
export const envName = platform.formatEnvironment;
/** Parses a name using the mock platform's stable environment set. */
export const parseEnvironment = platform.parseEnvironment;
/** Constructors for Henosis output schemas. */
export { h };
//# sourceMappingURL=index.js.map