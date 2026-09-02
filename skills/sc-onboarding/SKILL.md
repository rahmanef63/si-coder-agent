---
name: sc-onboarding
description: "Onboard SI-Coder provider credentials safely. Scans what is configured, asks only for missing pieces, prefers profile-scoped 0600 storage with managed ~/.bashrc fallback, and routes agents through /sc-provider so plaintext secrets never need to enter chat/tool JSON. One-shot CLI fallback: bin/onboard.js."
---

# /sc-onboarding — Guided credential setup

## Language

Keep durable instructions in English. **Reply in the user's language** unless they request another language.

> **Agent secret boundary:** never ask the user to paste an API key/token/password into chat, an MCP/function argument, or argv. Resolve `user → provider → connection` first. OAuth stays in the external connected-account flow; a direct new/rotated secret is entered with `sc user credential-set <user> <provider> <KEY> --connection <alias>` in the hidden terminal. Consume with `sc run [--connection provider=alias] -- <cmd>`.

Use this skill when the user is setting up `si-coder-agent` for the first time, or after they install a new `/sc-*` domain skill that needs new credentials.


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

When a technical failure occurs, translate it first:

- preferred: "The domain is not connected yet. I am fixing the connection between the domain and the website."
- optional detail: "The CNAME does not match the hosting target yet."

Never hide a failure, but explain its user impact before its implementation detail.


## The `sc` console (preferred entry point)

```
sc providers                 what is configured, per provider
sc providers show <id>       per-var detail + where to get each value
sc providers set  <id>       re-enter (rotate) every var for one provider
sc providers rm   <id>       remove its vars from the ~/.bashrc managed block
sc setup [--target t]        interactive wizard for whatever is missing
sc doctor [--target t]       LIVE check — calls each real API
sc preflight --target t      the gate /sc-all runs
```

Everything that picks *something* is arrow-key driven — no retyping identifiers that are
already on screen, and no silent typos:

- **`sc`** with no arguments opens the console menu (on a pipe it still prints usage, so
  scripts are unaffected).
- **`sc setup`** shows a checkbox list of all providers with **no implicit selection**.
  `↑/↓` move · `Enter` chooses the highlighted provider when nothing is checked / confirms
  when boxes are checked · `Space` multi-select · `Ctrl-A` all/none · `←/→` tabs · type to
  search · `Esc` clear/cancel. This prevents an unrelated Needs-fix provider from being
  configured just because it was preselected behind the cursor.
- **`sc providers show|set|rm`** with no id opens a single-select list.

Values themselves are still typed — a token has to be pasted — but secrets are read hidden
and never reach argv.

### More than one identity and more than one account

SI-Coder has two levels of identity:

```text
folder/project → user → provider → named connection
```

A user may have multiple labeled connections for the same provider. Example:

```text
rahmanfakhr
└─ convex-cloud
   ├─ Convex Admin        (Bearer token · account)
   ├─ Client A Production (API key · deployment)
   └─ Client B Preview    (API key · deployment)
```

Commands:

```bash
sc user add <name>
sc user map <folder> <name>
sc user which
sc user connections <name> [provider]
sc user connection-add <name> <provider> "<label>" --source <sc|composio|native-mcp> --auth <method>
sc user connection-use <name> <provider> <connection>
sc user connection-migrate <name> [provider]
```

Connection metadata is private but non-secret (`~/.config/si-coder/connections.json`, mode 0600). Only `source=sc` credential values live in one file per connection under `~/.config/si-coder/connections/<user>/<provider>/<connection>.env` (0600). Legacy user profile files remain readable only for compatibility/migration.

**Isolation rules:**

1. A resolved user outranks stale shell credentials.
2. Registry credentials not owned by that user are removed.
3. Within one provider, only one selected/default named connection is injected; fields from two connections are never merged.
4. A one-shot `sc run --connection provider=alias -- ...` override does not change the stored default.

`providers` answers "is it configured" (presence + format). `doctor` answers "does it
actually work" — a real call to the real API. A token can be perfectly well-formed and still
be revoked, expired, or belong to the wrong account; only the live call catches that, and it
also *names* what it reached (which GitHub login, which Cloudflare zones, which Vercel team),
which is how you catch a credential pointed at the wrong account.

The registry lives in `lib/providers.js`. Each var declares its own
required/secret/source/validator **plus credential source guidance** (`url`/`cmd`, `navigation[]`,
and `note`) inline. `DOMAIN_VARS` / `VALIDATORS` / `SECRET_SOURCES` are derived from it.
`lib/credential-guidance.js` is the renderer used by the Finder TUI, CLI onboarding, and agent
tool handoffs. `steps/<domain>.md` may add longer human context, but must not become a second
source of truth for where/how to obtain a credential.

## Two modes

### Mode A — AI-driven (default, interactive)

Triggered when the user runs `/sc-onboarding` from Claude / OpenClaw / Gemini.

The AI MUST:
1. **Ask which domains they want.** Present a checklist (core deploy domains shown;
   see the "Required vars per domain" table below or `skills/sc-onboarding/lib/onboarding-domains.js`
   `DOMAIN_VARS` for the full list, including the stub domains):
   - `[ ] github` (always required for any deploy)
   - `[ ] dokploy` (Dokploy CRUD + deploy targets)
   - `[ ] convex` (Convex self-hosted)
   - `[ ] hostinger` (optional DNS automation)
   - `[ ] vercel` (Vercel online frontend)
   - `[ ] convex-cloud` (Convex Cloud backend)
   - `[ ] sync` (Tailscale rsync of gitignored files between VPS and local)
   - `[ ] resend` (credential storage + live doctor) · `composio` (project API key + live doctor)
   - `[ ] cf` (Cloudflare) · `stripe` · `clerk` · `supabase` (remaining stub skills where noted)
2. **Run `scripts/scan-env.js --domains <list>`** to detect which required vars are already set in the user's environment (via `process.env` + `~/.bashrc` parse).
3. **For each missing provider connection, choose `source/backend` first.** Then inspect the auth methods for that source and choose the least-privilege method matching the task. Composio/native MCP are sources, not direct auth methods. For each required direct field, use the shared credential guidance from `lib/providers.js` / `credentialGuide()` to show the official reference URL or local command plus `navigation[]`. `steps/<domain>.md` is extended reference only. NEVER ask for vars that are already set unless the user says "reset" or "rotate".
4. **Write only the new values** to `~/.bashrc` by piping the pairs via **stdin** so the raw secret never lands in argv (`ps aux` / `/proc/<pid>/cmdline` / shell history):

   ```bash
   printf 'KEY=VALUE\nKEY2=VALUE2\n' | node scripts/scan-env.js --write-stdin
   ```

   Each `KEY=VALUE` is validated against the shared `VALIDATORS` (same source of truth as the CLI wizard) before anything is written; on the first failure it prints `KEY failed validation` and exits 1 **without writing any pair** (all-or-nothing). A legacy argv form (`scripts/scan-env.js --write KEY=VALUE [KEY=VALUE...]`, pairs positional before or after the boolean `--write`) still exists for non-secret keys only — **never pass secrets as argv**. Both paths append an idempotent managed block delimited by `# --- si-coder onboarding ---` / `# --- end si-coder onboarding ---`; keys are deduped on each run and existing exports outside the block are not edited.
5. **Confirm**: `source ~/.bashrc` + tell the user which `/sc-*` skill they can now use.

NEVER ask the user to paste a value if it is already exported. Never log the value back to the user — confirm with a capped preview only (≤4 leading chars + `…[len=N]`).

## Flow

```mermaid
flowchart TD
    A([/sc-onboarding]) --> B[Pick domains<br/>ticked checklist]
    B --> C[Scan sources:<br/>process.env + ~/.bashrc]
    C --> D[Resolve DOMAIN_VARS<br/>required + optional<br/>per ticked domain]
    D --> E{For each var:<br/>already set in<br/>env or ~/.bashrc?}
    E -- yes --> F[Skip<br/>never re-prompt]
    E -- no --> G{required?}
    G -- required --> H[Prompt for value<br/>missing required]
    G -- optional --> I[Prompt for value<br/>missing optional<br/>blank = skip]
    H --> J[Validate against VALIDATORS]
    I --> J
    J -- fail --> H
    J -- pass --> K[Collect into updates]
    F --> L
    K --> L{any updates<br/>to write?}
    L -- no --> M([Done — nothing to write])
    L -- yes --> N[Merge into managed block<br/># --- si-coder onboarding --- ... end<br/>dedup keys, single-quote escape]
    N --> O[Write ~/.bashrc<br/>chmod 0600]
    O --> P([source ~/.bashrc])
```

### Mode B — One-shot CLI (non-AI)

For users who clone the repo and want a scripted setup:

```bash
bash install.sh                        # symlink skills, then OFFER the wizard (interactive TTY only)
bash install.sh --no-onboard           # symlink only; never prompt (CI / curl | bash)
node bin/onboard.js                    # run the interactive wizard on its own
node bin/onboard.js --domains convex,dokploy,github   # non-interactive checklist
```

`install.sh` chains into the wizard when run in an interactive terminal, so a fresh
clone goes from install to configured in one flow. It auto-skips when stdin/stdout
is not a TTY (piped installs), or with `--no-onboard`, so `curl … | bash` never hangs.

The legacy one-shot wizard remains field-oriented for compatibility. The Finder/agent path is connection-oriented. For each missing legacy field the wizard:

1. **Prints where to get it** — the dashboard URL (or a local command, e.g. `tailscale status`)
   plus a one-line hint (required scope, path within the dashboard, "leave blank"). These come
   from the `SECRET_SOURCES` registry in `skills/sc-onboarding/lib/onboarding-domains.js` — the
   single source of truth that `scripts/scan-env.js` also prints next to each MISSING var.
2. **Reads secrets without echoing them** — token-shaped values (`isSecret(key)`) are read in
   raw mode with no terminal echo, so nothing lands in scrollback. Public values (URLs, publishable
   keys, ids) stay visible. New vars default to hidden until registered (fail-closed).
3. **Validates** against the `VALIDATORS` registry (same file) before writing.
4. **Writes** only new values into the managed `~/.bashrc` block. Nothing is ever passed via argv,
   so no secret reaches `ps` / `/proc/<pid>/cmdline` / shell history.

The `SECRET_SOURCES` ↔ `DOMAIN_VARS` registries are kept in lockstep by
`test/onboarding-sources.test.js` — adding a var without a source (or vice versa) fails the suite.

## Required vars per domain

Mirrors `skills/sc-onboarding/lib/onboarding-domains.js` `DOMAIN_VARS` (the single source of truth).

| Domain | Required | Optional |
|---|---|---|
| github | `GITHUB_TOKEN` | — |
| dokploy | `DOKPLOY_API_URL`, `DOKPLOY_API_KEY` | — |
| convex | (uses dokploy creds) | `CONVEX_ADMIN_KEY` (auto-generated on deploy) |
| hostinger | — | `HOSTINGER_API_TOKEN` (recommended) |
| vercel | `VERCEL_TOKEN` | `VERCEL_TEAM_ID` |
| convex-cloud | `CONVEX_DEPLOY_KEY` | `CONVEX_DEPLOYMENT` |
| sync | `SYNC_ROLE`, `SYNC_VPS_TS_ADDR`, `SYNC_LOCAL_TS_ADDR` | `SYNC_REMOTE_USER`, `SYNC_REMOTE_PATH` |
| cf (stub) | — | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| stripe (stub) | — | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET` |
| clerk (stub) | — | `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `NEXT_PUBLIC_CLERK_FRONTEND_API_URL` |
| supabase (stub) | — | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID` |
| resend | — | `RESEND_API_KEY`, `RESEND_FROM_DOMAIN` |
| composio | — | `COMPOSIO_API_KEY` |

Stub domains pre-register vars so `/sc-onboarding` can collect them; their `/sc-*` skills are not implemented yet. Resend and Composio credential setup/doctor are implemented directly in the `sc` provider console even though full provider-specific automation may remain separate. See `steps/*.md` for how to obtain each value.

## Safety

- Never echo secrets back to the user — confirm with a capped preview only (at most the first ~25% of the value, max 4 chars) plus `…[len=N]`.
- Never overwrite an existing export silently. Detect existing values, ask before rotating.
- The append block is a fixed, dedup-managed block delimited by `# --- si-coder onboarding ---` / `# --- end si-coder onboarding ---`, so the user can audit/remove it later.


## Relationship to Composio

This skill configures the **local SC store only**. It is not required for hosted Claude Web/ChatGPT-style deployments, which use full Composio connected accounts including GitHub. On a **local no-VPS** `/sc-all` route, GitHub stays SC-direct while Vercel/Convex/Hostinger prefer Composio when connected. Use `/sc-provider` for the canonical runtime/provider routing policy.

## Mandatory credential + next-step response contract

Whenever a credential/API key is missing, **never output only the variable name**. Always make the handoff explicit:

```text
Buat di      : <authoritative provider URL / secure connector auth link>
Petunjuk     : <minimum scope / exact menu when useful>
Connection  : <user/provider/label + scope>
Save with   : <sc user credential-set user provider KEY --connection alias, or secure provider connector>
Stored in   : <named SC connection 0600, or external connected account>
Lanjut       : <verification/resume action>
```

Rules:
- Local SC runtime: choose/create a labeled connection and use `sc user credential-set <user> <provider> <KEY> --connection <alias>` for direct credentials. Store values only in that connection's 0600 file; legacy profile/shell storage is migration-only.
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
