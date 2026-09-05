# Secure credential setup

Choose the correct **user → provider → connection → source → authentication method** before
entering a key. A folder-scoped active user may differ from your usual account;
use `--user` explicitly when setting up a different account.

## Interactive browser form

Run this in an interactive terminal, not through an agent's tool-output channel:

```sh
sc setup --web
# Optional: start with a particular user/provider
sc setup --web --provider composio --user YOUR_USER
# Organization administration uses a different key/header:
sc setup --web --provider composio --user YOUR_USER --auth organization-token
# Other direct providers use the same form:
sc setup --web --provider hostinger --user YOUR_USER
```

The command opens the complete user/provider connection workflow and prints a
private, ten-minute browser URL. The catalog includes all registered providers
and custom definitions. Each credential form is single-use after a successful save. Its token is a URL fragment,
not a query parameter, and disappears from browser history once loaded. The form
has masked inputs, show/hide controls, official references, expandable steps,
and live verification before saving. Blank values preserve previously stored
fields. Each credential form is bound to its selected user/provider/method; these cannot
be changed by modifying a save request. The hub provides named-connection creation,
labels, defaults, confirmed deletion, separate source selection, and public
credential guidance before collecting a value. The TUI also exposes **Open browser
setup** under users, providers, and connections; Enter/Esc closes it and returns
to the previous terminal view. Successful saves clear the input and invalidate the session.

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
Providers with no live verifier are reported as unverified. Only a separate user
confirmation can save them without claiming verification. An explicitly rejected
key cannot use this path. Composio-hosted connection creation and authorization
links use the existing connected-account flow; only identifiers/status stay local.
The user completes authorization on Composio and refreshes status here. Native-MCP
methods show their own authorization instructions and never accept local OAuth
secrets. A browser test cannot prove a real provider authorization was completed.

## Storage and security

The form permits at most five submission attempts, has exact-Origin/Host checks,
constant-time capability comparisons, bounded JSON bodies, field allowlisting,
and no credential values in responses. Credentials use the existing owner-only
connection store. File permissions are not encryption at rest and cannot protect
against compromise of the operating-system owner/root account.

Provider transport errors are reduced to safe diagnostic categories. Raw header or
network exceptions are not returned because runtime error text can echo a key.


## Endpoint-specific diagnostics

Organization keys use Composio's `/api/v3.1/org/owner/project/list` endpoint with
`x-org-api-key`; `/org/project/list` is a different user-key endpoint. Convex personal
tokens are verified through the PAT-authenticated read-only endpoint
`/v1/list_personal_access_tokens?limit=1`; returned token metadata is discarded.

## Import / export

The connection manager now includes **Import / export JSON**. Choose metadata-only
or encrypted direct credentials, then review the destination import plan. Existing
IDs/labels are preserved, not overwritten; use a user prefix for a separate copy.
Details: [Data portability](DATA-PORTABILITY.md).

## Hostinger Mail

The Hostinger provider now has two direct authentication methods. `api-token` is the account-level token used for Hostinger VPS/DNS and can also access Mail orders when the account has Hostinger Email. `mail-api-token` is a scoped Mail connection with `HOSTINGER_MAIL_API_TOKEN` plus `HOSTINGER_MAIL_ORDER_ID`.

Machine calling includes `sc.hostinger.mail.orders`, `sc.hostinger.mail.list`, `sc.hostinger.mail.logs`, and confirmed `sc.hostinger.mail.mutate`. Mailbox password/create operations, webhook secret creation/regeneration, and Mail API-token creation are intentionally excluded from tool JSON because those flows involve new secret values.

Official reference: <https://developers.hostinger.com/> → **Mail**.
