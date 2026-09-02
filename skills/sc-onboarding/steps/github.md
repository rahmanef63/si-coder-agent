# GitHub connections

GitHub can be connected through two distinct backends. Do not treat Composio as a GitHub auth method.

## Option A — SI-Coder direct

```bash
sc user connection-add <user> github "Default GitHub" --source sc --auth fine-grained-pat --default
```

Preferred when SI-Coder/local execution needs deterministic direct repository access.

### Fine-grained PAT — recommended when sufficient

Credential field: `GITHUB_TOKEN`

Create at:
https://github.com/settings/personal-access-tokens/new

Choose the resource owner, only the repositories SI-Coder needs, and the minimum repository permissions required for the operation. Copy the token once, then enter it through hidden local input:

```bash
sc user credential-set <user> github GITHUB_TOKEN --connection default-github
```

### Classic PAT — compatibility / broad repository automation

```bash
sc user connection-add <user> github "Compatibility GitHub" --source sc --auth classic-pat
```

Create at:
https://github.com/settings/tokens/new

Use the `repo` scope only when the task genuinely requires broad repository automation. Copy the token once and store it through the same hidden `credential-set` flow.

`GITHUB_TOKEN` validation accepts current `github_pat_…` fine-grained tokens and `ghp_…` classic tokens. SI-Coder metadata never stores the token value.

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
