---
name: si-coder
description: "Portable SI-Coder umbrella for deployment and provider operations. Runtime-first: hosted Claude Web/ChatGPT-style agents use full Composio for GitHub + Convex + Vercel + Hostinger without a VPS/local SC vault; local agents branch first on VPS ownership, then choose Dokploy/self-hosted or managed Vercel. Prefer /sc-all for one-prompt deploys, /sc-provider for secret-safe provider lifecycle, and /sc-install for portable installation."
---

# SI-Coder umbrella

Use the narrowest SI-Coder skill that satisfies the task:

| Intent | Skill |
|---|---|
| "deploy/ship this app" | `/sc-all` |
| provider/API key/secret lifecycle | `/sc-provider` |
| install skills/plugin/MCP in another agent | `/sc-install` |
| GitHub operations | `/sc-git` |
| Dokploy-only operations | `/sc-dokploy` |
| Convex self-hosted | `/sc-convex` |
| Convex Cloud | `/sc-convex-cloud` |
| Vercel-only operations | `/sc-vercel` |
| first-time local SC credential setup | `/sc-onboarding` |

## Default deploy behavior

Do not require the user to choose infrastructure terminology first.

1. Detect runtime **before** credentials.
2. Hosted web/chat runtime → full Composio: GitHub → Convex Cloud → Vercel → Hostinger; no VPS question and no local SC requirement.
3. Local runtime → determine whether the user has a VPS. If unknown and not inferable, ask exactly once.
4. Local + VPS → SC GitHub/Dokploy/self-hosted Convex route.
5. Local + no VPS → SC GitHub + managed Convex/Vercel/Hostinger, preferring Composio when connected.
6. Configure the requested canonical domain and verify production end-to-end.

Read `skills/sc-all/SKILL.md` for the full orchestration contract.

## Secret boundary

Never ask the user to paste a secret into chat or MCP JSON.

- Agent reads provider/credential **status**, not plaintext.
- New/rotated local secret → `sc secret set <provider> <KEY>` hidden-terminal handoff.
- Connected provider → initiate the provider's secure connection/auth flow.
- Consumer command → `sc run -- <command>`.
- `sc env` is intentionally disabled.
- Hosted runtime: GitHub is a Composio connected account. Local runtime: GitHub remains SC-direct by default. Never mix these policies across runtimes.

Read `skills/sc-provider/SKILL.md` and `references/provider-routing.md`.

## Portability

The repository's `skills/` directory is the Agent Skills SSOT. Do not maintain Claude/Codex/Hermes-specific copies.

- Claude Code plugin: `.claude-plugin/plugin.json` + `.mcp.json` + `skills/`.
- Codex/global Agent Skills: installer links to `~/.agents/skills`.
- Claude standalone: `~/.claude/skills`.
- Hermes/OpenClaw/custom directories are installer targets over the same skill folders.

Read `skills/sc-install/SKILL.md`.

## Proactive next action

After completing a meaningful milestone, offer exactly **one** relevant next action.

The offer should contain:

1. why it matters,
2. prerequisites,
3. a simple opt-in question.

If accepted, provide the secure connection link or terminal handoff and continue. Do not dump a generic upsell list, repeatedly suggest configured services, or imply the user must accept.

Typical progression when relevant:

`deploy → email → auth/account flows → observability → backups → CI/release hardening`

## Core engineering mandates

- Preserve existing project architecture unless a migration was requested.
- Prefer idempotent create-or-reuse behavior.
- Never overwrite a working canonical domain with an invented one.
- Never persist PATs in Git URLs.
- Never expose secrets in logs/build args/tool schemas.
- For Convex projects, preserve the project's intended auth/backend model rather than silently replacing it.
- Verify the final public result, not just the API side effects.

## Mandatory credential + next-step response contract

Whenever a credential/API key is missing, **never output only the variable name**. Always make the handoff explicit:

```text
Buat di      : <authoritative provider URL / secure connector auth link>
Petunjuk     : <minimum scope / exact menu when useful>
Simpan via   : <sc secret set provider KEY, or provider connector>
Simpan di    : <SC profile 0600, or Composio connected account>
Lanjut       : <verification/resume action>
```

Rules:
- Local SC runtime: use the provider endpoint from the registry and `sc secret set <provider> <KEY>`; tell the user it lands in the active SC profile (`~/.config/si-coder/profiles/<name>.env`, mode 0600; managed `~/.bashrc` only when no profile exists).
- Hosted Claude Web/ChatGPT-style runtime: prefer the secure Composio connection URL returned by the connector; credentials stay in the connected account. Do not ask for the raw provider key unless the connector explicitly requires an API key bootstrap.
- If a custom API-key provider has no creation URL, do not guess one. Require its provider metadata to be updated with `--url https://...` first.
- Never put the credential value in chat, argv, logs, recommendations, or tool JSON.

After every meaningful completed milestone, emit exactly one next-step block:

```text
[rekomendasi]
Berikutnya   : <one highest-value next step>
Kenapa       : <one sentence>
Butuh        : <prerequisites, or "tidak ada">
Kalau setuju : <what SI-Coder will do next / secure auth handoff>
```

Do not dump multiple recommendations. Do not recommend something already configured and healthy.
