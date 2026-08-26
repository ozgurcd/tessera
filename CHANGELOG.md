# Changelog

## Unreleased

- Correct the documented request-analysis boundary for path and response data.
- Scope allow entries to query or body fields.
- Deduplicate findings in linear time and retain all endpoint source sites.

## 0.1.0 — 2026-08-26

- Add the TypeScript 7 compiler-backed client extractor.
- Add endpoint- and method-scoped query and JSON body matching.
- Add the dependency-free `go-gin` server adapter.
- Add `init`, `check`, `list`, `explain`, and `selftest` CLI commands.
- Add versioned JSON output, allowlists, reverse matching, and stable exit codes.
- Add ten bundled adversarial contract fixtures and CI/release automation.
