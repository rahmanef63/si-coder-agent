# si-coder-agent — knowledge

- Product: SI-Coder / `sc` — secret-safe credential control plane + provider CLI + skill catalog + MCP.
- Repo: https://github.com/rahmanef63/si-coder-agent
- Version: 0.9.8
- Owner agent: si-coder (reports to manef / Alfa per fleet; product under Business).
- Canonical agent coding checkout: `/home/rahman/agent-work/si-coder` on Rahman's laptop (WSL). Do **not** use `~/projects`.
- Box reference checkout may exist at `/home/box/projects/si-coder-agent` — not the fleet coding SSOT.
- Live CLI preference: `~/.local/bin/sc` (`/usr/bin/sc` is a different binary).
- Stack: Node CLI + skills + MCP (`scripts/sc-mcp.js`, `machine/functions.json`); no runtime npm deps for core CLI.
- Credentials path: `~/.config/si-coder/connections/<user>/<provider>/` (user = human **or** project name); mode 0600/0700.
- Merged 2026-10-22: PR #15 local hardening → main @`5cfde0a` (squash `a4e1388`); https://github.com/rahmanef63/si-coder-agent/pull/15 ; Linear RAH-251.
- Hardening highlights: Node 20 test fix, hermetic installer tests, MCP redaction + e2e, mcp-contract hints + validate-before-execute, THREE-WAY + DECISIONS docs.
- Role split: SC = credentials; MSO = host ops; connectors-gateway = public MCP/OAuth edge. Integration via `sc run` env injection — no second secret store.
- Scores post-#15 (approx): MCP 74, auth 55, secrets 80, registry 82, tests 84, docs 78, avg ~76.
- Open: auth design (encrypted-at-rest + per-tool key limits) — blocked on Rahman; do not invent.
- Root was STALE/MISSING `AGENTS.md` (only `SKILL.md`); refreshed 2026-10-28 with `AGENTS.md` + this file.
- Never paste secret values into knowledge or chat — key names only.
