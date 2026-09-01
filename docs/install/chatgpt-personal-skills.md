# Install SI-Coder as a ChatGPT personal Skill

Use this path when the account exposes **Plugins → Skills** and skill uploading. OpenAI currently documents Skills for eligible ChatGPT Business, Enterprise, Healthcare, and Edu users, subject to workspace settings and rollout.

## Install

1. Download `sc.skill` or `sc.zip` from the SI-Coder GitHub release.
2. In ChatGPT, open **Plugins** in the sidebar.
3. Open the **Skills** tab.
4. Select **Create → Upload from your computer**.
5. Upload the SI-Coder package and complete ChatGPT's scan/review flow.
6. Ensure the skill is installed/enabled.

Release:

`https://github.com/rahmanef63/si-coder-agent/releases/tag/v0.8.1`

## Use it

Installed Skills can be activated automatically when relevant. Start with a normal request:

```text
Build a booking app for my salon and publish it.
```

Do not rely on `/sc` in ChatGPT Web. `/sc` is a Claude Code contract, not a universal Agent Skills invocation syntax.

## Personal Skill vs plugin marketplace

Use a personal Skill when one person wants SI-Coder quickly. Use the [workspace marketplace guide](chatgpt-workspace-marketplace.md) when an admin wants to install and sync SI-Coder from GitHub for a managed workspace.

## Security

ChatGPT scans uploaded skills before they become available. Review external skills before installing them. SI-Coder itself does not require raw provider secrets in chat; service authorization is handled separately and securely.

## Official reference

`https://help.openai.com/en/articles/20001066`
