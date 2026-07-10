import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { currentPlatformRef } from "../src/render.js";

const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    scratchDirs.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("currentPlatformRef", () => {
  it("reads the immutable ref written by the shared preparation recipe", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "henosis-platform-ref-"));
    scratchDirs.push(root);
    const sha = "0123456789abcdef0123456789abcdef01234567";
    await writeFile(path.join(root, ".henosis-platform-sha"), `${sha}\n`);

    expect(currentPlatformRef(root)).toBe(sha);
  });
});
