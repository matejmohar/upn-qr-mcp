#!/usr/bin/env node
/**
 * upn-qr-mcp — command-line entry point. MCP hosts (Claude Desktop, Claude Code, Cursor, …) launch this
 * process and talk to it over stdin/stdout.
 *
 * Never write to stdout here: it carries the protocol. Log to stderr.
 */
import { parseArgs } from "node:util";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server.js";
import { VERSION } from "./version.js";

const HELP = [
  `upn-qr-mcp ${VERSION} — MCP server for Slovenian UPN payment orders and UPN QR codes`,
  "",
  "Usage: upn-qr-mcp",
  "",
  "Runs over stdio; add it to your MCP client (Claude Desktop, Claude Code, Cursor, …). Needs no settings and",
  "makes no network requests.",
  "",
  "Options:",
  "  --version, -v          print the version",
  "  --help, -h             print this help",
  "",
  "Setup instructions: see README.md or https://martej.com",
  "",
].join("\n");

let args: ReturnType<typeof parse>;
function parse() {
  return parseArgs({
    options: {
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  }).values;
}
try {
  args = parse();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
  process.exit(2);
}

if (args.version) {
  process.stderr.write(`${VERSION}\n`);
  process.exit(0);
}
if (args.help) {
  process.stderr.write(HELP);
  process.exit(0);
}

const handle = serveStdio(() => createServer());
process.stderr.write(`[upn-qr-mcp] ${VERSION} running on stdio\n`);

const shutdown = () => {
  void handle.close().finally(() => process.exit(0));
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
