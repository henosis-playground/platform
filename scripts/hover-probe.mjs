import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const fixture = path.resolve(
  process.argv[2] ?? "packages/platform-mock/test/hover.ts",
);
const source = readFileSync(fixture, "utf8");
const marker = source.indexOf("// HOVER_FIXTURE: params");
if (marker === -1) throw new Error("Hover marker was not found");
const position = source.lastIndexOf("params", marker);
if (position === -1) throw new Error("params token was not found before marker");

const versions = new Map([[fixture, "0"]]);
const host = {
  getScriptFileNames: () => [fixture],
  getScriptVersion: (fileName) => versions.get(fileName) ?? "0",
  getScriptSnapshot: (fileName) => {
    if (!ts.sys.fileExists(fileName)) return undefined;
    return ts.ScriptSnapshot.fromString(ts.sys.readFile(fileName) ?? "");
  },
  getCurrentDirectory: () => process.cwd(),
  getCompilationSettings: () => ({
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  }),
  getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host);
const info = service.getQuickInfoAtPosition(fixture, position);
if (info === undefined) throw new Error("Language service returned no hover");
process.stdout.write(`${ts.displayPartsToString(info.displayParts)}\n`);
