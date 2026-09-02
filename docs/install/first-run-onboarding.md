# SI-Coder first-run onboarding

Installation and provider authorization are separate. Installing SI-Coder must never require copying provider secrets into chat.

## Hosted web surfaces

Examples: Claude Web and ChatGPT Web.

Default behavior:

- Do not ask whether the user has a VPS unless they explicitly request their own server.
- Use the hosted/managed route by default.
- Ask for a secure connected-account authorization only when a required provider is not connected.
- Never ask the user to paste a raw API key/token/password into chat.

The user-facing sequence should stay product-first:

```text
Describe the app → build/preview → connect an account only if blocked → publish → connect domain → verify
```

## Local surfaces

Examples: Claude Code, Codex CLI, Hermes, OpenClaw.

SI-Coder requires **Node.js 22, 24, or 26** for the current local release.

After installation:

```bash
sc setup
sc doctor
```

Fresh `sc setup` is **named-connection-first**:

```text
SI-Coder user
  → provider
  → named connection
  → hidden credential input
  → ~/.config/si-coder/connections/<user>/<provider>/<connection>.env (0600)
  → doctor
```

It does **not** write new provider secrets to `~/.bashrc`. If old profile-scoped provider values exist, setup can migrate them locally into the named connection without printing them.

In the Finder flow, `Esc` cancels the current credential/metadata input, writes nothing, and returns to the previous SC screen without exiting.

If a credential is missing, SI-Coder must show:

```text
Create at    : official provider URL / secure connector link
Instructions : minimum useful access/scopes
Connection   : user / provider / label / scope
Save with    : sc user credential-set <user> <provider> <KEY> --connection <alias>
Stored in    : named SC connection 0600 (or external connected account)
Continue     : sc user verify <user> <provider>
```

## GitHub direct auth

For local `source=sc` GitHub connections, SI-Coder uses **Personal access token (classic)** (`classic-pat`) only. Create it at `https://github.com/settings/tokens/new`, choose a limited expiration, and grant only the scopes the task requires.

The current doctor distinguishes:

- `repo` — private + public repository automation;
- `public_repo` — public repositories only;
- neither — token identity may be valid, but repository-write capability is insufficient;
- GitHub SAML SSO response — reported separately instead of being presented as a generic invalid token.

When `GH_OWNER` targets another organization/account, repository operations may still be gated by that organization's PAT policy or SAML SSO authorization. Fine-grained `github_pat_…` values are not accepted by the direct SC provider. GitHub through Composio remains a separate OAuth-backed source.

## Existing credentials and migration

The canonical local destination is the named connection store:

```text
~/.config/si-coder/connections.json                         metadata, 0600
~/.config/si-coder/connections/<user>/<provider>/<id>.env  direct source=sc values, 0600
```

Legacy locations remain readable only for compatibility/migration:

```text
~/.config/si-coder/profiles/<user>.env
managed ~/.bashrc block
current process environment
```

A resolved user's selected/default named connection outranks stale shell credentials for the same provider. Use:

```bash
sc user connection-migrate <user> [provider]
```

to move legacy profile values into named connections locally. Use `sc user duplicate <source> <target>` to copy an independent user + connection tree without exposing values.

The historical `node bin/onboard-legacy.js` / `scan-env --write-stdin` path is retained for old automation, but it is not the fresh-install recommendation.

## Capability truthfulness

`skills/catalog.json` is the lifecycle SSOT for local/default installation. Active skills are installed by default; unfinished or legacy skills remain in the repository without being presented as working capabilities. Cloudflare DNS is active. Dedicated Resend provisioning, Stripe, Clerk, and Supabase automation remain unfinished; their credential schemas may still be prepared/inspected explicitly through `sc-provider`.

For the full terminal navigation model, see [`../cli.md`](../cli.md).

## Never do this

- Do not ask for a raw token in chat.
- Do not pass a secret value through MCP/function JSON.
- Do not put a secret value in an argv flag.
- Do not print a secret after storing it.
- Do not default a fresh install back to global shell credential storage.
- Do not route a user-facing task to a stub skill and then fail with “not implemented”.
- Do not make the user manually copy a secret between providers when a secure connector/server-side route can do it.
