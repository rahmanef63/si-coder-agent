# Resend credentials (STUB — for future /sc-resend)

## `RESEND_API_KEY` (optional)

Server-side Resend key.

**How to get one**: https://resend.com/api-keys → Create API Key (scope to the sending domain).

**Validator**: starts with `re_`.

## `RESEND_FROM_DOMAIN` (optional)

The verified sending domain (e.g. `mail.example.com`). `/sc-resend verify-domain.js` will register this with Resend and auto-create the DKIM/SPF/DMARC DNS records via `/sc-cf` or `lib/hostinger.js`.

**Validator**: contains a dot.
