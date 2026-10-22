# Three-way comparison: SI-Coder vs MSO vs connectors-gateway

Date: 2026-10-23 (Asia/Jakarta). Branch `feat/three-way-uplift` (off `test/mcp-redact-e2e` @3091ce4). Local only, not pushed.

Scores are 0–100 judgement calls from a **read-only skim** of each codebase. MSO and the gateway were not run or modified, so their scores are less certain than SI-Coder's. Nothing is rounded up to 100.

| Aspect | SI-Coder before | SI-Coder after | MSO (`/home/box/mso` @6b035cfd) | connectors-gateway (@34d96ec) |
|---|---|---|---|---|
| MCP server quality | 62 | 74 | 88 | 85 |
| Auth / token handling | 55 | 55 | 85 | 88 |
| Secret handling / redaction | 65 | 80 | 75 | 90 |
| Tool registry | 70 | 82 | 85 | 82 |
| Tests | 80 | 84 | 85 | 85 |
| Docs | 72 | 78 | 85 | 88 |
| **Average** | **67** | **76** | **84** | **86** |

## Evidence

### SI-Coder
- **MCP:** `scripts/sc-mcp.js` is a dependency-free stdio server (about 130 lines) that supports the 2026-07-28 and 2025-11-25 protocols. Before this branch, `tools/list` carried no annotations and `tools/call` passed arguments to child scripts without validating them. It now has annotations, schema validation, and scrubbed, length-capped internal errors. It is still stdio only, with no HTTP transport, progress or cancellation.
- **Auth:** MCP auth relies on the stdio trust boundary. Credentials live in plain files under `~/.config/si-coder/connections/<user>/<provider>/`, and tools see the whole `process.env`. There is no OAuth, no per-tool scoping and no constant-time comparison. **This branch does not change auth.** Fixing it is design work, not a quick adopt.
- **Secrets:** Before this branch, `lib/redact-env.js` replaced only the literal values of env vars with secret-like names. The branch adds shape patterns adopted from the gateway (Bearer/Basic, `key=value`, `ghp_`/`github_pat_`/`sk_live_`/`sk-`/`xox*`, JWT, PEM). Raw credentials are refused as MCP arguments by design.
- **Registry:** `machine/functions.json` is the single source for 55 tools, all with closed object schemas. The branch adds derived `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` and a contract test.
- **Tests:** 459 tests passed before the branch; the branch adds 8 more (467 total). The suite uses `node:test` with no dependencies.
- **Docs:** README, SECURITY, CREDENTIAL-SETUP, cli.md and tool-calling.md. There was no threat model and no comparison or role document.

### MSO (read only)
- `lib/mcp/` has about 185 files. `tool-contract.test.ts` requires every tool descriptor to declare readOnly, destructive and openWorld hints. There are OAuth token and tenant MCP routes (`app/mcp/*`, `app/oauth/token`), PKCE (`lib/security/pkce.ts`), and `timingSafeEqual` in `lib/auth/session.ts`.
- About 920 test or spec files (vitest) and about 86 docs, including AGENT-SECURITY, AGENT-VAULT and dated audits. Redaction exists in places but is not a single central boundary that I could find.

### connectors-gateway (read only)
- Invariant 5 says connector credentials never appear in tool output, errors or logs. `adapters/remote-mcp/src/redact.ts` does literal and pattern redaction with a 200-character cap and has its own tests (`redact.test.ts`, `outbound-boundary.test.ts`).
- Auth: `packages/auth` (hashing), peer auth on the relay, approval keys, and OAuth redirect-URI hardening (HEAD commit). The registry is in `packages/registry`, with per-adapter manifests.
- About 193 `*.test.ts` files and numbered docs 00–21, including a security model, threat model and connector contract.

## What was adopted into SI-Coder
1. **Shape-based redaction**, from the gateway's `redact.ts` (commit `492909a`). The gateway's generic "any run of 24+ characters" rule was **not** adopted, because SC output must keep commit SHAs and deployment IDs readable.
2. **Tool hints on every tool, plus a contract test**, from MSO's `tool-contract.test.ts` (commit `633ba80`).
3. **Schema validation of arguments before execution**, from the gateway's validate-then-execute pipeline (commit `633ba80`). Unknown, missing or wrong-typed arguments, `maxLength` and min/max violations are rejected with `-32602` before any child process starts.
4. **Scrubbed, capped internal error messages**, from the gateway's 200-character error rule (commit `633ba80`, capped at 500 characters).

## Still not at 100 (honest gaps)
- **Auth (55):** needs encrypted-at-rest credentials or an OS keychain, per-tool env allowlists so a child process gets only the provider keys it needs, and an authenticated transport if SC MCP is ever exposed beyond stdio.
- **MCP (74):** no HTTP transport, progress notifications, cancellation or outputSchema.
- **Annotations:** derived from tool-name patterns. Explicit per-tool `annotations` in `functions.json` would be more reliable, and they already override the derived values.

## Recommended role split (no overlap)
| System | Owns | Does not own |
|---|---|---|
| **SI-Coder (sc)** | The secret and credential **control plane** (who has which provider key, per SC user or project), the provider CLI (setup → connect → publish → verify), deploy recipes, the skill catalog | Running arbitrary host shell commands; proxying third-party SaaS connectors |
| **MSO** | **Host operations**: shell/exec, filesystem, projects, pipelines, the app host, and the remote MCP with OAuth for host tools | Storing provider credentials (it asks SC: `sc run --connection …`) |
| **connectors-gateway** | The **external connector proxy**: remote MCP and SaaS adapters, local software bridges, policy and approvals, outbound redaction | Host shell; the credential source of truth for SC providers |

Integration contract: MSO and the gateway get credentials by having SC inject them as environment variables at runtime (`sc run`). Neither keeps its own copy of SC provider secrets. All three redact output at their own boundary.
