# SI-Coder

> Build and publish web apps from plain-language goals, without requiring the user to understand hosting, databases, DNS, deployment pipelines, or API-key plumbing.

SI-Coder is designed for non-technical users first. A request can be as simple as:

```text
/sc Create a booking app for my salon.
Customers should be able to request a time slot, and staff should manage bookings.
Put it on booking.example.com.
```

SI-Coder should then understand the product, ask only the minimum business questions, choose sensible technical defaults, build the first working version, connect required accounts safely, publish the app, connect the domain, verify the result, and recommend one useful next improvement.

## Use `/sc` first

The main user-facing entry point is:

```text
/sc <what you want to build or change>
```

Important slash skills:

| Slash skill | Use it for |
|---|---|
| `/sc` | Default entry point. Routes the request automatically. |
| `/sc-build` | New or vague app idea → short product interview → first working version → publish. |
| `/sc-all` | Existing app/project → publish it end to end. |
| `/sc-provider` | Connect or manage a service/account safely. |
| `/sc-install` | Install SI-Coder in another supported agent runtime. |
| `/sc-help` | Quick usage guidance. |

Provider-specific skills such as `/sc-vercel`, `/sc-dokploy`, `/sc-convex`, and `/sc-git` remain available for advanced users, but normal users should not need to choose them.

## Why there is no `.skill` file

SI-Coder follows the Agent Skills convention: each portable skill is a directory containing a file named **`SKILL.md`**.

Examples:

```text
skills/
├── sc/
│   └── SKILL.md        # /sc
├── sc-build/
│   └── SKILL.md        # /sc-build
├── sc-all/
│   └── SKILL.md        # /sc-all
└── sc-provider/
    └── SKILL.md        # /sc-provider
```

The skill name in frontmatter is the durable skill identity. Claude-style clients can expose installed skills through slash invocation; other Agent Skills runtimes may use their own invocation syntax. SI-Coder keeps one `skills/` source of truth instead of maintaining separate copies per runtime.

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

### Claude Code plugin

```bash
git clone https://github.com/rahmanef63/si-coder-agent.git
cd si-coder-agent
claude --plugin-dir "$PWD"
```

The plugin includes:

- `.claude-plugin/plugin.json`
- `skills/*/SKILL.md`
- `.mcp.json`
- the bundled secret-safe SI-Coder MCP server

### Standalone Agent Skills

```bash
bash install.sh --agent claude
bash install.sh --agent codex
bash install.sh --agent hermes
bash install.sh --agent openclaw
bash install.sh --agent all
```

Add `--with-mcp` when the local runtime should also register the bundled SI-Coder MCP server.

The installer discovers every `skills/*/SKILL.md` directory automatically, so newly added slash skills do not require a second hard-coded list.

## Advanced CLI

The CLI exists for local operators and agents. Non-technical users normally interact through `/sc`.

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
