# SI-Coder tool calling

SI-Coder exposes one secret-safe machine surface for local AI agents. Machine clients use the schemas from `machine/functions.json`; `scripts/sc-agent.js` executes them and `scripts/sc-mcp.js` exposes them over MCP stdio.

## Agent workflow tools

The standalone agent workflow adds bounded task/memory/evidence/recipe/skill surfaces:

- `sc.task.risk` — classify change risk.
- `sc.task.prepare` — skip memory for LOW risk; retrieve compact relevant memory/recipes for MEDIUM/HIGH risk.
- `sc.memory.query` / `sc.memory.record` / `sc.memory.status` — repo-local memory retrieval and lifecycle.
- `sc.evidence.record` — structured secret-safe verification receipt.
- `sc.recipe.list` / `observe` / `verify` / `promote` — repeated-work promotion.
- `sc.skill.verify` — skill quality/trigger/security validation.
- `sc.verify` — repository verification with compact evidence/test-memory recording.

The recursive secret-shaped input guard runs before dispatch, so adding nested JSON does not create a credential transport path.

## Identity model

The machine model matches the Finder:

```text
User
└─ Provider
   └─ Connection (unique alias/label)
      └─ Credential fields
```

One user may own several connections for the same provider. Agents must keep the connection identity explicit whenever more than one account/project/deployment exists.

## Core tools

Read/routing:

- `sc.user.list`
- `sc.user.show`
- `sc.user.which`
- `sc.user.providers.list`
- `sc.user.connections.list`
- `sc.user.credentials.status`
- `sc.user.credential.status`
- `sc.user.provider.verify`

Connection lifecycle:

- `sc.user.connection.manage`
  - `create`
  - `set-default`
  - `rename`
  - `delete`
  - `migrate-legacy`
- `sc.user.connection.request`

User lifecycle:

- `sc.user.create`
- `sc.user.duplicate`
- `sc.user.rename`
- `sc.user.default`
- `sc.user.map`
- `sc.user.unmap`
- `sc.user.delete`

Credential deletion:

- `sc.user.credential.delete`

Mutations that can change ownership/routing/copy/delete require explicit `confirm: true` where the schema requires it.

## Creating a connection

First inspect the provider's current auth choices:

```text
sc.user.connection.request
{
  user: "rahmanfakhr",
  provider: "convex-cloud"
}
```

For Convex Cloud this returns separate methods such as:

```text
personal-access-token  BEARER_TOKEN  account
  → CONVEX_PERSONAL_ACCESS_TOKEN

deployment-key        API_KEY       deployment
  → CONVEX_DEPLOYMENT_NAME
  → CONVEX_DEPLOY_KEY
```

Then create a named connection with `sc.user.connection.manage`.

For GitHub with `source=sc`, the same request now returns one direct auth method only:

```text
classic-pat  BEARER_TOKEN  account
  → GITHUB_TOKEN
  → referenceUrl: https://github.com/settings/tokens/new
```

This is metadata/handoff only. The machine schema does not change and never accepts the PAT value; `sc.user.credential.request` sends the human to hidden local input. GitHub `source=composio` remains a separate OAuth-backed connection path.

## OAuth / externally managed authorization

If a connection has `source=composio` or `source=native-mcp`, SI-Coder stores only safe routing/lifecycle metadata. It must **not** request/copy OAuth access or refresh tokens into SC.

For a Composio-backed connection, `sc.user.connection.request` returns an `externalConnectionAction` with toolkit, alias, connected-account/auth-config references, status, and the `composio-connect-link` strategy. The intended pattern is:

```text
user + provider + connection(source=composio)
→ create/reuse the appropriate Composio Auth Config
→ POST /api/v3.1/connected_accounts/link
→ show the transient redirect URL to the human
→ persist only connected_account_id/auth_config_id/alias/status
→ wait/poll for ACTIVE
→ explicitly select that connected account/alias for execution
```

The Connect Link `link_token` and provider credential state are never persisted by SI-Coder. Multi-account execution must select the returned `connectedAccountId`/alias explicitly.

References: `research/composio-auth-matrix.md`.

## Creating or rotating a direct credential

There is deliberately no MCP tool that accepts an API key/token/password value.

Use:

```text
sc.user.credential.request
{
  user: "rahmanfakhr",
  provider: "convex-cloud",
  connection: "client-a-production",
  key: "CONVEX_DEPLOY_KEY"
}
```

The response contains only safe metadata:

- connection identity/label/scope,
- current state,
- official `referenceUrl` or local `createCommand`,
- `navigation[]` and `navigationText`,
- the hidden-terminal command.

Example handoff:

```bash
sc user credential-set rahmanfakhr convex-cloud CONVEX_DEPLOY_KEY \
  --connection client-a-production
```

The value is entered only in the hidden local terminal prompt or an explicitly connected secure credential action.

## Explicit account selection during execution

For local child processes SI-Coder supports one-shot account selection without changing stored defaults:

```bash
sc run --connection github=work,convex-cloud=client-a-production -- <command>
```

This is only for `source=sc`, where SI-Coder owns the local credential set. For `source=composio`, resolve the selected connection and execute directly with its `connectedAccountId`/alias; for `source=native-mcp`, use the provider-owned MCP session. `sc run` refuses external sources so a stale local token cannot silently replace the selected external identity.

## Standalone machine contract

`machine/functions.json` is SI-Coder's own machine-function SSOT. The bundled MCP adapter reads it directly, so no separate orchestrator or host-specific function manifest is required.

## MCP server

```bash
node /path/to/si-coder-agent/scripts/sc-mcp.js
```

### Protocol compatibility

The stdio adapter is dual-era while the tool schema remains one SSOT:

- **MCP 2026-07-28**: supports `server/discover` and stateless requests carrying `params._meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"`. Modern responses include `_meta["io.modelcontextprotocol/serverInfo"]`. No initialize handshake is required.
  Every modern result is wire-stamped with `resultType: "complete"` unless a future flow returns another discriminator. Cacheable list results emit conservative `ttlMs: 0` + `cacheScope: "private"` by default; discovery can advertise its own cache hint.
- **MCP 2025-11-25**: keeps the legacy `initialize` / `notifications/initialized` path for clients that have not migrated yet.

A modern stdio client may probe `server/discover`; an older client can continue directly with `initialize`. This follows the MCP hybrid migration model without duplicating `machine/functions.json`. See `https://modelcontextprotocol.io/specification/2026-07-28/server/discover`.

Generic MCP configuration:

```json
{
  "mcpServers": {
    "si-coder": {
      "command": "node",
      "args": ["/path/to/si-coder-agent/scripts/sc-mcp.js"],
      "cwd": "/path/to/si-coder-agent"
    }
  }
}
```

`tools/list` is generated from `machine/functions.json`, so MCP and machine clients share tool names/input schemas.

## Claude Code

```bash
claude mcp add --scope user si-coder -- node /path/to/si-coder-agent/scripts/sc-mcp.js
```

## Codex

```bash
codex mcp add si-coder -- node /path/to/si-coder-agent/scripts/sc-mcp.js
```

or:

```bash
bash install.sh --agent codex --with-mcp
```

## Hermes

```bash
hermes mcp add si-coder \
  --command node \
  --args /path/to/si-coder-agent/scripts/sc-mcp.js
```

or:

```bash
bash install.sh --agent hermes --with-mcp
```

## OpenClaw

```bash
openclaw mcp add si-coder \
  --command node \
  --cwd /path/to/si-coder-agent \
  --arg /path/to/si-coder-agent/scripts/sc-mcp.js
```

or:

```bash
bash install.sh --agent openclaw --with-mcp
```

## Safety contract

- Machine schemas contain no plaintext-secret input field.
- The adapter rejects secret-shaped nested inputs as defense in depth.
- Reads return identities, aliases, scopes, auth methods, states and setup guidance only.
- Duplicating a user copies private connection stores locally and never returns values.
- Credential creation/rotation is a secure handoff, not a JSON write.
- OAuth/external authorization stays in the external connected-account system.
- Connection aliases are unique per user+provider to prevent ambiguous selection.

## Portable integration data

`sc.data.export` writes metadata-only JSON to a new file after explicit confirmation.
`sc.data.import` previews that file and requires `apply`, `confirm`, and the returned
`planId` to create users/connections. Both call the same core as the browser/CLI.
Encrypted bundles and passphrases are deliberately unavailable to machine calls.
See [Data portability](DATA-PORTABILITY.md) for the versioned contract.
