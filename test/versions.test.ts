import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const json = (path: string) => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8")) as Record<string, unknown>;

describe("release metadata", () => {
  it("keeps package.json, manifest.json and VERSION in sync", () => {
    const pkg = json("package.json");
    expect(json("manifest.json").version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });

  it("needs no settings: the extension has no user_config and passes no environment", () => {
    const manifest = json("manifest.json") as { user_config?: unknown; server: { mcp_config: { env?: unknown } } };
    expect(manifest.user_config).toBeUndefined();
    expect(manifest.server.mcp_config.env).toBeUndefined();
  });
});
