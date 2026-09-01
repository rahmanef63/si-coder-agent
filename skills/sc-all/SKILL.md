---
name: sc-all
description: "Turn a plain-language web-app goal into a working live app. Designed for non-technical users: choose architecture and hosting automatically, connect accounts safely, create/publish code, data, domain and verification end-to-end, and expose technical details only when needed or requested."
---

# /sc-all — runtime first, then deployment route

## Language

Keep durable instructions in English. **Reply in the user's language** unless they request another language.

Use this when the user says **build me a web app**, **create a website**, **put this app online**, **use my domain**, or describes a product they want built and published.

The user should describe the goal, not the infrastructure. SI-Coder owns the routing.


## Non-technical default UX — mandatory

SI-Coder is primarily for people who want a working web app, not an infrastructure lesson. **Lead with the outcome, hide the plumbing.**

A valid user request can be as simple as:

> "Create a salon booking app and put it on my domain."

From that sentence, the agent should normally choose the stack, database/data service, hosting route, repository strategy, deployment method, domain records, and verification approach itself.

Rules:

1. **Speak in goals:** "publish the app", "connect the account", "connect the domain", "store the app data". Do not lead with terms such as environment variable, DNS record, deploy key, compose, container, build pipeline, or provider routing.
2. **One user action at a time.** Never dump a setup checklist when only one permission/account connection blocks progress.
3. **Do not ask users to choose technology** unless they explicitly care. Choose sensible defaults and keep the technology name in optional technical details.
4. **Do not ask a question that tools/repo state can answer.** Inspect first, then ask only the unresolved product/domain/account decision.
5. **Credentials are framed as permissions, not secrets.** Say "I need permission to use the email service" first. Then show the official create/connect action, where access is stored, and what SI-Coder will do next. Put env-key names and terminal commands under optional technical details unless the user must run the command.
6. **Never ask the user to copy values between services** when a connector/server-side flow can do it safely.
7. **Progress is product-oriented:** `Build the app → Prepare data → Publish → Connect domain → Verify`, not internal provider phases.
8. Every completion message must state what is now working and then offer exactly one `[rekomendasi]` next step.
9. Technical users can ask for "technical details", `--technical`, JSON, or provider-specific skills. Do not force those details on everyone else.
10. When a planner/tool returns `userPlan`, **that is the default user-facing response**. Fields such as route, providerRouting, executionEngine, credential key names, and raw flow ids are internal/advanced unless they are necessary to recover from an error.

When a technical failure occurs, translate it first:

- preferred: "The domain is not connected yet. I am fixing the connection between the domain and the website."
- optional detail: "The CNAME does not match the hosting target yet."

Never hide a failure, but explain its user impact before its implementation detail.


## Core promise

One request drives the complete path. The following route vocabulary is **internal/advanced**; do not repeat it to a non-technical user unless needed:

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
Save with   : <sc secret set provider KEY, or provider connector>
Stored in   : <SC profile 0600, or Composio connected account>
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
Next        : <one highest-value next step>
Why         : <one sentence>
Needs       : <prerequisites, or "nothing from you yet">
If you want : <what SI-Coder will do next / secure auth handoff>
```

Do not dump multiple recommendations. Do not recommend something already configured and healthy.
