# SI-Coder (`sc`)

> A simple tool for AI coding agents to build, connect, publish, manage, and verify web apps from plain-language goals.

**SC is a tool, not another platform you need to learn.**

For normal use, tell SC what outcome you want:

```text
ChatGPT Skill (eligible workspace): @sc Create a booking app for my salon.
Claude Code                     : /sc Create a booking app for my salon.
Existing project                : /sc Fix the checkout flow and publish it.
Frontend specialist             : /sc-fe --workbench audit this desktop shell.
```

SC handles the technical work behind the request: inspecting the current project, choosing sensible defaults, editing the app, connecting supported services, publishing, and verifying the result.

You do **not** need to understand SC's internal skill tree, provider routing, MCP functions, memory system, recipes, evidence receipts, or release checks before using it.

## What SC does

SC gives an AI coding agent a consistent way to:

- build a new web app from a plain-language idea,
- work on an existing app without throwing away intentional project conventions,
- improve frontend UI, UX, DX, and agent experience,
- connect the accounts/services the app actually needs,
- publish to an appropriate runtime,
- connect a domain when requested,
- manage users, provider definitions, named connections, credentials, and skills,
- verify the important user flow after a change,
- keep credentials out of chat and tool payloads,
- suggest one useful next step after a meaningful milestone.

The default experience is intentionally product-focused. SC should ask about **what the app needs to do**, not make a normal user choose frameworks, databases, DNS records, container strategies, or deployment pipelines unless that choice materially matters.

## Common use cases

Start from the outcome. The main `/sc` skill can route internally; specialized `/sc-*` skills remain available when you want explicit control.

| Goal | Example | What SC handles |
|---|---|---|
| Build a new product | `/sc Build a booking app for a barbershop and publish it.` | product defaults, implementation, data/runtime routing, publish, verification |
| Improve an existing frontend | `/sc-fe --workbench --density compact audit and improve this desktop shell` | UI + UX + DX + AX audit, existing design-DNA preservation, rendered verification |
| Apply a design-principle preset | `/sc-fe --apple improve this settings experience` | Apple/HIG-inspired principles without cloning trade dress or replacing coherent project identity |
| Connect a provider safely | `/sc Connect transactional email for password reset.` | provider routing, required account access, safe credential flow, live verification |
| Publish and connect a domain | `/sc Publish this app on my existing stack and connect the domain.` | runtime selection, deploy, DNS/domain work, HTTPS and live checks |
| Work with multiple clients/accounts | `sc user add client-a` then create named connections | isolated user credential stores, project mapping, explicit connection selection |
| Create a project-specific workflow | `sc skill create release-check --description "Verify release readiness"` | creates `.mso/skills/release-check/SKILL.md`; compatible hosts can invoke `/release-check` |
| Share one skill vocabulary across tools | type `/skills`, then `/sc-fe ...` in MSO, Control Room, Baton, or another compatible host | discovery, direct slash invocation, exact-id ambiguity handling |

Frontend presets can be composed rather than treated as themes:

```text
/sc-fe --apple --density compact --motion subtle improve settings
/sc-fe --workbench --platform desktop --strict audit this project shell
```

When the project already has a coherent UI, SC preserves its design DNA by default. A preset changes principles and constraints; it is not permission to replace the product with a generic generated aesthetic.

## CRUD model

Operator-owned resources should be manageable as normal resources instead of one-off setup state.

| Resource | Create | Read | Update | Delete |
|---|---|---|---|---|
| Users | `sc user add <name>` | `sc user`, `sc user show <name>`, `sc user which` | `sc user rename <old> <new>`, `sc user use <name>`, mapping/owner commands | `sc user rm <name>` |
| Provider definitions | `sc providers create <id> ...` | `sc providers`, `sc providers show <id>` | `sc providers update <id> ...`, `key-add`, `key-rm` | `sc providers delete <id> --yes` |
| Named connections | `sc user connection-add <user> <provider> <label> ...` | `sc user connections <user> [provider]`, connection guide/status | label, default, authorize, sync, and migration commands | `sc user connection-rm <user> <provider> <connection> ...` |
| Credentials | `sc user credential-set <user> <provider> <KEY> --connection <id>` | `credential-status`; plaintext reads are intentionally disabled | run `credential-set` again to rotate | `sc user credential-rm <user> <provider> <KEY> --connection <id>` |
| Skills | `sc skill create <name> ...` | `sc skills`, `sc skill show <name|exact-id>` | `sc skill update <name|exact-id> ...` | `sc skill delete <name|exact-id> --yes` |

### Skill CRUD

Create a project skill:

```bash
sc skill create release-check \
  --description "Verify release, security, rollback, and live health before handoff"
```

It becomes:

```text
.mso/skills/release-check/SKILL.md
```

and is discoverable as:

```text
/release-check
```

Create a global operator skill instead:

```bash
sc skill create release-check \
  --scope global \
  --description "Shared release readiness workflow"
```

Global managed skills live in:

```text
~/.mso/skills/<name>/SKILL.md
```

Read, replace, update, and delete:

```bash
sc skills
sc skills --json
sc skill show release-check
sc skill show release-check --raw
sc skill update release-check --description "Verify release plus rollback readiness"
sc skill update release-check --from-file ./SKILL.md
sc skill delete release-check --yes
```

For long instructions, prefer `--from-file SKILL.md` instead of putting the full skill body in argv or shell history.

**Bundled SI-Coder skills under `skills/*` are package source and read-only at runtime.** Project skills live in `.mso/skills`; global operator skills live in `~/.mso/skills`. Project scope wins normal same-name resolution, while `/skill <exact-id>` remains the explicit ambiguity escape hatch.

The shared invocation contract is:

```text
/skills                         discover available skills
/<skill> [prompt]               invoke the normal resolved skill
/skill <exact-id> [prompt]      choose an exact project/global skill when needed
```

## The normal workflow

```text
Your goal
   ↓
  sc
   ↓
understand the product
   ↓
build or change it
   ↓
connect only what is needed
   ↓
publish
   ↓
verify the real result
```

For a vague new idea, SC may ask a small number of product questions. If it can infer a reasonable default, it should continue instead of turning the request into a requirements workshop.

For an existing project, just describe the change you want:

```text
/sc Make the dashboard responsive and fix the broken mobile navigation.
```

For deployment:

```text
/sc Publish this app and verify the login flow.
```

For a provider integration:

```text
/sc Connect transactional email for password reset.
```

The main `sc` skill routes internally to the appropriate workflow. Normal users should not need to choose a sub-skill themselves.

## Move users and connections between projects

```sh
sc data export --out users.integration-bundle.json
sc data export --include-secrets --out users.integration-bundle.enc.json
sc data import --file users.integration-bundle.json
```

Plain JSON contains metadata only. Encrypted transfers prompt locally for a passphrase. Import previews conflicts before an explicitly confirmed create-only apply; no default, folder mapping, or active OAuth session is copied. The browser manager also has **Import / export JSON**. Receiving projects use the documented versioned bundle and their own import adapter; no other application is required to run SI-Coder.

[Data portability and schema](docs/DATA-PORTABILITY.md).

## Set credentials without pasting into chat

```sh
sc setup --web
```

The temporary browser hub automatically uses a private Tailscale Serve URL when the VPS is already on a tailnet, with a localhost/SSH fallback. It includes every registered provider, user selection, named connections, source/auth methods, official links, expandable instructions, masked inputs, and verification before saving. Run it in an interactive terminal.

For VPS access, use SSH port forwarding rather than exposing the local port. See [Secure credential setup](docs/CREDENTIAL-SETUP.md).

## Installation

Already have SC installed in your agent? Skip this section and just use `sc`.

The canonical source is the `skills/sc/` directory containing `SKILL.md`. Different AI clients use different installation transports, so the exact install step varies by surface.

<details>
<summary><strong>Installation by client</strong></summary>

<!-- INSTALL_MATRIX_GENERATED:BEGIN -->
### Installation format matrix

> Generated from [docs/install/README.md](docs/install/README.md). Do not edit this matrix here.

| Surface | What it installs/reads | Recommended SI-Coder link | Invocation |
|---|---|---|---|
| Claude Code | Plugin marketplace, or a skill **directory containing `SKILL.md`** | [GitHub repo](https://github.com/rahmanef63/si-coder-agent) / [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.5/skills/sc) | `/sc` |
| Claude Web / claude.ai | **ZIP containing the skill folder** | [Download `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.5/sc.zip) | Automatic when relevant |
| Codex CLI / app | GitHub skill **directory containing `SKILL.md`** | [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.5/skills/sc) plus core sibling skills | Client-specific / automatic |
| ChatGPT uploaded Skills (eligible workspaces) | Uploaded skill package; canonical content is a folder with `SKILL.md` | [Download `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.5/sc.zip) | Automatic or `@sc` |
| ChatGPT managed workspace | GitHub plugin marketplace | [GitHub repo](https://github.com/rahmanef63/si-coder-agent) | `@SI-Coder` / plugin picker / automatic |
| Hermes / OpenClaw / generic Agent Skills | Skill **directory containing `SKILL.md`** | [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.5/skills/sc) or `install.sh` | Runtime-specific |
| Client that explicitly supports `.skill` archives | `.skill` archive containing a normal skill directory | [Download optional `sc.skill`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.5/sc.skill) | Client-specific |
<!-- INSTALL_MATRIX_GENERATED:END -->

Detailed guides:

- [Installation overview](docs/install/README.md)
- [Claude Code](docs/install/claude-code.md)
- [Claude Web / claude.ai](docs/install/claude-web.md)
- [Codex](docs/install/codex.md)
- [ChatGPT uploaded Skills](docs/install/chatgpt-skills.md)
- [ChatGPT workspace marketplace](docs/install/chatgpt-workspace-marketplace.md)
- [Generic local Agent Skills](docs/install/generic-local.md)

If an AI agent is given only this repository URL and asked to install SC, it should read [`AI_INSTALL.md`](AI_INSTALL.md) and choose the appropriate path automatically.

</details>

### Claude Code

```text
/plugin marketplace add rahmanef63/si-coder-agent
/plugin install si-coder@si-coder-marketplace
```

Then:

```text
/sc Create a booking app for my salon.
```

### Local Agent Skills runtimes

Requires **Node.js 22, 24, or 26**. The installer reads `skills/catalog.json` and installs active/default skills only; unfinished/legacy skills are kept out of normal routing.

```bash
bash install.sh --agent claude
bash install.sh --agent codex
bash install.sh --agent hermes
bash install.sh --agent openclaw
bash install.sh --agent mso
bash install.sh --agent all
```

`--agent mso` installs active/default SC skills into MSO's trusted `~/.mso/skills` root. `--agent all` installs to the supported local registries together.

Use `--with-mcp` only when the local runtime should also register SC's bundled MCP server.

## Accounts and credentials

SC should never ask you to paste a password, API key, or access token into chat or machine-tool JSON.

When account access is required, SC should tell you:

1. which service/account is needed,
2. why it is needed,
3. the safest supported way to connect it,
4. how SC will verify the connection.

Hosted agents should prefer secure connected-account authorization. On a fresh local install, `sc setup` creates/selects a user and named provider connection first; direct credentials are stored only in that connection's `0600` file. Fresh setup does not write provider secrets to `~/.bashrc`.

See [first-run account onboarding](docs/install/first-run-onboarding.md) for the detailed model.

## One recommendation, not a backlog dump

After a meaningful milestone, SC may return one next step:

```text
[rekomendasi]
Next : Add transactional email
Why  : Password reset needs reliable delivery.
```

The point is to keep the workflow moving without overwhelming the user with an internal engineering backlog.

## Advanced usage

Everything below is optional for normal SC users.

<details>
<summary><strong>Local CLI and provider connections</strong></summary>

Running `sc` on a TTY opens the local interactive CLI. It is useful for operators who want to inspect users, provider connections, deployment plans, skills, or diagnostics directly. The Finder root also includes **Import / export JSON**, so portability is discoverable without memorizing `sc data ...` commands. `Esc` goes back one level; inside a credential/metadata input it cancels that input without saving or exiting SC. The lower INFO/PREVIEW/RESULT area expands on taller terminals so setup guidance is easier to read.

```bash
sc doctor
sc deploy plan
sc deploy plan --technical
sc user connections <user>
sc skills
```

Direct local connections are user/account scoped. External OAuth or connected-account backends keep their provider tokens outside SC and store only safe routing metadata locally.

See [CLI navigation and account ownership](docs/cli.md).

</details>

<details>
<summary><strong>MCP and machine tools</strong></summary>

SC exposes a machine-readable tool surface for compatible agents through the bundled MCP server.

- Machine-function SSOT: `machine/functions.json`
- MCP server: `scripts/sc-mcp.js`
- Tool documentation: [docs/tool-calling.md](docs/tool-calling.md)

This is an integration surface for agents. A normal user does not need to call these functions manually.

</details>

<details>
<summary><strong>Agent memory, evidence, recipes, and verification</strong></summary>

SC also contains repo-local engineering safeguards used while maintaining SC itself:

```bash
sc task prepare "change provider auth routing" --json
sc memory query "provider auth" --json
sc skill verify --strict
sc verify
npm run verify:release
```

These features help an engineering agent reuse relevant past debugging/test knowledge, classify risky maintenance work, keep compact verification evidence, and promote repeated maintenance work into verified recipes/scripts.

They are **maintenance infrastructure**, not concepts a normal SC user needs to learn before using the tool.

See [agent workflow and repo-local memory](docs/agent-workflow.md).

</details>

## Design principles

SC should remain:

- **Simple at the surface** — one main tool/skill for normal use.
- **Product-first** — ask about desired behavior before infrastructure choices.
- **Agent-friendly** — technical capabilities are machine-readable when an agent needs them.
- **CRUD-capable for operator-owned resources** — users, provider definitions, connections, credentials, and managed skills can be inspected and changed explicitly.
- **Safe with credentials** — secrets do not travel through chat/tool payloads; fresh local setup is named-connection-scoped rather than shell-global.
- **Verifiable** — completion means the important result was actually checked.
- **Standalone** — this repository owns its runtime contracts and does not require another local project or orchestrator to function.
- **Progressively disclosed** — advanced internals stay available without dominating the main user experience.

## Repository map

Only the major surfaces are shown here:

```text
skills/sc/               main user-facing bundled skill
skills/sc-*/             bundled specialized workflows
.mso/skills/             project-managed slash skills
a ~/.mso/skills/         global operator-managed slash skills
bin/sc-entry.js          installed CLI entry + portable skill registry/CRUD
bin/sc.js                mature local control plane + Finder TUI
machine/functions.json   machine-tool contract
scripts/sc-mcp.js        MCP server
docs/                    detailed documentation
.agent/                  repo-maintenance memory/evidence/recipes
```

## Development

For contributors and maintainers:

```bash
npm test
npm run docs:check
node bin/sc.js skill verify --strict
npm run verify:release
npm pack --dry-run
```

Release checks cover regression tests, lifecycle catalog validation, repository-wide secret scanning, skill validation, portable package contents, documentation consistency, and deterministic generated artifacts. Tagged releases rerun the full gate and verify public reachability before GitHub Release publication.

## Documentation

- [Installation](docs/install/README.md)
- [CLI](docs/cli.md)
- [Tool calling / MCP](docs/tool-calling.md)
- [Agent workflow and memory](docs/agent-workflow.md)

If you only want to **use SC**, you can ignore those internals and start with:

```text
@sc Build or change the app I describe, publish it when needed, and verify the result.
```
