---
name: sc-sync
description: "rsync gitignored files between a VPS and a local machine over Tailscale, for a repo checked out (mirrored path) on both. Two directions: vps-local and local-vps, selected by SYNC_ROLE crossed with the requested direction (never by sniffing hostname). Always dry-run first, --apply to actually copy. Trigger on /sc-sync, 'sync vps to local', 'sync local to vps', 'tailscale sync', 'gitignored files between machines'."
---

# /sc-sync — Gitignored-file sync over Tailscale

## Why this exists

A repo is checked out on two machines (say, a VPS and a laptop). `.gitignore`
deliberately keeps some files out of git — local notes, generated docs,
scratch config — so they never travel with `git push` / `git pull`. Plain SSH
`scp`/`rsync` between the two kept failing (NAT, dynamic IP, firewall...);
Tailscale is confirmed working on both ends. This skill wraps `rsync` over the
Tailscale interface so those gitignored files can move in either direction
without inventing a new transport.

It deliberately does **not** try to guess which machine it's running on via
`hostname` — that leaks a real, personally-identifying hostname into logs and
breaks the moment either machine is renamed or reimaged. Instead the
invoking side declares itself explicitly via `SYNC_ROLE`.

## Requirements

- Both machines joined to the **same tailnet** (`tailscale status` shows both).
- The repo is checked out at the **same absolute path** on both machines (the
  default `SYNC_REMOTE_PATH` assumes this — override it if the layout differs).
- `rsync` installed on both machines.
- **The non-invoking side needs inbound SSH reachable** over Tailscale — rsync
  tunnels through SSH by default. That means:
  - Linux/macOS: `sshd` running, reachable from the tailnet.
  - **Windows: OpenSSH Server is NOT on by default.** You must explicitly
    enable "OpenSSH Server" (Settings → Optional Features, or
    `Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0` in an
    elevated PowerShell) and make sure the `sshd` service is running before a
    `local-vps`/`vps-local` sync can reach a Windows box. This is a real
    per-machine caveat, not a generic assumption — check it on whichever side
    is the pull/push target if the connection times out.

## Env vars

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `SYNC_ROLE` | yes | — | Which machine **this process is running on**: exactly `vps` or `local`. Never inferred from `hostname`. |
| `SYNC_VPS_TS_ADDR` | yes | — | Tailscale MagicDNS alias or `100.x` IP of the VPS, e.g. `your-vps` or `100.x.x.x`. |
| `SYNC_LOCAL_TS_ADDR` | yes | — | Tailscale MagicDNS alias or `100.x` IP of the local machine, e.g. `your-laptop`. |
| `SYNC_REMOTE_USER` | no | `os.userInfo().username` | SSH user on the far side. |
| `SYNC_REMOTE_PATH` | no | this repo's own `git rev-parse --show-toplevel` | Absolute repo path on the far side. Only override if the two checkouts don't live at the same path. |

## Direction routing

Direction (`vps-local` or `local-vps`) says which way data should flow.
`SYNC_ROLE` says which machine is running the command right now. Crossing the
two tells the script whether *this* machine is pushing (source) or pulling
(destination) — the routing table is a small pure function
(`route()` in `scripts/_shared.js`), unit tested for all four cells:

| direction | `SYNC_ROLE` | this machine is | other machine is |
|---|---|---|---|
| `vps-local` | `vps` | SRC — pushes to local | DST |
| `vps-local` | `local` | DST — pulls from vps | SRC |
| `local-vps` | `local` | SRC — pushes to vps | DST |
| `local-vps` | `vps` | DST — pulls from local | SRC |

## Usage

```bash
# On the VPS, set once (e.g. ~/.bashrc):
export SYNC_ROLE=vps
export SYNC_VPS_TS_ADDR=your-vps
export SYNC_LOCAL_TS_ADDR=your-laptop

# On the local machine, set once:
export SYNC_ROLE=local
export SYNC_VPS_TS_ADDR=your-vps
export SYNC_LOCAL_TS_ADDR=your-laptop

cd ~/projects/myrepo

# Preview only (default — no files are copied):
node skills/sc-sync/scripts/sync.js vps-local
node skills/sc-sync/scripts/sync.js local-vps

# Actually copy, after reviewing the dry-run diff above:
node skills/sc-sync/scripts/sync.js vps-local --apply
node skills/sc-sync/scripts/sync.js local-vps --apply

# Sync only specific paths instead of the full default set:
node skills/sc-sync/scripts/sync.js local-vps --apply docs/private-notes.md scratch/
```

The same command works from either machine for a given direction — it's the
env's `SYNC_ROLE` (not an argv flag) that tells the script whether it's
pushing or pulling this time.

## What gets synced by default

Everything `git ls-files --others --ignored --exclude-standard` reports for
the repo (i.e. every gitignored-but-present file), **excluding** anything
under: `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `.venv`,
`venv`, `__pycache__`, `target`, `vendor`, `coverage`, `.cache` — those are
build output / VCS internals / language caches, never something you want
hand-carried between machines. Pass explicit paths on the CLI to sync a
specific subset instead of the full default list.

## Agent responsibility

- **Dry-run first, always.** The default (no `--apply`) runs `rsync
  --dry-run` so the agent (and the human) can read exactly what would change
  before anything is copied.
- **Never skip straight to `--apply`.** Run without it, show/summarize the
  diff, and only re-run with `--apply` once the diff has actually been
  reviewed — don't add `--apply` on the first invocation just because the
  user asked to "sync".
- `--apply` uses `rsync -avzu` (`-u` = skip files newer on the destination),
  so a newer file on the far side won't be clobbered by an older local copy —
  but that's a safety net, not a substitute for reading the dry-run diff.
