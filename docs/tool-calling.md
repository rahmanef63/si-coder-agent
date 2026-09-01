# SI-Coder tool calling

SI-Coder exposes one secret-safe machine surface for local AI agents. MSO and MCP clients use the same schemas from `.mso/functions.json`; `scripts/sc-agent.js` is the execution adapter and `scripts/sc-mcp.js` exposes those functions over MCP stdio.

## Identity model

Agent operations are user-first, matching the Finder CLI:

```text
Users
└─ <user>
   └─ Providers
      └─ <provider>
         └─ Credentials
            └─ <KEY>
```

Prefer explicit user-scoped tools instead of relying on the caller's current directory.

Core read tools:

- `sc.user.list`
- `sc.user.show`
- `sc.user.which`
- `sc.user.providers.list`
- `sc.user.credentials.status`
- `sc.user.credential.status`
- `sc.user.provider.verify`

User mutations require explicit confirmation where they can change identity/routing or copy/delete credentials:

- `sc.user.create`
- `sc.user.duplicate`
- `sc.user.rename`
- `sc.user.default`
- `sc.user.map`
- `sc.user.unmap`
- `sc.user.delete`
- `sc.user.credential.delete`

## Creating or rotating a credential

There is deliberately no MCP tool that accepts an API key/token/password value.

Use:

```text
sc.user.credential.request
```

It returns the explicit user/provider/key status, official provider URL when known, and a user-specific hidden-terminal command such as:

```bash
sc user credential-set rahmanfakh github GITHUB_TOKEN
```

The secret must be entered only into the hidden local terminal prompt or an explicitly connected secure credential action. Never put it in chat, MCP JSON, CLI argv, logs, or generated documentation.

## MSO

MSO reads `.mso/functions.json` directly. No second manifest is maintained.

## MCP server

Run the bundled stdio server:

```bash
node /path/to/si-coder-agent/scripts/sc-mcp.js
```

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

`tools/list` is generated from `.mso/functions.json`, so MCP and MSO cannot drift on tool names or input schemas.

## Claude Code

Plugin mode loads the repository `.mcp.json`. For standalone installation:

```bash
claude mcp add --scope user si-coder -- node /path/to/si-coder-agent/scripts/sc-mcp.js
```

## Codex

```bash
codex mcp add si-coder -- node /path/to/si-coder-agent/scripts/sc-mcp.js
```

Or install Skills + MCP together:

```bash
bash install.sh --agent codex --with-mcp
```

## Hermes

Hermes provides native MCP management:

```bash
hermes mcp add si-coder \
  --command node \
  --args /path/to/si-coder-agent/scripts/sc-mcp.js
```

Or:

```bash
bash install.sh --agent hermes --with-mcp
```

## OpenClaw

OpenClaw provides native `mcp.servers` management:

```bash
openclaw mcp add si-coder \
  --command node \
  --cwd /path/to/si-coder-agent \
  --arg /path/to/si-coder-agent/scripts/sc-mcp.js
```

Or:

```bash
bash install.sh --agent openclaw --with-mcp
```

## Safety contract

- Machine schemas do not contain plaintext-secret input fields.
- Secret-shaped field names are rejected recursively by the adapter as defense in depth.
- Reads return status, provider/key names, ownership, routing, and setup guidance only.
- Credential duplication happens locally between private stores and never returns copied values.
- Credential creation/rotation is a secure handoff, not a JSON write operation.
- Delete/default/map/rename/duplicate operations require explicit confirmation on the machine surface.

## Credential acquisition metadata

`sc.user.credential.request` returns `referenceUrl`, `createCommand`, `navigation[]`, and `navigationText` before the hidden-terminal handoff. These fields come from `lib/providers.js`; agents should present them instead of inventing provider dashboard directions.
