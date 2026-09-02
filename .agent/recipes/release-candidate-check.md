---
id: "release-candidate-check"
name: "release-candidate-check"
status: "executable"
observed_count: 9
last_observed: "2026-09-02T20:44:17.696Z"
scope: "repository"
tags: ["verification","release","security"]
steps: ["JS syntax check","installer bash syntax check","full regression","docs check","skill catalog check","skill verification","full repository secret scan"]
script: "scripts/release-candidate-check.js"
---
