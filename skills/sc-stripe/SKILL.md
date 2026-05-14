---
name: sc-stripe
description: "(STUB / NOT IMPLEMENTED YET) Stripe payments setup — create products/prices, webhook endpoint registration, customer portal config, restricted API keys. Pairs with sc-convex for `payments` table mutations and HTTP webhook routes."
---

# /sc-stripe — Stripe (STUB)

> **Status:** boilerplate only. No working scripts yet.

## Scope when implemented

- Create/update Products + Prices idempotently from a config file
- Register webhook endpoint at `https://api-<domain>/webhook/stripe` and capture the signing secret
- Generate a **restricted API key** (least-privilege) for the runtime, distinct from the dashboard key
- Configure the Customer Portal session URL
- Smoke-test with a Stripe test-mode checkout link

## Env vars

| Var | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | `sk_test_...` or `sk_live_...` (server-side) |
| `STRIPE_PUBLISHABLE_KEY` | `pk_test_...` or `pk_live_...` (client-side) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` — captured after webhook registration |

## Suggested file layout

```
sc-stripe/
├── SKILL.md
└── scripts/
    ├── products.js    # idempotent product/price upsert from config
    ├── webhook.js     # register endpoint, capture whsec
    ├── portal.js      # customer portal config
    └── restricted-key.js  # least-privilege key for runtime
```

## Implementation notes

- API base: `https://api.stripe.com/v1`
- Auth: `Authorization: Bearer <STRIPE_SECRET_KEY>` + `Stripe-Version: 2024-12-18.acacia`
- Bodies are `application/x-www-form-urlencoded`, NOT JSON.
- Idempotency: pass `Idempotency-Key: <uuid>` header to avoid duplicate products on retry.
- Convex integration: see `sc-convex` for `payments` schema + `http.ts` `/webhook/stripe` route example.
