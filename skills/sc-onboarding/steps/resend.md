# Resend credentials (STUB — for future /sc-resend)

## `RESEND_API_KEY` (optional)

Server-side Resend key.

**Get it:** https://resend.com/api-keys → **Create API Key** → set Permission = **Sending access** (least privilege) and pick your **Domain**. Copy it now — shown once.

**Validator**: starts with `re_`.

## `RESEND_FROM_DOMAIN` (optional)

The verified sending domain (e.g. `mail.example.com`).

**Get it:** https://resend.com/domains → **Add Domain** → add the shown DKIM/SPF records at your DNS provider → **Verify DNS Records**. `/sc-resend` will automate this via `/sc-cf` or `lib/hostinger.js`.

**Validator**: contains a dot.


## First-party `*.rahmanef.com` sender convention

For Rahmanef-owned subdomain apps, do not create a per-subdomain From address.
Use the verified shared identity `official@rahmanef.com`, with the application
name as the display name and no reply-to by default. Examples:

```text
Play Together <official@rahmanef.com>
Baton <official@rahmanef.com>
```

Project code should keep the address and project identity separate when
possible (`EMAIL_FROM_ADDRESS`, `EMAIL_PROJECT_NAME`, `EMAIL_PROJECT_TAG`,
optional `EMAIL_REPLY_TO`) and build the visible header at send time. A
framework-specific combined variable such as Baton's `AUTH_EMAIL_FROM` may be
used as an adapter, not as a second source of truth.
