# SI-Coder (`sc`)

> A simple tool for AI coding agents to build, connect, publish, and verify web apps from plain-language goals.

**SC is a tool, not another platform you need to learn.**

For normal use, you only need to know one thing:

```text
Tell `sc` what you want to build or change.
```

Examples:

```text
ChatGPT Skill (eligible workspace): @sc Create a booking app for my salon.
Claude Code : /sc Create a booking app for my salon.
Natural use : Fix the mobile checkout flow and publish it.
```

SC handles the technical work behind the request: choosing sensible defaults, editing the app, connecting supported services, publishing, and verifying the result.

You do **not** need to understand SC's internal skills, provider routing, MCP functions, memory system, recipes, evidence receipts, or release checks to use it.

## What SC does

SC gives an AI coding agent a consistent way to:

- build a new web app from a plain-language idea,
- work on an existing app,
- connect the accounts/services the app actually needs,
- publish to an appropriate runtime,
- connect a domain when requested,
- verify the important user flow after a change,
- keep credentials out of chat and tool payloads,
- suggest one useful next step after a meaningful milestone.

The default experience is intentionally product-focused. SC should ask about **what the app needs to do**, not make a normal user choose frameworks, databases, DNS records, container strategies, or deployment pipelines.

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

## Set credentials without pasting into chat

```sh
sc setup --web
```

The temporary browser manager includes all registry providers, user selection,
named connections, authentication methods, official guides, and masked inputs.
It verifies credentials before saving, or explicitly marks them unverified when
a provider has no live check. Run it in an interactive terminal.
For VPS access, use SSH port forwarding rather than exposing the local port.
See [Secure credential setup](docs/CREDENTIAL-SETUP.md).

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
| Claude Code | Plugin marketplace, or a skill **directory containing `SKILL.md`** | [GitHub repo](https://github.com/rahmanef63/si-coder-agent) / [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.3/skills/sc) | `/sc` |
| Claude Web / claude.ai | **ZIP containing the skill folder** | [Download `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.3/sc.zip) | Automatic when relevant |
| Codex CLI / app | GitHub skill **directory containing `SKILL.md`** | [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.3/skills/sc) plus core sibling skills | Client-specific / automatic |
| ChatGPT uploaded Skills (eligible workspaces) | Uploaded skill package; canonical content is a folder with `SKILL.md` | [Download `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.3/sc.zip) | Automatic or `@sc` |
| ChatGPT managed workspace | GitHub plugin marketplace | [GitHub repo](https://github.com/rahmanef63/si-coder-agent) | `@SI-Coder` / plugin picker / automatic |
| Hermes / OpenClaw / generic Agent Skills | Skill **directory containing `SKILL.md`** | [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.3/skills/sc) or `install.sh` | Runtime-specific |
| Client that explicitly supports `.skill` archives | `.skill` archive containing a normal skill directory | [Download optional `sc.skill`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.3/sc.skill) | Client-specific |
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
```

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

Running `sc` on a TTY opens the local interactive CLI. It is useful for operators who want to inspect users, provider connections, deployment plans, or diagnostics directly. `Esc` goes back one level; inside a credential/metadata input it cancels that input without saving or exiting SC. The lower INFO/PREVIEW/RESULT area expands on taller terminals so setup guidance is easier to read.

```bash
sc doctor
sc deploy plan
sc deploy plan --technical
sc user connections <user>
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
- **Safe with credentials** — secrets do not travel through chat/tool payloads; fresh local setup is named-connection-scoped rather than shell-global.
- **Verifiable** — completion means the important result was actually checked.
- **Standalone** — this repository owns its runtime contracts and does not require another local project or orchestrator to function.
- **Progressively disclosed** — advanced internals stay available without dominating the main user experience.

## Repository map

Only the major surfaces are shown here:

```text
skills/sc/               main user-facing skill
skills/sc-*/             internal/specialized workflows
bin/sc.js                local CLI
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
