#!/usr/bin/env node
const { planDeploy } = require('../lib/deploy-route');

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--target') out.target = argv[++i];
    else if (a === '--composio') out.composio = true;
    else if (a === '--no-composio') out.composio = false;
    else if (a === '--vps') out.vps = true;
    else if (a === '--no-vps') out.vps = false;
    else if (a === '--json') out.json = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

try {
  const a = parse(process.argv.slice(2));
  const plan = planDeploy({
    requestedTarget: a.target || 'auto',
    env: process.env,
    composioAvailable: a.composio === undefined ? process.env.SC_COMPOSIO_AVAILABLE : a.composio,
    vpsAvailable: a.vps,
  });
  if (a.json || !process.stdout.isTTY) console.log(JSON.stringify(plan, null, 2));
  else {
    console.log(`route: ${plan.route} (${plan.target})`);
    console.log(`because: ${plan.reason}`);
    console.log(`flow: ${plan.flow.join(' -> ')}`);
    for (const p of plan.providerRouting) console.log(`  ${p.provider}: ${p.backend}`);
  }
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
