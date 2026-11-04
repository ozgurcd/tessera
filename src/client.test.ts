import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { extractClient } from "./client.js";

function project(source: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-client-"));
  fs.writeFileSync(path.join(directory, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2022", lib: ["ES2022", "DOM"], strict: true, noEmit: true }, include: ["src/**/*.ts"] }));
  fs.mkdirSync(path.join(directory, "src"));
  fs.writeFileSync(path.join(directory, "src/client.ts"), source);
  return directory;
}

test("fetch aliases and configured wrappers resolve while shadowed fetch is ignored", () => {
  const directory = project(`
    function apiFetch(url: string, options?: RequestInit) { return fetch(url, options); }
    const request = fetch;
    void request("/alias?name=value");
    void apiFetch("/wrapped?mode=full");
    function shadow(fetch: (url: string) => void) { fetch("/shadow?bad=true"); }
  `);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"], fetchWrappers: ["apiFetch"] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/alias", "/wrapped"]);
    assert.deepEqual(sends.map((send) => send.query), [["name"], ["mode"]]);
    assert.equal(sends.flatMap((send) => send.unresolved).length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("interpolated query values are not mistaken for computed field names", () => {
  const directory = project(`
    const value = "hello";
    void fetch(\`/search?query=\${encodeURIComponent(value)}&limit=20\`);
  `);
  try {
    const [send] = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.deepEqual(send?.query, ["limit", "query"]);
    assert.deepEqual(send?.unresolved, []);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Object.assign and non-literal methods are fail-closed", () => {
  const directory = project(`
    const method = Math.random() ? "POST" : "PUT";
    const body = { name: "example" };
    Object.assign(body, { admin_email: "admin@example.test" });
    void fetch("/organizations", { method, body: JSON.stringify(body) });
  `);
  try {
    const [send] = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.deepEqual(send?.body, ["admin_email", "name"]);
    assert.ok(send?.unresolved.some((reason) => reason.includes("HTTP method is computed")));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("const object members resolve for plain and as-const literals, nested members, and imports", () => {
  const directory = project(`
    import { REMOTE } from "./paths";
    const LOCAL = { search: "/search", deep: { leaf: "/deep/leaf" } };
    const ALIAS = LOCAL.search;
    void fetch(LOCAL.search + "?limit=1");
    void fetch(\`\${LOCAL.deep.leaf}?page=2\`);
    void fetch(REMOTE.list);
    void fetch(ALIAS);
    void fetch(LOCAL["search"]);
  `);
  fs.writeFileSync(path.join(directory, "src/paths.ts"), `export const REMOTE = { list: "/remote/list" } as const;`);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/search", "/deep/leaf", "/remote/list", "/search", "/search"]);
    assert.deepEqual(sends.map((send) => send.query), [["limit"], ["page"], [], [], []]);
    assert.equal(sends.flatMap((send) => send.unresolved).length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("object members stay unresolved when the object is mutable, reassigned, or not a literal", () => {
  const directory = project(`
    let letObject = { path: "/let" };
    const reassigned = { path: "/before" };
    reassigned.path = "/after";
    const spread = { ...{ path: "/spread" } };
    declare const opaque: { path: string };
    const fromCall = (() => ({ path: "/call" }))();
    const methodHolder = { path() { return "/method"; } };
    void fetch(letObject.path);
    void fetch(reassigned.path);
    void fetch(opaque.path);
    void fetch(fromCall.path);
    void fetch(methodHolder.path);
    void fetch(spread.path);
  `);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.equal(sends.length, 6);
    assert.ok(sends.every((send) => send.route === "<unresolved>" && send.unresolved.some((reason) => reason.includes("computed value"))), JSON.stringify(sends));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("routePrefixStrip removes a prefix only on a segment boundary and leaves other routes alone", () => {
  const directory = project(`
    declare const id: string;
    const IDP = { login: "/api/idp/api/v1/login" };
    void fetch(IDP.login);
    void fetch(\`/api/idp/api/v1/items/\${id}?q=1\`);
    void fetch("/api/idp");
    void fetch("/api/idpx/api/v1/other");
    void fetch("/api/v1/plain");
  `);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"], routePrefixStrip: ["/api/idp"] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/api/v1/login", "/api/v1/items/:param", "/", "/api/idpx/api/v1/other", "/api/v1/plain"]);
    const longest = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"], routePrefixStrip: ["/api", "/api/idp"] }, directory);
    assert.equal(longest[0]?.route, "/api/v1/login");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("an absolute client.include pattern matches files by absolute path", () => {
  const directory = project(`void fetch("/abs");`);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: [`${directory}/src/**/*.ts`] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/abs"]);
    assert.equal(sends[0]?.site.file, "src/client.ts");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("an include set that matches nothing names the patterns instead of failing silently", () => {
  const directory = project(`void fetch("/abs");`);
  try {
    assert.throws(() => extractClient({ tsconfig: "./tsconfig.json", include: ["/nowhere/src/**/*.ts"] }, directory), /client\.include matched no TypeScript source files.*\/nowhere\/src/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("mutating one const object member does not poison an unmutated sibling object", () => {
  const directory = project(`
    const stable = { path: "/stable" };
    const mutated = { path: "/before" };
    mutated.path = "/after";
    void fetch(stable.path);
    void fetch(mutated.path);
  `);
  try {
    const sends = extractClient({ tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] }, directory);
    assert.deepEqual(sends.map((send) => send.route), ["/stable", "<unresolved>"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

const CLIENT = { tsconfig: "./tsconfig.json", include: ["src/**/*.ts"] };

test("a fetch wrapper entry names the route argument and defaults the options argument to the next one", () => {
  const directory = project(`
    declare const BASE: string;
    function agFetch(base: string, route: string, init?: RequestInit) { return fetch(base + route, init); }
    function pathFirst(route: string, init?: RequestInit) { return fetch(route, init); }
    void agFetch(BASE, "/things?limit=1");
    void agFetch(BASE, "/things", { method: "POST", body: JSON.stringify({ name: "x" }) });
    void pathFirst("/plain?mode=1");
  `);
  try {
    const sends = extractClient({ ...CLIENT, fetchWrappers: [{ name: "agFetch", routeArg: 1 }, "pathFirst"] }, directory);
    assert.deepEqual(sends.map((send) => [send.method, send.route, send.query, send.body]), [["GET", "/things", ["limit"], []], ["POST", "/things", [], ["name"]], ["GET", "/plain", ["mode"], []]]);
    assert.equal(sends.flatMap((send) => send.unresolved).length, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("an explicit optionsArg is honoured and a call too short for routeArg is unresolved, not a crash", () => {
  const directory = project(`
    function wide(a: string, route: string, extra: number, init?: RequestInit) { return fetch(a + route + extra, init); }
    void wide("x", "/wide", 1, { method: "DELETE" });
    void wide("x");
  `);
  try {
    const sends = extractClient({ ...CLIENT, fetchWrappers: [{ name: "wide", routeArg: 1, optionsArg: 3 }] }, directory);
    assert.equal(sends.length, 2);
    assert.deepEqual([sends[0]?.method, sends[0]?.route], ["DELETE", "/wide"]);
    assert.equal(sends[1]?.route, "<unresolved>");
    assert.ok(sends[1]?.unresolved.includes("missing URL argument"));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("a const object mutated by Object.assign, a callee, or a nested Object.assign is computed; read-only uses keep it resolved", () => {
  const directory = project(`
    const A = { path: "/a-old" };
    Object.assign(A, { path: "/a-new" });
    const B = { path: "/b-old" };
    function patch(o: { path: string }) { o.path = "/b-new"; }
    patch(B);
    const C = { inner: { path: "/c-old" }, top: "/c-top" };
    Object.assign(C.inner, { path: "/c-new" });
    const SAFE = { path: "/safe" };
    void Object.keys(SAFE);
    void JSON.stringify(SAFE);
    Object.freeze(SAFE);
    const ALIAS = A;
    void fetch(A.path); void fetch(B.path); void fetch(C.inner.path); void fetch(C.top); void fetch(SAFE.path); void fetch(ALIAS.path);
  `);
  try {
    const sends = extractClient(CLIENT, directory);
    assert.deepEqual(sends.map((send) => send.route), ["<unresolved>", "<unresolved>", "<unresolved>", "/c-top", "/safe", "<unresolved>"]);
    assert.ok(sends.filter((send) => send.route === "<unresolved>").every((send) => send.unresolved.some((reason) => reason.includes("computed value"))));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("an object mutated in another file that declares it or uses it is computed", () => {
  const directory = project(`
    import { TABLE } from "./table";
    void fetch(TABLE.list);
  `);
  fs.writeFileSync(path.join(directory, "src/table.ts"), `export const TABLE = { list: "/before" };\nObject.assign(TABLE, { list: "/after" });\n`);
  try {
    assert.deepEqual(extractClient(CLIENT, directory).map((send) => send.route), ["<unresolved>"]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("an absolute include matches through a symlinked path in either direction", () => {
  const directory = project(`void fetch("/linked");`);
  const link = `${directory}-link`;
  fs.symlinkSync(directory, link);
  try {
    // files are named under the config directory; the pattern uses the other spelling of the same directory
    assert.deepEqual(extractClient({ tsconfig: "./tsconfig.json", include: [`${link}/src/**/*.ts`] }, directory).map((send) => send.route), ["/linked"]);
    assert.deepEqual(extractClient({ tsconfig: "./tsconfig.json", include: [`${directory}/src/**/*.ts`] }, link).map((send) => send.route), ["/linked"]);
    assert.throws(() => extractClient({ tsconfig: "./tsconfig.json", include: [`${link}/nowhere/**/*.ts`] }, directory), /client\.include matched no TypeScript source files/);
  } finally { fs.rmSync(link, { force: true }); fs.rmSync(directory, { recursive: true, force: true }); }
});

test("a const object passed to a new expression is treated as mutable, like a call argument", () => {
  const directory = project(`
    const A = { path: "/a-old" };
    class Mut { constructor(o: { path: string }) { o.path = "/a-new"; } }
    new Mut(A);
    const B = { path: "/b-safe" };
    void new Date(B.path.length);
    void fetch(A.path); void fetch(B.path);
  `);
  try {
    const sends = extractClient(CLIENT, directory);
    assert.deepEqual(sends.map((send) => send.route), ["<unresolved>", "/b-safe"]);
    assert.ok(sends[0]!.unresolved.some((reason) => reason.includes("computed value")));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
