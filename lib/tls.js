// lib/tls.js — poll a domain until it serves a VALID TLS cert (verify ON)
// Replaces the NODE_TLS_REJECT_UNAUTHORIZED=0 anti-pattern.
async function waitForValidTls(apiDomain, { attempts = 30, delayMs = 5000, probePath = '/version' } = {}) {
  if (!apiDomain) throw new Error('apiDomain required');
  const url = `https://${apiDomain}${probePath}`;
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    try {
      // Native fetch verifies the chain; a self-signed / not-yet-issued cert rejects here.
      const r = await fetch(url, { method: 'GET' });
      if (r.status > 0) return true; // any HTTP response means TLS handshake + verify passed
    } catch (e) {
      lastErr = e.message;
    }
    await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`TLS not valid for https://${apiDomain} after ${attempts} attempts: ${lastErr}`);
}

module.exports = { waitForValidTls };
