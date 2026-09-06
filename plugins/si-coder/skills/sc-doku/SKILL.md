---
name: sc-doku
description: "Configure DOKU Checkout REST and DOKU MCP through SI-Coder named connections, then discover or invoke DOKU MCP tools without exposing merchant credentials."
use_when: "Use when the user needs DOKU payment credentials, DOKU Checkout integration, DOKU MCP setup, DOKU MCP tool discovery, or a DOKU MCP payment/status/refund/void operation through SC."
do_not_use_when: "Do not use for a different payment provider or when the task does not involve DOKU."
required_tools: []
security_constraints: "Never request, print, or persist DOKU Client secrets/API keys in chat, MCP tool JSON, argv, docs, or repo files. Use SC private Connections setup; remote MCP calls require explicit confirmation."
references: ["https://dashboard.doku.com/bo/developer/api-keys", "https://developers.doku.com/get-started-with-doku-api/retrieve-payment-credential", "https://developers.doku.com/accept-payments/doku-mcp-server", "https://developers.doku.com/accept-payments/direct-api/snap/integration-guide"]
compatibility: "Standalone SI-Coder; DOKU MCP uses HTTP Streamable with Client-Id plus Basic authorization derived from the selected SC connection."
---

# /sc-doku — DOKU Checkout + MCP

## Language
Reply in the user's language unless they request another language.

## Dashboard fields — do not interchange them

Open `https://dashboard.doku.com/bo/developer/api-keys` (**Developer → API Keys**). Current DOKU Dashboard may show four related surfaces:

- **Client ID** — merchant/brand identifier used by Checkout/REST and DOKU MCP. Current public examples include `BRN-...`; older examples also use `MCH-...`.
- **Secret Key** — Checkout/Non-SNAP payment signing secret. Pair this with Client ID for DOKU Checkout.
- **API Key** — DOKU MCP credential when MCP access is enabled. Pair this with Client ID for DOKU MCP; SC stores it under the internal key `DOKU_MCP_API_KEY`.
- **SNAP settings** — separate advanced Direct API setup. SNAP can require OAuth tokens, client secret, and RSA public/private keys; it is not required for ordinary DOKU Checkout.

## Environment boundary — production and sandbox are different credentials

- **Production Dashboard:** `https://dashboard.doku.com/bo/developer/api-keys` → Developer → API Keys. Credentials copied here belong to production and must not be stored in a connection labelled sandbox.
- **Sandbox:** register/login at `https://sandbox.doku.com/bo/sandbox-registration` and use the Sandbox Client ID + Sandbox Secret Key issued there. Sandbox and production credentials are separate.
- Keep SC connection labels explicit, for example `app-checkout-sandbox` versus `app-checkout-production`. Never infer environment from the credential prefix alone.

## Connection model
Keep DOKU credentials in **SC Connections**. Use separate named connections for sandbox and production when practical.

- **Checkout / Non-SNAP REST** (`checkout-rest`): Dashboard **Client ID** + **Secret Key**. Do not use the dashboard API Key for Checkout signatures.
- **DOKU MCP** (`mcp-api-key`): Dashboard **Client ID** + **API Key**; SC stores that API Key internally as `DOKU_MCP_API_KEY`. MCP access must be enabled for the merchant. Optional `DOKU_MCP_ENV=sandbox|production` defaults to `sandbox`.
- **SNAP / Direct API** is a separate advanced integration. It uses SNAP token/signature rules (including RSA public/private keys for asymmetric token signatures and client-secret-based symmetric signatures). Do not enable or paste SNAP keys when the application only uses DOKU Checkout.

For MCP credentials, DOKU's current guide says to request **“Payment Integration via MCP Server (AI Agents)”**. SC stores the raw API key privately and derives `Authorization: Basic base64(apiKey + ":")` only in memory while calling DOKU. Never store the encoded Authorization header as another credential.

Use the private setup UI or hidden TTY flow instead of chat:

```bash
sc browser
# or create a connection explicitly, then use hidden credential entry:
sc user connection-add <user> doku "DOKU MCP Sandbox" --source sc --auth mcp-api-key --default
sc user credential-set <user> doku --connection <connection>
```

Checkout REST credentials cannot be safely verified by creating a payment behind the user's back. Saving them without live verification is acceptable only through SC's explicit unverified-save path; verify them in the application's DOKU sandbox flow.

## MCP environments
Current official endpoints:

- sandbox: `https://api-sandbox.doku.com/doku-mcp-server/mcp`
- production: `https://mcp.doku.com/mcp`

Always begin in sandbox unless the user explicitly requests production and the merchant is activated.

## Discover tools dynamically
DOKU MCP exposes many payment/transaction tools and the catalog can evolve. Do not hardcode a static list.

```bash
sc doku mcp tools --user <user> --connection <connection>
```

Agents using the SI-Coder MCP call the read-only machine function `sc.doku.mcp.tools` with explicit `user` and `connection`.

## Invoke a DOKU MCP tool
All remote MCP tool calls require explicit confirmation because the discovered catalog can include payment creation, refunds, voids, and other financially consequential actions.

```bash
printf '%s' '{"non_secret":"tool arguments"}' \
  | sc doku mcp call <tool-name> --user <user> --connection <connection> --confirm
```

The SI-Coder MCP equivalent is `sc.doku.mcp.call` with `confirm=true`. Credential-shaped fields are rejected by SC's machine safety boundary.

Before a production payment/refund/void action, verify the selected user, named connection, environment, amount/currency, target invoice/transaction, and user intent. Never infer a financial operation from an ambiguous request.
