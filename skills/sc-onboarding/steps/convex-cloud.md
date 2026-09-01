# Convex Cloud connections

Convex Cloud supports more than one authorization shape. Do not put all Convex credentials into one anonymous profile blob; create a labeled SI-Coder connection for the intended scope.

## Account / management connection — Bearer token

Auth method: `personal-access-token`

### `CONVEX_PERSONAL_ACCESS_TOKEN`

Create/manage:
https://dashboard.convex.dev/profile#personal-access-tokens

Navigation:
**Profile → Personal Access Tokens → Create Token → name/expiration → Create → Copy**.

This is a broad account-level credential for the Convex Management API. It uses `Authorization: Bearer <token>` and has the access of the account that created it.

Example:

```bash
sc user connection-add rahmanfakhr convex-cloud "Convex Admin" --auth personal-access-token
sc user credential-set rahmanfakhr convex-cloud CONVEX_PERSONAL_ACCESS_TOKEN --connection convex-admin
```

## Deployment / project connection — API key

Auth method: `deployment-key`

A deployment connection has **two required fields**.

### `CONVEX_DEPLOYMENT_NAME`

Open the target Convex project and deployment, then **Settings**. Copy the deployment name, e.g. `acoustic-panther-728`.

### `CONVEX_DEPLOY_KEY`

Open the target deployment → **Settings → Deploy keys → Generate a deploy key**. Name it and grant only the permissions required. A deployment pipeline needs `deployment:deploy`; an AI agent that reads logs/data/env may need additional explicit deployment role actions.

Deploy keys may be `prod:`, `preview:`, or `dev:`.

Example:

```bash
sc user connection-add rahmanfakhr convex-cloud "Client A Production" --auth deployment-key
sc user credential-set rahmanfakhr convex-cloud CONVEX_DEPLOYMENT_NAME --connection client-a-production
sc user credential-set rahmanfakhr convex-cloud CONVEX_DEPLOY_KEY --connection client-a-production
```

The Deployment Platform API sends the key as `Authorization: Convex <key>` to the selected `<deployment-name>.convex.cloud` endpoint.

## `CONVEX_DEPLOYMENT` legacy/local marker

`npx convex dev` may write a local deployment marker. It is not a substitute for a named account/deployment connection and should normally stay out of CI.

## References

- https://docs.convex.dev/management-api/overview
- https://docs.convex.dev/management-api/convex-management-api
- https://docs.convex.dev/management-api/create-deploy-key
- https://docs.convex.dev/deployment-platform-api
- https://docs.convex.dev/team-management/role-actions
