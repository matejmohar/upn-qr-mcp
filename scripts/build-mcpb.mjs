// Builds dist/ and packs a self-contained .mcpb bundle into release/.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: "inherit", ...opts });
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (manifest.version !== version) {
  throw new Error(`manifest.json version ${manifest.version} != package.json ${version}. Run: node scripts/sync-version.mjs`);
}

const stage = "build/mcpb";
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync("release", { recursive: true });

run("npm", ["run", "build"]);
cpSync("dist", `${stage}/dist`, { recursive: true });
cpSync("fonts", `${stage}/fonts`, { recursive: true });
for (const f of ["manifest.json", "icon.png", "package.json", "package-lock.json", "LICENSE", "README.md"]) cpSync(f, `${stage}/${f}`);
run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: stage });
prune(`${stage}/node_modules`);

const out = `release/upn-qr-mcp-${version}.mcpb`;
run("npx", ["mcpb", "validate", `${stage}/manifest.json`]);
run("npx", ["mcpb", "pack", stage, out]);
console.log(`\nBuilt ${out}`);

/**
 * Drops files the server never loads at runtime: source maps, type declarations, and the parts of zxing-wasm other
 * than the ES reader and its .wasm (the full and writer builds alone are 2 MB of WebAssembly).
 */
function prune(dir) {
  const zxing = `${dir}/zxing-wasm/dist`;
  for (const d of ["full", "writer", "cjs", "iife", "miniprogram"]) rmSync(`${zxing}/${d}`, { recursive: true, force: true });
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.(map|d\.ts|d\.mts|d\.cts)$/.test(entry.name)) rmSync(join(entry.parentPath, entry.name));
  }
}
