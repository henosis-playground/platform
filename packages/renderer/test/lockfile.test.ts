import { describe, expect, it } from "vitest";
import { parseLockfile } from "../src/lockfile.js";

describe("parseLockfile", () => {
  it("parses pinned component entries", () => {
    expect(
      parseLockfile(`
        [environment]
        id = "dev"

        [components.service-a]
        repo = "henosis-playground/service-a"
        ref = "242e3cd"
        digest = "sha256:abc"
      `),
    ).toEqual({
      environment: { id: "dev" },
      components: {
        "service-a": {
          kind: "pinned",
          repo: "henosis-playground/service-a",
          ref: "242e3cd",
          digest: "sha256:abc",
        },
      },
    });
  });

  it("parses follower entries in preview lockfiles", () => {
    expect(
      parseLockfile(`
        [environment]
        id = "preview-42"

        [components.service-b]
        follow = "dev"
      `).components["service-b"],
    ).toEqual({ kind: "follower", follow: "dev" });
  });

  it("allows an empty components table", () => {
    expect(
      parseLockfile(`
        [environment]
        id = "preview-empty"

        [components]
      `),
    ).toEqual({
      environment: { id: "preview-empty" },
      components: {},
    });
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseLockfile(`
        [environment]
        id = "dev"

        [metadata]
        owner = "platform"
      `),
    ).toThrow('unexpected top-level key "metadata"');
  });

  it("rejects unexpected component keys", () => {
    expect(() =>
      parseLockfile(`
        [environment]
        id = "dev"

        [components.service-a]
        repo = "henosis-playground/service-a"
        ref = "242e3cd"
        digest = "sha256:abc"
        render = true
      `),
    ).toThrow('Invalid component "service-a": unexpected key "render"');
  });

  it("rejects followers in stable environments", () => {
    expect(() =>
      parseLockfile(`
        [environment]
        id = "prod"

        [components.service-b]
        follow = "dev"
      `),
    ).toThrow("follower entries are invalid in prod");
  });
});
