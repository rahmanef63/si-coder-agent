# Provider routing policy

This is the policy used by `sc-all`/`sc deploy plan`. It is intentionally explicit so an agent never guesses where a credential should live.

## Rule 1 — GitHub stays in SC by default

GitHub repo creation/push is foundational to both deploy paths. Keep `GITHUB_TOKEN` in the local SC profile and run Git/GitHub operations through SC/direct Git. Composio GitHub may be used later for optional issue/PR/release workflows, but it is not the default source identity for deployment.

## Rule 2 — Managed/no-VPS path prefers Composio

When the host exposes a Composio connector/MCP and the user has connected the toolkit, prefer Composio for:

- Vercel project/domain/deployment operations.
- Convex Cloud control-plane operations.
- Hostinger domain/DNS operations.

Credentials stay inside the connected account. The skill should call the connector, not ask for the provider key in chat.

If Composio is unavailable, fall back to SC-managed credentials and the existing `sc-vercel`, `sc-convex-cloud`, and Hostinger libraries.

## Rule 3 — VPS path keeps VPS control local

Dokploy credentials stay in SC. The frontend/backend is controlled directly by SC on the user's VPS. Hostinger DNS may use Composio when connected, otherwise SC.

## Rule 4 — Composio itself is bootstrapped safely

`COMPOSIO_API_KEY` may be stored in SC if a local SC runtime is available. Do not send it through agent tool JSON. If the host provides Composio natively, use its connection flow instead and do not duplicate the secret locally.

## Important Convex boundary

Composio can manage Convex projects/deployments and connected authentication. Do not expose a newly created Convex deploy key to the model just to copy it elsewhere. If a code deployment still needs a deploy key, keep that key in SC/local CI or use a connector/workflow that can transfer it server-side without returning the value to chat. Never turn a control-plane convenience into a secret exfiltration path.
