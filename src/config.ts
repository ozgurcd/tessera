import fs from "node:fs";
import path from "node:path";
import type { TesseraConfig } from "./types.js";

export class ConfigError extends Error {}

function stripJsonComments(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    const next = text[i + 1];
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      result += char;
    } else if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      result += "\n";
    } else if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) i += 1;
      i += 1;
    } else {
      result += char;
    }
  }
  return result;
}

export function loadConfig(configPath: string): { config: TesseraConfig; directory: string } {
  const absolute = path.resolve(configPath);
  if (!fs.existsSync(absolute)) throw new ConfigError(`configuration file not found: ${configPath}`);
  let raw: unknown;
  try {
    raw = JSON.parse(stripJsonComments(fs.readFileSync(absolute, "utf8")));
  } catch (error) {
    throw new ConfigError(`cannot parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!raw || typeof raw !== "object") throw new ConfigError("configuration must be an object");
  const value = raw as Record<string, unknown>;
  const client = value.client as Record<string, unknown> | undefined;
  const server = value.server as Record<string, unknown> | undefined;
  if (!client || typeof client.tsconfig !== "string") throw new ConfigError("client.tsconfig is required");
  if (!server || typeof server.adapter !== "string" || typeof server.root !== "string") {
    throw new ConfigError("server.adapter and server.root are required");
  }
  if (server.adapter !== "go-gin") throw new ConfigError(`unknown server adapter '${server.adapter}'`);
  for (const key of ["include", "fetchWrappers"] as const) {
    const setting = client[key];
    if (setting !== undefined && (!Array.isArray(setting) || setting.some((item) => typeof item !== "string" || !item))) {
      throw new ConfigError(`client.${key} must be an array of non-empty strings`);
    }
  }
  if (server.readerShapes !== undefined) {
    if (!Array.isArray(server.readerShapes) || server.readerShapes.some((shape) => {
      if (!shape || typeof shape !== "object") return true;
      const record = shape as Record<string, unknown>;
      return typeof record.call !== "string" || !record.call || !Number.isInteger(record.nameArg) || Number(record.nameArg) < 0;
    })) throw new ConfigError("server.readerShapes must contain { call, nameArg } entries");
  }
  if (server.routeOverrides !== undefined) {
    if (!server.routeOverrides || typeof server.routeOverrides !== "object" || Array.isArray(server.routeOverrides) || Object.values(server.routeOverrides as Record<string, unknown>).some((item) => typeof item !== "string" || !item)) {
      throw new ConfigError("server.routeOverrides must map endpoint keys to file paths");
    }
  }
  const rules = (value.rules ?? {}) as Record<string, unknown>;
  const unmapped = rules.unmapped ?? "skip";
  const unresolved = rules.unresolved ?? "warn";
  if (unmapped !== "skip" && unmapped !== "error") throw new ConfigError("rules.unmapped must be 'skip' or 'error'");
  if (unresolved !== "warn" && unresolved !== "error") throw new ConfigError("rules.unresolved must be 'warn' or 'error'");
  if (rules.reverseDirection !== undefined && typeof rules.reverseDirection !== "boolean") throw new ConfigError("rules.reverseDirection must be a boolean");
  const allow = (value.allow ?? []) as unknown;
  if (!Array.isArray(allow)) throw new ConfigError("allow must be an array");
  for (const [index, entry] of allow.entries()) {
    const reason = entry && typeof entry === "object" ? (entry as Record<string, unknown>).reason : undefined;
    const record = entry as Record<string, unknown>;
    if (typeof reason !== "string" || !reason.trim()) throw new ConfigError(`allow[${index}] requires a non-empty reason`);
    if (["method", "route", "location", "field"].some((key) => typeof record[key] !== "string" || !(record[key] as string).trim())) throw new ConfigError(`allow[${index}] requires method, route, location, and field`);
    if (record.location !== "query" && record.location !== "body") throw new ConfigError(`allow[${index}].location must be 'query' or 'body'`);
  }
  return {
    directory: path.dirname(absolute),
    config: {
      client: client as TesseraConfig["client"],
      server: server as TesseraConfig["server"],
      rules: { unmapped, unresolved, reverseDirection: rules.reverseDirection === true },
      allow: allow as TesseraConfig["allow"],
    },
  };
}

export const STARTER_CONFIG = `{
  "$schema": "https://raw.githubusercontent.com/ozgurcd/tessera/main/tessera.schema.json",
  "client": {
    "tsconfig": "./tsconfig.json",
    "include": ["src/**/*.ts"],
    "fetchWrappers": []
  },
  "server": {
    "adapter": "go-gin",
    "root": "../backend",
    "readerShapes": [
      { "call": "c.Query", "nameArg": 0 },
      { "call": "c.DefaultQuery", "nameArg": 0 }
    ],
    "routeOverrides": {}
  },
  "rules": {
    "unmapped": "skip",
    "unresolved": "warn",
    "reverseDirection": false
  },
  "allow": []
}
`;
