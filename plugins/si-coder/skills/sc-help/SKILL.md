---
name: sc-help
description: "Quick reference for SI-Coder route selection, secret-safe provider control, portable installation, and provider-specific skills. Use for 'sc help', 'what should I run', 'which deploy route', or 'list si-coder commands'."
---

# sc-help

## Language

Keep durable instructions in English. **Reply in the user's language** unless they request another language.


## Non-technical default UX — mandatory

SI-Coder is primarily for people who want a working web app, not an infrastructure lesson. **Lead with the outcome, hide the plumbing.**

A valid user request can be as simple as:

> "Create a salon booking app and put it on my domain."

From that sentence, the agent should normally choose the stack, database/data service, hosting route, repository strategy, deployment method, domain records, and verification approach itself.

Rules:

1. **Speak in goals:** "publish the app", "connect the account", "connect the domain", "store the app data". Do not lead with terms such as environment variable, DNS record, deploy key, compose, container, build pipeline, or provider routing.
2. **One user action at a time.** Never dump a setup checklist when only one permission/account connection blocks progress.
3. **Do not ask users to choose technology** unless they explicitly care. Choose sensible defaults and keep the technology name in optional technical details.
4. **Do not ask a question that tools/repo state can answer.** Inspect first, then ask only the unresolved product/domain/account decision.
5. **Credentials are framed as permissions, not secrets.** Say "I need permission to use the email service" first. Then show the official create/connect action, where access is stored, and what SI-Coder will do next. Put env-key names and terminal commands under optional technical details unless the user must run the command.
6. **Never ask the user to copy values between services** when a connector/server-side flow can do it safely.
7. **Progress is product-oriented:** `Build the app → Prepare data → Publish → Connect domain → Verify`, not internal provider phases.
8. Every completion message must state what is now working and then offer exactly one `[rekomendasi]` next step.
9. Technical users can ask for "technical details", `--technical`, JSON, or provider-specific skills. Do not force those details on everyone else.
10. When a planner/tool returns `userPlan`, **that is the default user-facing response**. Fields such as route, providerRouting, executionEngine, credential key names, and raw flow ids are internal/advanced unless they are necessary to recover from an error.

When a technical failure occurs, translate it first:

- preferred: "The domain is not connected yet. I am fixing the connection between the domain and the website."
- optional detail: "The CNAME does not match the hosting target yet."

Never hide a failure, but explain its user impact before its implementation detail.


## Pick the entry point

| Goal | Internal skill identity |
|---|---|
| Describe anything you want SI-Coder to build/change | `sc` |
| New/vague app idea | `sc-build` |
| Existing app: publish from repo to production | `sc-all` |
| API/provider credential or account connection | `sc-provider` |
| Install in Claude Code/Codex/Hermes/OpenClaw | `sc-install` |
| Provider-specific operation | matching `sc-*` skill |

Invocation is a host concern: ChatGPT Web uses automatic selection or `@sc` for the personal Skill; Claude Code exposes the main skill as `/sc`.

## Deploy routing

```bash
# Hosted Claude Web / ChatGPT-style runtime
sc deploy plan --runtime hosted --composio

# Local runtime: VPS is the first branch
sc deploy plan --runtime local
```

- **hosted web/chat** → full Composio for GitHub + Convex Cloud + Vercel + Hostinger; no VPS required.
- **local, VPS unknown** → ask once whether the user has a VPS instead of guessing.
- **local + VPS** → SC GitHub/Dokploy/self-hosted Convex.
- **local + no VPS** → SC GitHub; Vercel/Convex/Hostinger prefer Composio, SC fallback.

Advanced overrides: `--runtime hosted|local` and `--target dokploy|hybrid|vercel|vps|managed`.

## Local CLI navigation

On a TTY, bare `sc` is a persistent layered menu. Use `Tab` to enter a deeper layer, `→`/`Enter` to open or run, and `←`/`Esc` to go back. Completing an action returns to the current breadcrumb layer. `Esc` at Home does not quit; choose Quit or press Ctrl-D.

Credential profiles have explicit user/account ownership:

```bash
sc user
sc user show <profile>
sc user owner <profile> <owner>
sc user map <folder> <profile>
sc user which
```

Owner metadata is separate from credential values. Never infer that credentials from one profile may be reused by another owner.

## Secret-safe commands

| Command | Purpose |
|---|---|
| `sc providers [--json]` | provider metadata + safe credential state |
| `sc secret list/get ...` | state/source only; plaintext disabled |
| `sc secret set <provider> [KEY]` | hidden local credential entry |
| `sc secret rm ... --yes` | remove managed credential |
| `sc run -- <cmd>` | run child with resolved profile, without printing secrets |
| `sc doctor` | live provider validation |
| `sc audit --json` | metadata-only lifecycle audit |
| `sc update --check` / `sc update` | safe fast-forward self-update |

## Portable install

```bash
bash install.sh --agent claude
bash install.sh --agent codex --with-mcp
bash install.sh --agent hermes
bash install.sh --agent openclaw
bash install.sh --agent all
```

Claude plugin development/direct use:

```bash
claude --plugin-dir /path/to/si-coder-agent
```

## Skills

`/sc-all`, `/sc-provider`, `/sc-install`, `/sc-git`, `/sc-dokploy`, `/sc-convex`, `/sc-convex-cloud`, `/sc-vercel`, `/sc-cf`, `/sc-onboarding`, `/sc-sync`, `/sc-n8n` are active surfaces. Provider-specific Resend/Stripe/Clerk/Supabase automation may still be partial, while their credential schemas can be managed by SC.

## After completing a task

Recommend one useful next step with its benefit + prerequisites, then ask whether the user wants it. Never request a raw secret in chat; use a secure provider connection or `sc secret set ...` handoff.

## Mandatory credential + next-step response contract

Whenever a credential/API key is missing, **never output only the variable name**. Always make the handoff explicit:

```text
Buat di      : <authoritative provider URL / secure connector auth link>
Petunjuk     : <minimum scope / exact menu when useful>
Save with   : <sc secret set provider KEY, or provider connector>
Stored in   : <SC profile 0600, or Composio connected account>
Lanjut       : <verification/resume action>
```

Rules:
- Local SC runtime: use the provider endpoint from the registry and `sc secret set <provider> <KEY>`; tell the user it lands in the active SC profile (`~/.config/si-coder/profiles/<name>.env`, mode 0600; managed `~/.bashrc` only when no profile exists).
- Hosted Claude Web/ChatGPT-style runtime: prefer the secure Composio connection URL returned by the connector; credentials stay in the connected account. Do not ask for the raw provider key unless the connector explicitly requires an API key bootstrap.
- If a custom API-key provider has no creation URL, do not guess one. Require its provider metadata to be updated with `--url https://...` first.
- Never put the credential value in chat, argv, logs, recommendations, or tool JSON.

After every meaningful completed milestone, emit exactly one next-step block:

```text
[rekomendasi]
Next        : <one highest-value next step>
Why         : <one sentence>
Needs       : <prerequisites, or "nothing from you yet">
If you want : <what SI-Coder will do next / secure auth handoff>
```

Do not dump multiple recommendations. Do not recommend something already configured and healthy.
