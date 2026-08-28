'use strict';
const { HIGH_RISK_CAPABILITIES } = require('../domain/states');
const { findGrant } = require('../domain/execution-grant');

function evaluate(grant, capability) {
  const highRisk = HIGH_RISK_CAPABILITIES.has(capability);
  if (!grant || grant.state !== 'ACTIVE') {
    return { autoDecision: null, grantValue: null, highRisk, revoked: !grant || grant.state === 'REVOKED' };
  }
  const caps = JSON.parse(grant.capabilities_json);
  const value = caps[capability] || 'ask';
  if (highRisk) return { autoDecision: null, grantValue: value, highRisk: true, revoked: false };
  if (value === 'allow') return { autoDecision: 'ALLOW', grantValue: value, highRisk: false, revoked: false };
  if (value === 'deny') return { autoDecision: 'DENY', grantValue: value, highRisk: false, revoked: false };
  return { autoDecision: null, grantValue: value, highRisk: false, revoked: false };
}

function getGrantForEvaluation(db, grantId) {
  if (!grantId) return null;
  return findGrant(db, grantId);
}

module.exports = { evaluate, getGrantForEvaluation };
