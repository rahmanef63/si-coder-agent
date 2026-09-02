#!/usr/bin/env bash
# install.sh — portable Agent Skills installer for SI-Coder.
# One skills/ SSOT; symlink into the runtime's user skills directory.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
agent="claude"
custom_dir="${SC_SKILLS_DIR:-}"
with_mcp=0
run_onboarding=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent) agent="${2:?--agent needs claude|codex|hermes|openclaw|all}"; shift 2 ;;
    --skills-dir) custom_dir="${2:?--skills-dir needs a path}"; agent="custom"; shift 2 ;;
    --with-mcp) with_mcp=1; shift ;;
    --no-onboard) run_onboarding=0; shift ;;
    -h|--help)
      cat <<'EOF'
Usage: bash install.sh [options]

  --agent claude|codex|hermes|openclaw|all   target runtime (default: claude)
  --skills-dir PATH                          custom Agent Skills directory
  --with-mcp                                 register local SC MCP where supported
  --no-onboard                               skip interactive credential setup

Claude plugin mode needs no symlink install:
  claude --plugin-dir /path/to/si-coder-agent
EOF
      exit 0 ;;
    *) echo "❌ unknown option: $1" >&2; exit 1 ;;
  esac
done

if ! command -v node >/dev/null 2>&1; then
  echo "❌ SI-Coder local install requires Node.js 22 or newer." >&2
  exit 1
fi
node_major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ ! "$node_major" =~ ^[0-9]+$ ]] || (( node_major < 22 )); then
  echo "❌ SI-Coder requires Node.js >=22; found $(node --version)." >&2
  exit 1
fi

case "$agent" in
  claude) dirs=("$HOME/.claude/skills") ;;
  codex) dirs=("$HOME/.agents/skills") ;;
  hermes) dirs=("$HOME/.hermes/skills") ;;
  openclaw) dirs=("$HOME/.openclaw/workspace/skills") ;;
  all) dirs=("$HOME/.claude/skills" "$HOME/.agents/skills" "$HOME/.hermes/skills" "$HOME/.openclaw/workspace/skills") ;;
  custom) dirs=("$custom_dir") ;;
  *) echo "❌ unknown --agent $agent" >&2; exit 1 ;;
esac

link_skill() {
  local src="$1" dst_dir="$2" name dst
  name="$(basename "$src")"
  dst="$dst_dir/$name"
  mkdir -p "$dst_dir"
  if [[ -e "$dst" && ! -L "$dst" ]]; then
    echo "❌ refusing to overwrite non-symlink: $dst" >&2
    return 1
  fi
  ln -sfn "$src" "$dst"
  echo "🔗 $dst -> $src"
}

catalog="$REPO_DIR/skills/catalog.json"
mapfile -t skill_names < <(node -e '
  const fs=require("fs");
  const rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).skills || {};
  for (const [name,row] of Object.entries(rows)) if (row.lifecycle === "active" && row.installByDefault) console.log(name);
' "$catalog")
skill_dirs=()
for name in "${skill_names[@]}"; do skill_dirs+=("$REPO_DIR/skills/$name"); done
for dst in "${dirs[@]}"; do
  echo "📦 Installing SI-Coder Agent Skills into $dst"
  for src in "${skill_dirs[@]}"; do
    [[ -f "$src/SKILL.md" ]] || continue
    link_skill "$src" "$dst"
  done
done

# The npm link gives humans/agents the `sc` command without touching /usr/bin/sc.
# A link failure must never be silently reported as a fully working CLI install.
npm_link_failed=0
if [[ "${SC_SKIP_NPM_LINK:-0}" != "1" ]]; then
  if command -v npm >/dev/null 2>&1; then
    if ! npm_link_output="$(cd "$REPO_DIR" && npm link 2>&1)"; then
      npm_link_failed=1
      echo "⚠️ Skills were installed, but npm could not link the global 'sc' command." >&2
      echo "   npm said: $(printf '%s' "$npm_link_output" | tail -n 2 | tr '\n' ' ')" >&2
      echo "   You can still run: node '$REPO_DIR/bin/sc.js'" >&2
    fi
  else
    npm_link_failed=1
    echo "⚠️ npm is not available, so the global 'sc' command was not linked." >&2
    echo "   You can still run: node '$REPO_DIR/bin/sc.js'" >&2
  fi
fi

if [[ "$with_mcp" == "1" ]]; then
  echo ""
  echo "🔌 MCP"
  if [[ "$agent" == "codex" || "$agent" == "all" ]]; then
    if command -v codex >/dev/null 2>&1; then
      if codex mcp get si-coder >/dev/null 2>&1; then
        echo "✅ Codex MCP 'si-coder' already configured"
      else
        codex mcp add si-coder -- node "$REPO_DIR/scripts/sc-mcp.js"
        echo "✅ Registered SI-Coder MCP in Codex"
      fi
    else
      echo "ℹ️ Codex CLI not found. When installed: codex mcp add si-coder -- node '$REPO_DIR/scripts/sc-mcp.js'"
    fi
  fi
  if [[ "$agent" == "claude" || "$agent" == "all" ]]; then
    echo "ℹ️ Claude plugin mode loads .mcp.json automatically: claude --plugin-dir '$REPO_DIR'"
    echo "   Standalone skills can register it manually with: claude mcp add --scope user si-coder -- node '$REPO_DIR/scripts/sc-mcp.js'"
  fi
  if [[ "$agent" == "hermes" || "$agent" == "all" ]]; then
    if command -v hermes >/dev/null 2>&1; then
      if hermes mcp list 2>/dev/null | grep -Fq 'si-coder'; then
        echo "✅ Hermes MCP 'si-coder' already configured"
      else
        hermes mcp add si-coder --command node --args "$REPO_DIR/scripts/sc-mcp.js"
        echo "✅ Registered SI-Coder MCP in Hermes"
      fi
    else
      echo "ℹ️ Hermes CLI not found. When installed: hermes mcp add si-coder --command node --args '$REPO_DIR/scripts/sc-mcp.js'"
    fi
  fi
  if [[ "$agent" == "openclaw" || "$agent" == "all" ]]; then
    if command -v openclaw >/dev/null 2>&1; then
      if openclaw mcp show si-coder >/dev/null 2>&1; then
        echo "✅ OpenClaw MCP 'si-coder' already configured"
      else
        openclaw mcp add si-coder --command node --cwd "$REPO_DIR" --arg "$REPO_DIR/scripts/sc-mcp.js"
        echo "✅ Registered SI-Coder MCP in OpenClaw"
      fi
    else
      echo "ℹ️ OpenClaw CLI not found. When installed: openclaw mcp add si-coder --command node --cwd '$REPO_DIR' --arg '$REPO_DIR/scripts/sc-mcp.js'"
    fi
  fi
fi

echo ""
echo "✅ SI-Coder active skills installed for: $agent (${#skill_dirs[@]} skills; unfinished/legacy skills are not installed by default)"
echo "   /sc          → main entry point: describe what you want in plain language"
echo "   /sc-build    → idea → short product interview → first working version → publish"
echo "   /sc-all      → publish an existing app end to end"
echo "   /sc-provider → connect/manage service access safely"
echo "   /sc-install  → portable install guidance"
if [[ "$npm_link_failed" == "0" || "${SC_SKIP_NPM_LINK:-0}" == "1" ]]; then
  echo "   Technical CLI (optional): sc deploy plan --json"
else
  echo "   Technical CLI: node '$REPO_DIR/bin/sc.js' deploy plan --json  (until npm link is fixed)"
fi

[[ -t 0 && -t 1 ]] || run_onboarding=0
if [[ "$run_onboarding" == "1" ]]; then
  echo ""
  read -r -p "Set up credentials now? [Y/n] " _ans
  if [[ ! "$_ans" =~ ^[Nn] ]]; then
    node "$REPO_DIR/bin/sc.js" setup
  fi
else
  echo ""
  echo "Credential setup: sc setup"
  echo "Provider status : sc providers"
  echo "Live verification: sc doctor"
fi
