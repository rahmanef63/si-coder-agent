'use strict';

// lib/vercel.js coverage — locks in SCV-1 (DNS value normalization + IPv4 guard) and
// SCV-3 (409 disambiguation) against regression. Node built-ins only; mocks global.fetch.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeClient } = require('../lib/vercel');

// Minimal fetch stub: `route(url, init)` returns { status, body }. Body is JSON-stringified
// unless already a string. Shapes match what lib/vercel.js fetchWithTimeout consumes.
function mockFetch(route) {
  return async (url, init = {}) => {
    const r = route(String(url), init);
    const body = r.body === undefined ? '{}' : (typeof r.body === 'string' ? r.body : JSON.stringify(r.body));
    return { ok: r.status >= 200 && r.status < 300, status: r.status, text: async () => body };
  };
}

test('getRequiredDns (SCV-1): array-valued recommendedIPv4 normalizes to one dotted-quad A target', async () => {
  const orig = global.fetch;
  global.fetch = mockFetch((url) => {
    if (url.includes('/v6/domains/')) {
      return { status: 200, body: { misconfigured: true, recommendedCNAME: [], recommendedIPv4: [{ rank: 1, value: ['76.76.21.21', '76.76.21.93'] }] } };
    }
    return { status: 404 }; // getProjectDomain -> no TXT challenge
  });
  try {
    const dns = await makeClient({ token: 't' }).getRequiredDns('proj', 'example.com');
    assert.equal(dns.recordType, 'A');
    assert.equal(dns.value, '76.76.21.21', 'array head, never the raw array');
  } finally { global.fetch = orig; }
});

test('getRequiredDns (SCV-1): a non-IPv4 A target throws instead of emitting a broken record', async () => {
  const orig = global.fetch;
  global.fetch = mockFetch((url) => {
    if (url.includes('/v6/domains/')) {
      return { status: 200, body: { misconfigured: true, recommendedCNAME: [], recommendedIPv4: [{ rank: 1, value: 'cname.vercel-dns.com' }] } };
    }
    return { status: 404 };
  });
  try {
    await assert.rejects(() => makeClient({ token: 't' }).getRequiredDns('proj', 'example.com'), /unexpected A-record target/);
  } finally { global.fetch = orig; }
});

test('addDomain (SCV-3): 409 owned-elsewhere surfaces { conflict:true }, not a silent benign', async () => {
  const orig = global.fetch;
  global.fetch = mockFetch((url, init) => {
    if (init.method === 'POST' && url.includes('/domains')) return { status: 409, body: { error: { code: 'domain_already_in_use' } } };
    return { status: 404 }; // getProjectDomain -> NOT on this project
  });
  try {
    const res = await makeClient({ token: 't' }).addDomain('proj', 'taken.com');
    assert.equal(res.conflict, true, 'owned-elsewhere 409 -> conflict, must surface');
  } finally { global.fetch = orig; }
});

test('addDomain (SCV-3): 409 already-on-this-project is benign { alreadyExists:true }', async () => {
  const orig = global.fetch;
  global.fetch = mockFetch((url, init) => {
    if (init.method === 'POST' && url.includes('/domains')) return { status: 409, body: { error: { code: 'domain_already_in_use' } } };
    return { status: 200, body: { name: 'mine.com', verified: true } }; // getProjectDomain -> on this project
  });
  try {
    const res = await makeClient({ token: 't' }).addDomain('proj', 'mine.com');
    assert.equal(res.alreadyExists, true, 'on-this-project 409 -> benign');
  } finally { global.fetch = orig; }
});
