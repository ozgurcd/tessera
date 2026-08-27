# Changelog

## Unreleased

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
