# Resend credentials

## `RESEND_API_KEY` (optional)

Server-side Resend key.

**Get it:** https://resend.com/api-keys → **Create API Key** → set Permission = **Sending access** (least privilege) and pick your **Domain**. Copy it now — shown once.

**Validator**: starts with `re_`.

## `RESEND_FROM_DOMAIN` (optional)

The verified sending domain (e.g. `mail.example.com`).

**Get it:** https://resend.com/domains → **Add Domain** → add the shown DKIM/SPF records at your DNS provider → **Verify DNS Records**. `/sc-resend` will automate this via `/sc-cf` or `lib/hostinger.js`.

**Validator**: contains a dot.


## Sender convention

Do not assume a repository-global sender domain. Use the verified Resend domain chosen
for the current project/account and keep sender address, display name, optional tag, and
optional reply-to separate when possible:

```text
EMAIL_FROM_ADDRESS=transactional@example.com
EMAIL_PROJECT_NAME=<Project Name>
EMAIL_PROJECT_TAG=<project-slug>
EMAIL_REPLY_TO=
```

A framework-specific combined variable may be used as an adapter, not as a second source
of truth. Never derive the sender address automatically from the app subdomain unless the
user's verified email configuration explicitly says to do so.

## Verify the stored credential

```bash
sc doctor --providers resend
```

`sc` validates the API key with a read-only domain-list request. A Resend **Sending access** key is accepted even though it cannot list domains; a **Full access** key additionally lets the doctor verify `RESEND_FROM_DOMAIN`. Full `/sc-resend` send/domain automation is a separate skill and may still be incomplete.
