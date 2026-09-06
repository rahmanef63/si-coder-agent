#!/usr/bin/env node
'use strict';

const SkillCLI = require('../lib/skill-cli');

SkillCLI.runStandalone(process.argv.slice(2)).catch(error => {
  console.error(`❌ ${error.message}`);
  process.exitCode = 1;
});
