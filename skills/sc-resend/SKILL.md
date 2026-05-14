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
