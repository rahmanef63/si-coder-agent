# SI-Coder

> Build and publish web apps from plain-language goals, without requiring the user to understand hosting, databases, DNS, deployment pipelines, or API-key plumbing.

SI-Coder is designed for non-technical users first. The canonical skill identity is `sc`; the host product decides how that skill is invoked.

```text
ChatGPT Web : @sc Create a booking app for my salon.
Claude Code : /sc Create a booking app for my salon.
Natural use : Create a booking app for my salon.
```

Customers should be able to request a time slot, staff should manage bookings, and SI-Coder should handle the technical defaults, publishing, domain setup, verification, and one useful next recommendation.

## Use the `sc` skill first

| Surface | Main invocation |
|---|---|
| ChatGPT Web | automatic skill selection or `@sc` |
| Claude Code | `/sc` |
| Codex / other Agent Skills clients | use that client's current skill-selection/invocation UX |

Internal skill identities are `sc-build`, `sc-all`, `sc-provider`, `sc-install`, and `sc-help`. The main `sc` skill routes to them automatically; normal users should not need to select a sub-skill or provider-specific skill themselves.

A `.skill` file is the install/import package. It does **not** reserve a custom `/slash` command in ChatGPT Web; slash registration is a capability of the host UI.

## Source format vs install package

SI-Coder separates the canonical Agent Skills directory format from client-specific archive transports:

- `skills/<name>/SKILL.md` is the required entry point inside each canonical skill directory.
- `dist/sc.zip` is the upload-ready ZIP for web surfaces that accept/require a ZIP; Claude Web explicitly documents this format.
- `dist/sc.skill` is an optional ZIP-format distribution artifact for clients that explicitly support the `.skill` extension.

The Agent Skills specification defines the skill as a directory containing `SKILL.md`. Archive extensions are transport choices made by individual clients, not the canonical source format.

```text
skills/sc/SKILL.md       # source of truth
        ↓ package:skills
dist/sc.zip               # upload-ready ZIP transport
dist/sc.skill             # optional .skill-aware client transport
```

The standalone packaged bundle (`sc.zip` and byte-identical `sc.skill`) includes the core build, deploy, provider, install, and help workflows as generated references so a web user only needs to upload **one file**.

## Non-technical product interview

A vague idea should not turn into a requirements workshop.

For example:

```text
/sc-build I need a website for my laundry business.
```

SI-Coder first infers everything it can from the message. If a real product decision is still missing, it asks **one question at a time**, with at most **three questions before the first build**.

Typical questions are about the product:

- What is the most important thing a user should be able to do?
- Who will use the app?
- Is there one thing that absolutely must work in the first version?

It does **not** ask normal users to choose a framework, database, hosting provider, repository strategy, DNS record, container setup, or deployment pipeline.

After three questions, SI-Coder uses sensible assumptions and builds a focused first version. The user can refine the product after seeing a working preview.

## Runtime-first publishing

SI-Coder chooses infrastructure internally.

### Hosted chat/web agents

Examples: Claude Web, ChatGPT-style hosted agents, or another environment without a normal local shell/secret store.

The user does not need a VPS. SI-Coder uses secure connected accounts and performs the managed publishing flow behind the scenes.

Default user-facing explanation:

```text
I will publish the app, connect the domain, and verify the main user flow.
You do not need to prepare a server or terminal.
```

Technical routing details remain available on request.

### Local coding agents

Examples: Claude Code, Codex CLI, Hermes, or OpenClaw on a machine.

SI-Coder inspects existing configuration first. If it genuinely cannot tell whether the user wants to use an existing server, it asks one plain-language choice:

```text
Do you want to use your own server, or should I use the easiest managed option?
```

The user should not need to know the words Dokploy, Vercel, Convex, or DNS to answer.

## Safe account and credential handoff

SI-Coder never asks the user to paste a password, API key, or token into chat or MCP tool JSON.

When one local credential is genuinely required, the handoff is complete and explicit:

```text
Create at   : https://provider.example/settings/api-keys
Instructions: create the required access with the minimum useful permissions
Save with   : sc secret set <provider> <KEY>
Stored in   : active SC profile, mode 0600
Continue    : sc doctor --providers <provider>
```

For hosted agents, prefer a secure connected-account authorization link instead of asking for the underlying provider key.

The machine-facing `sc.secret.request` surface also returns a simple `userAction` as the default presentation, while technical storage/verification details remain optional.

## `[rekomendasi]` next-step contract

After a meaningful milestone, SI-Coder shows exactly one high-value next step instead of dumping a generic backlog:

```text
[rekomendasi]
Next        : Add transactional email
Why         : Password reset and invitation flows need reliable email delivery.
Needs       : A sender domain and secure email-service access.
If you want : I can connect it, verify the domain, and wire the app flow next.
```

The literal `[rekomendasi]` marker is intentionally stable across languages; the content should be written in the user's language.

## Architecture

SI-Coder separates user experience from implementation details:

```text
User goal
   ↓
/sc
   ├─ new/vague idea → /sc-build
   ├─ existing app   → /sc-all
   ├─ account access → /sc-provider
   └─ advanced task  → matching /sc-* skill

/sc-build
   ↓
minimal product discovery
   ↓
first working version
   ↓
/sc-all publishing flow
   ↓
verified public app + domain
```

The technical control plane contains:

1. **Agent Skills** — behavior/orchestration in `skills/*/SKILL.md`.
2. **SC** — local provider registry, credential-safe profiles, diagnostics, and local/VPS operations.
3. **Connected provider tools** — secure hosted account connections and managed provider execution.
4. **MCP/MSO function surface** — machine-readable, secret-safe operations for agents.

## Local CLI navigation and user ownership

Run `sc` on a TTY to open a persistent layered console. `Tab` enters a deeper layer, `→`/`Enter` opens or runs the selected item, and `←`/`Esc` goes back. The breadcrumb stays visible, for example `SI-Coder › Users › Profiles › rahmanef`. Finishing an action returns to the current layer instead of terminating the CLI.

Each credential profile now has an explicit owner. Credentials remain in `~/.config/si-coder/profiles/<profile>.env` (0600), owner metadata lives separately in `~/.config/si-coder/profile-meta.json` (0600), and folder-to-profile routing remains in `~/.config/si-coder/sc.md`. Legacy profiles default their owner to the profile name until changed.

See [CLI navigation, profiles, and ownership](docs/cli.md).

## Machine-facing product interview

The MCP/MSO tool `sc.product.interview` helps enforce the non-technical discovery policy.

It accepts product facts the agent already inferred, such as:

- `goal`
- `primaryUser`
- `primaryAction`
- `mustHave`
- `domain`
- `existingProject`
- `questionsAsked`

It returns either:

- `readyToBuild: true`, or
- exactly one `nextQuestion` plus a `userFlow` presentation.

The policy hard-caps the first discovery phase at three questions and explicitly forbids technology-choice questions by default.

## Installation

<!-- INSTALL_MATRIX_GENERATED:BEGIN -->
### Installation format matrix

> Generated from [docs/install/README.md](docs/install/README.md). Do not edit this matrix here.

| Surface | What it installs/reads | Recommended SI-Coder link | Invocation |
|---|---|---|---|
| Claude Code | Plugin marketplace, or a skill **directory containing `SKILL.md`** | [GitHub repo](https://github.com/rahmanef63/si-coder-agent) / [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.5/skills/sc) | `/sc` |
| Claude Web / claude.ai | **ZIP containing the skill folder** | [Download `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.5/sc.zip) | Automatic when relevant |
| Codex CLI / app | GitHub skill **directory containing `SKILL.md`** | [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.5/skills/sc) plus core sibling skills | Client-specific / automatic |
| ChatGPT personal Skills | Uploaded skill package; canonical content is a folder with `SKILL.md` | [Download `sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.5/sc.zip) | Automatic or `@sc` |
| ChatGPT managed workspace | GitHub plugin marketplace | [GitHub repo](https://github.com/rahmanef63/si-coder-agent) | `@SI-Coder` / plugin picker / automatic |
| Hermes / OpenClaw / generic Agent Skills | Skill **directory containing `SKILL.md`** | [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.5/skills/sc) or `install.sh` | Runtime-specific |
| Client that explicitly supports `.skill` archives | `.skill` archive containing a normal skill directory | [Download optional `sc.skill`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.5/sc.skill) | Client-specific |
<!-- INSTALL_MATRIX_GENERATED:END -->

If an AI is given only this repository URL and asked to install SI-Coder, it should read [`AI_INSTALL.md`](AI_INSTALL.md) and choose the current surface automatically.

Detailed install/onboarding guides:

- [Installation matrix](docs/install/README.md)
- [Claude Code](docs/install/claude-code.md)
- [Claude Web / claude.ai](docs/install/claude-web.md)
- [Codex](docs/install/codex.md)
- [ChatGPT personal Skills](docs/install/chatgpt-personal-skills.md)
- [ChatGPT workspace marketplace](docs/install/chatgpt-workspace-marketplace.md)
- [Generic local Agent Skills](docs/install/generic-local.md)
- [First-run account onboarding](docs/install/first-run-onboarding.md)
- [OpenAI Plugin Directory publication status](docs/publishing/openai-plugin-directory.md)

### Claude Code — repository/plugin install

Preferred full install:

```text
/plugin marketplace add rahmanef63/si-coder-agent
/plugin install si-coder@si-coder-marketplace
```

The repository now contains `.claude-plugin/marketplace.json`, so the repo itself is a Claude Code marketplace. After installation, use:

```text
/sc Create a booking app for my salon.
```

A local developer can still use `claude --plugin-dir /path/to/si-coder-agent`. Anthropic also supports skill-only GitHub installs; the full plugin path is preferred here because SI-Coder includes multiple skills plus MCP support.

### Codex — ask the built-in skill installer

Codex has a built-in `$skill-installer` that supports GitHub repository paths. Ask Codex:

```text
Install SI-Coder from https://github.com/rahmanef63/si-coder-agent
Follow AI_INSTALL.md and install the core SI-Coder skills.
```

The core paths are `skills/sc`, `skills/sc-build`, `skills/sc-all`, `skills/sc-provider`, and `skills/sc-install`. Codex uses its own current skill-selection/invocation UX; do not assume Claude's `/sc` syntax there.

### Claude.ai / Claude Web — one-file upload

Use the release `sc.zip`. Anthropic currently documents Claude Web custom-skill upload as a ZIP containing the skill folder.

Direct downloads from `main`:

- `https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.5/sc.zip`

Current Claude web flow is **Customize → Skills → + → Create skill → Upload a skill**. The uploaded package is self-contained; no VPS or local SI-Coder installation is required for the hosted route. Claude automatically uses relevant skills. Slash availability can vary by Claude surface, so only Claude Code's `/sc` is treated as a guaranteed slash contract here.

### ChatGPT Web — repository marketplace or personal Skill

For a managed workspace, the closest match to “install this GitHub repo” is now native: a workspace admin can go to **Workspace settings → Plugins → Add → Import marketplace**, enter `https://github.com/rahmanef63/si-coder-agent`, and leave Path empty. OpenAI supports `.agents/plugins/marketplace.json` and automatically syncs imported GitHub marketplaces daily. SI-Coder ships a separate **skill-only** OpenAI plugin under `plugins/si-coder/` so the web plugin does not inherit the repository's local MCP server and become Desktop-only.

For personal Skills, OpenAI documents a `SKILL.md`-based skill and an Upload from your computer flow, but does not currently require the `.skill` extension. SI-Coder recommends the complete `sc.zip` package.

Direct download: `https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.5/sc.zip`

After installation, ChatGPT can use the skill automatically. OpenAI documents explicit Skill selection by **@ mention**; SI-Coder registers the OpenAI display name `sc`, so use `@sc`, not `/sc`. SI-Coder does not pretend ChatGPT has a slash command when the current OpenAI surface does not document one.

### Other local Agent Skills runtimes

```bash
bash install.sh --agent claude
bash install.sh --agent codex
bash install.sh --agent hermes
bash install.sh --agent openclaw
bash install.sh --agent all
```

Add `--with-mcp` when the local runtime should also register the bundled SI-Coder MCP server.

### Rebuild install artifacts

```bash
npm run package:skills
```

This regenerates `dist/sc.skill`, `dist/sc.zip`, `dist/sc-build.skill`, and `dist/manifest.json` from the canonical source.

## Advanced CLI

The CLI exists for local operators and agents. Non-technical users normally interact through the main `sc` skill using the invocation supported by their current surface.

```bash
# User-oriented publish plan
sc deploy plan

# Optional technical diagnostics
sc deploy plan --technical
sc deploy plan --json

# Local account/credential status
sc providers
sc secret list
sc secret get resend RESEND_API_KEY
sc secret set resend RESEND_API_KEY
sc doctor

# Consume stored credentials without printing them
sc run -- <command>
```

Secret values are never returned by `sc secret get`. `sc env` remains disabled because plaintext export is unsafe for an agent-facing control plane.

## Portable skill layout

```text
.
├── .claude-plugin/plugin.json
├── .mcp.json
├── .mso/functions.json
├── SKILL.md                    # umbrella skill
├── skills/
│   ├── sc/SKILL.md             # /sc
│   ├── sc-build/SKILL.md       # /sc-build
│   ├── sc-all/SKILL.md
│   ├── sc-provider/SKILL.md
│   ├── sc-install/SKILL.md
│   └── sc-*/SKILL.md
├── lib/
│   ├── product-interview.js
│   ├── user-facing.js
│   ├── deploy-route.js
│   └── credential-guidance.js
├── scripts/sc-agent.js
├── scripts/sc-mcp.js
└── bin/sc.js
```

## Development and verification

```bash
npm test
claude plugin validate .
npm pack --dry-run
```

Release gates include:

- full regression tests,
- plugin validation,
- secret-schema guards,
- portable package contents,
- non-technical user-facing jargon guards,
- slash-skill discovery/install tests,
- clean and synchronized `main` branch.

## Security principles

- Never put raw secrets in chat, MCP JSON, CLI argv, logs, or generated documentation.
- Prefer secure connected accounts on hosted agents.
- Store local secrets only through SI-Coder's protected local path.
- Keep technical diagnostics available but opt-in for normal users.
- Never claim a deployment is complete until the public result has been verified.
