# uipathcli Source Catalog

> Catalog of the UiPath Platform CLI (`uipath`) source at
> `RGA_Oh_My_UiPath/research/uipathcli-source` (GitHub: `UiPath/uipathcli`, MIT license).
> Generated from static analysis of the Go source tree.

---

## 1. CLI Structure & Build System

| Aspect | Details |
|---|---|
| **Language** | Go (module `github.com/UiPath/uipathcli`, `go 1.26`) |
| **CLI framework** | `github.com/urfave/cli/v3` (v3.10.0) |
| **OpenAPI parsing** | `github.com/getkin/kin-openapi` (v0.140.0) |
| **YAML** | `github.com/goccy/go-yaml` |
| **Query engine** | `github.com/jmespath/go-jmespath` (client-side response filtering) |
| **Build** | `build.sh` / `build.ps1` — cross-compiles linux/windows/darwin × amd64/arm64 via `GOOS`/`GOARCH`, version injected via `-ldflags -X github.com/UiPath/uipathcli/utils.Version=...` |
| **Release** | `version.sh` (git-tag semver bump), `package.sh`, `publish.sh` |
| **Definition updates** | `update_definitions.sh` — fetches latest OpenAPI specs from cloud.uipath.com using `yq` |
| **CI** | `.github/workflows/` (GitHub Actions; `ci.yaml`) |
| **Tests** | Go `*_test.go` throughout; `test/testdata/` fixtures; Coveralls badge in README |

### Architecture (key packages)

| Package | Role |
|---|---|
| `main.go` | Entry point; wires config, authenticators, definition provider, executors, plugin commands |
| `parser/` | OpenAPI YAML → internal `Definition`/`Operation`/`Parameter` model; snake/kebab-case conversion of operation IDs |
| `definitions/` | **Embedded** (`go:embed`) OpenAPI 3.0 specs that drive the whole command tree |
| `commandline/` | Command tree construction (`command_builder.go`), flags, help, autocomplete, `config`/`cache`/`commands` handlers |
| `executor/` | `http_executor.go` (API calls), `plugin_executor.go` (custom plugin commands) |
| `auth/` | PAT, Bearer (client credentials), OAuth (browser + PKCE) authenticators |
| `config/` | Multi-profile YAML config store (`~/.uipath/config`) |
| `output/` | JSON / text output writers + JMESPath transformer |
| `plugin/` | Plugin API + built-in plugin commands (digitizer, orchestrator upload/download, studio pack/analyze/restore/publish/testrun) |
| `cache/` | File-based token cache |
| `utils/` | `api/` (typed API clients for plugins), `resiliency/` (3-attempt retry), `network/`, `stream/`, `process/`, `visualization/` (progress bars), `converter/`, `directories/` |

**Command model:** the CLI is *definition-driven*. `uipath <service> <resource> <operation> --flag value` where services/resources/operations are generated from the embedded OpenAPI specs (tags → resources, `operationId` → kebab-case operation, `x-uipathcli-name` overrides). Multiple spec files with the same prefix (e.g. `identity.yaml` + `identity.token.yaml`) merge into one service (`multi_definition.go`). External definitions can be loaded via `UIPATH_DEFINITIONS_PATH`; per-profile `serviceVersion` selects alternate definition sets.

---

## 2. Command Tree

### Top-level commands (from `command_builder.go` + `main.go`)

```
uipath
├── orchestrator ...        (generated: orchestrator.yaml, 418 operations)
├── identity ...            (generated: identity.yaml + identity.token.yaml, 34 operations)
├── du ...                  (generated: du.framework.yaml, 34 operations)
├── studio ...              (generated: studio.yaml + plugin commands)
├── config                  (interactive configuration)
│   ├── set                 (set config key/value)
│   ├── cache clear         (clear token cache)
│   └── offline             (download external deps for offline mode)
├── autocomplete
│   ├── enable              (--shell bash|powershell|zsh...)
│   └── complete            (internal suggestion engine)
├── commands  [hidden]
│   └── show                (dump full command tree as JSON — used for docs/IntelliSense)
└── --version
```

### Services & resources (tags → resources)

**orchestrator** (66 resources, 418 ops): alerts, apptasks, assets, attachments, auditlogs, buckets, businessrules, calendars, credentialstores, directoryservice, executionmedia, exports, folders, foldersnavigation, generictasks, jobs, jobtriggers, libraries, licensesnameduser, licensesruntime, licensing, logs, machines, maintenance, organizationunits, packagefeeds, permissions, personalworkspaces, processes, processschedules, queuedefinitions, queueitemcomments, queueitemevents, queueitems, queueprocessingrecords, queueretention, queues, releaseretention, releases, robotlogs, robots, roles, sessions, settings, stats, status, taskactivities, taskcatalogs, taskdefinitions, taskforms, tasknotes, taskretention, tasks, tenants, testautomation, testcasedefinitions, testcaseexecutions, testdataqueueactions, testdataqueueitems, testdataqueues, testsetexecutions, testsetschedules, testsets, translations, users, webhooks

**identity** (9 resources, 34 ops): auditquery, group, messagetemplate, robotaccount, samlcertificate, setting, user, userloginattempt (+ internal `token` op → `identity/connect/token`)

**du** — Document Understanding (5 resources, 34 ops): discovery, digitization, classification, extraction, validation

**studio** (plugin-only commands; spec has no paths): `package pack|analyze|restore|publish`, `test run`

**Plugin commands** (custom, registered in `main.go`):

| Plugin command | Implements |
|---|---|
| `du digitization digitize` | Sync wrapper over async DU digitize API (polls up to 60s, progress bar, stdin `--file -` support) |
| `orchestrator buckets download` | Download a file from a storage bucket |
| `orchestrator buckets upload` | Upload a file to a storage bucket |
| `studio package pack` | Build & package a Studio project (`.nupkg`) |
| `studio package analyze` | Static analysis / governance policy violations |
| `studio package restore` | Restore project dependencies |
| `studio package publish` | Publish package to Orchestrator |
| `studio test run` | Run test cases, parallel multi-project, JUnit output, robot-log attach |

---

## 3. Service Coverage

| Service | Spec file | Base URL | Ops | Notes |
|---|---|---|---|---|
| **Orchestrator** | `orchestrator.yaml` (UiPath.WebApi 20.0, 45k lines) | `https://cloud.uipath.com/{org}/{tenant}/orchestrator_` | 418 | Full API: folders, jobs, queues, robots, machines, assets, releases, test automation/app tasks, audit, buckets, webhooks, licensing, … |
| **Identity** | `identity.yaml` (IdentityServer External API 3.2.54), `identity.token.yaml` | `https://cloud.uipath.com/identity_` | 34 | Users, groups, robot accounts, settings, audit query, SAML certs, login attempts; `connect/token` |
| **Document Understanding** | `du.framework.yaml` (DU Cloud APIs 1.0) | `…/{org}/{tenant}/du_` (per `utils/api/du_client.go`) | 34 | Digitization, classification, extraction (incl. Generative Extractor), validation, project discovery |
| **Studio** | `studio.yaml` (paths empty) | `…/{org}/studio_/backend` | 0 API ops | CLI surface provided by plugins (pack/analyze/restore/publish/test) |

**Not directly wrapped:** AI Center, Action Center (beyond generic tasks), Insights, Data Fabric, Automation Hub — though generic task/app-task operations exist under orchestrator. Coverage is 100% derived from the OpenAPI specs, so it tracks whatever `update_definitions.sh` pulls.

---

## 4. Auth Mechanisms (`auth/`)

Authenticators are selected automatically per profile (checked in order PAT → OAuth → Bearer):

| Flow | Authenticator | Config keys | Env vars | How it works |
|---|---|---|---|---|
| **Client credentials** (default for scripts) | `bearer_authenticator.go` | `auth.clientId`, `auth.clientSecret`, `auth.grantType` (default `client_credentials`), `auth.scopes`, `auth.properties.*` | `UIPATH_CLIENT_ID`, `UIPATH_CLIENT_SECRET`, `UIPATH_AUTH_GRANT_TYPE`, `UIPATH_AUTH_SCOPES` | POSTs to `{identityUri}/connect/token`, caches JWT in file cache keyed by identity host + grant + client + scopes |
| **OAuth browser login** (interactive) | `oauth_authenticator.go` | `auth.clientId`, `auth.redirectUri`, `auth.scopes` | `UIPATH_CLIENT_ID`, `UIPATH_AUTH_REDIRECT_URI`, `UIPATH_AUTH_SCOPES` | **Authorization Code + PKCE (S256)**; opens system browser (`browser_launcher_{darwin,linux,windows}.go`), listens on localhost (e.g. `http://localhost:12700`), serves local success HTML page, exchanges code at identity server, caches refresh token |
| **Personal Access Token** | `pat_authenticator.go` | `auth.pat` | `UIPATH_PAT` | PAT used directly as bearer token |
| **API key / custom headers** | profile `header:` map | e.g. `X-UIPATH-License` | — | For non-identity services (see `apikey` profile example in README) |

Other details: `identity_client.go` handles token requests; token cache honors expiry with grace period; `--insecure`/`UIPATH_INSECURE` disables TLS verification; OAuth requires an External Application (**Non-Confidential**) while client credentials require a **Confidential** external app.

---

## 5. Config Structure (`config/`)

- **File:** `$HOME/.uipath/config` (override: `UIPATH_CONFIGURATION_PATH`), YAML.
- **Multi-profile:** `profiles:` list; selected via `--profile` / `UIPATH_PROFILE` (default `default`).
- **Interactive setup:** `uipath config --auth credentials|login|pat`; programmatic: `uipath config set --key K --value V --profile P`.
- **Allowed keys** (`ConfigKeys` in `commandline/`): `organization`, `tenant`, `uri`, `identityUri`, `auth.*` (`clientId`, `clientSecret`, `pat`, `redirectUri`, `scopes`, `grantType`, `properties.<key>`), `insecure`, `debug`, `output`, `parameter.<key>`, `header.<name>`, `serviceVersion`.

Example profile (`profile_yaml.go` fields):

```yaml
profiles:
  - name: default
    organization: my-org
    tenant: DefaultTenant
    auth:
      clientId: <id>
      clientSecret: <secret>
    uri: https://cloud.uipath.com     # Automation Suite override supported
    insecure: false
    debug: false
    output: json                      # json | text
    serviceVersion: ""                # pick alternate definition set
```

**Global arguments** (flag / env / profile): `--debug`, `--insecure`, `--output`, `--profile`, `--query`, `--uri`, `--organization`, `--tenant`, `--identity-uri`, `--wait`, `--wait-timeout`, plus `UIPATH_CLIENT_ID/SECRET/PAT`.

---

## 6. Output Formats (`output/`)

| Format | Writer | Behavior |
|---|---|---|
| `json` (default) | `json_output_writer.go` | Pretty-printed JSON on stdout; pipeable to `jq` |
| `text` | `text_output_writer.go` | Tab-separated fields, one row per line (for `cut`/`grep`/`sort`) |

Extras: `--query` applies **JMESPath** transforms (`jmespath_transformer.go`); `--wait "<expr>"` + `--wait-timeout N` polls an operation until a JMESPath condition is true (default 30s) — sync-style wrappers for async APIs; `--debug` dumps raw HTTP request/response; input via `--file <path>` or `--file -` (stdin piping).

---

## 7. API Surface (key wrapped endpoints)

- **Orchestrator** (`/odata/*` and `/api/*`): Buckets (`/api/Buckets/...` incl. ListFiles, read/write URIs), Folders, Users, Robots, Machines, Jobs (`odata/Jobs` start/stop/resume/restart), Queues & QueueItems (add/bulk-add, review, transaction results), Assets, Releases & Processes, Libraries, ProcessSchedules, TestAutomation (test set executions, attachments), AppTasks/GenericTasks/TaskForms (Action Center), AuditLogs, Licensing/Stats, Webhooks, CredentialStores, Maintenance, Sessions, Logs.
- **Identity** (`/api/*`, `/connect/*`): `POST /connect/token` (token issuance), Users CRUD + bulk, Groups, RobotAccounts, Settings, `AuditQuery/{partitionGlobalId}` (+ download), MessageTemplates, SAML certificates, UserLoginAttempts.
- **DU** (`/api/framework/*`): `/projects`, `/document-types`, `/classifiers`, `/extractors`, `/tags`; digitization start/get, classification classify/classify-by-tag/start/get, extraction extract/start/extract-by-doc-type/get, validation start*/get* (incl. per-doc-type variants).
- **Studio backend** (`/{org}/studio_/backend`): reserved; current Studio features (pack/analyze/publish/test) are plugin commands that call Orchestrator/other endpoints under the hood via `utils/api` clients (`orchestrator_client.go`, `du_client.go`).
- **Plumbing:** retry (3 attempts on retryable errors), request IDs, bearer-token injection, org/tenant URL templating, per-service base paths (`orchestrator_`, `identity_`, `du_`, `studio_/backend`).

---

## 8. Quick-Reference Table

| Command | Subcommands (representative) | Service | Auth Required | Description |
|---|---|---|---|---|
| `uipath orchestrator <resource> <op>` | 66 resources × CRUD ops, e.g. `users get`, `folders get/post`, `jobs start-jobs/stop-jobs`, `queues add-queue-item`, `assets post`, `releases put-by-id`, `buckets post/get-by-id` | Orchestrator | Yes (any flow) | Full Orchestrator REST API surface generated from OpenAPI (418 ops) |
| `uipath orchestrator buckets download` | `--path --bucket-id --folder-id` | Orchestrator | Yes | Plugin: download file from storage bucket |
| `uipath orchestrator buckets upload` | `--file --bucket-id --folder-id` | Orchestrator | Yes | Plugin: upload file to storage bucket |
| `uipath identity <resource> <op>` | `user get-users/create-user`, `group get-groups`, `robotaccount …`, `setting get-settings-bulk`, `auditquery get-audit-events` | Identity | Yes | Identity server management API (34 ops) |
| `uipath du discovery <op>` | `projects`, `project-by-id`, `document-types`, `classifiers`, `extractors`, `tags` | Document Understanding | Yes | List DU projects, document types, classifiers, extractors |
| `uipath du digitization <op>` | `start`, `get`, `digitize` (plugin sync wrapper) | Document Understanding | Yes | Digitize documents (OCR/DOM), poll async results |
| `uipath du classification <op>` | `classify`, `classify-by-tag`, `start`, `get` | Document Understanding | Yes | Classify digitized documents |
| `uipath du extraction <op>` | `extract`, `start`, `extract-by-doc-type`, `get` | Document Understanding | Yes | Extract fields (incl. Generative Extractor via `--prompts`) |
| `uipath du validation <op>` | `start-classification-validation*`, `start-extraction-validation*`, `get-*` | Document Understanding | Yes | Human-in-the-loop validation workflows |
| `uipath studio package pack` | — | Studio / Orchestrator | No (local build) | Package a Studio project into `.nupkg` |
| `uipath studio package analyze` | — | Studio | No | Governance/static analysis; `--query` to filter violations |
| `uipath studio package restore` | — | Studio | No | Restore project dependencies |
| `uipath studio package publish` | — | Studio → Orchestrator | Yes | Publish package to Orchestrator feed |
| `uipath studio test run` | `--source --attach-robot-logs --results-output junit` | Studio → Orchestrator | Yes | Run test sets; JUnit reports; multi-project parallel |
| `uipath config` | interactive; `--auth credentials\|login\|pat` | All | No | Interactive CLI setup |
| `uipath config set` | `--key --value [--profile]` | All | No | Update config file values |
| `uipath config cache clear` | — | All | No | Clear local token cache |
| `uipath config offline` | — | All | No | Download external dependencies for offline use |
| `uipath autocomplete enable` | `--shell bash\|powershell\|zsh` | All | No | Install shell completions |
| `uipath commands show` | hidden | All | No | Dump full command tree as JSON |
| Global flags | `--profile --output --query --wait --debug --insecure --uri --organization --tenant --identity-uri --wait-timeout` | All | — | Applied to all operations; overridable via `UIPATH_*` env vars |

---

## 9. Key Takeaways for RGA Integration

1. **Definition-driven**: every API command is generated from embedded OpenAPI specs — no hand-written per-endpoint code. Adding a service = dropping in a YAML spec (or pointing `UIPATH_DEFINITIONS_PATH` at a directory).
2. **Three auth modes** with sensible precedence and caching; PAT is the simplest for automation (`UIPATH_PAT` env var alone is enough).
3. **Script-friendly**: JMESPath `--query`, `--output text`, `--wait` polling, stdin/stdout piping make it ideal for shell pipelines (the README's own examples chain du digitization → classification → extraction).
4. **Plugin API** (`plugin.CommandPlugin`) is the sanctioned extension point for higher-level commands (as used by digitize/upload/download/studio).
5. **Binary only** — single static Go binary, no runtime deps; cross-platform (linux/windows/darwin, amd64/arm64).
