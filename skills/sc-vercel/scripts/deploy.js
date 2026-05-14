#!/usr/bin/env node
// deploy.js — STUB. Vercel project create + env + deploy, alternative frontend host to Dokploy.
//
// TODO(impl):
// 1. Add lib/vercel.js with team-aware fetch wrapper (?teamId=...).
// 2. Find or create project: POST /v10/projects with { name, gitRepository: { type: 'github', repo: 'owner/name' } }.
// 3. Upsert env: POST /v10/projects/:id/env (target: ['production', 'preview']).
// 4. Add domain: POST /v10/projects/:id/domains { name }.
// 5. Trigger deployment: POST /v13/deployments with { name, gitSource: { type: 'github', ref: 'main' } }.
// 6. Poll GET /v13/deployments/:id until readyState === 'READY' | 'ERROR'.
console.error('sc-vercel/deploy.js: not implemented yet. See SKILL.md for plan.');
process.exit(2);
