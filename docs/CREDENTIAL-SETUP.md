# Secure credential setup

Choose the correct **user → provider → connection → authentication method** before
entering a key. A folder-scoped active user may differ from your usual account;
use `--user` explicitly when setting up a different account.

## Interactive browser form

Run this in an interactive terminal, not through an agent's tool-output channel:

```sh
sc setup --web --provider composio --user YOUR_USER
# Organization administration uses a different key/header:
sc setup --web --provider composio --user YOUR_USER --auth organization-token
# Other direct providers use the same form:
sc setup --web --provider hostinger --user YOUR_USER
```

The command prints a private, single-use setup URL. Its token is a URL fragment,
not a query parameter, and disappears from browser history once loaded. The form
has masked inputs, show/hide controls, official references, expandable steps,
and live verification before saving. Blank values preserve previously stored
fields. The user/provider/method cannot be changed by modifying the submitted
JSON. Successful saves clear the input and invalidate the session.

The server binds **only to 127.0.0.1** and expires after ten minutes. For a VPS,
choose a port, then forward it over your own SSH connection:

```sh
# VPS terminal
sc setup --web --provider composio --user YOUR_USER --port 49152
# Your computer; keep this connection open and use the private URL in its browser
ssh -N -L 49152:127.0.0.1:49152 -p YOUR_SSH_PORT YOUR_SSH_USER@YOUR_VPS_HOST
```

Do not expose that HTTP port publicly or share the URL in chat. HTTPS proxying is
not implied by the loopback form. Non-interactive setup is refused rather than
printing setup capabilities in agent logs.

Existing secret input through hidden terminal prompts, stdin, environment, and
files remains supported. Bracketed paste is handled without interpreting its
wrapper as Escape. Pasted line breaks do not automatically submit another prompt;
leading/trailing whitespace is normalized consistently.

## Composio key types

Project API keys use `x-api-key`; organization tokens use `x-org-api-key`. Choose
one matching the job. The syntax validator treats project keys as opaque values;
it does not require an undocumented prefix. A syntactically accepted key is not
proof of authorization: the selected provider endpoint must accept it.

Composio-connected application OAuth tokens stay with Composio. A hosted OAuth
connection is not interchangeable with entering the Composio platform API key.

Reference: <https://docs.composio.dev/reference/authenticating-to-composio>.

## Troubleshooting

`command -v sc` may resolve to an unrelated system spreadsheet program on some
Linux machines. Use the installed SI-Coder executable or place its installation
bin directory earlier in PATH; do not overwrite `/usr/bin/sc`.

```sh
command -v sc
"$HOME/.local/bin/sc" user list
"$HOME/.local/bin/sc" user verify YOUR_USER composio
```

A 401 response indicates authentication rejection. A 403 does not, by itself,
prove a token is expired: check the token type, resource scope, and endpoint.
Providers requiring unavailable live verification are reported as unverified,
not silently saved by the browser form. This initial form handles direct
credentials, not native-MCP or Composio-hosted OAuth authorization flows.

## Storage and security

The form permits at most five submission attempts, has exact-Origin/Host checks,
constant-time capability comparisons, bounded JSON bodies, field allowlisting,
and no credential values in responses. Credentials use the existing owner-only
connection store. File permissions are not encryption at rest and cannot protect
against compromise of the operating-system owner/root account.

Provider transport errors are reduced to safe diagnostic categories. Raw header or
network exceptions are not returned because runtime error text can echo a key.
