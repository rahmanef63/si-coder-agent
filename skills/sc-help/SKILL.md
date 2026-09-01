---
name: sc-help
description: "Quick reference for SI-Coder route selection, secret-safe provider control, portable installation, and provider-specific skills. Use for 'sc help', 'what should I run', 'which deploy route', or 'list si-coder commands'."
---

# /sc-help

## Pick the entry point

| Goal | Use |
|---|---|
| Deploy from repo to production | `/sc-all` |
| API/provider credential or account connection | `/sc-provider` |
| Install in Claude Code/Codex/Hermes/OpenClaw | `/sc-install` |
| Provider-specific operation | matching `/sc-*` skill |

## Deploy routing

```bash
sc deploy plan --target auto
```

- usable VPS/Dokploy → VPS route.
- no usable VPS → managed Vercel + Convex Cloud.
- GitHub → SC on both paths.
- managed Vercel/Convex/Hostinger → Composio preferred when a connected toolkit exists; SC fallback.

Advanced overrides: `--target dokploy|hybrid|vercel|vps|managed`.

## Secret-safe commands

| Command | Purpose |
|---|---|
| `sc providers [--json]` | provider metadata + safe credential state |
| `sc secret list/get ...` | state/source only; plaintext disabled |
| `sc secret set <provider> [KEY]` | hidden local credential entry |
| `sc secret rm ... --yes` | remove managed credential |
| `sc run -- <cmd>` | run child with resolved profile, without printing secrets |
| `sc doctor` | live provider validation |
| `sc audit --json` | metadata-only lifecycle audit |
| `sc update --check` / `sc update` | safe fast-forward self-update |

## Portable install

```bash
bash install.sh --agent claude
bash install.sh --agent codex --with-mcp
bash install.sh --agent hermes
bash install.sh --agent openclaw
bash install.sh --agent all
```

Claude plugin development/direct use:

```bash
claude --plugin-dir /path/to/si-coder-agent
```

## Skills

`/sc-all`, `/sc-provider`, `/sc-install`, `/sc-git`, `/sc-dokploy`, `/sc-convex`, `/sc-convex-cloud`, `/sc-vercel`, `/sc-cf`, `/sc-onboarding`, `/sc-sync`, `/sc-n8n` are active surfaces. Provider-specific Resend/Stripe/Clerk/Supabase automation may still be partial, while their credential schemas can be managed by SC.

## After completing a task

Recommend one useful next step with its benefit + prerequisites, then ask whether the user wants it. Never request a raw secret in chat; use a secure provider connection or `sc secret set ...` handoff.
