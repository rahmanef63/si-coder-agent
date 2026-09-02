# Install SI-Coder in a ChatGPT workspace from GitHub

This is the closest supported path to “install this repository” for a managed ChatGPT workspace. SI-Coder ships an OpenAI marketplace at `.agents/plugins/marketplace.json` and a web-compatible skill-only plugin under `plugins/si-coder/`.

## Requirements

- A ChatGPT workspace where plugin marketplace import is available.
- Workspace admin access for the import.
- A GitHub account that can read the marketplace repository and referenced plugin content. OpenAI supports both public and private GitHub repositories for marketplace import.

## Package format

This route does **not** use `sc.zip`, `sc.skill`, or a raw `SKILL.md` download. ChatGPT imports the GitHub marketplace manifest and the plugin's skill directories from the repository.

## Import the marketplace

1. Open **Workspace settings → Plugins**.
2. Select **Add → Import marketplace**.
3. Use this GitHub repository as the source:

   `https://github.com/rahmanef63/si-coder-agent`

4. Leave the repository path empty unless the UI explicitly asks for the marketplace file location.
5. Review the imported marketplace and install **SI-Coder**.
6. Configure role availability according to the workspace's plugin policy.

OpenAI documents daily sync for imported GitHub marketplaces, so repository updates can flow into the workspace marketplace without a manual re-upload.

## Use it

When explicit plugin controls are available in ChatGPT:

```text
@SI-Coder Build a booking app for my salon.
```

You can also use **+ → More** to select an installed plugin when that control is available. Natural-language requests can use installed skill content automatically where supported.

## Why the OpenAI plugin is separate

The root SI-Coder repository includes a local MCP configuration for local runtimes. The OpenAI web plugin deliberately copies only the core Skills and contains no local MCP server, so it remains appropriate for ChatGPT Web instead of being treated as a desktop-only local integration.

## Publish inside your workspace

If the workspace role is allowed to publish plugins:

1. Open the SI-Coder plugin you own/imported.
2. Open **••• → Share plugin**.
3. Choose the desired workspace access level.
4. Select **Visible in <workspace> directory** to list it in that workspace's directory.

This publishes inside the workspace only. It does not publish SI-Coder to the universal public Plugin Directory.

## Official references

- `https://help.openai.com/en/articles/20001504`
- `https://help.openai.com/en/articles/20001256`
