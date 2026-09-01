---
name: sc-all
description: "One-prompt end-to-end deployment. Automatically chooses the VPS/Dokploy route when a usable VPS is available, otherwise the managed Vercel + Convex Cloud route. GitHub identity stays in SC; Vercel/Convex/Hostinger prefer Composio connected accounts on the managed route and fall back to SC credentials. Handles repo push, backend, frontend, custom domain DNS, verification, then proactively offers one useful next step such as transactional email setup."
---

# /sc-all — one prompt, two deployment routes

Use this when the user says things like **deploy this**, **ship this app**, **put this online**, or asks for a full domain-to-production flow.

The user should not need to know `dokploy`, `hybrid`, or `vercel` up front. Default to **auto routing**.

## Core promise

One user request should drive the whole sequence:

`inspect → choose route → satisfy auth safely → GitHub → backend → frontend → domain/DNS → verify → recommend next action`

Do not stop after creating a project, adding a domain, or triggering a build. Finish the production path and verify it.

## Route selection

Start with:

```bash
sc deploy plan --target auto --json
```

If the host agent knows a Composio connector is available, use `--composio`. The pure route planner never reads or returns secret values.

### Route A — user has a usable VPS

Choose this when Dokploy/VPS capability is configured or the user explicitly asks for VPS/self-hosted.

```text
GitHub (SC) → Convex self-hosted → Dokploy → Hostinger DNS → verify
```

Default target: `dokploy`.

If the user explicitly wants the frontend on the VPS but a managed database, use `hybrid`:

```text
GitHub (SC) → Convex Cloud → Dokploy → Hostinger DNS → verify
```

### Route B — user has no usable VPS

Automatically choose managed hosting:

```text
GitHub (SC) → Convex Cloud → Vercel → Hostinger DNS → verify
```

Do not ask "Do you have a VPS?" if the environment already answers it. Ask only when detection is genuinely ambiguous.

## Secret/provider routing

Read `../../references/provider-routing.md` when provider auth is involved.

Canonical policy:

| Provider | VPS route | Managed/no-VPS route |
|---|---|---|
| GitHub | **SC** | **SC** |
| Dokploy | **SC** | n/a |
| Convex | SC/self-hosted | **Composio preferred**, SC fallback |
| Vercel | optional | **Composio preferred**, SC fallback |
| Hostinger | Composio or SC | **Composio preferred**, SC fallback |

### GitHub is intentionally special

Keep repo creation/push identity in SC. Do not silently switch deployment source identity to a Composio GitHub account. Composio GitHub can still be used later for optional PR/issues/releases.

If `GITHUB_TOKEN` is missing, request the local hidden handoff:

```bash
sc secret set github GITHUB_TOKEN
```

Never ask the user to paste the token into chat.

### Composio path

When Composio tools/connectors are available:

1. Search the connector/tool catalog for the exact Vercel, Convex, or Hostinger action.
2. Check the toolkit connection.
3. If disconnected, initiate the provider's secure connection flow and show the returned auth link.
4. Continue only after the connection is active.
5. Execute provider operations through the connector so raw provider credentials never enter chat.

Do **not** fetch/decrypt provider credentials merely to move them between services.

If Composio is unavailable, use the existing SC credential profile + `sc-vercel`, `sc-convex-cloud`, and Hostinger libraries.

## One-prompt orchestration

### Phase 0 — inspect, do not interrogate

Infer from the repository whenever possible:

- project/app name from package/repo/directory,
- GitHub remote/owner,
- framework and build command,
- whether `convex/` exists,
- existing production domain,
- existing Vercel/Dokploy project state.

Ask only for information that cannot be safely inferred, such as the desired domain when several valid domains exist.

### Phase 1 — GitHub

GitHub is shared by both routes.

- Verify SC GitHub status.
- Create the repository if missing.
- Protect `.env*`, keys, certificates, and other secret files before `git add`.
- Commit/push with the intended account.
- Prefer SSH or the existing secure repository binding; never embed a PAT in a Git URL.

### Phase 2A — VPS route

For `dokploy`:

- ensure/create Dokploy project,
- provision self-hosted Convex when the project requires it,
- ensure/create Dokploy application,
- inject required public build values,
- attach the desired domain,
- deploy and poll until success/error,
- configure Hostinger DNS,
- verify backend + frontend + TLS.

For `hybrid`, replace self-hosted Convex with Convex Cloud but keep the frontend on Dokploy.

### Phase 2B — managed/no-VPS route

1. **Convex Cloud**
   - reuse an existing project/deployment when appropriate,
   - otherwise create/prepare the production deployment,
   - keep deployment credentials out of model-visible output.

2. **Vercel**
   - create/reuse the project,
   - bind it to the GitHub repository,
   - apply environment configuration without exposing secret values,
   - create the production deployment and poll to `READY` or terminal failure.

3. **Domain first-class flow**
   - use the user's chosen Hostinger domain/subdomain,
   - add that exact domain to the Vercel project,
   - read Vercel's required DNS configuration,
   - write/validate the corresponding Hostinger record,
   - re-check Vercel domain verification and HTTPS.

Never invent a replacement subdomain when a working canonical domain already exists.

## Completion gate

A deployment is not complete until all applicable checks pass:

- repository remote/branch is correct,
- backend is reachable,
- frontend deployment is successful,
- custom domain is attached,
- DNS resolves to the intended target,
- HTTPS works,
- public app responds,
- no secret was printed to chat/log output.

Report the final canonical URL and the route used (`vps/dokploy`, `vps/hybrid`, or `managed/vercel`).

## Proactive next-step behavior

After a successful milestone, **offer exactly one high-value next action**. Do not dump a generic checklist.

Good pattern:

> Deployment is live. The highest-value next step is transactional email so password reset/invites can work. I can configure Resend next; it needs a Resend account/API key and a verified sender domain. If you want, I’ll give you the secure setup link/terminal handoff and continue from there.

Rules:

1. Explain the benefit in one sentence.
2. Name the prerequisites before asking for approval.
3. Ask a simple opt-in question.
4. If the user agrees, give the secure auth link or `sc secret set ...` handoff; never request the raw key in chat.
5. After completing that action, recommend the next most relevant one.

Typical progression, only when relevant:

`deploy → transactional email → auth/account flows → observability/alerts → backups/recovery → CI/release hardening`

Do not recommend a service already configured and healthy.

## Explicit target compatibility

Advanced users may still force:

```bash
sc deploy plan --target dokploy
sc deploy plan --target hybrid
sc deploy plan --target vercel
```

Legacy low-level commands remain available through `sc-dokploy`, `sc-convex`, `sc-convex-cloud`, and `sc-vercel`. `/sc-all` owns the routing and orchestration; sub-skills own provider-specific mechanics.

## Related references

- Provider/secret routing: `../../references/provider-routing.md`
- Portable skills/plugins: `../../references/portable-skills.md`
- Secret CRUD and MCP boundary: `../sc-provider/SKILL.md`
