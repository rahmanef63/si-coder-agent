# Portable skill/plugin installation

SI-Coder uses the Agent Skills `SKILL.md` format. The same `skills/` tree is the SSOT; execution behavior changes by runtime.

## Hosted web/chat surfaces — Claude Web, ChatGPT chat

A hosted chat does **not** need a VPS and does **not** need a local SC vault to run the default deployment flow.

Treat it as `runtime=hosted`:

```text
Composio → GitHub → Convex Cloud → Vercel → Hostinger DNS → verify
```

All four deployment providers are Composio connected accounts. If an account is disconnected, provide the secure Composio auth link and continue after it becomes active. Never ask for raw provider API keys in chat.

The SI-Coder skill is the orchestration/script policy; the hosted agent executes equivalent connector calls directly. A local `sc` binary is optional/not required for this route.

If the hosted user explicitly requests VPS/Dokploy, a connected VPS runner/MCP or local runtime is required.

## Claude Code

- Plugin development/test: `claude --plugin-dir /path/to/si-coder-agent`
- Standalone skill links: `bash install.sh --agent claude`
- Plugin installs can start the bundled local `si-coder` MCP from `.mcp.json`.
- Because this is a local runtime, `/sc-all` branches first on VPS ownership when not already known.

## Codex CLI

- Install user skills: `bash install.sh --agent codex`
- Skills link to `~/.agents/skills`.
- `--with-mcp` registers the bundled SC MCP when Codex CLI is available.
- Local routing: VPS yes → Dokploy; VPS no → managed Vercel. GitHub stays local/SC by default.

## Hermes / OpenClaw / generic local agents

Use `bash install.sh --agent hermes`, `--agent openclaw`, or `--skills-dir /custom/skills`.

They follow the same local branch: first determine whether the user has a VPS, then choose VPS/Dokploy or managed/Vercel.

## Runtime rule summary

| Runtime | VPS question | GitHub | Managed providers |
|---|---|---|---|
| Hosted web/chat | **No** | Composio | Composio |
| Local, VPS unknown | **Ask once** | SC after branch | depends on branch |
| Local, no VPS | already answered | SC | Composio preferred / SC fallback |
| Local + VPS | already answered | SC | Dokploy/self-hosted via SC |
