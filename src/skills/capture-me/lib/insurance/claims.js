/**
 * lib/insurance/claims.js — 理赔记录封装 + 状态机
 *
 * submitted → under_review → approved → paid
 *                          ↘ rejected
 */
const insDb = require('./db');

const STATUS_TRANSITIONS = {
  submitted: ['under_review', 'approved', 'rejected'],
  under_review: ['approved', 'rejected'],
  approved: ['paid'],
  rejected: [],
  paid: [],
};

function addClaim(input) { return insDb.insertClaim(input); }
function getClaim(id) { return insDb.getClaim(id); }
function listClaimsByPolicy(pid) { return insDb.listClaimsByPolicy(pid); }
function recentClaims(days = 365) { return insDb.listClaimsSince(days); }

function updateClaimStatus(claimId, newStatus) {
  const c = getClaim(claimId);
  if (!c) throw new Error(`claim ${claimId} not found`);
  const allowed = STATUS_TRANSITIONS[c.status] || [];
  if (!allowed.includes(newStatus)) {
    throw new Error(`invalid transition: ${c.status} → ${newStatus}; allowed: ${allowed.join(', ')}`);
  }
  insDb.updateClaim(claimId, { status: newStatus });
  return getClaim(claimId);
}

function markPaid(claimId, amount, date) {
  const c = getClaim(claimId);
  if (!c) throw new Error(`claim ${claimId} not found`);
  if (c.status === 'submitted' || c.status === 'under_review') {
    insDb.updateClaim(claimId, { status: 'approved' });
  }
  if (!['approved', 'submitted', 'under_review'].includes(c.status)) {
    throw new Error(`cannot mark paid from status: ${c.status}; allowed: ${STATUS_TRANSITIONS[c.status].join(', ') || 'none (terminal)'}`);
  }
  insDb.updateClaim(claimId, { status: 'paid', paid_amount: amount, paid_date: date });
  return getClaim(claimId);
}

function markRejected(claimId, reason) {
  const c = getClaim(claimId);
  if (!c) throw new Error(`claim ${claimId} not found`);
  if (!['submitted', 'under_review'].includes(c.status)) {
    throw new Error(`cannot reject from status: ${c.status}; allowed: ${STATUS_TRANSITIONS[c.status].join(', ') || 'none (terminal)'}`);
  }
  insDb.updateClaim(claimId, { status: 'rejected', rejection_reason: reason });
  return getClaim(claimId);
}

function countRejectedLastYear() {
  return recentClaims(365).filter(c => c.status === 'rejected').length;
}

module.exports = {
  addClaim, getClaim, listClaimsByPolicy, recentClaims,
  updateClaimStatus, markPaid, markRejected, countRejectedLastYear,
  STATUS_TRANSITIONS,
};
