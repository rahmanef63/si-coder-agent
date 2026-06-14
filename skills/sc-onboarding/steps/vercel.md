# Vercel credentials

## `VERCEL_TOKEN` (required)
Personal Access Token. https://vercel.com/account/tokens → Create.
**Validator**: length ≥ 24.

## `VERCEL_TEAM_ID` (optional)
Only if the project lives under a team. Settings → General → Team ID. Appended as `?teamId=` to every API call.
**Validator**: length ≥ 8.

## Deploy flow
`/sc-vercel` creates a project bound to your GitHub repo, sets the build command to
`npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL`
(couples Convex Cloud deploy + Next.js build), adds your domain/subdomain, and writes the
matching A/CNAME to Hostinger from Vercel's required DNS config. Requires `CONVEX_DEPLOY_KEY`.
