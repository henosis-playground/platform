import { describe, expect, it } from "vitest";
import { representativePreviewName } from "@henosis/core";
import { parseManifest } from "../src/manifest.js";

describe("parseManifest", () => {
  it("parses pinned component entries", () => {
    expect(
      parseManifest(`
        [environment]
        id = "dev"

        [components.service-a]
        repo = "henosis-playground/service-a"
        ref = "242e3cd"
        digest = "sha256:abc"
      `),
    ).toEqual({
      environment: { kind: "dev" },
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

  it("parses follower entries in preview manifests", () => {
    expect(
      parseManifest(`
        [environment]
        id = "preview-42"

        [components.service-b]
        follow = "dev"
      `).components["service-b"],
    ).toEqual({ kind: "follower", follow: "dev" });
  });

  it("accepts canonical TypeIDs and generalized stable follower targets", () => {
    expect(
      parseManifest(`
        [environment]
        id = "${representativePreviewName}"

        [components.service-b]
        follow = "prod"
      `),
    ).toEqual({
      environment: { kind: "preview", id: representativePreviewName },
      components: {
        "service-b": { kind: "follower", follow: "prod" },
      },
    });
  });

  it("rejects malformed preview identities instead of treating them as names", () => {
    expect(() =>
      parseManifest(`
        [environment]
        id = "preview_NOT-A-TYPEID"
      `),
    ).toThrow("Invalid canonical TypeID");
  });

  it("allows an empty components table", () => {
    expect(
      parseManifest(`
        [environment]
        id = "preview-empty"

        [components]
      `),
    ).toEqual({
      environment: { kind: "preview", id: "preview-empty" },
      components: {},
    });
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseManifest(`
        [environment]
        id = "dev"

        [metadata]
        owner = "platform"
      `),
    ).toThrow('unexpected top-level key "metadata"');
  });

  it("rejects unexpected component keys", () => {
    expect(() =>
      parseManifest(`
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
      parseManifest(`
        [environment]
        id = "prod"

        [components.service-b]
        follow = "dev"
      `),
    ).toThrow("follower entries are invalid in prod");
  });
});
