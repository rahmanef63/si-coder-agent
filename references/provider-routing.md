# Provider routing policy

This policy is used by `sc-all` / `sc deploy plan`. Routing starts with **runtime**, not provider credentials.

## Rule 0 — runtime first

There are three execution contexts:

1. **Hosted** — Claude Web, ChatGPT chat, or another hosted agent with connectors but no normal local SC vault/shell.
2. **Local, no VPS** — Claude Code/Codex/Hermes/OpenClaw running on a machine, user chooses managed hosting.
3. **Local + VPS** — local runtime with a VPS/Dokploy deployment target.

Never apply local-secret assumptions to a hosted chat.

## Rule 1 — hosted = full Composio

Hosted deployments use Composio connected accounts for all deployment providers:

- GitHub
- Convex Cloud
- Vercel
- Hostinger

There is no local SC/Git identity to preserve in this mode. The agent should discover the toolkit actions, ensure the correct account is connected, execute the flow, and keep provider credentials inside Composio.

If Composio is unavailable, stop at a secure connection/enablement step. Never ask the user to paste provider API keys into chat and never pretend a local SC vault exists.

An explicit VPS/Dokploy request from hosted mode requires a connected VPS runner/MCP or a local SI-Coder runtime.

## Rule 2 — local GitHub stays in SC

For local runtimes, GitHub repo creation/push remains SC/direct Git by default. This keeps source identity deterministic across deployment operations.

Composio GitHub may still be used for optional issues/PR/releases, but it is not the default deployment identity when a local SC runtime exists.

## Rule 3 — local no-VPS prefers Composio for managed providers

When connected, prefer Composio for:

- Vercel project/domain/deployment operations,
- Convex Cloud control-plane operations,
- Hostinger domain/DNS operations.

Fallback to SC-managed credentials only because a local SC runtime exists and can safely own that secret boundary.

## Rule 4 — local VPS keeps VPS control in SC

Dokploy credentials stay in SC. Self-hosted Convex runs under the VPS/Dokploy path. Hostinger may use Composio or SC. The `hybrid` target may use Composio for Convex Cloud while keeping the frontend on Dokploy.

## Rule 5 — bootstrap Composio safely

If a host provides Composio natively, use its secure connection flow. Do not duplicate provider secrets into SC.

`COMPOSIO_API_KEY` belongs in SC only when a local runtime actually needs to call Composio by API key. Never pass it through chat/tool JSON.

## Convex boundary

Do not expose a newly created Convex deploy key to the model just to copy it elsewhere. Prefer connected-account operations or a server-side credential handoff. On local fallback, keep the deploy key inside SC/local CI and consume it through `sc run` or another non-printing path.
