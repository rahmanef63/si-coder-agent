---
name: sc-all
description: "One-prompt end-to-end deployment with runtime-first routing. Hosted agents such as Claude Web/ChatGPT use a full Composio connected-account flow and never require a VPS or local SC vault. Local agents branch first on whether the user has a VPS: yes -> Dokploy/self-hosted path; no -> managed Vercel + Convex Cloud. Finishes GitHub, backend, frontend, custom domain/DNS, verification, then offers one useful next action."
---

# /sc-all — runtime first, then deployment route

Use this when the user says **deploy this**, **ship this app**, **put this online**, or asks for a full domain-to-production flow.

The user should describe the goal, not the infrastructure. SI-Coder owns the routing.

## Core promise

One request drives the complete path:

`detect runtime → choose/ask VPS branch → connect auth safely → GitHub → backend → frontend → domain/DNS → verify → recommend next action`

Do not stop at repo creation, project creation, DNS write, or build trigger. Complete and verify the production path.

# 0. FIRST BRANCH — where is the agent running?

This decision happens **before credential routing**.

## A. Hosted agent — Claude Web, ChatGPT chat, other server-side chat hosts

Treat the runtime as `hosted` when the agent has no normal local shell/filesystem/SC vault and is operating through hosted connectors/plugins.

**Do not ask whether the user owns a VPS. Do not require a VPS. Do not ask for local `sc secret set`.**

The default path is full Composio:

```text
Composio connect
  → GitHub
  → Convex Cloud
  → Vercel
  → Hostinger DNS
  → verify
```

Every deployment provider, including GitHub, is a Composio connected account in this mode because there is no local SC/Git identity to preserve.

Planning equivalent:

```bash
sc deploy plan --runtime hosted --target auto --composio --json
```

The script is a portable policy reference; a hosted chat does **not** need the local `sc` executable to execute the flow. The host agent should run the equivalent connector calls directly.

### Hosted Composio execution contract

1. Discover the required toolkit/actions for **GitHub, Convex, Vercel, Hostinger**.
2. Check connection state for each toolkit.
3. For disconnected toolkits, create the secure Composio auth connection and show the auth link.
4. Continue only after the needed connection is active.
5. Run the provider operations through Composio; never retrieve/decrypt credentials just to pass them between providers.
6. Reuse identifiers returned by earlier steps (repo, project, deployment, domain) rather than searching ambiguously again.
7. Verify the public result.

If Composio itself is unavailable, the hosted route is **blocked**. Offer to connect/enable Composio; do not fall back to asking the user to paste provider API keys into chat.

If a hosted user explicitly asks to deploy to their VPS/Dokploy, explain that this requires a connected VPS runner/MCP or a local SI-Coder runtime. Never silently replace an explicit VPS request with Vercel.

## B. Local agent — Claude Code, Codex CLI, Hermes/OpenClaw on a machine

The first infrastructure branch is:

> **Do you have a VPS you want SI-Coder to deploy to?**

Do not ask this if existing configuration already answers it (for example valid Dokploy configuration), or if the user already said yes/no. Otherwise ask this **once, before provider credential setup**.

Planner:

```bash
sc deploy plan --runtime local --target auto --json
```

When ambiguous it returns `route: decision-required` + the VPS question instead of guessing.

### B1. Local + VPS

```text
GitHub (SC)
  → Convex self-hosted
  → Dokploy
  → Hostinger DNS
  → verify
```

Default target: `dokploy`.

Optional `hybrid` when the user wants VPS frontend + managed Convex:

```text
GitHub (SC) → Convex Cloud → Dokploy → Hostinger DNS → verify
```

### B2. Local + no VPS

```text
GitHub (SC)
  → Convex Cloud
  → Vercel
  → Hostinger DNS
  → verify
```

On a local runtime, GitHub stays in SC by default so repository identity remains deterministic. Vercel/Convex/Hostinger prefer Composio when connected and fall back to SC credentials when necessary.

# Provider routing matrix

| Provider | Hosted web/chat | Local, no VPS | Local + VPS |
|---|---|---|---|
| GitHub | **Composio** | **SC** | **SC** |
| Convex | **Composio / Cloud** | Composio preferred, SC fallback | **SC/self-hosted** (`hybrid`: managed) |
| Vercel | **Composio** | Composio preferred, SC fallback | optional |
| Hostinger | **Composio** | Composio preferred, SC fallback | Composio or SC |
| Dokploy | n/a | n/a | **SC** |

Read `../../references/provider-routing.md` before auth work.

# One-prompt orchestration

## Phase 1 — inspect, do not interrogate

Infer whenever possible:

- project/app name,
- GitHub repository/branch,
- framework/build command,
- whether `convex/` exists,
- canonical domain,
- existing Vercel/Dokploy/Convex state.

Only ask for a fact that cannot be safely inferred. On local runtime, VPS ownership is the first such branch when unknown.

## Phase 2 — repository

### Hosted
Use the connected Composio GitHub account. Confirm the selected account if multiple connections exist. Create/reuse the repository and publish the intended source through the available GitHub connector actions.

### Local
Use SC/direct GitHub identity. Protect `.env*`, keys, certificates and other secret files before staging. Never embed a PAT in a Git URL.

# Phase 3 — backend/frontend

## Hosted or local/no-VPS managed route

1. **Convex Cloud** — reuse/create production project/deployment through Composio when available.
2. **Vercel** — reuse/create project, bind repository, apply config safely, deploy production.
3. Keep credentials inside their connected-account/secret boundary; do not surface raw deploy keys to chat merely to copy them elsewhere.

## VPS route

1. Ensure/reuse Dokploy project.
2. Provision/reuse self-hosted Convex unless `hybrid` was explicitly selected.
3. Ensure/reuse Dokploy application.
4. Inject only required public/build values.
5. Deploy and poll to success/failure.

# Phase 4 — domain is first-class

For a Hostinger domain/subdomain:

1. use the user's intended canonical domain,
2. attach that exact domain to Vercel or Dokploy,
3. retrieve the destination's required DNS configuration,
4. validate/write Hostinger DNS,
5. re-check domain verification, DNS and HTTPS.

Do not invent a replacement subdomain when a canonical domain already exists.

# Completion gate

A deployment is complete only when applicable checks pass:

- source/repository is correct,
- backend is reachable,
- frontend deployment succeeded,
- custom domain is attached,
- DNS points to the intended destination,
- HTTPS works,
- public app responds,
- no plaintext secret was emitted.

Report both runtime and route, for example:

- `hosted/composio/vercel`
- `local/managed/vercel`
- `local/vps/dokploy`
- `local/vps/hybrid`

# Proactive next-step behavior

After a successful milestone, offer **exactly one** high-value next action.

Pattern:

> Deployment is live. The next useful step is transactional email so password reset/invites work. I can configure Resend next. It needs a Resend account plus a verified sender domain. Want me to set that up?

Rules:

1. Explain the benefit.
2. State prerequisites before asking.
3. Ask a simple opt-in question.
4. Hosted runtime: use a secure connector/auth link when available; never ask for a raw key in chat.
5. Local runtime: use connector auth or `sc secret set ...` hidden-terminal handoff.
6. After completion, suggest only the next most relevant action.
7. Never recommend something already healthy.

Typical progression when relevant:

`deploy → transactional email → auth/account flows → observability → backups/recovery → CI/release hardening`

# Explicit routing

```bash
# Hosted chat/web: full Composio, no VPS branch
sc deploy plan --runtime hosted --composio

# Local: ask/detect VPS first
sc deploy plan --runtime local
sc deploy plan --runtime local --vps
sc deploy plan --runtime local --no-vps --composio

# Advanced explicit targets
sc deploy plan --runtime local --target dokploy
sc deploy plan --runtime local --target hybrid
sc deploy plan --runtime local --target vercel
```

Low-level skills remain available through `sc-dokploy`, `sc-convex`, `sc-convex-cloud`, and `sc-vercel`. `/sc-all` owns runtime/route orchestration; sub-skills own provider mechanics.

## Related references

- Provider routing: `../../references/provider-routing.md`
- Portable hosted/local behavior: `../../references/portable-skills.md`
- Secret/MCP boundary: `../sc-provider/SKILL.md`

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
