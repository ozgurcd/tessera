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

function configWith(extra: Record<string, unknown>, clientExtra: Record<string, unknown> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-config-"));
  const file = path.join(directory, "tessera.config.json");
  fs.writeFileSync(file, JSON.stringify({ client: { tsconfig: "./tsconfig.json", ...clientExtra }, server: { adapter: "go-gin", root: "./server" }, ...extra }));
  return { file, directory, dispose: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test("client.fetchWrappers accepts names and { name, routeArg, optionsArg } entries and rejects malformed ones", () => {
  const good = configWith({}, { fetchWrappers: ["a", { name: "b", routeArg: 1 }, { name: "c", routeArg: 0, optionsArg: 2 }] });
  try { assert.equal(loadConfig(good.file).config.client.fetchWrappers?.length, 3); } finally { good.dispose(); }
  for (const bad of [[{ name: "b" }], [{ name: "", routeArg: 1 }], [{ name: "b", routeArg: -1 }], [{ name: "b", routeArg: 1.5 }], [{ name: "b", routeArg: 1, optionsArg: -1 }], [{ name: "b", routeArg: 1, extra: true }], [1], [""]]) {
    const config = configWith({}, { fetchWrappers: bad });
    try { assert.throws(() => loadConfig(config.file), /client\.fetchWrappers/, JSON.stringify(bad)); } finally { config.dispose(); }
  }
});

test("server.nonReaders must be non-empty strings", () => {
  const good = configWith({ server: { adapter: "go-gin", root: "./server", nonReaders: ["mw.Respond*"] } });
  try { assert.deepEqual(loadConfig(good.file).config.server.nonReaders, ["mw.Respond*"]); } finally { good.dispose(); }
  for (const bad of ["mw.X", [""], [1]]) {
    const config = configWith({ server: { adapter: "go-gin", root: "./server", nonReaders: bad } });
    try { assert.throws(() => loadConfig(config.file), /server\.nonReaders/, JSON.stringify(bad)); } finally { config.dispose(); }
  }
});

test("extraServers are validated like server, and prefix and maxMountDepth have rules", () => {
  const good = configWith({ server: { adapter: "go-nethttp", root: "./a", prefix: "/gw" }, extraServers: [{ adapter: "go-nethttp", root: "./b", prefix: "/ag", maxMountDepth: 3 }, { adapter: "go-gin", root: "./c" }] });
  try {
    const loaded = loadConfig(good.file).config;
    assert.equal(loaded.extraServers?.length, 2);
    assert.equal(loaded.server.prefix, "/gw");
  } finally { good.dispose(); }
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ extraServers: {} }, /extraServers must be an array/],
    [{ extraServers: [{ adapter: "go-nethttp" }] }, /extraServers\[0\]/],
    [{ extraServers: [{ adapter: "express", root: "./b" }] }, /unknown server adapter/],
    [{ extraServers: [{ adapter: "go-nethttp", root: "./b", prefix: "ag" }] }, /prefix/],
    [{ extraServers: [{ adapter: "go-nethttp", root: "./b", prefix: "/ag/" }] }, /prefix/],
    [{ extraServers: [{ adapter: "go-nethttp", root: "./b", maxMountDepth: 0 }] }, /maxMountDepth/],
    [{ extraServers: [{ adapter: "go-nethttp", root: "./b", nonReaders: [""] }] }, /nonReaders/],
    [{ server: { adapter: "go-gin", root: "./a", prefix: "/" } }, /prefix/],
  ];
  for (const [extra, pattern] of cases) {
    const config = configWith(extra);
    try { assert.throws(() => loadConfig(config.file), pattern, JSON.stringify(extra)); } finally { config.dispose(); }
  }
});
