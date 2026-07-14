import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const fixture = path.resolve(
  process.argv[2] ?? "examples/benchmark/src/backend.ts",
);
const token = process.argv[3] ?? "inputs";
const source = readFileSync(fixture, "utf8");
const marker = source.indexOf(`// HOVER_FIXTURE: ${token}`);
if (marker === -1) throw new Error(`Hover marker for ${token} was not found`);
const position = source.lastIndexOf(token, marker);
if (position === -1) throw new Error(`${token} token was not found before marker`);

const host = {
  getScriptFileNames: () => [fixture],
  getScriptVersion: () => "0",
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
