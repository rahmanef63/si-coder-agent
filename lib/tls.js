// lib/tls.js — poll a domain until it serves a VALID TLS cert (verify ON)
// Replaces the NODE_TLS_REJECT_UNAUTHORIZED=0 anti-pattern.
async function waitForValidTls(apiDomain, { attempts = 30, delayMs = 5000, probePath = '/version', timeoutMs = 10000 } = {}) {
  if (!apiDomain) throw new Error('apiDomain required');
  const url = `https://${apiDomain}${probePath}`;
  let lastErr = '';
  for (let i = 0; i < attempts; i++) {
    // A backend that accepts the TCP connection but never sends an HTTP response would
    // hang `await fetch` forever; bound each attempt so the schema-deploy path can't stall.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Native fetch verifies the chain; a self-signed / not-yet-issued cert rejects here.
      const r = await fetch(url, { method: 'GET', signal: controller.signal });
      if (r.status > 0) return true; // any HTTP response means TLS handshake + verify passed
    } catch (e) {
      lastErr = e.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : e.message;
    } finally {
      clearTimeout(timer);
    }
    // RES-RE-NIT-3: don't sleep after the final attempt — it only delays the surfaced error.
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  throw new Error(`TLS not valid for https://${apiDomain} after ${attempts} attempts: ${lastErr}`);
}

module.exports = { waitForValidTls };
