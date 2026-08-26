import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { GoGinAdapter } from "./go-gin.js";

test("Gin adapter resolves nested groups, ShouldBindWith, and warns about unknown readers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-gin-"));
  try {
    fs.writeFileSync(path.join(directory, "routes.go"), `package api
      type request struct { Name string \`json:"name"\`; Skip string \`json:"-"\` }
      func routes(r *gin.Engine) {
        api := r.Group("/api")
        v1 := api.Group("/v1")
        v1.POST("/items/:id", create)
      }
      func create(ctx *gin.Context) {
        var req request
        _ = ctx.ShouldBindWith(&req, binding.JSON)
        _ = ctx.Query("filter")
        _ = customReader(ctx, "cursor")
      }
    `);
    const reads = await new GoGinAdapter().extract({ adapter: "go-gin", root: ".", readerShapes: [{ call: "c.Query", nameArg: 0 }] }, directory);
    assert.equal(reads.length, 1);
    assert.equal(reads[0]?.method, "POST");
    assert.equal(reads[0]?.route, "/api/v1/items/:param");
    assert.deepEqual(reads[0]?.body, ["name"]);
    assert.deepEqual(reads[0]?.query, ["filter"]);
    assert.ok(reads[0]?.unresolved.some((reason) => reason.includes("possible unconfigured query reader 'customReader'")));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("route overrides extract otherwise unregistered handlers", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-override-"));
  try {
    fs.writeFileSync(path.join(directory, "audit.go"), `package api
      func audit(c *gin.Context) { _ = c.Query("cursor") }
    `);
    const reads = await new GoGinAdapter().extract({ adapter: "go-gin", root: ".", routeOverrides: { "GET /audit/events": "audit.go" } }, directory);
    assert.deepEqual(reads.map((read) => ({ method: read.method, route: read.route, query: read.query })), [{ method: "GET", route: "/audit/events", query: ["cursor"] }]);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("duplicate Gin routes retain every possible handler site and intersect reads", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "tessera-duplicate-route-"));
  try {
    fs.writeFileSync(path.join(directory, "routes.go"), `package api
      func routes(r *gin.Engine) {
        r.GET("/items", first)
        r.GET("/items", second)
      }
      func first(c *gin.Context) { _ = c.Query("first_only") }
      func second(c *gin.Context) { _ = c.Query("second_only") }
    `);
    const reads = await new GoGinAdapter().extract({ adapter: "go-gin", root: "." }, directory);
    assert.equal(reads.length, 1);
    assert.deepEqual(reads[0]?.query, []);
    assert.equal(reads[0]?.sites?.length, 2);
    assert.ok(reads[0]?.unresolved.some((reason) => reason.includes("duplicate route registration")));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
