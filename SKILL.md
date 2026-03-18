---
name: si-coder
description: "Zero-Human full-stack deployment to Dokploy via GitHub and Hostinger DNS."
version: 1.1.0
metadata:
  requires:
    env:
      - DOKPLOY_API_URL
      - DOKPLOY_API_KEY
      - GITHUB_TOKEN
      - HOSTINGER_API_TOKEN
    bins:
      - node
      - git
      - npx
---

# SI Coder Auto Deploy

This skill automates the entire lifecycle of creating a GitHub repository and deploying full-stack apps to a Dokploy server.

## CORE MANDATES FOR THE AI (LEARNED LESSONS)
To guarantee **Zero Human Involvement** (the user just wants to receive the final working URL):
1. **Self-Hosted Convex by Default**: NEVER use Clerk unless explicitly asked. ALWAYS use `@convex-dev/auth`. ALWAYS include a `docker-compose.yml` for self-hosting Convex alongside the frontend.
2. **Build Safety**: Do NOT run `npx convex codegen` inside the `Dockerfile`. You MUST generate the types locally (`npx convex dev --once`) and commit the `convex/_generated` folder to Git before deploying.
3. **No Prompts / Dependency Hell**: Always use `npm install --yes --legacy-peer-deps`. If a scaffolded template is too complex (bloated), wipe it and start fresh with `npx create-next-app` to avoid endless TypeScript errors.
4. **Exact Cloning**: If asked to clone a website (e.g., `siata.org`), you MUST replicate its actual layout (e.g., full-screen map with sidebars), not just build a generic admin dashboard. Fetch the website to understand its structure.
5. **Dokploy Idempotency**: The deployment script handles existing apps, composes, and domains safely. Do NOT delete or recreate existing domains if Dokploy rejects them (it means they are already configured via Hostinger/Dokploy).

## Pre-requisites
1. **Dokploy Credentials**: Environment variables `DOKPLOY_API_URL` and `DOKPLOY_API_KEY` (usually stored in `~/.bashrc`).
2. **GitHub Credentials**: A GitHub Personal Access Token (PAT) with repository creation permissions, stored in `GITHUB_TOKEN` environment variable.
3. **Hostinger Credentials**: `HOSTINGER_API_TOKEN` (optional but recommended for DNS automation).
4. **SSH Keys**: The machine must have SSH access to GitHub (`git@github.com`) configured for pushing code.

## Workflow

When the user asks to deploy a project:

1. **Verify Credentials**: Check for `DOKPLOY_API_URL`, `DOKPLOY_API_KEY`, and `GITHUB_TOKEN`.
2. **Docker Compose**: Ensure the project has a `docker-compose.yml` that defines the frontend, backend (Convex DB), etc. (Or at least a Dockerfile for simple apps).
3. **Execute Deployment Script**: Run the Node.js deployment script from inside the project directory.

## Features
- **Zero-Human Intervention**: The script creates reops, pushes code, creates projects, and triggers deployments automatically.
- **Hostinger DNS Automation**: If `HOSTINGER_API_TOKEN` is present, the script automatically adds `A` records for your main domain and Convex backend subdomains (`api-`, `dash-`, `site-`) pointing to your Dokploy server.
- **Self-Hosted Convex DB**: Automatically deploys a production-ready Convex self-hosted DB using Dokploy templates.

```bash
cd <your_project_dir>
node <path_to_skill>/scripts/deploy.js "$DOKPLOY_API_URL" "$DOKPLOY_API_KEY" "<PROJECT_NAME>" "<APP_NAME>" "$GITHUB_TOKEN" "[DOMAIN]"
```

### Example

```bash
cd ./my-ecommerce-app
node ./scripts/deploy.js "$DOKPLOY_API_URL" "$DOKPLOY_API_KEY" "my-store" "my-ecommerce-app" "$GITHUB_TOKEN" "mystore.com"
```

## How the script works
The script will:
1. Contact the GitHub API using `GITHUB_TOKEN` to create a new private repository named `APP_NAME`.
2. Initialize local Git, commit files (including `convex/_generated`), and `git push` to GitHub via SSH.
3. Fetch Dokploy projects to find or create `PROJECT_NAME`.
4. Auto-detect if `docker-compose.yml` exists. If so, it creates a **Dokploy Compose** service (grouping the Frontend + Convex Self-Hosted DB). If not, it creates a standard **Dokploy Application**.
5. Update the Dokploy source to point to the new GitHub repository (using PAT embedded in URL).
6. Create the `DOMAIN` for the application (silently skips if it already exists).
7. Trigger the deployment and poll for success.
