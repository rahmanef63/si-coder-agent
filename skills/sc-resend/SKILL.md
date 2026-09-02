---
name: sc-resend
description: "(STUB / NOT IMPLEMENTED YET) Transactional email via Resend — verify sender domain DNS (DKIM/SPF/DMARC), create API keys, send template-based emails. Pairs with sc-cf or lib/hostinger.js for the DNS record creation step."
use_when: "Use only when maintaining or implementing the unfinished dedicated Resend automation itself. Credential storage and live verification belong to sc-provider until this skill is implemented."
do_not_use_when: "Do not route normal user-facing Resend provisioning/email tasks here; the dedicated automation is not implemented yet. Keep credential work in sc-provider and explain the current limitation."
required_tools: []
security_constraints: "Never request, print, or persist plaintext credentials in chat/tool payloads; use SI-Coder safe credential handoffs."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# /sc-resend — Resend (STUB)

> **Status:** boilerplate only.

## Scope when implemented

- **Domain verification**: register a sending domain with Resend, fetch the DKIM/SPF/DMARC records it requires, then create them via `sc-cf` or `lib/hostinger.js` automatically — no manual DNS copy-paste.
- **API key** rotation per project, scoped to the verified domain.
- **Audience** creation for broadcast lists (optional).
- **Smoke send** to a verified recipient to confirm DNS propagation.


## Sender identity policy

Sender identity is project configuration, not repository-global policy. Use one explicitly
verified Resend domain/account selected by the user and keep the visible project name
separate from the sender address:

```text
From: <Project Name> <transactional@example.com>
Reply-To: <optional monitored mailbox>
```

Do not infer a sender address from the application hostname. A project hosted at
`app.example.com` may legitimately send from a different verified domain. Keep the
project-local contract explicit:

```text
EMAIL_FROM_ADDRESS=transactional@example.com
EMAIL_PROJECT_NAME=<Project Name>
EMAIL_PROJECT_TAG=<project-slug>
EMAIL_REPLY_TO=
```

Framework adapters may map these values into native variables, but the selected project
configuration remains the source of truth. Never bake another project's domain, sender,
or display name into this skill.

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
