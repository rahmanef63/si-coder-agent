---
name: sc-onboarding
description: "Onboard new SI-Coder users. Scans env for credentials each sc-* domain needs, lists what is set and what is missing, asks the user only for the missing pieces, then writes them to ~/.bashrc. One-shot CLI fallback: bin/onboard.js for non-AI flows."
---

# /sc-onboarding — Guided credential setup

Use this skill when the user is setting up `si-coder-agent` for the first time, or after they install a new `/sc-*` domain skill that needs new credentials.

## Two modes

### Mode A — AI-driven (default, interactive)

Triggered when the user runs `/sc-onboarding` from Claude / OpenClaw / Gemini.

The AI MUST:
1. **Ask which domains they want.** Present a checklist:
   - `[ ] sc-dokploy` (Dokploy CRUD + deploy targets)
   - `[ ] sc-convex` (Convex self-hosted)
   - `[ ] sc-cf` (Cloudflare, future)
   - `[ ] github` (always required for any deploy)
   - `[ ] hostinger` (optional DNS automation)
2. **Run `scripts/scan-env.js --domains <list>`** to detect which required vars are already set in the user's environment (via `process.env` + `~/.bashrc` parse).
3. **For each missing var, prompt the user via `AskUserQuestion`** with the per-var description from `steps/<domain>.md`. NEVER ask for vars that are already set unless the user says "reset" or "rotate".
4. **Write only the new values** to `~/.bashrc` using `scripts/scan-env.js --write`, which appends an idempotent block `# --- si-coder onboarding (timestamp) ---`. Existing exports are not edited.
5. **Confirm**: `source ~/.bashrc` + tell the user which `/sc-*` skill they can now use.

NEVER ask the user to paste a value if it is already exported. Never log the value back to the user — confirm by hash/length only.

### Mode B — One-shot CLI (non-AI)

For users who clone the repo and want a scripted setup:

```bash
bash install.sh                        # symlink skills to ~/.claude/skills/
node bin/onboard.js                    # interactive readline wizard
node bin/onboard.js --domains convex,dokploy,github   # non-interactive checklist
```

The CLI reads `steps/<domain>.md` for prompts + validators and writes to `~/.bashrc`.

## Required vars per domain

| Domain | Required | Optional |
|---|---|---|
| github | `GITHUB_TOKEN` | — |
| dokploy | `DOKPLOY_API_URL`, `DOKPLOY_API_KEY` | — |
| convex | (uses dokploy creds) | `CONVEX_ADMIN_KEY` (auto-generated on deploy) |
| hostinger | — | `HOSTINGER_API_TOKEN` (recommended) |
| cf (future) | — | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |

See `steps/*.md` for how to obtain each one.

## Safety

- Never echo secrets back to the user — confirm with first 12 chars + `…[redacted]`.
- Never overwrite an existing export silently. Detect existing values, ask before rotating.
- The append block is timestamped so the user can audit/remove it later.
