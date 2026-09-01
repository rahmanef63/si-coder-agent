# Install SI-Coder as a ChatGPT personal Skill

Use this path when the account exposes **Plugins → Skills → Create → Upload from your computer**.

## Correct package format

OpenAI defines the skill itself around a **`SKILL.md` file inside a skill directory** and documents uploading a skill from your computer, but the current Help Center does **not** specify that a `.skill` filename is required. SI-Coder therefore recommends the ordinary ZIP package because it preserves the complete `sc/` directory and its resources in one upload.

[Download SI-Coder Skill v0.8.4 (`sc.zip`)](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.4/sc.zip)

For inspection, the canonical source is:

- [sc skill directory](https://github.com/rahmanef63/si-coder-agent/tree/v0.8.4/skills/sc)
- [raw `SKILL.md`](https://raw.githubusercontent.com/rahmanef63/si-coder-agent/v0.8.4/skills/sc/SKILL.md)

Do not upload only the raw Markdown file when supporting files are needed; upload the complete packaged skill.

> **Archive note:** `sc.zip` does not contain a nested `sc.skill`. `sc.zip` and `sc.skill` are separate, byte-identical release assets. When you open the ZIP, the expected content is the `sc/` skill directory with `SKILL.md` and its resources.

## Install

1. Download [`sc.zip`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.4/sc.zip).
2. In ChatGPT, open **Plugins** in the sidebar.
3. Open the **Skills** tab.
4. Select **Create → Upload from your computer**.
5. Upload `sc.zip` and complete ChatGPT's scan/review flow.
6. Ensure the skill is installed/enabled.

SI-Coder also publishes an optional [`sc.skill`](https://github.com/rahmanef63/si-coder-agent/releases/download/v0.8.4/sc.skill) archive for clients that explicitly accept `.skill`; OpenAI's current ChatGPT Help Center does not require that extension, so it is not the default ChatGPT link.

## Use it

Installed Skills can be activated automatically when relevant. SI-Coder registers the ChatGPT display name `sc`, so explicit selection is:

```text
@sc Build a booking app for my salon and publish it.
```

Or simply ask naturally and let ChatGPT select the skill automatically.

Packaging does not register a custom ChatGPT `/` command. Do not rely on `/sc` in ChatGPT Web.

## Personal Skill vs plugin marketplace

Use a personal Skill when one person wants SI-Coder quickly. Use the [workspace marketplace guide](chatgpt-workspace-marketplace.md) when an admin wants to install and sync SI-Coder from GitHub for a managed workspace.

## Official references

- https://help.openai.com/en/articles/20001066-skills-in-chatgpt
- https://openai.com/academy/skills/
