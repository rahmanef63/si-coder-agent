# Hostinger DNS (optional)

## `HOSTINGER_API_TOKEN` (optional but recommended)

Enables automatic A-record creation for your main domain + `api-`, `dash-`, `site-` Convex subdomains. Without it, you must add DNS records manually before deployment.

**Get it:** https://hpanel.hostinger.com/profile/api (hPanel → Profile → API)
1. Click **Generate token**, name it, pick a (short) expiration → **Generate**
2. Copy it now — the value is hidden once you leave the API page

No scope picker: the token has full account access (DNS zone management included).

**Validator**: length ≥ 32.

If your DNS provider is **not** Hostinger, skip this. You can manually point an A record at your Dokploy server's IP.

## Future: Cloudflare

When `/sc-cf` ships, it will replace Hostinger automation for users on Cloudflare DNS. See `steps/cf.md` (TBD).
