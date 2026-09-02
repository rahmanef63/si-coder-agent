# Install SI-Coder as an uploaded ChatGPT Skill

Use this route only when the ChatGPT account/workspace exposes **Plugins → Skills → Create → Upload from your computer**.

## Availability

OpenAI currently documents Skills for eligible ChatGPT **Business, Enterprise, Healthcare, and Edu** workspaces, subject to workspace settings and product availability. Do not present uploaded Skills as a universal personal feature on every ChatGPT plan.

The Plugin Directory is visible more broadly, but whether a plugin or Skill can be installed/invoked depends on the plan, workspace, role, region, surface, and included capabilities.

## Correct package format

OpenAI defines a Skill around a **`SKILL.md` file inside a skill directory** and documents uploading a Skill from the computer. The current Help Center does **not** specify that a `.skill` filename is required. SI-Coder therefore recommends the ordinary ZIP package because it keeps the complete `sc/` directory and resources together.

[Download SI-Coder Skill v0.9.2 (`sc.zip`)](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.2/sc.zip)

For inspection, the canonical source is:

- [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.9.2/skills/sc)
- [raw `SKILL.md`](https://raw.githubusercontent.com/rahmanef63/si-coder-agent/v0.9.2/skills/sc/SKILL.md)

Do not upload only the raw Markdown file when supporting files are needed; use the complete packaged Skill.

> **Archive note:** `sc.zip` does not contain a nested `sc.skill`. `sc.zip` and `sc.skill` are separate, byte-identical release assets. Opening the ZIP should show the `sc/` skill directory with `SKILL.md` and its resources.

## Install

1. Download [`sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.2/sc.zip).
2. In ChatGPT, open **Plugins** in the sidebar.
3. Open the **Skills** tab.
4. Select **Create → Upload from your computer**.
5. Upload `sc.zip` and complete ChatGPT's scan/review flow.
6. Ensure the Skill is installed/enabled.

SI-Coder also publishes an optional [`sc.skill`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.9.2/sc.skill) archive for clients that explicitly accept `.skill`; OpenAI's current ChatGPT Help Center does not require that extension, so it is not the default ChatGPT link.

## Use it

Installed Skills can be used automatically when relevant. OpenAI Academy also documents explicit Skill selection by @-mention, so when that control is available SI-Coder's Skill identity can be selected as:

```text
@sc Build a booking app for my salon and publish it.
```

Packaging does not register a custom ChatGPT `/` command. Do not rely on `/sc` in ChatGPT Web.

## Uploaded Skill vs GitHub marketplace plugin

Use the uploaded-Skill route when the eligible workspace exposes Skill upload and one user/workspace wants the packaged workflow. Use the [workspace marketplace guide](chatgpt-workspace-marketplace.md) when an admin wants SI-Coder imported and synchronized directly from GitHub.

## Official references

- https://help.openai.com/en/articles/20001066
- https://help.openai.com/en/articles/20001256
- https://academy.openai.com/en/public/clubs/work-users-ynjqu/resources/skills
