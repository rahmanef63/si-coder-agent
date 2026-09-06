# Composio API connections

Composio has project-scoped and organization-scoped API credentials. Keep them as separate labeled SI-Coder connections.

## Project API connection — `COMPOSIO_API_KEY`

Scope: one Composio project. Sent in `x-api-key`.

Dashboard navigation:
**Platform → select project → Settings / Project Settings → API Keys → Create API Key**.

Prefer a scoped project key when the agent only needs selected resource areas such as Sessions, Tool execution, Connected accounts, or Toolkits.

Example:

```bash
sc user connection-add rahmanfakhr composio "SI-Coder Project" --source sc --auth project-api-key
sc user credential-set rahmanfakhr composio COMPOSIO_API_KEY --connection si-coder-project
```

## Organization API connection — `COMPOSIO_ORG_API_KEY`

Scope: every project in the organization. Sent in `x-org-api-key` and should be used only for organization/project administration.

Dashboard navigation:
**Organization Settings → General Settings → Organization Access Tokens**.

Example:

```bash
sc user connection-add rahmanfakhr composio "Organization Admin" --source sc --auth organization-token
sc user credential-set rahmanfakhr composio COMPOSIO_ORG_API_KEY --connection organization-admin
```

## Multiple connected provider accounts

Composio also lets one user connect several accounts for the same toolkit and assign unique aliases. SI-Coder mirrors that concept with named connections. See `docs/research/composio-auth-matrix.md`.

## References

- https://docs.composio.dev/reference/authenticating-to-composio
- https://docs.composio.dev/reference/authenticating-to-composio/project-api-key-permissions
- https://docs.composio.dev/docs/authentication/managing-multiple-connected-accounts
