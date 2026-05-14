#!/usr/bin/env node
// products.js — STUB. Idempotent Stripe product/price upsert from a config file.
//
// TODO(impl):
// 1. Add lib/stripe.js with form-encoded fetch helper, Idempotency-Key support.
// 2. Read products.json describing { products: [{ name, prices: [...] }] }.
// 3. For each product: search by metadata.sku → upsert.
// 4. For each price: search by lookup_key → upsert (Stripe prices are immutable, so "upsert" = archive old + create new on diff).
// 5. Output mapping product.id → sku for app to consume.
console.error('sc-stripe/products.js: not implemented yet. See SKILL.md for plan.');
process.exit(2);
