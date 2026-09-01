---
name: sc-provider
description: "SI-Coder provider + secret control plane for humans and agents. CRUD custom provider metadata, inspect credential status without plaintext, hand secret creation/rotation to a hidden terminal, run consumers with injected profile env, audit lifecycle operations, and safely self-update sc. Use when an agent needs API/provider credentials without asking the user to paste secrets into chat."
---

# /sc-provider — provider + secret control plane

Use this whenever an agent needs to discover, configure, rotate, remove, or consume API/provider credentials.


## Non-technical default UX — mandatory

SI-Coder is primarily for people who want a working web app, not an infrastructure lesson. **Lead with the outcome, hide the plumbing.**

A valid user request can be as simple as:

> "Buatkan web app booking salon dan online-kan di domain saya."

From that sentence, the agent should normally choose the stack, database/data service, hosting route, repository strategy, deployment method, domain records, and verification approach itself.

Rules:

1. **Speak in goals:** "online-kan aplikasi", "hubungkan akun", "pasang domain", "simpan data". Do not lead with terms such as environment variable, DNS record, deploy key, compose, container, build pipeline, or provider routing.
2. **One user action at a time.** Never dump a setup checklist when only one permission/account connection blocks progress.
3. **Do not ask users to choose technology** unless they explicitly care. Choose sensible defaults and keep the technology name in optional technical details.
4. **Do not ask a question that tools/repo state can answer.** Inspect first, then ask only the unresolved product/domain/account decision.
5. **Credentials are framed as permissions, not secrets.** Say "Saya perlu izin untuk mengakses layanan email" first. Then show `Buat di`/`Hubungkan di`, `Simpan di`, and what SI-Coder will do next. Put env-key names and terminal commands under optional technical details unless the user must run the command.
6. **Never ask the user to copy values between services** when a connector/server-side flow can do it safely.
7. **Progress is product-oriented:** `Membuat aplikasi → Menyiapkan data → Online-kan → Memasang domain → Mengecek hasil`, not internal provider phases.
8. Every completion message must state what is now working and then offer exactly one `[rekomendasi]` next step.
9. Technical users can ask for "detail teknis", `--technical`, JSON, or provider-specific skills. Do not force those details on everyone else.

When a technical failure occurs, translate it first:

- preferred: "Domain belum terhubung. Saya sedang memperbaiki arah domain ke website."
- optional detail: "CNAME belum sesuai dengan target hosting."

Never hide a failure, but explain its user impact before its implementation detail.


## Non-negotiable secret boundary

**Never ask the user to paste an API key/token/password into chat or tool JSON. Never put a secret value in argv.**

The agent may handle provider **metadata** and credential **status**, but not plaintext values. For a new or rotated secret, hand the user a terminal command such as:

```bash
sc secret set resend RESEND_API_KEY
```

`sc` reads secret keys in hidden TTY mode. Non-interactive trusted local flows may use `--stdin`, `--from-env NAME`, or `--from-file PATH`; the value is never echoed by `sc`.

To consume credentials, run the actual tool under the resolved profile:

```bash
sc run -- <command> [args...]
```

This injects the profile environment into the child without printing secret values.

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

Deleting a custom provider/key also purges the corresponding managed values from all si-coder profiles and the managed `~/.bashrc` block so an orphaned credential does not escape profile isolation. User-owned exports outside the managed block are reported and left untouched.

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

## Profiles are the vault boundary

Preferred storage is `~/.config/si-coder/profiles/<name>.env` mode 0600. Profiles override stale shell values and strip registry credentials that the profile does not own.

```bash
sc user add personal --from-shell
sc user map ~/projects/personal personal
sc user which
```

For backward compatibility, machines with no profile still use the managed `~/.bashrc` block.

## Agent / MSO function surface

The repository exposes `.mso/functions.json` functions for safe agent operations:

- `sc.providers.list`
- `sc.provider.create`, `sc.provider.update`, `sc.provider.delete`
- `sc.provider.key-add`, `sc.provider.key-remove`
- `sc.secrets.status`
- `sc.secret.request` — returns the hidden-terminal handoff, not a secret field
- `sc.secret.delete`
- `sc.deploy.plan` — returns VPS/managed route + provider backends, no values
- `sc.doctor`
- `sc.update.check`, `sc.update`
- `sc.version`, `sc.verify`

There is intentionally **no** `sc.secret.set` MCP/function tool accepting a value. A secret value in function input would put it back into the agent/chat boundary this design is meant to avoid.

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
