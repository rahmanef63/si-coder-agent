---
name: sc-resend
description: "(STUB / NOT IMPLEMENTED YET) Transactional email via Resend — verify sender domain DNS (DKIM/SPF/DMARC), create API keys, send template-based emails. Pairs with sc-cf or lib/hostinger.js for the DNS record creation step."
---

# /sc-resend — Resend (STUB)

> **Status:** boilerplate only.

## Scope when implemented

- **Domain verification**: register a sending domain with Resend, fetch the DKIM/SPF/DMARC records it requires, then create them via `sc-cf` or `lib/hostinger.js` automatically — no manual DNS copy-paste.
- **API key** rotation per project, scoped to the verified domain.
- **Audience** creation for broadcast lists (optional).
- **Smoke send** to a verified recipient to confirm DNS propagation.


## Rahmanef sender policy

For first-party apps hosted on `*.rahmanef.com`, use one verified transactional
identity and vary only the project display name:

```text
From: <Project Name> <official@rahmanef.com>
Reply-To: (unset by default)
```

Do not derive the sender address from the app subdomain. For example,
`baton.rahmanef.com` sends as `Baton <official@rahmanef.com>`, not
`official@baton.rahmanef.com`. Preserve the existing verified Resend/DNS
configuration for `rahmanef.com`; a transport or return-path hostname such as
`send.rahmanef.com` is infrastructure, not the visible From identity.

Recommended project-local env contract:

```text
EMAIL_FROM_ADDRESS=official@rahmanef.com
EMAIL_PROJECT_NAME=<Project Name>
EMAIL_PROJECT_TAG=<project-slug>
EMAIL_REPLY_TO=
```

Framework adapters may map that SSOT into their native variable names. Example:
Baton uses `AUTH_EMAIL_FROM="Baton <official@rahmanef.com>"`; Play Together
builds the same header from `EMAIL_PROJECT_NAME` + `EMAIL_FROM_ADDRESS`. Keep
reply-to absent unless the project has a distinct monitored mailbox. Future
HTML templates should take the same project identity object for header, footer,
subject prefix/tagging, and plaintext fallback rather than forking templates per
application.

## Env vars

| Var | Purpose |
|---|---|
| `RESEND_API_KEY` | `re_...` server key |
| `RESEND_FROM_DOMAIN` | The verified sending domain |

## Suggested file layout

```
sc-resend/
├── SKILL.md
└── scripts/
    ├── verify-domain.js   # register + auto-create DNS records via sc-cf / hostinger
    ├── api-key.js         # create/rotate scoped API key
    ├── audiences.js       # CRUD audience (optional)
    └── smoke-send.js      # send a test email to confirm
```

## Implementation notes

- API base: `https://api.resend.com`
- Auth: `Authorization: Bearer <RESEND_API_KEY>`
- Domain verify response gives 3 records `[{ name, type, value }]` — feed those into the DNS module via `configureDns()`.
- DMARC: Resend recommends `v=DMARC1; p=none;` initially, tighten to `p=quarantine` once SPF/DKIM are confirmed in DNS for 24h.
