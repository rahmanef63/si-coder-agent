# Composio auth model reference for SI-Coder

Verified against current Composio documentation on **2026-09-02**. The executable SI-Coder registry SSOT is `lib/providers.js`; connection persistence is `lib/connections.js`; Composio lifecycle logic is `lib/composio-connections.js`.

## Mental model

Keep these five questions separate:

1. **User** — who owns the integration.
2. **Provider** — the actual service: GitHub, Convex, Vercel, Gmail, etc.
3. **Connection** — one concrete account/project/deployment, with a stable id and human label.
4. **Source/backend** — where authentication is actually managed: `sc`, `composio`, or `native-mcp`.
5. **Auth scheme + scope** — OAuth2, PAT/Bearer, API key, DCR OAuth, account/project/deployment/team/server scope, etc.

SI-Coder therefore models:

```text
User
└─ Provider
   └─ Connection
      ├─ source/backend
      ├─ auth method / scheme
      ├─ scope
      ├─ default selection
      └─ external reference OR local credential fields
```

Example:

```text
rahmanfakhr
└─ GitHub
   ├─ Default GitHub
   │  source = sc
   │  auth   = Fine-grained PAT
   │  scope  = account
   │
   └─ Work GitHub
      source = composio
      auth   = OAuth2
      scope  = account
      external.connectedAccountId = ca_...
```

**Composio is not a GitHub auth method and not the parent provider.** GitHub remains the provider. Composio is the connection source/backend.

## Composio concepts mapped to SI-Coder

Composio separates:

- **Toolkit** — provider integration such as `github`.
- **Auth Config** — authentication blueprint: scheme, scopes, and auth configuration. It is project-scoped.
- **Connected Account** — one user's authenticated toolkit account.
- **Alias / connected account id** — explicit identity used when one user has multiple accounts for the same toolkit.

SI-Coder stores the equivalent routing identity but does not copy externally managed provider credentials into its vault.

References:
- https://docs.composio.dev/reference/api-reference/auth-configs
- https://docs.composio.dev/docs/authentication/managing-multiple-connected-accounts
- https://docs.composio.dev/docs/auth-configuration/connected-accounts

## Connection source contract

### `source = sc`

SI-Coder owns the direct credential lifecycle. Values live only in:

```text
~/.config/si-coder/connections/<user>/<provider>/<connection>.env
```

The file is mode `0600`. Examples: GitHub PAT, Convex Cloud PAT/deploy key, Vercel token, Dokploy API key.

### `source = composio`

Composio owns the provider credential. SI-Coder stores **no provider access/refresh token** and creates no local provider credential file for the connection.

Safe persisted metadata is limited to routing/lifecycle fields such as:

```json
{
  "system": "composio",
  "brokerConnection": "project",
  "toolkit": "github",
  "connectedAccountId": "ca_...",
  "alias": "work-github",
  "authConfigId": "ac_...",
  "lastKnownStatus": "ACTIVE",
  "checkedAt": "..."
}
```

A Composio **project API key** is a separate normal SI-Coder provider connection under provider `composio`; it gives SI-Coder permission to create/read Connected Account metadata in that Composio project. An organization token is a different connection and is not used as a project API key.

### `source = native-mcp`

Authentication belongs to the provider-owned MCP/OAuth surface. SI-Coder stores only routing identity/status references and does not copy the provider credential.

## Auth schemes

| Scheme | Meaning | Storage rule |
|---|---|---|
| `OAUTH2` | Hosted/provider OAuth consent | External when source is Composio/native MCP |
| `DCR_OAUTH` | Dynamic-client-registration OAuth, common for MCP | External/native MCP |
| `API_KEY` | Static key | Local only for `source=sc`; otherwise external system |
| `BEARER_TOKEN` | Long-lived bearer/PAT | Local only for `source=sc`; otherwise external system |
| `BASIC` | Username/password basic auth | External or direct according to source |
| `LOCAL` | Machine-generated/discovered config | `source=sc` only |

Composio Auth Configs support OAuth2, API key, Bearer, and Basic schemes.

Reference: https://docs.composio.dev/reference/api-reference/auth-configs

## Current Composio Connect Link lifecycle

For a Composio-backed connection:

```text
SC user/provider/connection
→ resolve the same user's Composio project connection
→ resolve/pin an Auth Config for the toolkit + scheme
→ POST /api/v3.1/connected_accounts/link
→ return the transient redirect URL to the human
→ persist only connected_account_id/auth_config_id/alias/status
→ poll GET /api/v3.1/connected_accounts/{id}
→ ACTIVE
```

The v3.1 Link endpoint accepts `auth_config_id`, `user_id`, optional alias/callback URL, and returns `redirect_url`, `expires_at`, `connected_account_id`, and `link_token`.

**SI-Coder deliberately discards `link_token` and never stores the redirect URL.** The redirect URL is transient user-facing authorization data. Connected-account GET responses may contain credential state, so `lib/composio-connections.js` allow-lists only safe identity/status fields and drops `state` entirely.

For Composio-managed OAuth, use `link()` / `/connected_accounts/link`. The older create/initiate path for managed OAuth was retired in 2026; do not reintroduce it.

References:
- https://docs.composio.dev/reference/api-reference/connected-accounts/postConnectedAccountsLink
- https://docs.composio.dev/docs/auth-configuration/migrating-initiate-to-link
- https://docs.composio.dev/reference/api-reference/connected-accounts/getConnectedAccountsByNanoid

## Multiple accounts

One user may have multiple Connected Accounts for the same toolkit. Keep SI-Coder labels simple (`Default GitHub`, `Work GitHub`, `Client A GitHub`) and store source/owner/provider separately rather than encoding them into labels.

Execution rule:

```text
Agent asks SI-Coder which connection to use
→ source=sc       : use the selected direct SC connection
→ source=composio : use toolkit + connectedAccountId/alias directly with Composio
→ source=native-mcp: use the provider-native MCP account/session
```

SI-Coder is the resolver/control plane. It should not wrap every Composio tool execution when the agent can execute against Composio directly.

## GitHub

### Direct

```text
source = sc
```

Preferred choices:

- `fine-grained-pat` — recommended when its repository/permission model covers the required operation.
- `classic-pat` — compatibility/broad repository automation path.

The method-specific guidance points to the correct GitHub creation page. Both use `GITHUB_TOKEN`; the connection method determines the acquisition guidance.

### Composio

```text
source = composio
auth   = OAUTH2
```

The GitHub OAuth token stays in the Composio Connected Account. SI-Coder keeps only the toolkit/account/auth-config references and status.

## Convex Cloud

Keep account and deployment direct credentials distinct:

```text
Convex Admin
source = sc
auth   = personal-access-token
scheme = BEARER_TOKEN
scope  = account
field  = CONVEX_PERSONAL_ACCESS_TOKEN

Example App Dev
source = sc
auth   = deployment-key
scheme = API_KEY
scope  = deployment
fields = CONVEX_DEPLOYMENT_NAME + CONVEX_DEPLOY_KEY
```

A Composio-backed Convex connection is a separate `source=composio` connection; it must not overwrite or reinterpret these direct connections.

## Composio itself as a provider

This is a separate role from Composio being a backend for GitHub/Gmail/etc.:

```text
Provider = composio

Project connection
  source = sc
  auth   = project-api-key
  field  = COMPOSIO_API_KEY
  header = x-api-key

Organization connection
  source = sc
  auth   = organization-token
  field  = COMPOSIO_ORG_API_KEY
  header = x-org-api-key
```

Connected-account lifecycle requires a project API connection because v3.1 Auth Config and Connected Account endpoints use `x-api-key`.

## Metadata migration v1 → v2

Old connection metadata overloaded `source` with provenance (`legacy-profile`) and encoded some external systems as auth methods. v2 separates:

```text
source = sc | composio | native-mcp
origin = legacy-profile | ...   # provenance only
```

Migration rules are normalized read-only first, then persisted explicitly with a `0600` backup. Legacy external OAuth placeholders without a real Connected Account id become `needs-authorization`; they are never promoted to ACTIVE implicitly.
