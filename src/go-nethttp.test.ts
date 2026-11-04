import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GoNetHttpAdapter } from "./go-nethttp.js";

async function extractFrom(files: Record<string, string>, server: Record<string, unknown> = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-nethttp-"));
  try {
    for (const [name, source] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
      fs.writeFileSync(path.join(directory, name), source);
    }
    return await new GoNetHttpAdapter().extract({ adapter: "go-nethttp", root: ".", ...server }, directory);
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

test("a trailing-slash pattern and a {rest...} wildcard are subtree routes; a single wildcard and the root are not", async () => {
  const reads = await extractFrom({ "routes.go": `package api
    func routes(mux *http.ServeMux) {
      mux.HandleFunc("/files/", f)
      mux.HandleFunc("GET /rest/{path...}", g)
      mux.HandleFunc("GET /one/{id}", h)
      mux.HandleFunc("/", root)
    }` });
  const flags = Object.fromEntries(reads.map((read) => [`${read.method} ${read.route}`, read.subtree === true]));
  assert.deepEqual(flags, { "* /": false, "* /files/:param": true, "GET /one/:param": false, "GET /rest/:param": true });
});

test("a sub-mux mounted with http.StripPrefix serves its routes below the stripped prefix and the mount itself is not a subtree", async () => {
  const reads = await extractFrom({ "routes.go": `package api
    func routes(mux *http.ServeMux) {
      sub := http.NewServeMux()
      sub.HandleFunc("GET /items", a)
      sub.HandleFunc("GET /items/{id}", b)
      sub.HandleFunc("/", rootOfSub)
      mux.Handle("/api/v1/", http.StripPrefix("/api/v1", sub))
    }` });
  assert.deepEqual(summary(reads), ["* /api/v1", "GET /api/v1/items", "GET /api/v1/items/:param"]);
  assert.ok(reads.every((read) => !read.subtree));
});

test("StripPrefix mounts follow nested muxes, constructor functions, and constants; the same receiver name elsewhere is not affected", async () => {
  const reads = await extractFrom({
    "paths.go": `package api
      const v1 = "/api/v1"`,
    "routes.go": `package api
    func routes(mux *http.ServeMux) {
      mux.Handle(v1+"/", http.StripPrefix(v1, items()))
      inner := http.NewServeMux()
      inner.HandleFunc("GET /leaf", leaf)
      mid := http.NewServeMux()
      mid.Handle("/deep/", http.StripPrefix("/deep", inner))
      mux.Handle("/mid/", http.StripPrefix("/mid", mid))
    }
    func items() *http.ServeMux {
      m := http.NewServeMux()
      m.HandleFunc("GET /things", a)
      return m
    }
    func other(m *http.ServeMux) {
      m.HandleFunc("GET /unmounted", a)
    }` });
  assert.deepEqual(summary(reads), ["GET /api/v1/things", "GET /mid/deep/leaf", "GET /unmounted"]);
});

test("a StripPrefix over a non-mux handler keeps its subtree route, and an unresolvable prefix is reported", async () => {
  const reads = await extractFrom({ "routes.go": `package api
    func routes(mux *http.ServeMux) {
      mux.Handle("/static/", http.StripPrefix("/static/", http.FileServer(http.Dir("."))))
      mux.Handle("/dyn/", http.StripPrefix(prefixFor(), subMux))
      subMux := http.NewServeMux()
      subMux.HandleFunc("GET /x", a)
    }` });
  assert.ok(reads.some((read) => read.route === "/static/:param" && read.subtree === true), JSON.stringify(summary(reads)));
  const unresolved = reads.flatMap((read) => read.unresolvedDetails ?? []).map((detail) => detail.message);
  assert.ok(unresolved.some((message) => message.includes("StripPrefix")), unresolved.join("\n"));
  assert.ok(!summary(reads).includes("GET /x"), "a sub-mux with an unresolvable mount prefix must not be registered at the wrong route");
});

test("StripPrefix nesting beyond maxMountDepth is reported unresolved, not registered at a wrong route", async () => {
  const source = `package api
    func routes(mux *http.ServeMux) {
      c := http.NewServeMux()
      c.HandleFunc("GET /leaf", leaf)
      b := http.NewServeMux()
      b.Handle("/c/", http.StripPrefix("/c", c))
      a := http.NewServeMux()
      a.Handle("/b/", http.StripPrefix("/b", b))
      mux.Handle("/a/", http.StripPrefix("/a", a))
    }`;
  assert.deepEqual(summary(await extractFrom({ "routes.go": source })), ["GET /a/b/c/leaf"]);
  assert.deepEqual(summary(await extractFrom({ "routes.go": source }, { maxMountDepth: 3 })), ["GET /a/b/c/leaf"]);
  const shallow = await extractFrom({ "routes.go": source }, { maxMountDepth: 2 });
  assert.ok(!summary(shallow).includes("GET /a/b/c/leaf"));
  assert.ok(shallow.flatMap((read) => read.unresolvedDetails ?? []).some((detail) => detail.message.includes("maxMountDepth")));
});

test("a StripPrefix mount cycle terminates and is reported", async () => {
  const reads = await extractFrom({ "routes.go": `package api
    func routes() {
      a := http.NewServeMux()
      b := http.NewServeMux()
      a.Handle("/b/", http.StripPrefix("/b", b))
      b.Handle("/a/", http.StripPrefix("/a", a))
      a.HandleFunc("GET /x", x)
    }` });
  assert.ok(reads.flatMap((read) => read.unresolvedDetails ?? []).some((detail) => detail.message.includes("maxMountDepth")), JSON.stringify(summary(reads)));
});

test("a package-level sub-mux registered in another function is found by receiver name; an unrelated receiver of another package is not", async () => {
  const reads = await extractFrom({
    "api/routes.go": `package api
      var apiMux = http.NewServeMux()
      func init() { apiMux.HandleFunc("GET /ping", ping) }
      func mount(mux *http.ServeMux) { mux.Handle("/api/", http.StripPrefix("/api", apiMux)) }`,
    "other/routes.go": `package other
      func init() { apiMux.HandleFunc("GET /elsewhere", e) }`,
  });
  assert.deepEqual(summary(reads), ["GET /api/ping", "GET /elsewhere"]);
});

const EXAMPLE = `package main
  func main() {
    mux := http.NewServeMux()
    mux.Handle("/api/", mw.Handler(http.HandlerFunc(apiHandler)))
  }`;
const REAL = `package main
  func routes(mux *http.ServeMux) { mux.HandleFunc("GET /api/v1/real", real) }`;
const ONE_ROUTE = (route: string) => `package main\nfunc r(m *http.ServeMux) { m.HandleFunc("GET ${route}", h) }`;

test("example, tool and testdata mains under the root are not scanned by default, so their catch-all cannot hide unmapped routes", async () => {
  const reads = await extractFrom({
    "cmd/idp/main.go": REAL,
    "tools/license-gen/examples/with-monitoring/main.go": EXAMPLE,
    "internal/examples/demo.go": EXAMPLE,
    "testdata/t.go": EXAMPLE,
  });
  assert.deepEqual(summary(reads), ["GET /api/v1/real"]);
});

test("server.exclude replaces the default list: a bare name matches at any depth, a slashed path is relative to the root, a longer name does not match", async () => {
  const files = { "cmd/idp/main.go": REAL, "tools/a.go": EXAMPLE, "cmd/legacy/main.go": ONE_ROUTE("/legacy"), "mytools/b.go": ONE_ROUTE("/mytools") };
  assert.deepEqual(summary(await extractFrom(files, { exclude: [] })), ["* /api/:param", "GET /api/v1/real", "GET /legacy", "GET /mytools"]);
  assert.deepEqual(summary(await extractFrom(files, { exclude: ["cmd/legacy"] })), ["* /api/:param", "GET /api/v1/real", "GET /mytools"]);
  assert.deepEqual(summary(await extractFrom(files, { exclude: ["tools", "legacy"] })), ["GET /api/v1/real", "GET /mytools"]);
});

test("a subtree whose handler wraps a dispatching mux is a mount, not a catch-all route", async () => {
  const reads = await extractFrom({ "routes.go": `package api
    func routes(mux *http.ServeMux) {
      orgLink := http.NewServeMux()
      orgLink.HandleFunc("GET /api/v1/org-link/detail", d)
      mux.Handle("/api/v1/org-link/", RequireOperator(audit)(orgLink))
      inner := http.NewServeMux()
      inner.HandleFunc("GET /admin/license", l)
      outer := http.NewServeMux()
      outer.Handle("/admin/", RequireOperator(inner))
    }` });
  assert.deepEqual(summary(reads), ["GET /admin/license", "GET /api/v1/org-link/detail"]);
  assert.ok(reads.every((read) => !read.subtree));
});

test("a subtree over a wrapped plain handler, or over a mux with no registrations in scope, stays a catch-all route", async () => {
  const reads = await extractFrom({ "routes.go": `package api
    func routes(mux *http.ServeMux) {
      mux.Handle("/a/", RequireOperator(audit)(handler))
      mux.Handle("/b/", RequireOperator(audit)(elsewhereMux))
      mux.Handle("/c/", wrap(mux2))
      other := http.NewServeMux()
      other.HandleFunc("GET /unrelated", u)
    }` });
  assert.deepEqual(reads.filter((read) => read.subtree).map((read) => read.route), ["/a/:param", "/b/:param", "/c/:param"]);
});
