---
name: sc-provider
description: "SI-Coder provider + secret control plane for humans and agents. CRUD custom provider metadata, inspect credential status without plaintext, hand secret creation/rotation to a hidden terminal, run consumers with injected profile env, audit lifecycle operations, and safely self-update sc. Use when an agent needs API/provider credentials without asking the user to paste secrets into chat."
---

# /sc-provider — provider + secret control plane

Use this whenever an agent needs to discover, configure, rotate, remove, or consume API/provider credentials.

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
