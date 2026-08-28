#!/usr/bin/env bash
cd ~/worker-sandbox/calc
npm test 2>&1 | tail -n 10
