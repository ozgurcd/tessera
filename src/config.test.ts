import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigError, loadConfig } from "./config.js";

test("JSONC configuration loads and rules receive safe defaults", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-config-"));
  const file = path.join(directory, "tessera.config.json");
  try {
    fs.writeFileSync(file, `{
      // Project configuration
      "client": { "tsconfig": "./tsconfig.json" },
      "server": { "adapter": "go-gin", "root": "./server" }
    }`);
    const loaded = loadConfig(file);
    assert.deepEqual(loaded.config.rules, { unmapped: "skip", unresolved: "warn", reverseDirection: false });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("allow entries without reasons are configuration errors", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-config-"));
  const file = path.join(directory, "tessera.config.json");
  try {
    fs.writeFileSync(file, JSON.stringify({
      client: { tsconfig: "./tsconfig.json" },
      server: { adapter: "go-gin", root: "./server" },
      allow: [{ method: "POST", route: "/legacy", field: "trace_id" }],
    }));
    assert.throws(() => loadConfig(file), ConfigError);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("allow entries require an explicit query or body location", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-config-"));
  const file = path.join(directory, "tessera.config.json");
  try {
    fs.writeFileSync(file, JSON.stringify({
      client: { tsconfig: "./tsconfig.json" },
      server: { adapter: "go-gin", root: "./server" },
      allow: [{ method: "POST", route: "/legacy", field: "trace_id", reason: "proxy" }],
    }));
    assert.throws(() => loadConfig(file), /location/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("go-nethttp is a known adapter and unknown adapters list the known ones", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-config-"));
  const file = path.join(directory, "tessera.config.json");
  try {
    fs.writeFileSync(file, JSON.stringify({ client: { tsconfig: "./tsconfig.json" }, server: { adapter: "go-nethttp", root: "./server" } }));
    assert.equal(loadConfig(file).config.server.adapter, "go-nethttp");
    fs.writeFileSync(file, JSON.stringify({ client: { tsconfig: "./tsconfig.json" }, server: { adapter: "express", root: "./server" } }));
    assert.throws(() => loadConfig(file), /go-gin, go-nethttp/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("client.routePrefixStrip must be absolute path prefixes without a trailing slash", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-config-"));
  const file = path.join(directory, "tessera.config.json");
  const write = (routePrefixStrip: unknown) => fs.writeFileSync(file, JSON.stringify({ client: { tsconfig: "./tsconfig.json", routePrefixStrip }, server: { adapter: "go-gin", root: "./server" } }));
  try {
    write(["/api/idp"]);
    assert.deepEqual(loadConfig(file).config.client.routePrefixStrip, ["/api/idp"]);
    for (const bad of ["/api/idp", [""], ["api/idp"], ["/api/idp/"], ["/"], [1]]) {
      write(bad);
      assert.throws(() => loadConfig(file), /client\.routePrefixStrip/, JSON.stringify(bad));
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
