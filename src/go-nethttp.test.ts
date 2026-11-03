import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GoNetHttpAdapter } from "./go-nethttp.js";

async function extractFrom(files: Record<string, string>) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-nethttp-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      fs.writeFileSync(path.join(directory, name), source);
    }
    return await new GoNetHttpAdapter().extract({ adapter: "go-nethttp", root: "." }, directory);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

const summary = (reads: Awaited<ReturnType<typeof extractFrom>>) => reads.map((read) => `${read.method} ${read.route}`);

test("literal, method-pattern, and wildcard registrations are extracted for HandleFunc and Handle", async () => {
  const reads = await extractFrom({ "routes.go": `package api
    func routes(mux *http.ServeMux, srv *server) {
      mux.HandleFunc("/api/a", a)
      mux.HandleFunc("GET /api/b/{id}", b)
      mux.Handle("POST /api/c/{rest...}", c)
      http.HandleFunc("PUT /api/d/{$}", d)
      srv.mux.HandleFunc("DELETE example.com/api/e", e)
    }` });
  assert.deepEqual(summary(reads), ["* /api/a", "DELETE /api/e", "GET /api/b/:param", "POST /api/c/:param", "PUT /api/d"]);
  assert.ok(reads.every((read) => read.fieldsUnmodeled === true && read.query.length === 0 && read.body.length === 0));
  assert.deepEqual(reads.find((read) => read.route === "/api/a")?.site, { file: "routes.go", line: 3 });
});

test("a trailing-slash subtree pattern maps to one parameter segment and the root pattern stays root", async () => {
  const reads = await extractFrom({ "routes.go": `package api
    func routes(mux *http.ServeMux) {
      mux.HandleFunc("/api/files/", f)
      mux.HandleFunc("/", root)
    }` });
  assert.deepEqual(summary(reads), ["* /", "* /api/files/:param"]);
});

test("string constants resolve across files, blocks, and concatenation; ambiguous or computed patterns are unresolved", async () => {
  const reads = await extractFrom({
    "paths.go": `package api
      const base = "/api/v1"
      const (
        itemsPath = base + "/items"
        itemPath  = itemsPath + "/{id}"
        dup       = "/one"
      )`,
    "other.go": `package other
      const dup = "/two"`,
    "routes.go": `package api
    func routes(mux *http.ServeMux) {
      mux.HandleFunc("GET "+itemsPath, a)
      mux.HandleFunc("DELETE "+itemPath, b)
      mux.HandleFunc(dup, c)
      mux.HandleFunc(computed(), d)
      mux.Handle("GET", "/not-a-mux-route", e)
      mux.Handle("/ok", handlerValue)
    }` });
  assert.deepEqual(summary(reads).filter((line) => !line.includes("<unresolved>")), ["* /ok", "DELETE /api/v1/items/:param", "GET /api/v1/items"]);
  const unresolved = reads.flatMap((read) => read.unresolvedDetails ?? []).map((detail) => `${detail.site.file}:${detail.site.line} ${detail.message}`);
  assert.equal(unresolved.length, 2, unresolved.join("\n"));
  assert.ok(unresolved.some((line) => line.includes("routes.go:5") && line.includes("'dup'")), unresolved.join("\n"));
  assert.ok(unresolved.some((line) => line.includes("routes.go:6") && line.includes("route pattern cannot be resolved")), unresolved.join("\n"));
});

test("duplicate registrations keep one endpoint with every site; test files and vendor are skipped", async () => {
  const reads = await extractFrom({
    "a.go": `package api
      func a(mux *http.ServeMux) { mux.HandleFunc("GET /x", h) }`,
    "b.go": `package api
      func b(mux *http.ServeMux) { mux.HandleFunc("GET /x", h) }`,
    "c_test.go": `package api
      func c(mux *http.ServeMux) { mux.HandleFunc("GET /only-in-test", h) }`,
    "vendor/v.go": `package v
      func v(mux *http.ServeMux) { mux.HandleFunc("GET /vendored", h) }`,
  });
  assert.deepEqual(summary(reads), ["GET /x"]);
  assert.deepEqual(reads[0]?.sites, [{ file: "a.go", line: 2 }, { file: "b.go", line: 2 }]);
});

test("a tree without routes yields none, and a missing root is a ConfigError", async () => {
  assert.deepEqual(await extractFrom({ "readme.txt": "none" }), []);
  await assert.rejects(new GoNetHttpAdapter().extract({ adapter: "go-nethttp", root: "./does-not-exist" }, os.tmpdir()), /server root not found/);
});
