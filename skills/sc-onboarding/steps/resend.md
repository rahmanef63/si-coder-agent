# Resend credentials (STUB — for future /sc-resend)

## `RESEND_API_KEY` (optional)

Server-side Resend key.

**Get it:** https://resend.com/api-keys → **Create API Key** → set Permission = **Sending access** (least privilege) and pick your **Domain**. Copy it now — shown once.

**Validator**: starts with `re_`.

## `RESEND_FROM_DOMAIN` (optional)

The verified sending domain (e.g. `mail.example.com`).

**Get it:** https://resend.com/domains → **Add Domain** → add the shown DKIM/SPF records at your DNS provider → **Verify DNS Records**. `/sc-resend` will automate this via `/sc-cf` or `lib/hostinger.js`.

**Validator**: contains a dot.
