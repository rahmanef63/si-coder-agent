# Stripe credentials (STUB — for future /sc-stripe)

## `STRIPE_SECRET_KEY` (optional)

Server-side Stripe key. Use `sk_test_...` while developing — switch to `sk_live_...` only for production.

**How to get one**: https://dashboard.stripe.com/apikeys — Developers → API keys (test-mode keys live at https://dashboard.stripe.com/test/apikeys). Live `sk_...` is shown once — copy it immediately.

**Validator**: starts with `sk_test_` or `sk_live_`.

## `STRIPE_PUBLISHABLE_KEY` (optional)

Client-side key — safe to embed in frontend bundles.

**How to get one**: same **API keys** page (shown by default, no reveal needed): https://dashboard.stripe.com/apikeys

**Validator**: starts with `pk_test_` or `pk_live_`.

## `STRIPE_WEBHOOK_SECRET` (optional)

Returned when `/sc-stripe` registers a webhook endpoint. Used to verify Stripe signatures in your handler.

**How to get one** (manual, until `/sc-stripe` lands): https://dashboard.stripe.com/webhooks → add/select an endpoint → reveal its signing secret.

**Validator**: starts with `whsec_`.
