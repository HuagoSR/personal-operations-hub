#!/usr/bin/env bash
grep -n "subtract" ~/worker-sandbox/calc/src/calc.js
cd ~/worker-sandbox/calc && npm test 2>&1 | grep -E "^# (tests|pass|fail)"
