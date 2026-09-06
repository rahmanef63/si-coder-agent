# Cloudflare credentials — DNS automation active

## `CLOUDFLARE_API_TOKEN` (optional)

Used by `/sc-cf` for implemented DNS automation. Workers/Pages/R2/tunnel remain outside the implemented scope. NOT a Global API Key — make a scoped token.

**Scopes for current DNS automation**: `Zone:Read`, `Zone:DNS:Edit` only. Add broader account permissions only for a future capability that actually needs them.

**How to get one**: https://dash.cloudflare.com/profile/api-tokens → Create Token → **Edit zone DNS** template (or **Custom token** for Workers/Pages/R2).

**Validator**: length ≥ 32.

## `CLOUDFLARE_ACCOUNT_ID` (optional)

**How to get one**: https://dash.cloudflare.com/?to=/:account/workers-and-pages → **Account details** → copy Account ID (or Account home → account-row menu → *Copy account ID*).

**Validator**: length ≥ 16.
