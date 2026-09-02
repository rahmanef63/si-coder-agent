# SI-Coder first-run onboarding

Installation and provider authorization are separate. Installing SI-Coder should never require copying provider secrets into chat.

## Hosted web surfaces

Examples: Claude Web and ChatGPT Web.

Default behavior:

- Do not ask whether the user has a VPS.
- Use the hosted/managed route unless the user explicitly requests their own server.
- Ask for a secure connected-account authorization only when a required provider is not connected.
- Never ask the user to paste a raw API key into chat.

The user-facing sequence should look like:

```text
Describe the app → answer at most a few product questions → preview/build → connect account if blocked → publish → connect domain → verify
```

## Local surfaces

Examples: Claude Code, Codex CLI, Hermes, OpenClaw.

After installation:

```bash
sc setup
sc doctor
```

`sc setup` uses hidden terminal entry for credentials. In the Finder flow, `Esc` cancels the current credential/metadata input and returns to the previous SC screen without saving or exiting. `sc doctor` verifies provider connectivity without printing credential values.

If a credential is missing, SI-Coder must show:

```text
Create at    : official provider URL
Instructions : minimum useful access/scopes
Save with    : sc user credential-set <user> <provider> <KEY> --connection <alias>
Stored in    : protected SC profile/local store
Continue     : sc doctor --providers <provider>
```

### GitHub direct auth

For local `source=sc` GitHub connections, SI-Coder uses **Personal access token (classic)** (`classic-pat`) only. Create it at `https://github.com/settings/tokens/new`, choose a limited expiration, and grant only the scopes the task requires (`repo` when private-repository automation is necessary). Fine-grained `github_pat_…` values are not accepted by the direct SC provider; GitHub through Composio remains a separate OAuth-backed source.

## Existing credentials

SI-Coder resolves local credentials in this order:

1. Active/path-mapped SC profile.
2. Current process environment.
3. Managed local shell block when no profile owns the key.

Local credential stores are user + connection scoped. The interactive hierarchy is `Users → <user> → Providers → <provider> → Connections → <label> → Credentials`. One user can keep multiple work/personal/project/deployment connections for the same provider without merging values. Connection metadata is stored in `connections.json`; direct values are stored in `connections/<user>/<provider>/<alias>.env` (0600). Legacy profile files remain a migration fallback. Use `sc user connection-migrate <user>` to move old profile values and `sc user duplicate <source> <target>` to copy the full independent user+connection structure.

For the full terminal navigation model, see [`../cli.md`](../cli.md).

## Never do this

- Do not ask for a raw token in chat.
- Do not pass a secret value through MCP/function JSON.
- Do not put a secret value in an argv flag.
- Do not print a secret after storing it.
- Do not make the user manually copy a secret between providers when a secure connector/server-side route can do it.
