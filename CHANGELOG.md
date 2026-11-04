# Changelog

## 0.1.2 — 2026-11-04

- Add `client.fetchWrappers` entries of the form `{ name, routeArg, optionsArg }` for
  wrappers whose route is not argument 0; plain names keep their meaning (TES-04).
- Add `server.nonReaders` to silence "possible unconfigured query reader" for calls that
  take the Gin context and a string but read no field; an entry may end in `*` (TES-05).
- Add `extraServers` and a per-root `prefix` so one run checks a client against several
  server roots (TES-07).
- A `const` object mutated by `Object.assign`, or passed to a call that may mutate it, now
  resolves as computed instead of to its stale initializer (TES-08).
- net/http: `/dir/` and `{rest...}` patterns are subtree routes that match at any depth;
  sub-muxes mounted with `http.StripPrefix` are registered below the stripped prefix, bounded
  by `server.maxMountDepth` (TES-09).
- An absolute `client.include` pattern now matches through symlinked directories such as
  macOS `/tmp` and `/var` (TES-10).
- A client call served only by a subtree (`/dir/`, `{rest...}`) catch-all is reported as
  `CATCH-ALL` ("matched by catch-all", `summary.catchAll`, `kind: "catch-all"`), never as
  mapped, and its fields are not checked. A subtree over a wrapper around a mux is a mount,
  not a catch-all route.
- Add `server.exclude` (default `examples`, `testdata`, `tools`) so example, tool and test
  mains under a server root stop registering routes; both Go adapters honor it.
- A `const` object passed to a `new` expression now resolves as computed, like a call argument.
- Add the `tessera version` subcommand and `tessera version --json`
  (`{"schema_version":"tessera.version.v1","version":"v<version>"}`); `-v`/`--version` unchanged.
- Expand the adversarial suite to twenty-nine fixtures.

## 0.1.1 — 2026-11-04

- Add the `go-nethttp` adapter: `HandleFunc`/`Handle` registrations with literal or
  string-constant patterns, Go 1.22 `METHOD /path` patterns and `{wildcard}`
  segments. Routes only; handler fields are not modeled, so fields sent to these
  endpoints are reported as unresolved. Method-less patterns serve every method.
- Resolve `fetch(OBJ.member)` when `OBJ` is a `const` object literal (plain or
  `as const`, nested, same module or imported) and the member is never assigned.
- Add `client.routePrefixStrip` to remove a proxy mount such as `/api/idp`
  from client routes before pairing.
- Accept absolute `client.include` patterns; an empty match now names the patterns.
- Expand the adversarial suite to twenty-three fixtures.
- Correct the documented request-analysis boundary for path and response data.
- Scope allow entries to query or body fields.
- Deduplicate findings in linear time and retain all endpoint source sites.
- Pin and document the native TypeScript 7 API posture and sibling-runner mode.
- Correct Go–Gin duplicate-route aggregation, middleware handler selection,
  bind-shape reporting, router-group scoping, nested struct tags, and group
  assignment scan complexity; expand the adversarial suite to sixteen fixtures.
- Follow same-package Gin context helpers to a bounded depth, report unresolved
  findings at their true source sites, recognize disjoint router-group scopes,
  and expand the adversarial suite to eighteen fixtures.
- Preserve locally assigned URL bases, expand finite string-literal path
  unions, and report non-finite unions as unresolved instead of fabricating a
  parameterized route; expand the adversarial suite to twenty fixtures.
- Document that the narrowed Identuum proving count matches the route ledger
  only in cardinality, not membership or coverage, and cannot justify retiring
  the existing shell parity gate.

## 0.1.0 — 2026-08-26

- Add the TypeScript 7 compiler-backed client extractor.
- Add endpoint- and method-scoped query and JSON body matching.
- Add the dependency-free `go-gin` server adapter.
- Add `init`, `check`, `list`, `explain`, and `selftest` CLI commands.
- Add versioned JSON output, allowlists, reverse matching, and stable exit codes.
- Add ten bundled adversarial contract fixtures and CI/release automation.
