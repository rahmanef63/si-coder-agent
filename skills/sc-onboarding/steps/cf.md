# Cloudflare credentials (STUB — for future /sc-cf)

## `CLOUDFLARE_API_TOKEN` (optional)

Used by `/sc-cf` for DNS/Workers/Pages/R2. NOT a Global API Key — make a scoped token.

**Scopes**: `Zone:Read`, `Zone:DNS:Edit`, `Account:Workers Scripts:Edit`, `Account:Pages:Edit`, `Account:R2:Edit` (only what you need).

**How to get one**: https://dash.cloudflare.com/profile/api-tokens → Create Token → Custom token.

**Validator**: length ≥ 32.

## `CLOUDFLARE_ACCOUNT_ID` (optional)

Find it in the right sidebar of any Cloudflare account dashboard page.

**Validator**: length ≥ 16.
