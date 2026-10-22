# Local decisions (unpushed)

## 2026-10-23 — Scrub secret values from MCP tool output
- **Decision:** `scripts/sc-mcp.js` now passes child stdout/stderr (and parsed structuredContent) through `lib/redact-env.js`, replacing the literal value of any secret-named env var (TOKEN/SECRET/PASSWORD/API_KEY/DEPLOY_KEY/PAT/COMPOSIO_KEY/AUTH, len ≥ 8) with `[redacted]`.
- **Why:** the MCP server runs tools with full `process.env` (shared GH_PAT_*/COMPOSIO_KEY_* on the box) and relayed raw output to the agent/chat. Any tool that echoed a credential (error message, debug dump) would leak it into agent transcripts. Audit of other child_process sites found no `shell: true` or string-interpolated commands after PR #2, so output leakage was the highest remaining risk.
- **Scope/limits:** value-based, defense-in-depth only; does not catch secrets not present in env. Tests: `test/redact-env.test.js` (REDACT-1..4).

## 2026-10-23 — E2E test for MCP redaction; tighten AUTH match
- **Decision:** added `test/mcp-redact-e2e.test.js` (spawns `scripts/sc-mcp.js` over stdio in a sandbox with `FAKE_TEST_TOKEN=dummyvalue123456` and an echo tool; asserts `[redacted]`, no raw value). Tightened `AUTH` in `SECRET_NAME` to a segment match `(?:^|_)O?AUTH(?:_|$)` — previously `AUTHOR`/`GIT_AUTHOR_NAME` values were over-redacted.

## 2026-10-23 — Three-way uplift (see docs/THREE-WAY-COMPARISON.md)
- **Adopted shape-based redaction** from connectors-gateway (Bearer, key=value, ghp_/github_pat_/sk_/sk-/xox*/JWT/PEM). **Rejected** the gateway's generic "any 24+ char run" rule: it would hide the commit SHAs and deployment IDs that SC users must see.
- **Adopted MSO's tool-hint contract.** Hints are derived from tool-name patterns in `lib/mcp-contract.js` so the 55-tool registry didn't need hand edits. Explicit `annotations` in functions.json override them.
- **Adopted the gateway's validate-before-execute step.** `tools/call` checks arguments against `inputSchema` (shallow) and returns -32602 before spawning anything.
- **Deferred auth hardening** (encrypted store, per-tool env allowlist). It is a design change that needs Rahman's input, so the auth score stays at 55.
- **Role split:** SC = credential control plane + provider CLI; MSO = host ops; gateway = external connector proxy.
- **Test timeouts:** the e2e and contract stdio tests now use 120 s timeouts. The box hit load average ~140 during the run, and the 15 s timeouts produced false failures.
