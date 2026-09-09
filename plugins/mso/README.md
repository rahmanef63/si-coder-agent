# Optional MSO adapter

MSO can consume SI-Coder's host-neutral `../si-coder/plugin.json`. This adapter materializes Agent Skills for MSO's non-symlink skill directory and declares both the MCP (`scripts/sc-mcp.js`, `machine/functions.json`) and Agent Skills surfaces. It is optional: SI-Coder does not discover MSO directories or credentials.

For an existing compatibility workflow, run `bash install.sh --agent mso`; the core installer delegates to this adapter and prints a deprecation notice. The adapter never stores credentials in its manifest.


## Project MCP composition

When an authorized MSO connection exposes a project-owned MCP, discover its tools
through that connection and use the bounded action appropriate to the requested
outcome. Keep connection details, credentials, and authorization scoped to the
target account. MSO may materialize skill bundles because it does not follow
directory symlinks; the core SI-Coder bundle remains host-neutral.
