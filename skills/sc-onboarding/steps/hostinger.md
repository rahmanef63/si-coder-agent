# Hostinger DNS (optional)

## `HOSTINGER_API_TOKEN` (optional but recommended)

Enables automatic A-record creation for your main domain + `api-`, `dash-`, `site-` Convex subdomains. Without it, you must add DNS records manually before deployment.

**How to get one**:
1. Hostinger hPanel → Advanced → API
2. Generate a developer token
3. Copy the value

**Validator**: length ≥ 32.

If your DNS provider is **not** Hostinger, skip this. You can manually point an A record at your Dokploy server's IP.

## Future: Cloudflare

When `/sc-cf` ships, it will replace Hostinger automation for users on Cloudflare DNS. See `steps/cf.md` (TBD).
