import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const packageRoot = path.resolve(process.argv[2] ?? "");
if (packageRoot.length === 0) {
  throw new Error("Usage: generate-package-version.mjs <package-root>");
}
const packageJson = JSON.parse(
  await readFile(path.join(packageRoot, "package.json"), "utf8"),
);
if (typeof packageJson.version !== "string") {
  throw new Error(`Missing package version in ${packageRoot}`);
}
await writeFile(
  path.join(packageRoot, "src", "version.generated.ts"),
  `// Generated from package.json by scripts/generate-package-version.mjs.\nexport const PACKAGE_VERSION = ${JSON.stringify(packageJson.version)};\n`,
);
