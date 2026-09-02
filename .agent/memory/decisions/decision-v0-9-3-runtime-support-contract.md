---
id: "decision-v0-9-3-runtime-support-contract"
type: "decision"
title: "v0.9.3 runtime support contract"
status: "confirmed"
confidence: 1
scope: "repository"
tags: ["release","runtime","node","compatibility"]
commit: "f354f32a7b6bb1d7081f87a0cb779570cd6305e5+dirty"
supersedes: null
created_at: "2026-09-02T20:44:35.588Z"
last_verified: null
related_areas: ["package engines","install.sh","CI matrix","release history"]
verification: ["Node 22.23.2: 316/316 pass","Node 24.20.0: 316/316 pass","Node 26.8.1: 316/316 pass","npm run verify:release passes on clean v0.9.3 commit"]
decision: "Keep v0.9.2 immutable after it was already committed and tagged. Ship the remaining runtime-contract correction as v0.9.3. Support only Node.js majors 22, 24, and 26 because the full 316-test suite passes on 22.23.2, 24.20.0, and 26.8.1; exclude EOL 23/25 and unverified future majors until the compatibility matrix is intentionally extended."
---
