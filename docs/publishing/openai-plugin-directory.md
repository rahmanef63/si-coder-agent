# OpenAI Plugin Directory publication status and submission pack

This document distinguishes the distribution paths OpenAI currently documents from the parts that are not exposed as a self-serve universal publication flow for a skill-only plugin.

## What is ready now

SI-Coder already ships:

- `.agents/plugins/marketplace.json` — GitHub marketplace import entry point.
- `plugins/si-coder/.codex-plugin/plugin.json` — OpenAI plugin metadata.
- `plugins/si-coder/skills/` — a skill-only, web-compatible plugin bundle.
- `dist/sc.skill` and `dist/sc.zip` — personal Skill upload artifacts.
- No local MCP inside `plugins/si-coder/`, avoiding a desktop-only requirement for the web plugin.

## Self-serve distribution OpenAI currently documents

### Workspace marketplace import

A workspace admin can import the GitHub repository as a plugin marketplace from **Workspace settings → Plugins → Add → Import marketplace**. OpenAI documents daily synchronization from GitHub.

### Workspace directory publication

With the applicable role permission, a plugin owner can use **Share plugin** and select **Visible in <workspace> directory**. This publishes only to that workspace.

### Personal Skill upload

Eligible users can open **Plugins → Skills → Create → Upload from your computer** and install the packaged Skill.

## Universal public Plugin Directory boundary

OpenAI's current public documentation states that:

- New **app submissions** can appear in the Plugin Directory packaged as plugins.
- Some plugins can receive an **OpenAI Verified** badge after OpenAI review.
- Publishing a plugin to a workspace directory does **not** publish it to the universal public Plugin Directory.

The documentation does not currently provide a general self-serve submission endpoint for a standalone skill-only plugin to the universal public directory. Therefore SI-Coder must not claim “public Plugin Directory submitted” until OpenAI exposes an applicable submission/review path or SI-Coder includes an app that goes through the documented app-submission process.

## Submission-ready metadata

Name: **SI-Coder**

Category: **Developer Tools**

Short description: **Build and publish web apps from plain language**

Long description:

> SI-Coder turns a non-technical product idea into a focused web app workflow, chooses sensible technical defaults, guides secure service connections, and handles publishing/domain verification without requiring the user to learn infrastructure terminology.

Developer: **Rahman EF**

Repository: `https://github.com/rahmanef63/si-coder-agent`

License: **MIT**

Suggested test prompts:

1. `Build a salon booking app where customers request a time and staff manage bookings.`
2. `Publish this existing web app and connect my domain.`
3. `I need transactional email. Help me connect it without putting an API key in chat.`
4. `Build a laundry website. Use your best judgement for the technical choices.`

Expected behaviors:

- Non-technical, outcome-first language.
- No unnecessary framework/provider questions.
- At most three product-discovery questions before a first build plan.
- No raw secret requests in chat/tool JSON.
- Hosted mode does not ask for VPS ownership unless explicitly requested.

## Security and privacy review notes

The OpenAI web plugin in this repository is skill-only. It has no bundled local MCP server and does not itself grant access to external provider accounts. Provider authorization remains subject to ChatGPT/plugin/app permissions and the external provider's own authorization.

SI-Coder instructions explicitly prohibit collecting raw API keys/passwords in chat or tool JSON.

## Official references

- `https://help.openai.com/en/articles/20001256`
- `https://help.openai.com/en/articles/20001504`
- `https://help.openai.com/en/articles/20001066`
- `https://help.openai.com/en/articles/11487775`
