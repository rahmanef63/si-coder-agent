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
PATH       SI-Coder › Users › rahmanfakh › Providers › GitHub › Credentials › GITHUB_TOKEN

Users                 │ rahmanfakh             │ Providers               │ GitHub
❯ › rahmanef          │ ❯ › Providers          │ ❯ › github              │ ❯ › Credentials
  › rahmanfakh        │   · Credential overview│   › hostinger           │   · Provider details
  › rahmnf            │   · Set as default     │   › dokploy             │   · Verify as this user
  · Add user          │   · Duplicate user     │   › vercel              │   · Set / rotate provider
```

Credentials are intentionally **not** edited from a global Accounts screen. Select a user first so the owner is always visible in `PATH`.

The bottom panel is selection-driven:

- `PREVIEW` always describes the item currently highlighted, using the explicit user in the Finder path.
- `RESULT` is temporary action output. It disappears as soon as the selection/filter changes, so stale provider output cannot look like the currently selected provider.

## User model

Internally, the existing profile files remain the credential-store implementation for backward compatibility, but the product/UI concept is a **user**:

```text
~/.config/si-coder/profiles/<user>.env   # that user's credentials, mode 0600
~/.config/si-coder/profile-meta.json     # non-secret user metadata, mode 0600
~/.config/si-coder/sc.md                 # default user + folder → user rules
```

When a user governs the current directory, registry credential keys not owned by that user are stripped from the child environment. This prevents a stale GitHub/Hostinger/Dokploy token from another user leaking into a deployment.

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

## Credential CRUD per user

Read/list status; values are never printed:

```bash
sc user credentials rahmanfakh
sc user credentials rahmanfakh github
sc user credential-status rahmanfakh github GITHUB_TOKEN
```

Create or update one credential:

```bash
sc user credential-set rahmanfakh github GITHUB_TOKEN
```

On a TTY the input is hidden. Scripted use must use a safe input source such as stdin/env/file; never put a secret in argv.

Delete one credential:

```bash
sc user credential-rm rahmanfakh github GITHUB_TOKEN --yes
```

The Finder path for the same operation is:

```text
Users
→ rahmanfakh
→ Providers
→ GitHub
→ Credentials
→ GITHUB_TOKEN
→ Status / Set or Rotate / Remove
```

## Delete a user safely

Interactive deletion requires typing the exact user name, not only pressing `y`. The deletion is also written to the metadata-only audit log with the number of credentials and folder mappings removed.

```bash
sc user rm old-user
```

Machine/tool calling requires an explicit `confirm: true` on `sc.user.delete`.

## Tool calling

The Finder hierarchy has a matching secret-safe machine surface. MSO reads `.mso/functions.json`; the bundled `scripts/sc-mcp.js` exposes the same tools to Claude Code, Codex, Hermes, OpenClaw, and generic MCP clients.

Prefer `sc.user.*` tools so ownership is always explicit. Credential creation/rotation uses `sc.user.credential.request`; no MCP/function accepts a raw token/key/password value.

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

Use `sc run -- <command>` to inject the resolved user's credentials into a child process without exporting plaintext back into the parent terminal.

## Non-interactive behavior

The Finder TUI is only used when stdin and stdout are both a TTY. Piped/scripted `sc` calls remain command-oriented and do not open the interactive console.
