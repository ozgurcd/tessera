import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractServers } from "./adapters.js";

function tree(files: Record<string, string>): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-servers-"));
  for (const [name, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    fs.writeFileSync(path.join(directory, name), source);
  }
  return directory;
}

const IDP = `package s
  func routes(mux *http.ServeMux) { mux.HandleFunc("GET /api/v1/things", a) }`;
const AG = `package s
  func routes(mux *http.ServeMux) { mux.HandleFunc("GET /api/v1/org-link/plan", a); mux.HandleFunc("GET /", root) }`;
const summary = (reads: Awaited<ReturnType<typeof extractServers>>) => reads.map((read) => `${read.method} ${read.route}`);

test("several server roots are merged, each with its own prefix and adapter", async () => {
  const directory = tree({ "idp/r.go": IDP, "ag/r.go": AG });
  try {
    const reads = await extractServers({ adapter: "go-nethttp", root: "./idp" }, [{ adapter: "go-nethttp", root: "./ag", prefix: "/gw/ag" }], directory);
    assert.deepEqual(summary(reads), ["GET /api/v1/things", "GET /gw/ag", "GET /gw/ag/api/v1/org-link/plan"]);
    const unprefixed = await extractServers({ adapter: "go-nethttp", root: "./idp" }, [{ adapter: "go-nethttp", root: "./ag" }], directory);
    assert.deepEqual(summary(unprefixed), ["GET /", "GET /api/v1/org-link/plan", "GET /api/v1/things"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("a prefix applies to the primary root too, never to an unresolved registration, and keeps subtree marks", async () => {
  const directory = tree({ "idp/r.go": `package s
    func routes(mux *http.ServeMux) { mux.HandleFunc("/files/", f); mux.HandleFunc(computed(), g) }` });
  try {
    const reads = await extractServers({ adapter: "go-nethttp", root: "./idp", prefix: "/gw" }, [], directory);
    assert.deepEqual(summary(reads), ["* /gw/files/:param", "* <unresolved>"]);
    assert.equal(reads.find((read) => read.route === "/gw/files/:param")?.subtree, true);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("a missing extra root fails the whole extraction instead of silently dropping it", async () => {
  const directory = tree({ "idp/r.go": IDP });
  try {
    await assert.rejects(extractServers({ adapter: "go-nethttp", root: "./idp" }, [{ adapter: "go-nethttp", root: "./missing" }], directory), /server root not found: \.\/missing/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
