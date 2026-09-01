// user-facing.js — non-technical presentation layer for SI-Coder.
// Internal route/provider details stay available for agents and diagnostics, while this helper
// turns them into outcome-oriented language for people who should not need DevOps vocabulary.

const FRIENDLY_PROVIDER = Object.freeze({
  github: 'code storage',
  vercel: 'hosting',
  convex: 'app data',
  'convex-cloud': 'app data',
  hostinger: 'domain',
  dokploy: 'server',
  resend: 'email',
  composio: 'connected accounts',
});

function friendlyProvider(id) { return FRIENDLY_PROVIDER[id] || id; }

function userPlanForDeploy(plan) {
  const hosted = plan.runtime === 'hosted';
  const waiting = plan.route === 'decision-required';
  const blocked = plan.ready === false;

  if (waiting) {
    return {
      title: 'One choice before I continue',
      outcome: 'I will use the simplest suitable way to put your app online.',
      status: 'needs-answer',
      question: 'Do you want to use your own server, or should I use the easiest managed option?',
      choices: [
        { id: 'vps', label: 'Use my own server' },
        { id: 'managed', label: 'Use the easiest option' },
      ],
      technicalDetailsOptional: true,
    };
  }

  const base = {
    title: 'Ready to put your web app online',
    outcome: 'SI-Coder will handle publishing, the domain, and the final checks.',
    status: blocked ? 'needs-action' : 'ready',
    steps: [
      'Prepare the app version to publish',
      'Connect any accounts that are actually needed',
      'Publish the app',
      'Connect your chosen domain',
      'Verify security and the main user flow',
    ],
    technicalDetailsOptional: true,
  };

  if (hosted) {
    base.connectionMessage = 'You do not need to prepare a server or terminal. I will use secure account connections.';
    base.accounts = ['code storage', 'app data', 'hosting', 'domain'];
  } else if (plan.route === 'vps') {
    base.connectionMessage = 'I will use your server and handle the technical setup behind the scenes.';
    base.accounts = ['code storage', 'server', 'domain'];
  } else {
    base.connectionMessage = 'I will use managed hosting so you do not need to maintain a server.';
    base.accounts = ['code storage', 'app data', 'hosting', 'domain'];
  }

  if (blocked) {
    const first = plan.blockedBy?.[0];
    if (first?.capability === 'composio') {
      base.action = {
        title: 'Connect your accounts',
        message: 'I need secure permission to use the services for your app. Do not send passwords or API keys in chat.',
        buttonLabel: 'Connect accounts',
      };
    } else if (first?.capability === 'vps-runner') {
      base.action = {
        title: 'Connect your server',
        message: 'Because you chose your own server, I need a secure connection to it before I can continue.',
        buttonLabel: 'Connect server',
      };
    }
  }

  return base;
}

function userCredentialCard({ provider, createAt, note, saveWith, saveDestination, continueWith, hosted = false } = {}) {
  const name = friendlyProvider(provider);
  if (hosted) {
    return {
      title: `Connect ${name}`,
      message: `Allow SI-Coder to access ${name} through the secure connection page. Do not send a password or key in chat.`,
      primaryAction: { label: `Connect ${name}`, url: createAt || null },
      after: 'Once connected, I will continue automatically.',
      technicalDetailsOptional: true,
    };
  }
  return {
    title: `Give SI-Coder access to ${name}`,
    message: 'Create the access on the official page, then store it through SI-Coder. The value will not be displayed back to you.',
    primaryAction: { label: 'Open the official page', url: createAt || null },
    instructions: note || null,
    saveAction: saveWith || null,
    after: 'After it is stored, SI-Coder will verify the access and continue.',
    technical: { saveDestination: saveDestination || null, verify: continueWith || null },
    technicalDetailsOptional: true,
  };
}

function friendlyRecommendation({ next, why, prerequisites = [], action } = {}) {
  return {
    label: '[rekomendasi]',
    title: next || 'Next step',
    reason: why || 'This makes the web app more complete and ready to use.',
    beforeWeStart: prerequisites,
    offer: action || 'If you want, I can continue with this next.',
  };
}

module.exports = { friendlyProvider, userPlanForDeploy, userCredentialCard, friendlyRecommendation };
