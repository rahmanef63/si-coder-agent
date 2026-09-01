# SI-Coder CLI

Run `sc` in a terminal to open the Finder-style interactive console. It owns one alternate-screen frame: moving, filtering, and changing layers repaint that same frame instead of appending lines to terminal scrollback.

The identity model is **user-first**. A user owns an isolated credential store, and every provider/credential is managed underneath that user.

## Navigation

```text
↑ / ↓       move selection
Tab / →     enter the selected deeper layer
Enter       open a layer or run/submit an action
← / Esc     go back one layer
Ctrl-D      quit the interactive console
```

At Home, `Esc` does not close SI-Coder. Use **Quit** or `Ctrl-D`.

### Stable Finder grid

On wide terminals SI-Coder reserves **four fixed-width column slots**. Before a fourth layer exists, the unused slot stays blank instead of stretching the existing columns. Opening a deeper layer fills that slot; after four layers, the oldest visible column slides out and the newest layer slides in. Medium terminals use the same model with three slots, and narrow terminals use two.

The footer is fixed-height as well: `PREVIEW` shows the highlighted item, while `RESULT` temporarily replaces it after an action. This keeps the body height stable and prevents provider navigation from jumping or pushing the header out of the terminal viewport.

## Finder hierarchy

```text
SECTIONS   [ Users ]   Build   Providers   System
PATH       SI-Coder › Users › rahmanfakhr › Providers › convex-cloud › Connections › Project A

Users                 │ rahmanfakhr            │ Providers               │ convex-cloud
❯ › rahmanef          │ ❯ › Providers          │   › github              │ ❯ › Connections
  › rahmanfakhr       │   · Credential overview│ ❯ › convex-cloud        │   › Add connection
  › rahmnf            │   · Set as default     │   › hostinger           │   · Provider details
  · Add user          │   · Duplicate user     │   › vercel              │   · Verify default connection
```

Deeper layers slide the oldest column out while preserving the four-column grid:

```text
Providers → convex-cloud → Connections → Project A
                                       → Admin
```

Credentials are intentionally **not** edited from a global Accounts screen. Select a user, provider, and named connection first so ownership and scope are always visible in `PATH`.

The bottom panel is selection-driven:

- `PREVIEW` always describes the highlighted user/provider/connection/credential.
- `RESULT` is temporary action output and disappears after navigation.

## User → provider → connection model

The product model is:

```text
User
└─ Provider
   ├─ Connection: Work GitHub
   ├─ Connection: Personal GitHub
   └─ Connection: Client A Production
      └─ credential fields
```

A connection has a **label**, immutable internal id/alias, auth method, scope, default flag, and its own isolated secret file. Labels must be unique within one user+provider.

```text
~/.config/si-coder/connections.json                         # non-secret metadata, 0600
~/.config/si-coder/connections/<user>/<provider>/<id>.env  # one connection's values, 0600
~/.config/si-coder/profiles/<user>.env                     # legacy compatibility store
~/.config/si-coder/profile-meta.json                       # user metadata
~/.config/si-coder/sc.md                                   # default user + folder → user rules
```

Only the selected/default connection for each provider is injected into a child process. Fields from two different provider connections are never merged together. Registry credentials not owned by the selected user/connection are stripped from the child environment.

### Connection CRUD

```bash
sc user connections rahmanfakhr convex-cloud

sc user connection-add rahmanfakhr convex-cloud "Convex Admin" \
  --auth personal-access-token --default

sc user connection-add rahmanfakhr convex-cloud "Client A Production" \
  --auth deployment-key

sc user connection-use rahmanfakhr convex-cloud client-a-production
sc user connection-label rahmanfakhr convex-cloud client-a-production "Client A Prod"
sc user connection-rm rahmanfakhr convex-cloud client-a-production
```

Use `sc user connection-migrate <user> [provider]` to move legacy profile values into named connections locally. Migration does not print the values.

### One-shot explicit connection selection

The stored default does not have to change for one operation:

```bash
sc run --connection github=work,convex-cloud=client-a-production -- <command>
```

This mirrors explicit account selection in multi-account agent systems: the override is used only for that child process.

## Duplicate and rename users

Duplicate all credentials into a new independent user:

```bash
sc user duplicate rahmanef rahmanfakh
```

If the destination already exists but is completely empty, opt in explicitly:

```bash
sc user duplicate rahmanef rahmanfakh --replace-empty
```

After duplication, rotating a credential in `rahmanfakh` does **not** modify `rahmanef`.

Rename a user:

```bash
sc user rename rahmanfakh rahmanfakhr
```

Rename migrates the default-user reference and folder mappings automatically. It refuses to overwrite an existing destination user.

## Import legacy credentials

Older SI-Coder installations may still have credentials in the shell rather than inside a user store. Import only recognized provider credentials with:

```bash
sc user import rahmanef --yes
```

Import is non-destructive by default: existing credentials already stored in the user win. Use `--overwrite` only when intentionally replacing them.

## Credential CRUD per connection

Read/list status; values are never printed:

```bash
sc user credentials rahmanfakhr convex-cloud
sc user credentials rahmanfakhr convex-cloud --connection client-a-production
sc user credential-status rahmanfakhr convex-cloud CONVEX_DEPLOY_KEY --connection client-a-production
```

Create or update one field:

```bash
sc user credential-set rahmanfakhr convex-cloud CONVEX_DEPLOYMENT_NAME --connection client-a-production
sc user credential-set rahmanfakhr convex-cloud CONVEX_DEPLOY_KEY --connection client-a-production
```

On a TTY secret input is hidden. Scripted trusted-local use may use stdin/env/file, but the value must never be put in argv or agent JSON.

Delete one field:

```bash
sc user credential-rm rahmanfakhr convex-cloud CONVEX_DEPLOY_KEY \
  --connection client-a-production --yes
```

The Finder path for the same operation is:

```text
Users
→ rahmanfakhr
→ Providers
→ convex-cloud
→ Connections
→ Client A Production
→ Credentials
→ CONVEX_DEPLOY_KEY
→ Status / Set or Rotate / Remove
```

OAuth/external connections intentionally have no local credential editor. Their connection menu shows an authorization guide instead.

## Where to get each credential

Before SI-Coder opens hidden input, the selected credential shows the same source guidance in the Finder footer:

```text
INFO     Set credential — hidden input stored only under rahmanfakhr
PREVIEW
user rahmanfakhr › github › Work GitHub › GITHUB_TOKEN
state: missing · plaintext read disabled
open: https://github.com/settings/tokens/new
click: Open the token page → Set a note/name → Choose expiration → Enable repo scope → Generate token → Copy it now
```

Pressing **Enter** repeats the reference URL and navigation path before the hidden `value:` prompt. Credentials generated locally use `get with:` instead of a URL; generated-at-deploy values explain that they should normally be left blank.

The source/auth metadata is defined once in `lib/providers.js` (`auth[]`, `url`/`cmd`, `navigation[]`, `note`) and rendered by `lib/credential-guidance.js`. Tool-calling returns the same fields as `referenceUrl`, `createCommand`, `navigation`, and `navigationText`.

## Delete a user safely

Interactive deletion requires typing the exact user name, not only pressing `y`. The deletion is also written to the metadata-only audit log with the number of credentials and folder mappings removed.

```bash
sc user rm old-user
```

Machine/tool calling requires an explicit `confirm: true` on `sc.user.delete`.

## Tool calling

The Finder hierarchy has a matching secret-safe machine surface. MSO reads `.mso/functions.json`; the bundled `scripts/sc-mcp.js` exposes the same tools to Claude Code, Codex, Hermes, OpenClaw, and generic MCP clients.

Prefer `sc.user.*` tools so ownership is always explicit. Agents use `sc.user.connections.list`, `sc.user.connection.manage`, and `sc.user.connection.request` for labeled accounts; credential creation/rotation uses `sc.user.credential.request` with an optional `connection`. No MCP/function accepts a raw token/key/password value.

See [`tool-calling.md`](tool-calling.md).

## Default user and folder mappings

Set the fallback/default user:

```bash
sc user use rahmanfakh
```

An explicit folder mapping overrides the default user. To switch the current folder tree too:

```bash
sc user map . rahmanfakh
```

Inspect the effective identity and why it was selected:

```bash
sc user which
```

## Secret safety

The UI may show user names, provider names, credential key names, state, and source. It must never print credential values.

Use `sc run [--connection provider=alias] -- <command>` to inject the resolved user's selected connections into a child process without exporting plaintext back into the parent terminal.

## Non-interactive behavior

The Finder TUI is only used when stdin and stdout are both a TTY. Piped/scripted `sc` calls remain command-oriented and do not open the interactive console.
