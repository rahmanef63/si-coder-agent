---
name: sc-provider
description: "SI-Coder provider + connection control plane for humans and agents. Manage user-scoped labeled provider connections, auth methods/scopes, custom provider metadata, secret-safe credential status/handoffs, injected execution, audits, and safe updates without putting provider secrets in chat/tool JSON."
use_when: "Use when the task matches this skill scope: SI-Coder provider + connection control plane for humans and agents. Manage user-scoped labeled provider connections, auth methods/scopes, custom provider metadata, secret-safe credential status/handoffs, injected execution, audits, and safe updates without putting provider secrets in chat/tool JSON."
do_not_use_when: "Do not use when the task is outside this skill scope or a more specific SI-Coder skill owns the requested outcome."
required_tools: []
security_constraints: "Never request, print, or persist plaintext credentials in chat/tool payloads; use SI-Coder safe credential handoffs."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# /sc-provider — provider + secret control plane

## Language

Keep durable instructions in English. **Reply in the user's language** unless they request another language.

Use this whenever an agent needs to discover, configure, rotate, remove, or consume API/provider credentials.


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

When a technical failure occurs, translate it first:

- preferred: "The domain is not connected yet. I am fixing the connection between the domain and the website."
- optional detail: "The CNAME does not match the hosting target yet."

Never hide a failure, but explain its user impact before its implementation detail.


## Non-negotiable secret boundary

**Never ask the user to paste an API key/token/password into chat or tool JSON. Never put a secret value in argv.**

The agent may handle provider/connection **metadata** and credential **status**, but not plaintext values. First resolve the user + labeled connection. For a new or rotated direct secret, hand the user a connection-specific terminal command such as:

```bash
sc user credential-set personal resend RESEND_API_KEY --connection transactional-email
```

`sc` reads secret keys in hidden TTY mode. Non-interactive trusted local flows may use `--stdin`, `--from-env NAME`, or `--from-file PATH`; the value is never echoed by `sc`.

To consume credentials, run the actual tool under the resolved profile:

```bash
sc run -- <command> [args...]
```

This injects only resolved `source=sc` credential sets into the child without printing secret values. `sc run` deliberately refuses `source=composio` / `source=native-mcp`; resolve those connections in SI-Coder, then execute through the returned Connected Account or provider-owned MCP session.

## SC + Composio hybrid routing

SC is the local secret/control-plane boundary. Composio is a connected-account boundary for providers that benefit from managed tool execution. Read `../../references/provider-routing.md` before choosing a backend.

Runtime policy:

- **Hosted Claude Web/ChatGPT-style agent** → full Composio for GitHub, Convex Cloud, Vercel, and Hostinger. No local SC vault is required.
- **Local + no VPS** → GitHub in SC; Vercel/Convex/Hostinger prefer Composio and may fall back to SC.
- **Local + VPS** → GitHub/Dokploy/self-hosted Convex in SC; Hostinger may use Composio or SC.
- Composio project key itself belongs in SC only when a local runtime needs API-key access. A hosted native connector should use its own connection flow.

When using Composio, ask for a secure connection link, never the underlying provider secret. Hosted mode must not fall back to asking for a raw key in chat.

## Provider CRUD

Built-in provider definitions are code-reviewed and immutable. Custom provider definitions live at `~/.config/si-coder/providers.json` (0600) and contain metadata only.

```bash
sc providers --json
sc providers create openai --title OpenAI --key OPENAI_API_KEY --prefix sk- --min-length 20
sc providers update openai --blurb "OpenAI project API"
sc providers key-add openai OPENAI_ORG_ID --public --note "optional org id"
sc providers key-rm openai OPENAI_ORG_ID --yes
sc providers delete openai --yes
```

Deleting a custom provider/key also purges corresponding managed values from legacy profiles, named connection stores, and the managed `~/.bashrc` block. User-owned exports outside the managed block are reported and left untouched.


## Credential source guidance — one SSOT

Every built-in credential field declares its acquisition metadata in `lib/providers.js`:

- `url` — official/reference dashboard or credential endpoint when one exists,
- `cmd` — safe local command when the value is generated/discovered locally,
- `navigation[]` — the exact menu/click path to reach or create it,
- `note` — scope/permission caveats.

`lib/credential-guidance.js` renders that same metadata in the Finder `PREVIEW`, hidden-input CLI flow, onboarding, and `sc.user.credential.request`. Agents should surface `referenceUrl` + `navigation` before asking the user to enter anything locally. Do not invent a dashboard path when the registry already provides one.

## Named connections are the credential boundary

The user-first hierarchy is now:

```text
User → Provider → Connection(alias) → Credential fields
```

One user may own several isolated connections for the same provider (work/personal GitHub, multiple Convex deployments, multiple Vercel teams, client accounts, etc.). Each connection has a unique label/alias within that user+provider, one **source/backend**, one auth method, and one scope. Only `source=sc` has a private `0600` env file; external sources keep provider credentials outside SI-Coder.

```bash
sc user connections <user> [provider]
sc user connection-add <user> <provider> "<label>" --source <sc|composio|native-mcp> --auth <method> [--default]
sc user connection-use <user> <provider> <connection>
sc user connection-label <user> <provider> <connection> "<new label>"
sc user connection-rm <user> <provider> <connection>
sc user connection-migrate <user> [provider]
```

The provider's `sources` metadata selects the backend first; direct `auth[]` then defines local auth methods. External source metadata supplies its own auth schemes. Do not put Composio back into direct `auth[]`. GitHub `source=sc` intentionally exposes only `classic-pat` and validates `ghp_…`; GitHub `source=composio` remains OAuth-backed.

OAuth/external connections must not copy provider access/refresh tokens into SI-Coder. Store only safe external ids/alias/scope/status and authorize Composio-backed connections through `connected_accounts/link`. Never persist `link_token`, redirect URL, or Connected Account credential state.

Direct credential values live under:

```text
~/.config/si-coder/connections/<user>/<provider>/<connection>.env
```

Legacy `profiles/<user>.env` remains a compatibility/migration source only. A selected named connection atomically overrides the legacy provider fields so credentials from two accounts cannot be merged accidentally.

For one command, select a non-default **direct (`source=sc`)** connection without changing the user's stored default:

```bash
sc run --connection github=work,convex-cloud=client-a-production -- <command>
```

Never pass a Composio/native-MCP connection to `sc run`; resolve it, then use the external backend explicitly.

## Credential CRUD

`Read` deliberately means status/source/metadata — **plaintext retrieval is disabled**.

```bash
sc secret list [provider] [--json]
sc secret get <provider> [ENV_KEY] [--json]
sc secret set <provider> [ENV_KEY]
sc secret rm <provider> [ENV_KEY] --yes
```

`sc secret set <provider>` without a key uses the interactive provider form. With one key it can use:

```bash
sc secret set <provider> <KEY> --stdin
sc secret set <provider> <KEY> --from-env EXISTING_ENV_NAME
sc secret set <provider> <KEY> --from-file /local/secret/file
```

Do not construct a command containing the secret itself.

## Users, folders, and default connections

A folder resolves to one SI-Coder user through `sc.md`. Inside that user, each provider resolves to one default named connection unless the caller explicitly selects another alias.

```bash
sc user add personal
sc user map ~/projects/personal personal
sc user which
sc user connections personal
```

This gives two independent isolation levels:

1. **folder → user**, so another user's provider data is stripped;
2. **user + provider → connection**, so work/personal/project credentials for the same provider are not merged.

For backward compatibility, machines may still contain legacy profile or managed-shell values. Use `sc user connection-migrate <user>` to move recognized legacy values into named connections without printing them.

## Agent / MCP function surface

`machine/functions.json` is the machine-tool SSOT. `scripts/sc-mcp.js` reads it directly and exposes the same functions to Claude Code, Codex, Hermes, OpenClaw, or another MCP client.

Prefer explicit user/connection tools:

- `sc.user.list`, `sc.user.show`, `sc.user.which`
- `sc.user.create`, `sc.user.duplicate`, `sc.user.rename`, `sc.user.delete`
- `sc.user.default`, `sc.user.map`, `sc.user.unmap`
- `sc.user.providers.list`, `sc.user.provider.verify`
- `sc.user.connections.list`
- `sc.user.connection.manage`
- `sc.user.connection.request`
- `sc.user.credentials.status`, `sc.user.credential.status`
- `sc.user.credential.request`
- `sc.user.credential.delete`

The legacy cwd-dependent `sc secret ...` commands remain CLI compatibility paths, but they are intentionally not the primary MCP contract.

There is no machine tool that accepts a raw provider key/token/password. Direct credential creation/rotation uses `sc.user.credential.request`, then hidden local terminal input. External/OAuth auth uses `sc.user.connection.request` and the secure external authorization flow.

See `docs/tool-calling.md` and `docs/research/composio-auth-matrix.md`.

## Self-update

```bash
sc update --check
sc update
```

`sc update` only performs a Git fast-forward. It refuses dirty, ahead, diverged, and detached checkouts; it never resets, stashes, rebases, or discards local changes.

## Audit

```bash
sc audit --limit 50
sc audit --json
```

The audit log is metadata-only (`~/.config/si-coder/audit.jsonl`, 0600): action, provider/key names, profile/store and input source. Credential values are not accepted by the audit module.

## Mandatory credential + next-step response contract

Whenever a credential/API key is missing, **never output only the variable name**. Always make the handoff explicit:

```text
Buat di      : <authoritative provider URL / secure connector auth link>
Petunjuk     : <minimum scope / exact menu when useful>
Connection  : <user/provider/label + scope>
Save with   : <sc user credential-set user provider KEY --connection alias, or secure provider connector>
Stored in   : <named SC connection 0600, or external connected account>
Lanjut       : <verification/resume action>
```

Rules:
- Local SC runtime: resolve/create a labeled connection first, then use the provider endpoint from the registry and `sc user credential-set <user> <provider> <KEY> --connection <alias>`; it lands only in that connection's 0600 file. Legacy profile/shell storage is compatibility-only.
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
