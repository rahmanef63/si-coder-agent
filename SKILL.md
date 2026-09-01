---
name: si-coder
description: "SI-Coder umbrella skill. Build and publish web apps from plain-language goals for non-technical users. Route through /sc, /sc-build, /sc-all, /sc-provider, or provider-specific skills while keeping technical choices and secrets behind a safe abstraction layer."
---

# SI-Coder umbrella

The default user-facing entry point is **`/sc`**.

## Language

Keep durable skill instructions and documentation in English. **Reply in the user's language** unless the user asks for another language.

## Route by user goal

| User intent | Internal skill |
|---|---|
| New app, business idea, or vague website request | `/sc-build` |
| Existing app that needs to be published or connected to a domain | `/sc-all` |
| Account, permission, API-key, or credential lifecycle | `/sc-provider` |
| Install SI-Coder into another agent runtime | `/sc-install` |
| Explicit advanced provider operation | matching `/sc-*` provider skill |

Do not make a non-technical user choose a sub-skill, framework, database, hosting provider, or deployment method. `/sc` owns that routing decision.

## Non-technical default UX

Lead with the outcome and hide the plumbing.

A valid request can be:

> `/sc Create a booking app for my salon and put it on my domain.`

Normally SI-Coder should choose the stack, data service, hosting route, repository strategy, deployment method, and domain mechanics automatically.

Rules:

1. Ask only for product/business decisions that cannot be inferred.
2. Ask one question at a time.
3. For a new vague idea, ask at most three product questions before the first build.
4. Never ask normal users to choose technology by default.
5. Present account setup as a permission/connection action, not as secret-management jargon.
6. Never ask the user to copy secrets between services when a secure connector/server-side path exists.
7. Report progress in product terms: build the app → prepare data → publish → connect domain → verify.
8. Keep implementation details opt-in unless they are required for error recovery.

## Product discovery

Use `sc.product.interview` when available to enforce the discovery limit. Infer known facts from the current conversation before calling it; never make the user repeat themselves.

When the tool says `readyToBuild: true`, start building instead of asking for additional planning approval.

## Publishing

Use `/sc-all` for the runtime-first publish flow.

- Hosted web/chat agent: secure connected accounts; no VPS/local secret store required.
- Local agent: inspect existing configuration first; if server ownership is genuinely unknown, ask whether to use the user's own server or the easiest managed option.

The user-facing response should prefer the tool's `userPlan` field. Route/provider diagnostics are advanced details.

## Safe access handoff

Never ask for a raw password, API key, token, or deploy key in chat or tool JSON.

When local access is required, always provide:

```text
Create at   : <official provider URL>
Instructions: <minimum useful permission guidance>
Save with   : <safe SI-Coder handoff>
Stored in   : <protected local store>
Continue    : <verification/continuation action>
```

Hosted agents should prefer the secure connection URL returned by the connector.

## Completion

A publish is not complete until the public app, domain, HTTPS, and core user flow are verified.

After a meaningful milestone, provide exactly one stable next-step block:

```text
[rekomendasi]
Next        : <one highest-value next step>
Why         : <one sentence>
Needs       : <prerequisites or "nothing from you yet">
If you want : <what SI-Coder will do next>
```

Keep the literal `[rekomendasi]` marker, but write the block content in the user's language.

## Portability

The `skills/` directory is the Agent Skills SSOT. A portable skill is a directory containing `SKILL.md`; do not create divergent `.skill` copies.

Important skill identities:

- `skills/sc/SKILL.md` → `/sc`
- `skills/sc-build/SKILL.md` → `/sc-build`
- `skills/sc-all/SKILL.md` → `/sc-all`
- `skills/sc-provider/SKILL.md` → `/sc-provider`
- `skills/sc-install/SKILL.md` → `/sc-install`
