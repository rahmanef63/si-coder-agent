# SI Coder: Zero-Human Full-Stack Deployment 🚀

Deploy any full-stack website (Next.js + Convex DB) with **Zero Human Involvement** using Dokploy, GitHub, and Hostinger DNS.

## 🌟 The Niche
Stop manually setting up VPS, DNS, and Databases. **SI Coder** automates the entire lifecycle:
1.  **GitHub**: Creates a private repo and pushes your local code via SSH.
2.  **Hostinger**: Automatically adds `A` records for your main domain and 3 backend subdomains.
3.  **Dokploy**: Creates the project, sets up the Application (Frontend) and Compose (Backend).
4.  **Convex**: Automatically deploys the schema, seeds data, and saves the Admin Key to Dokploy envs.

---

## 🤖 Instructions for AI Agents (Installation)
If you are an AI agent, you can "ingest" this skill by reading the `SKILL.md` file in this repository.

**Standard Installation Path:**
- **OpenClaw/Codex**: `~/.openclaw/skills/si-coder/`
- **Claude**: `~/.claude/agents/si-coder/`
- **Gemini CLI**: `~/.gemini/skills/si-coder/`

### How to use this skill:
Once installed, the user can prompt:
> *"Use si-coder to deploy my project 'my-app' to 'myapp.com'. Style it like Notion and add a Chat feature. Run it autonomously."*

---

## 🛠 Prerequisites & Setup

### 1. Environment Variables
Copy `.env.example` to your shell profile (e.g., `~/.bashrc` or `~/.zshrc`):

```bash
export GITHUB_TOKEN="ghp_..."
export DOKPLOY_API_URL="https://your-dokploy.com/api"
export DOKPLOY_API_KEY="your_key"
export HOSTINGER_API_TOKEN="your_token" # Optional: For DNS Auto-sync
```

### 2. Local Requirements
- **Node.js**: Required to run the deployment script.
- **SSH Access**: Your machine must have SSH keys registered with GitHub (`git@github.com`).
- **Project Structure**: Ensure your project has a `Dockerfile` (for frontend) and a `docker-compose.yml` (to trigger Convex backend).

---

## 📦 What's Included?
- `scripts/deploy.js`: The "brain" of the operation. Handles all API calls.
- `SKILL.md`: The instruction manual for AI agents.
- `.env.example`: Template for your credentials.

## ❓ FAQ & Debugging

### **Q: Why is my site stuck on "Loading"?**
**A:** Check your `Dockerfile`. Ensure you are using `ARG` and `ENV` for `NEXT_PUBLIC_CONVEX_URL` so the script can inject the correct URL during the build.

### **Q: Convex Dashboard shows 401/404?**
**A:** The script automatically generates an `Admin Key`. Check your Dokploy Dashboard -> Compose Service -> Environment Variables to find the `CONVEX_ADMIN_KEY`. Use this key to login.

### **Q: DNS not propagating?**
**A:** Hostinger API changes are usually instant, but global DNS can take 1-5 minutes. The script adds the records, but you might need to wait a moment before the SSL (Let's Encrypt) succeeds in Dokploy.

---

## 📜 License
MIT - Created by Rahman EF.
