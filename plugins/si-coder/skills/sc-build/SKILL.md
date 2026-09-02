---
name: sc-build
description: "Build a web app from a plain-language idea for a non-technical user. Ask at most three short business/product questions one at a time, infer everything already stated, choose technical defaults automatically, create a first working version, gather product feedback, then publish through /sc-all."
use_when: "Use when the task matches this skill scope: Build a web app from a plain-language idea for a non-technical user. Ask at most three short business/product questions one at a time, infer everything already stated, choose technical defaults automatically, create a first working version, gather product feedback, then publish through /sc-all."
do_not_use_when: "Do not use when the task is outside this skill scope or a more specific SI-Coder skill owns the requested outcome."
required_tools: []
security_constraints: "Never request, print, or persist plaintext credentials in chat/tool payloads; use SI-Coder safe credential handoffs."
references: []
compatibility: "Standalone SI-Coder; host invocation syntax and available tools may vary."
---

# /sc-build — idea to working web app

Use this for a new app, a vague business idea, or requests such as:

> `/sc-build I need a website for my laundry business.`

The user is not expected to provide a PRD, choose a framework, understand hosting, or know database terminology.

## Language

Reply in the user's language. Keep internal instructions and durable documentation in English.

## Phase 1 — understand the product, not the infrastructure

First extract as much as possible from the user's existing message:

- the outcome they want,
- who will use it,
- the most important user action,
- any must-have requirement,
- business/product name if given,
- desired domain if given,
- whether there is already an existing project.

Do **not** ask again for anything already stated or safely inferable.

When product information is genuinely missing, use the `sc.product.interview` tool when available. Otherwise follow the same policy manually.

### Interview rules

1. Ask **one question at a time**.
2. Ask at most **three questions before the first build**.
3. Questions are business/product questions, never technology questions.
4. Prefer 2–4 plain-language choices when they make answering easier.
5. A domain is not required for the first preview.
6. Do not ask about framework, database, hosting provider, repository provider, DNS, containers, CI, or environment variables by default.
7. If the user says "use your best judgment", stop interviewing and build.
8. After three questions, use sensible assumptions and build a focused first version.

## Phase 2 — create the internal build brief

Create a concise internal brief without asking the user to approve technical details:

- product goal,
- users/roles,
- primary flow,
- first-version must-have,
- pages/screens implied by the flow,
- data the app needs,
- external services only when the feature requires them,
- launch/domain preference if already known.

Choose the simplest maintainable architecture supported by the current environment and existing project standards. If an existing project is present, preserve its architecture unless the user requested a migration.

## Phase 3 — build first, explain second

Create the first working version as soon as the brief is sufficient.

Default quality bar:

- responsive/mobile-first,
- accessible basic interactions,
- useful empty/loading/error states,
- real data flow for the core feature rather than decorative mock UI,
- authentication only when the product actually needs separate identities/roles,
- sensible validation and safe defaults,
- no placeholder files that exist only to preserve obsolete imports,
- DRY/SSOT implementation appropriate to the chosen stack.

Do not make the user review an implementation plan before building unless there is a real cost, destructive change, legal/compliance concern, or another decision that cannot be safely inferred.

## Phase 4 — preview and product feedback

When a preview is possible, summarize what now works in user terms. Ask for product feedback, not technical approval.

Good:

> "The first version is ready: customers can choose a service and request a booking, and the admin can see incoming requests. What would you like to change in the experience?"

Avoid:

> "Do you approve Svelte + Convex + Vercel?"

If the user is satisfied or asked to publish immediately, continue without another confirmation loop.

## Phase 5 — publish seamlessly

Follow `/sc-all` for the runtime-first deployment, connected-account, domain, and verification flow.

- Hosted chat/web agent → use secure connected accounts; do not require a VPS or local secret store.
- Local runtime → infer existing server configuration; if genuinely unknown, ask in plain language whether the user wants to use their own server or the easiest managed option.
- Never ask the user to copy secret values between services when a connector/server-side path can do it.

A publish is complete only after the public app and domain/HTTPS path are verified.

## Permission/access handoff

When one service permission blocks progress, present only that action:

- what access is needed in user language,
- the official URL or secure connector link,
- where SI-Coder stores the access safely,
- what SI-Coder will do immediately after the user completes it.

Keep environment key names, terminal commands, and provider internals in optional technical details unless the user must run a command locally.

## Completion and next step

State what is working now, including the canonical public URL when published. Then provide exactly one:

```text
[rekomendasi]
Next        : <one highest-value next improvement>
Why         : <one sentence>
Needs       : <prerequisites, or "nothing from you yet">
If you want : <what SI-Coder will do next>
```

Do not present a generic backlog or upsell list.
