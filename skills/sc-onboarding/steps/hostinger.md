# Hostinger API (optional)

## Account token — `HOSTINGER_API_TOKEN`

Use this for Hostinger VPS/DNS automation and account-level Hostinger Mail API access.

**Get it:** https://hpanel.hostinger.com/profile/api
1. Open hPanel → Profile → API.
2. Generate a named token and choose a short, appropriate expiration.
3. Copy it once into the named Hostinger connection.

The current Hostinger API exposes `/api/mail/v1/orders`, so the same account token can enumerate and manage Hostinger Mail resources when the account owns a mail service. SI-Coder verifies Mail access first and falls back to VPS verification when the account has no accessible mail order.

## Scoped Hostinger Mail token — `HOSTINGER_MAIL_API_TOKEN` + `HOSTINGER_MAIL_ORDER_ID`

Use a separate `mail-api-token` named connection when a project should only manage one mail order instead of inheriting the full account token.

The Hostinger Mail API supports order/mailbox management, aliases, forwarders, autoreplies, catch-alls, webhooks and logs. Store the scoped token together with its exact mail order ID; SI-Coder refuses a different order at execution time.

Operations that create or consume new secret values (mailbox passwords, generated Mail API tokens, generated webhook secrets) are intentionally not accepted through agent/tool JSON.

**Reference:** https://developers.hostinger.com/ → Mail.
