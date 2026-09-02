---
id: "debug-node-test-runner-unicode-ipc"
type: "debug"
title: "Node test runner Unicode IPC flake"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["node","test-runner","cloudflare","ipc","verification"]
commit: "cfd6b22bd2c2bc56c7ab763c063eff97025b98d8+dirty"
supersedes: null
created_at: "2026-09-02T17:05:52.489Z"
last_verified: "2026-09-02T17:05:28.978Z"
issue: "Intermittent full-suite verification failed at file level with ERR_TEST_FAILURE: Unable to deserialize cloned data due to invalid or unsupported version."
root_cause: "Node v22.23.2 node:test child-process IPC has an upstream serialization/deserialization defect that can be triggered when multibyte stdout progress output shares the test child stream; Cloudflare tests exercised that path repeatedly."
fix: "Make Cloudflare high-level DNS logging injectable while preserving console as the production default, inject a silent logger into every Cloudflare test path including timeout tests, and lock the boundary with SCF-20."
symptoms: ["test/cloudflare.test.js failed at file level while individual assertions were passing","suite count dropped from 304 to 290 with 289 pass and 1 fail","multibyte Cloudflare progress output appeared immediately before the child IPC failure"]
failed_attempts: ["initial release verification rerun passed and masked the intermittent failure","silencing only FAST-path calls still failed at dedicated stress run 28 because two timeout tests bypassed FAST"]
verification: ["reproduced before fix in full suite and dedicated Cloudflare stress","Cloudflare stress passed 50/50 after all test paths used the injected logger","after SCF-20 Cloudflare stress passed another 30/30","after SCF-20 full repository suite passed 5/5 consecutive runs at 305/305"]
---
