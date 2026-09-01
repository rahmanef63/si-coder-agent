# SI-Coder CLI

Run `sc` in a terminal to open the Finder-style interactive console. It owns one alternate-screen frame: moving, filtering, and changing layers repaint that same frame instead of appending lines to terminal scrollback. A visible `SECTIONS` tab bar and `PATH` breadcrumb stay at the top while parent/current layers are shown side by side as columns.

## Navigation

```text
↑ / ↓       move selection
Tab         enter the selected deeper layer
→ / Enter   open a layer or run/submit an action
← / Esc     go back one breadcrumb layer
Ctrl-D      quit the interactive console
```

At the Home layer, `Esc` does not close the CLI. Use **Quit** or `Ctrl-D` to leave.

Example layout:

```text
SECTIONS   Build   Accounts  [ Users ]  System
PATH      [ SI-Coder ] › [ Users ] › [ Profiles ] › [ rahmanef ]
───────────────────────────────────────────────────────────────
Users                 │ Profiles              │ rahmanef
❯ › Profiles          │ ❯ › rahmanef          │ ❯ · Details
  · Current folder    │   › rahmanfakh        │   · Set owner
  · Add profile       │   › rahmnf            │   · Use as default
```

On narrower terminals SI-Coder keeps the newest columns and collapses older parents behind `… /`. This lets a user inspect a profile, change its owner, map the current folder, and return to the profile list without restarting `sc`.

## Users, profiles, and credential ownership

A **profile** is the isolated credential store used by SI-Coder. A profile has an explicit **owner**, which is the human/account identity whose credentials belong in that profile.

```text
~/.config/si-coder/profiles/<profile>.env   # credentials, mode 0600
~/.config/si-coder/profile-meta.json        # profile → owner metadata, mode 0600
~/.config/si-coder/sc.md                    # folder → profile rules + active fallback
```

`profile-meta.json` contains metadata only. It never duplicates credential values.

Existing profiles are backward-compatible: when no owner metadata exists yet, the owner defaults to the profile name until explicitly changed.

Useful commands:

```bash
sc user
sc user show rahmanef
sc user owner rahmanef "Rahman personal"
sc user add client-a --owner "Client A"
sc user use rahmanef
sc user map ~/projects/personal rahmanef
sc user which
```

Folder rules use longest-path matching. When a profile governs the current directory, only credential keys stored in that profile are allowed through; credential keys inherited from another shell/profile are removed from the child environment.

## Secret safety

The interactive UI may show profile names, owner labels, credential key names, state, and source. It must never print credential values.

Use:

```bash
sc secret set <provider> <KEY>
sc secret list
sc doctor
sc run -- <command>
```

`sc run` injects the resolved profile into the child process without exporting plaintext credentials back into the parent terminal.

## Non-interactive behavior

The layered menu is only used when stdin and stdout are both a TTY. Piped/scripted `sc` calls remain command-oriented and do not open an interactive menu.
