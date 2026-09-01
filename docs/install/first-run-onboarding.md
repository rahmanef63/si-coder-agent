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

`sc setup` uses hidden terminal entry for credentials. `sc doctor` verifies provider connectivity without printing credential values.

If a credential is missing, SI-Coder must show:

```text
Create at    : official provider URL
Instructions : minimum useful access/scopes
Save with    : sc secret set <provider> <KEY>
Stored in    : protected SC profile/local store
Continue     : sc doctor --providers <provider>
```

## Existing credentials

SI-Coder resolves local credentials in this order:

1. Active/path-mapped SC profile.
2. Current process environment.
3. Managed local shell block when no profile owns the key.

Profiles are preferred because they isolate credentials between projects/users.

## Never do this

- Do not ask for a raw token in chat.
- Do not pass a secret value through MCP/function JSON.
- Do not put a secret value in an argv flag.
- Do not print a secret after storing it.
- Do not make the user manually copy a secret between providers when a secure connector/server-side route can do it.
