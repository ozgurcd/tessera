# tessera

Tessera statically checks that a hand-written TypeScript HTTP client and its
server agree about the request wire. It finds fields the client sends in a
query string or JSON body that the matching server handler never reads. Paths
identify endpoints; path parameters are not compared as fields.

The comparison is always scoped to one HTTP method and normalized route. A
field read by `GET /items` cannot hide a defect in `POST /items`, and a field
read by one endpoint cannot hide a defect in another.

```text
UNMATCHED  POST /api/v1/organizations  body field 'admin_email' is sent by src/api.ts:42 but no handler field reads it (handlers/organizations.go:18)
tessera: 1 unmatched, 0 unresolved, 0 unmapped
```

Tessera is a source analyzer, not a runtime proxy, schema generator, or
replacement for end-to-end tests.

## Requirements and installation

- Node.js 24 or newer (CI also tests the current Node.js 26 release)
- TypeScript 7.0.2 exactly
- A TypeScript project and, for v0.1.0, a Go server using Gin-style routes

The package is named `@identuum/tessera`; TypeScript is an explicit peer
dependency because its compiler API powers the analysis.

### In-repository mode (the quickstart)

This mode assumes the target repository already uses TypeScript 7.0.2. Install
and initialize Tessera at that repository's root:

```sh
npm install --save-dev @identuum/tessera typescript@7.0.2
npx tessera init
```

Until a registry package is available, the tagged GitHub release can be
installed directly:

```sh
npm install --save-dev github:ozgurcd/tessera#v0.1.0 typescript@7.0.2
```

`tessera init` detects `tsconfig.json`,
`tsconfig.app.json`, or `tsconfig.build.json` and writes a starter
`tessera.config.json`. It will not overwrite an existing file.

```sh
npx tessera init
npx tessera check
```

Edit the generated server root and client include patterns before the first
check.

### Sibling-directory mode

Use a sibling runner when the target repository is still on TypeScript 5 or 6,
or any compiler version other than 7.0.2. This keeps Tessera's TypeScript 7
peer isolated and does not change the target repository's dependencies.

Given sibling directories named `identuum-ui`, `backend`, and
`tessera-runner`:

```sh
mkdir ../tessera-runner
cd ../tessera-runner
npm init --yes
npm install --save-dev github:ozgurcd/tessera#v0.1.0 typescript@7.0.2
npx tessera init
```

Then set `client.tsconfig` to `../identuum-ui/tsconfig.json`, client includes
to paths such as `../identuum-ui/src/**/*.ts`, and `server.root` to
`../backend`. All configuration paths are resolved relative to the Tessera
configuration file.

## Configuration

A complete configuration looks like this:

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/ozgurcd/tessera/main/tessera.schema.json",
  "client": {
    "tsconfig": "./tsconfig.json",
    "include": ["src/lib/**/*.ts"],
    "fetchWrappers": ["apiFetch", "authedFetch"]
  },
  "server": {
    "adapter": "go-gin",
    "root": "../backend",
    "readerShapes": [
      { "call": "c.Query", "nameArg": 0 },
      { "call": "c.DefaultQuery", "nameArg": 0 },
      { "call": "parsePositiveQuery", "nameArg": 1 }
    ],
    "routeOverrides": {
      "GET /api/v1/audit/events": "internal/handlers/audit_events.go"
    }
  },
  "rules": {
    "unmapped": "skip",
    "unresolved": "warn",
    "reverseDirection": false
  },
  "allow": [
    {
      "method": "POST",
      "route": "/api/v1/legacy",
      "location": "body",
      "field": "trace_id",
      "reason": "consumed by the proxy before the handler"
    }
  ]
}
```

Every allow entry requires a query/body location and a reason, preventing an
exception for one part of a request from silently allowing the same field name
in another. Relative paths are resolved from the configuration file. JSON with
line and block comments is accepted.

## Commands

```text
tessera init                 write a starter config and detect tsconfig
tessera check                compare all mapped endpoints (the CI command)
tessera list                 print both extracted halves
tessera explain <route>      show sent and read fields side by side
tessera selftest             run the sixteen bundled known-good/known-bad fixtures
```

All commands accept `--config <path>`, `--json`, and `--quiet`. JSON responses
contain `schemaVersion: 1` so automation can reject incompatible future output.

The exit codes are stable API:

| Code | Meaning |
| ---: | --- |
| 0 | Clean, or only warning-level unresolved/unmapped sites |
| 1 | Unmatched fields, or an unmapped endpoint configured as an error |
| 2 | Configuration or command usage error |
| 3 | Unresolved sites with `rules.unresolved` set to `"error"` |

If unmatched and unresolved-error findings coexist, code 1 takes precedence.

## What is analyzed

The client extractor creates a TypeScript project from the configured
`tsconfig`, uses the TypeScript 7 compiler snapshot and type checker, and
resolves real symbols rather than matching identifier text. It supports:

- global `fetch`, aliases of it, and configured wrapper names;
- static, absolute, and interpolated URLs, with path expressions normalized to
  `:param`;
- literal query strings and `URLSearchParams.set`/`append`, including aliases
  and values passed into local helpers;
- default `GET` and literal option methods;
- JSON object literals, identifiers assembled across statements, conditional
  property assignments, literal bracket assignments, `Object.assign`, and
  typed spreads.

Computed methods, routes, bodies, and field names produce `UNRESOLVED`. They
never silently become an empty send set.

The `go-gin` adapter parses Go tokens in-process and has no runtime dependency
on a Go toolchain or third-party parser. It discovers Gin route registrations,
nested group variables, handler functions, anonymous or named bind structs,
`ShouldBindJSON`, `BindJSON`, `ShouldBindWith`, `ShouldBindQuery`, and
`BindQuery`. Body binds read top-level JSON tags; query binds read top-level
form tags. Generic `ShouldBind`, URI binding, and unknown bind shapes are
reported as unresolved instead of becoming silent empty read sets. Query readers are
configuration-first so project helpers are visible; a helper taking
`*gin.Context` and a string literal but missing from `readerShapes` is reported
as unresolved.

For duplicate method/route registrations, the adapter unions the fields read
by all possible handlers and emits an unresolved note. This favors usable
output for mutually exclusive setup branches while preserving the warning that
branch-specific parity cannot be proven.

This choice keeps the npm package portable. The adapter is isolated behind the
exported `ServerAdapter` interface so another server implementation does not
need to imitate Go or Gin.

## CI adoption

First run the bundled adversarial suite, then inspect what the analyzer sees:

```sh
npx tessera selftest
npx tessera list
npx tessera check
```

A green first run on an application is not enough evidence by itself. The
self-test includes divergent pagination, configured helper indirection,
literal query strings, interpolated routes, conditional bodies, typed spreads,
computed fields, unmapped routes, endpoint scoping, and method discrimination.
The suite also covers duplicate Gin registrations, middleware chains, bind
variants, group shadowing, nested struct tags, and large group scans. Every
fixture asserts both output and process exit code.

`rules.unresolved` defaults to `"warn"` for an inspectable first adoption.
Change it to `"error"` before making Tessera a required merge gate. Unmapped
endpoints are always printed by route; set `rules.unmapped` to `"error"` when
every intended endpoint is represented.

Reverse checking is off by default because servers commonly support multiple
clients. Enable `reverseDirection` only when the configured TypeScript client
is expected to exercise every server field.

## Blind spots

Tessera deliberately does not claim coverage for:

- headers and cookies;
- path parameter names and values as fields; normalized route shapes are used
  only to pair client calls with server handlers;
- response status codes and response payload shapes; v0.1 analyzes requests
  only;
- dynamically computed field names on either side;
- non-JSON bodies such as `FormData`, streams, and binary data;
- clients outside `client.include`, including curl and other services;
- endpoints absent from the extracted route map (they are printed and skipped
  unless configured as errors);
- binding and query-reader shapes outside the adapter's known/configured set;
- the server-to-client direction unless explicitly enabled;
- runtime behavior. Tessera reads source, never traffic, so a bound field that
  the handler later ignores is invisible.

When evaluating one of these boundaries, record what was measured rather than
quietly broadening the tool's claim.

## Library API

```ts
import { checkConfig, extract, GoGinAdapter, match } from "@identuum/tessera";

const result = await checkConfig("tessera.config.json");
process.exitCode = result.exitCode;
```

The public package exports `SendSet`, `ReadSet`, `ServerAdapter`, configuration
and finding types, the client extractor, Gin adapter, matcher, `extract`,
`check`, and `checkConfig`.

## Development

```sh
npm ci
npm test
npm run check
npm pack --dry-run
```

The project intentionally uses only TypeScript at runtime. As of 26 August
2026, development is pinned to the current stable TypeScript 7.0.2 and Node
type definitions 26.3.0. CI and release actions are also pinned to their
current stable releases.

TypeScript is pinned exactly because Tessera imports APIs that TypeScript marks
`unstable`; update the peer pin, development pin, and lockfile together only
after the full suite passes. Do not add `@typescript/typescript6`: it provides
the legacy `ts.createProgram` compatibility surface, while Tessera uses the new
native `typescript/unstable/sync` and `typescript/unstable/ast` APIs.

## License

MIT
