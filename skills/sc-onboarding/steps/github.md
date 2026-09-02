# GitHub connections

GitHub can be connected through two distinct backends. Composio is a connection backend, not a GitHub auth method.

## Option A — SI-Coder direct

SC direct GitHub uses **Personal access token (classic)** only.

```bash
sc user connection-add <user> github "Default GitHub" --source sc --auth classic-pat --default
```

Credential field: `GITHUB_TOKEN`

Create it here:

https://github.com/settings/tokens/new

GitHub navigation:

1. Settings
2. Developer settings
3. Personal access tokens
4. Tokens (classic)
5. Generate new token → Generate new token (classic)
6. Set a descriptive note and a limited expiration
7. Enable only the scopes SC needs; use `repo` when SC must automate private repositories
8. Generate token and copy it once

Store it through hidden local input:

```bash
sc user credential-set <user> github GITHUB_TOKEN --connection default-github
```

SC accepts the `ghp_…` PAT-classic format for direct GitHub. Fine-grained `github_pat_…` tokens are not accepted by the direct SC provider. Credential values are never stored in connection metadata or returned through machine tools.

`GH_OWNER` is optional public account metadata for direct GitHub routing when needed.

## Option B — Composio Connected Account

```bash
sc user connection-add <user> github "Work GitHub" --source composio --auth oauth2
sc user connection-authorize <user> github work-github
```

This requires a separate user-owned `composio` provider connection using a Composio **project API key**. SI-Coder creates a Composio Connect Link, returns the transient authorization URL, and stores only safe external references such as `connectedAccountId`, `authConfigId`, alias, toolkit, broker connection, and last-known status.

GitHub OAuth access/refresh tokens remain in Composio. SI-Coder does not create a local GitHub `.env` file for this connection and discards Composio `link_token`/credential state.

Refresh safe lifecycle status with:

```bash
sc user connection-sync <user> github work-github
```

When several GitHub connections exist, agents must select the intended SI-Coder connection and then use the returned Composio `connectedAccountId`/alias explicitly for Composio execution.

## SSH push is separate

If a direct workflow pushes using `git@github.com:...`, SSH authentication is independent of PAT/OAuth. Ensure `ssh -T git@github.com` succeeds and manage SSH keys through GitHub's SSH-key settings.
