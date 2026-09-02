---
id: "test-node-test-runner-unicode-ipc-deflake"
type: "test"
title: "Cloudflare Node test-runner deflake stress"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["node","test-runner","cloudflare","ipc","regression"]
commit: "cfd6b22bd2c2bc56c7ab763c063eff97025b98d8+dirty"
supersedes: null
created_at: "2026-09-02T17:05:52.595Z"
last_verified: "2026-09-02T17:05:28.978Z"
target: "Cloudflare verification stability"
source: "manual stress verification"
environment: "node v22.23.2"
steps: ["run Cloudflare test file 30 consecutive times after SCF-20","run complete npm test suite 5 consecutive times"]
expected: "no node:test IPC deserialize failure and every complete suite reports 305/305"
actual: "Cloudflare 30/30 passed; full repository suite 5/5 passed; every full run reported 305 tests, 305 pass, 0 fail"
result: "pass"
related_areas: ["cloudflare","test runner","verification","release"]
---
