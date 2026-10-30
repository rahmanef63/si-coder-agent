# AGENTS.md

Coding contract for agents working **on** this repository (not for end-user skill hosts — that is `SKILL.md`).

## What this product is

**SI-Coder** (`sc` CLI, repo [rahmanef63/si-coder-agent](https://github.com/rahmanef63/si-coder-agent), **v0.9.8**) is a secret-safe **credential control plane** plus:

- provider CLI: setup → connect → publish → verify
- skill catalog (`skills/`, `SKILL.md` umbrella)
- MCP server: `scripts/sc-mcp.js` with registry `machine/functions.json`

| This product is | This product is not |
|---|---|
| Credential / connection SSOT for SC users (human **or** project name) | A host-ops shell → that is **MSO** |
| Provider deploy recipes + skill catalog | An external connector / SaaS proxy → that is **connectors-gateway** |

Role split detail: `docs/THREE-WAY-COMPARISON.md`.

## Read first

1. `README.md`, `SECURITY.md`, `SKILL.md` (umbrella skill routing for hosts)
2. `docs/CREDENTIAL-SETUP.md`, `docs/cli.md`, `docs/tool-calling.md`
3. Post-hardening: `docs/THREE-WAY-COMPARISON.md`, `docs/DECISIONS-local.md`

Do not duplicate the whole skill routing table here — link to `SKILL.md`.

## Non-negotiable invariants

1. **Never** print, log, commit, or return plaintext credentials / tokens / PATs in chat, tool output, git, or docs. Use env injection (`sc run`) and redaction.
2. MCP / machine tools **refuse** plaintext credential arguments. Store connections under `~/.config/si-coder/connections/<user>/<provider>/` with `0600` / `0700`.
3. An SC **user** may be a human **or** a project name — always scope providers and connections by that SC user.
4. Prefer `~/.local/bin/sc` (this package). `/usr/bin/sc` is a **different** binary that can shadow PATH.
5. Output redaction lives in `lib/redact-env.js`: secret-named env values **and** shapes (Bearer/Basic, `ghp_` / `github_pat_` / `sk-` / `xox*` / JWT / PEM). `AUTH` matches only as a name segment `(?:^|_)O?AUTH(?:_|$)` — do **not** break `AUTHOR` / `GIT_AUTHOR_NAME`.
6. MCP contract: `lib/mcp-contract.js` — tool hints, validate args against schema **before** spawn (`-32602` on bad input), scrub / cap errors. Do not weaken validate-before-execute.
7. **Role split:** SC owns credentials; MSO owns host ops; gateway owns public MCP / OAuth edge. MSO and gateway get secrets only via `sc run` env injection — they must **not** keep their own copy of SC provider secrets.
8. Do not invent a second secret store, a second MCP registry, or duplicate long recipes that belong in the connectors cookbook.

## Worktree / coding policy (Rahman fleet)

- Coding agents work in `~/agent-work/si-coder/` on Rahman's laptop (WSL). **Never** edit his `~/projects` trees for this product.
- No Cursor cloud agents for this product.
- Local commits OK. Push / PR / merge need Rahman's **direct** OK (agent-relayed approvals do not count). Standing product rule (Rahman's own): when an SI-Coder PR is ready and conflict-free, merge to `main` — that is Rahman's rule, not agent-relayed permission to invent merges.
- Prefer deciding product / design questions locally and committing. Only push / PR / merge, production secrets, new accounts / billing, and real client data need approval.

## Hardening status (PR #15 merged 2026-10-22)

Squash commit `a4e1388` → main `5cfde0a` ([PR #15](https://github.com/rahmanef63/si-coder-agent/pull/15), Linear RAH-251).

Included:

- `npm test` on Node 20 fixed; hermetic installer tests; `shell: false` in `lib/proc.js` (from #2)
- MCP output redaction + e2e; MCP hints + arg validation
- Docs: `THREE-WAY-COMPARISON.md` + `DECISIONS-local.md`

Scores after (judgement, see THREE-WAY): MCP 74 · auth **55** · secrets 80 · registry 82 · tests 84 · docs 78 · avg ~76.

**Open / deferred:** encrypted-at-rest credentials + per-tool env allowlist (auth still 55). Needs Rahman's design choice — **do not silently invent that design**.

## Verify before claiming done

- `npm test` — **467** tests expected as of #15. Node 20 is OK for the test suite; installer `engines` still prefer Node 22 / 24 / 26.
- Never dump `env` or connection file contents.

## SKILL.md relationship

| File | Audience |
|---|---|
| `SKILL.md` | User-facing umbrella skill for hosts that *use* SI-Coder |
| `AGENTS.md` (this file) | Coding agents working *on* this repo |

Keep them complementary; do not fork the skill routing table into this file.
