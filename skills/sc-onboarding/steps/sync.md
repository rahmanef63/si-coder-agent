# Tailscale sync credentials (`sc-sync`)

Used by `/sc-sync` to rsync gitignored files (docs, local-only config) between a VPS
and a local machine over Tailscale, for a repo that is git-shared across both.

## `SYNC_ROLE` (required)

Which machine **this** process is running on: `vps` or `local`. Set once per machine
— **never the same value on both**. This is how `sc-sync` knows the direction of a
"push" vs a "pull" from wherever it's invoked.

**Validator**: must be exactly `vps` or `local`.

## `SYNC_VPS_TS_ADDR` (required)

The Tailscale address of the VPS side: either its MagicDNS alias (e.g. `myvps`) or
its raw `100.x` Tailscale IP.

**Ask the user directly**: "Do you have a Tailscale MagicDNS alias configured for
this machine (e.g. `myvps`), or do you connect via the raw 100.x Tailscale IP?
Either is fine — set `SYNC_VPS_TS_ADDR` / `SYNC_LOCAL_TS_ADDR` to whichever you
actually use."

**How to find it**: on the VPS, run one of:
```bash
tailscale status      # shows hostnames/aliases for all peers in the tailnet
tailscale ip -4        # prints this machine's own 100.x address
```

**Validator**: non-empty string, basic hostname/IP shape (letters, digits, `.`, `:`, `_`, `-`).

## `SYNC_LOCAL_TS_ADDR` (required)

Same idea as `SYNC_VPS_TS_ADDR`, but for the local dev machine side. Find it the
same way (`tailscale status` from either box, or `tailscale ip -4` on the local
machine itself).

**Validator**: non-empty string, basic hostname/IP shape.

## `SYNC_REMOTE_USER` (optional)

SSH user to connect as on the *other* machine. Defaults to the current OS user
(`os.userInfo().username`) if unset — only set this if the remote account has a
different username than the one running `sc-sync` locally.

**Validator**: non-empty string if present.

## `SYNC_REMOTE_PATH` (optional)

Absolute path to this repo's checkout on the *other* machine. Defaults to this
machine's own `git rev-parse --show-toplevel` — only set this if the two machines
don't mirror the same absolute path for the repo.

**Validator**: non-empty string if present.

## Windows-local caveat

If the **local** side of the pair is a Windows machine and you'll ever invoke
`sc-sync` *from the VPS* (pushing to, or pulling from, that Windows box), the
Windows machine needs **OpenSSH Server** enabled and listening for the inbound
SSH connection — Tailscale gets you network reachability, but rsync/ssh still
needs something to accept the connection on the other end. This only matters for
that VPS-initiates-toward-Windows-local direction; if you always run `sc-sync`
from the local machine's own shell (pushing/pulling from there), this doesn't
apply.

## Test

After both required vars are set, run `tailscale ping $SYNC_VPS_TS_ADDR` (from
local) or `tailscale ping $SYNC_LOCAL_TS_ADDR` (from vps) to confirm the tailnet
can actually reach the other side before running `/sc-sync`.
