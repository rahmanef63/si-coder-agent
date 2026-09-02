---
id: "test-zip-packaging-ignores-group-write-permission-drift"
type: "test"
title: "ZIP packaging ignores group-write permission drift"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["distribution","determinism","release"]
commit: "7f177ff3a792d8e32c654cb8f7a730d41fa1c4fb+dirty"
supersedes: null
created_at: "2026-09-02T17:16:55.941Z"
last_verified: "2026-09-02T17:15:00.000Z"
target: "skill package deterministic permissions"
source: "DIST-8b and repeated package:skills"
environment: "node v22.23.2, python 3.12.3"
steps: ["package identical fixture at 0644 and 0664","compare archive bytes","rebuild real artifacts twice","compare hashes"]
expected: "source group-write bit cannot change generated ZIP bytes"
actual: "DIST-8b passed; two real rebuilds produced sc.skill/sc.zip sha256 656020952269789efc1a53a138a1c882f4428d72eecd44ebe828500e381abb55"
result: "pass"
related_areas: ["distribution","release"]
---
