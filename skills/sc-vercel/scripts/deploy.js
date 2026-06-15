#!/usr/bin/env node
// deploy.js — Vercel online frontend deploy orchestrator (Vercel + Convex Cloud).
//
// Creates/links a Vercel project bound to a GitHub repo, sets CONVEX_DEPLOY_KEY,
// sets the coupled build command (Convex Cloud deploy injects NEXT_PUBLIC_CONVEX_URL
// into the Next.js build), adds a custom domain/subdomain, writes the matching
// Hostinger DNS from Vercel's required config, triggers + polls the deploy.
//
// NEVER log CONVEX_DEPLOY_KEY — it is a secret. Only NEXT_PUBLIC_CONVEX_URL (public)
// is ever printed.
const path = require('path');
const { execFileSync } = require('child_process');
const { getClient, parseArgs } = require('./_shared');
const { configureDnsRecord } = require(path.resolve(__dirname, '../../../lib/hostinger'));

// Read owner/name from the local `origin` git remote in `cwd`.
function deriveFromGitRemote(cwd) {
  try {
    const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd }).toString().trim().replace(/\/$/, '');
    const m = url.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    if (m) return `${m[1]}/${m[2]}`;
  } catch (e) {
    // no remote / not a repo — caller handles the null case
  }
  return null;
}

// Read the current branch name in `cwd` (e.g. 'main', 'master'). null if detached/unknown.
function deriveBranchFromGit(cwd) {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd }).toString().trim();
    if (branch && branch !== 'HEAD') return branch;
  } catch (e) {
    // not a repo / detached HEAD — caller falls back to 'main'
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.cwd || process.cwd();
  const project = args.project || args.app;
  const app = args.app || args.project;
  const domain = args.domain;
  const prod = !!args.prod;
  const decoupled = !!args.decoupled;

  if (!project || !domain) {
    console.error('Usage: deploy.js --project <name> --app <name> --domain <host> [--git-owner <o> --git-repo <r>] [--ref <branch>] [--prod] [--decoupled] [--cwd <path>]');
    process.exit(1);
  }

  const token = process.env.VERCEL_TOKEN;
  if (!token) { console.error('Missing VERCEL_TOKEN in env'); process.exit(1); }
  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  if (!deployKey) { console.error('Missing CONVEX_DEPLOY_KEY in env (required for the online path)'); process.exit(1); }
  const hostingerToken = process.env.HOSTINGER_API_TOKEN; // optional — for DNS

  const vercel = getClient();

  // 2. Resolve git repo (owner/name).
  const owner = args['git-owner'];
  const repo = args['git-repo'];
  const gitRepo = (owner && repo) ? `${owner}/${repo}` : deriveFromGitRemote(cwd);
  if (!gitRepo) {
    console.error('Could not resolve GitHub repo. Pass --git-owner <o> --git-repo <r> or run inside a repo with an origin remote.');
    process.exit(1);
  }
  const [gitOwner, gitName] = gitRepo.split('/');

  // Resolve the git ref to deploy: explicit flag, else the repo's current branch, else 'main'.
  const ref = args.ref || args.branch || deriveBranchFromGit(cwd) || 'main';
  console.log(`📦 Vercel deploy: project=${project} app=${app} repo=${gitRepo} ref=${ref} domain=${domain}`);

  // 3. Find or create the project bound to the GitHub repo.
  const proj = await vercel.findOrCreateProject({ name: project, gitRepo, framework: 'nextjs' });
  console.log(`✅ project id=${proj.id}`);

  // 4. Set env vars. CONVEX_DEPLOY_KEY is a prod key -> Production only, encrypted.
  const envVars = [
    { key: 'CONVEX_DEPLOY_KEY', value: deployKey, type: 'encrypted', target: ['production'] },
  ];
  // Only set NEXT_PUBLIC_CONVEX_URL when a decoupled build is explicitly chosen.
  // Default: omit — the --cmd injection at build time is the source of truth.
  if (decoupled && process.env.NEXT_PUBLIC_CONVEX_URL) {
    envVars.push({ key: 'NEXT_PUBLIC_CONVEX_URL', value: process.env.NEXT_PUBLIC_CONVEX_URL, type: 'plain', target: ['production', 'preview'] });
  }
  const envRes = await vercel.setEnvVars(proj.id, envVars, ['production', 'preview']);
  if (envRes && Array.isArray(envRes.failed) && envRes.failed.length) {
    console.warn(`⚠️ ${envRes.failed.length} env var(s) failed to set (continuing)`);
  }
  console.log('🔐 env vars set (CONVEX_DEPLOY_KEY -> production, encrypted)');

  // 5. Build command. Default (coupled): Convex Cloud deploys first and injects
  // NEXT_PUBLIC_CONVEX_URL into the Next.js build. Decoupled: plain build — the
  // URL comes from the env var set above, NOT from --cmd injection (no double-set).
  const buildCommand = decoupled
    ? 'npm run build'
    : "npx convex deploy --cmd 'npm run build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL";
  await vercel.setBuildCommand(proj.id, buildCommand);
  console.log(`🛠️  build command set: ${buildCommand}`);

  // 6. Add the custom domain (tolerate 409 already-assigned to THIS project, but
  //    surface a 409 where the domain is owned by another project/team — SCV-3).
  const domRes = await vercel.addDomain(proj.id, domain);
  if (domRes && domRes.conflict) {
    console.error(`❌ domain ${domain} is owned by another Vercel project/team (409). Remove it there or pick a different host.`);
    process.exit(1);
  }
  console.log(`🌐 domain attached: ${domain}`);

  // 7. Read the exact DNS record Vercel requires for this host.
  const dns = await vercel.getRequiredDns(proj.id, domain);
  console.log(`📋 required DNS: ${dns.recordType} ${domain} -> ${dns.value}${dns.misconfigured ? ' (currently misconfigured)' : ''}`);

  // 8. Configure Hostinger DNS (or print manual instructions).
  if (hostingerToken) {
    if (dns.txt) {
      console.log(`📝 ownership TXT required: ${dns.txt.name} -> ${dns.txt.value}`);
      await configureDnsRecord({ fullDomain: dns.txt.name, type: 'TXT', target: dns.txt.value, hostingerToken });
      try {
        await vercel.verifyDomain(proj.id, domain);
        console.log('✅ domain verification requested');
      } catch (e) { console.warn(`⚠️ verify failed: ${e.message}`); }
    }
    await configureDnsRecord({ fullDomain: domain, type: dns.recordType, target: dns.value, hostingerToken });
  } else {
    console.log('\n⚠️ No HOSTINGER_API_TOKEN — add these DNS records manually:');
    if (dns.txt) console.log(`   TXT ${dns.txt.name} -> ${dns.txt.value}`);
    console.log(`   ${dns.recordType} ${domain} -> ${dns.value}`);
  }

  // 9. Trigger the first deploy (git-linked projects auto-deploy on push, but force one).
  console.log(`🚀 triggering ${prod ? 'production' : 'preview'} deploy...`);
  let dpl;
  try {
    dpl = await vercel.triggerDeploy({
      projectId: proj.id,
      name: project,
      org: gitOwner,
      repo: gitName,
      ref,
      prod,
    });
  } catch (e) {
    // Anchor to the 'Vercel 403' prefix the client throws (lib/vercel.js formats errors as
    // `Vercel <status> <endpoint>: ...`) so a stray 403 inside a JSON body can't false-match.
    if (/Vercel 403\b/.test(e.message)) {
      console.error('❌ triggerDeploy 403 — the Vercel GitHub App is likely not installed on the repo/org.');
      console.error('   Install it at https://vercel.com/account/integrations then re-run.');
    }
    throw e;
  }
  console.log(`📨 deployment ${dpl.id} (${dpl.url || 'pending'})`);

  // 10. Poll readiness (capped — never loop forever if Vercel stalls).
  const terminal = new Set(['READY', 'ERROR', 'CANCELED']);
  const buildDeadline = Date.now() + 15 * 60 * 1000; // 15 min hard cap
  let state = dpl.readyState;
  let last = dpl;
  while (!terminal.has(state)) {
    if (Date.now() > buildDeadline) {
      console.error(`❌ deploy timed out after 15min (last readyState=${state}). Check https://vercel.com for ${dpl.id}.`);
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 4000));
    // A transient blip (network hiccup, Vercel 5xx, timeout) must NOT abort the whole
    // deploy. Swallow it, log, and keep polling until the 15-min buildDeadline above
    // catches a genuine stall.
    try {
      last = await vercel.getDeployment(dpl.id);
      state = last.readyState;
      console.log(`   ... readyState=${state}`);
    } catch (e) {
      console.warn(`   ... poll blip (continuing): ${e.message}`);
    }
  }
  if (state === 'ERROR') {
    console.error(`❌ deploy ERROR: ${last.errorMessage || 'unknown'}`);
    process.exit(1);
  }
  if (state === 'CANCELED') {
    console.error('❌ deploy CANCELED');
    process.exit(1);
  }
  console.log(`✅ deploy READY: https://${last.url}`);
  console.log(`🔗 custom domain: https://${domain}`);

  // 11. Poll DNS propagation (soft — DNS + cert can lag; never hard-fail).
  const dnsDeadline = Date.now() + 60000;
  let dnsOk = false;
  while (Date.now() < dnsDeadline) {
    try {
      const cfg = await vercel.getDomainConfig(domain, proj.id);
      if (cfg && cfg.misconfigured === false) { dnsOk = true; break; }
    } catch (e) { /* transient — keep polling */ }
    await new Promise(r => setTimeout(r, 5000));
  }
  console.log(dnsOk ? '✅ DNS configured (misconfigured=false)' : '⏳ DNS still propagating (cert/record may lag)');

  // 12. Summary.
  let cloudUrl = null;
  try {
    const cc = require(path.resolve(__dirname, '../../../lib/convex-cloud'));
    if (cc && typeof cc.deriveCloudUrl === 'function') cloudUrl = cc.deriveCloudUrl(deployKey);
  } catch (e) { /* convex-cloud lib optional here */ }

  console.log('\n— Summary —');
  console.log(`project id:       ${proj.id}`);
  console.log(`deployment URL:   https://${last.url}`);
  console.log(`custom domain:    https://${domain}`);
  console.log(`DNS applied:      ${dns.recordType} ${domain} -> ${dns.value}`);
  if (cloudUrl) console.log(`Convex Cloud URL: ${cloudUrl}`);
  console.log('\n✅ sc-vercel deploy done.');
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
