#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { extractClient } from "./client.js";
import { ConfigError, loadConfig, STARTER_CONFIG } from "./config.js";
import { GoGinAdapter } from "./go-gin.js";
import { match } from "./matcher.js";
import { humanExplain, humanList, humanResult } from "./report.js";
import { runSelftest } from "./selftest.js";

const HELP = `tessera — compare what a TypeScript HTTP client sends with what its server reads

Usage:
  tessera init                 Write tessera.config.json and detect tsconfig
  tessera check                Check every extracted client endpoint
  tessera list                 Print both extracted halves
  tessera explain <route>      Show sent and read fields for a route
  tessera selftest             Run the bundled fixture suite

Global flags:
  --config <path>              Configuration file (default: tessera.config.json)
  --json                       Emit versioned structured JSON
  --quiet                      Suppress output
  -h, --help                   Show this help
  -v, --version                Show the installed version

Exit codes: 0 clean, 1 unmatched/error-unmapped, 2 configuration or usage error,
3 unresolved sites when rules.unresolved is "error".

Blind spots:
  Headers and cookies are not analyzed.
  Path parameters are normalized for routing, not compared as fields.
  Response status codes and payload shapes are not analyzed.
  Dynamically computed field names cannot be analyzed.
  Non-JSON bodies (FormData, streams, binary) cannot be analyzed.
  Only files matched by client.include are scanned; other clients are out of frame.
  Endpoints absent from the route map are skipped, not checked (unless configured as errors).
  Server binding shapes outside the adapter's known set cannot be analyzed.
  Server-to-client checking is disabled unless reverseDirection is enabled.
  Tessera reads source, never traffic; fields read and then ignored are invisible.
`;

type Args = { command?: string; positional: string[]; config: string; json: boolean; quiet: boolean; help: boolean; version: boolean };

function parseArgs(argv: string[]): Args {
  const result: Args = { positional: [], config: "tessera.config.json", json: false, quiet: false, help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "--config") {
      const value = argv[++index];
      if (!value) throw new ConfigError("--config requires a path");
      result.config = value;
    } else if (argument === "--json") result.json = true;
    else if (argument === "--quiet") result.quiet = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else if (argument === "--version" || argument === "-v") result.version = true;
    else if (argument.startsWith("-")) throw new ConfigError(`unknown option: ${argument}`);
    else if (!result.command) result.command = argument;
    else result.positional.push(argument);
  }
  return result;
}

function version(): string {
  const packagePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
  return (JSON.parse(fs.readFileSync(packagePath, "utf8")) as { version: string }).version;
}

async function extracted(configPath: string) {
  const loaded = loadConfig(configPath);
  const sends = extractClient(loaded.config.client, loaded.directory);
  const reads = await new GoGinAdapter().extract(loaded.config.server, loaded.directory);
  return { ...loaded, sends, reads };
}

function initialize(configPath: string, json: boolean, quiet: boolean): number {
  const absolute = path.resolve(configPath);
  if (fs.existsSync(absolute)) throw new ConfigError(`refusing to overwrite existing configuration: ${configPath}`);
  const candidates = ["tsconfig.json", "tsconfig.app.json", "tsconfig.build.json"];
  const detected = candidates.find((item) => fs.existsSync(path.resolve(path.dirname(absolute), item))) ?? "tsconfig.json";
  const contents = STARTER_CONFIG.replace('"./tsconfig.json"', `"./${detected}"`);
  fs.writeFileSync(absolute, contents);
  if (!quiet) process.stdout.write(json ? `${JSON.stringify({ schemaVersion: 1, created: absolute, tsconfig: detected })}\n` : `tessera: wrote ${configPath} (tsconfig: ${detected})\n`);
  return 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.command && !args.version)) { if (!args.quiet) process.stdout.write(HELP); return 0; }
  if (args.version) { if (!args.quiet) process.stdout.write(`${version()}\n`); return 0; }
  if (args.command === "init") return initialize(args.config, args.json, args.quiet);
  if (args.command === "selftest") {
    const result = await runSelftest();
    if (!args.quiet) process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${result.lines.join("\n")}\n`);
    return result.passed === result.total ? 0 : 1;
  }
  if (!["check", "list", "explain"].includes(args.command ?? "")) throw new ConfigError(`unknown command: ${args.command ?? ""}`);
  const state = await extracted(args.config);
  if (args.command === "list") {
    if (!args.quiet) process.stdout.write(args.json ? `${JSON.stringify({ schemaVersion: 1, client: state.sends, server: state.reads })}\n` : `${humanList(state.sends, state.reads)}\n`);
    return 0;
  }
  if (args.command === "explain") {
    const route = args.positional[0];
    if (!route || args.positional.length > 1) throw new ConfigError("explain requires exactly one route");
    const matched = match(state.sends, state.reads, state.config.rules, state.config.allow);
    if (!args.quiet) process.stdout.write(args.json ? `${JSON.stringify({ schemaVersion: 1, route, client: state.sends.filter((item) => item.route === route), server: state.reads.filter((item) => item.route === route), findings: matched.findings.filter((item) => "route" in item && item.route === route) })}\n` : `${humanExplain(route, state.sends, state.reads)}\n`);
    return 0;
  }
  const result = match(state.sends, state.reads, state.config.rules, state.config.allow);
  if (!args.quiet) process.stdout.write(args.json ? `${JSON.stringify(result)}\n` : `${humanResult(result)}\n`);
  return result.exitCode;
}

main().then((code) => { process.exitCode = code; }).catch((error: unknown) => {
  process.stderr.write(`tessera: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
