# Cloudflare credentials (STUB — for future /sc-cf)

## `CLOUDFLARE_API_TOKEN` (optional)

Used by `/sc-cf` for DNS/Workers/Pages/R2. NOT a Global API Key — make a scoped token.

**Scopes**: `Zone:Read`, `Zone:DNS:Edit`, `Account:Workers Scripts:Edit`, `Account:Pages:Edit`, `Account:R2:Edit` (only what you need).

**How to get one**: https://dash.cloudflare.com/profile/api-tokens → Create Token → **Edit zone DNS** template (or **Custom token** for Workers/Pages/R2).

**Validator**: length ≥ 32.

## `CLOUDFLARE_ACCOUNT_ID` (optional)

**How to get one**: https://dash.cloudflare.com/?to=/:account/workers-and-pages → **Account details** → copy Account ID (or Account home → account-row menu → *Copy account ID*).

**Validator**: length ≥ 16.
