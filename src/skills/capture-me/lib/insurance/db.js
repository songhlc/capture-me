/**
 * lib/insurance/db.js — 4 张保险表的 CRUD 助手
 * JSON 字段（health_disclosure / risk_profile / beneficiary_ids / sales_contact）
 * 进出库都做 stringify / parse 转换，调用方拿到的是 plain object。
 */
const Database = require('better-sqlite3');
const path = require('path');
const SKILL_DIR = path.join(__dirname, '..', '..');
const DB_PATH = process.env.CAPTURE_YOU_TEST_DB_PATH
  || path.join(SKILL_DIR, 'sqlite', 'capture.db');

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso() { return new Date().toISOString(); }
const JSON_KEYS = ['health_disclosure', 'risk_profile', 'beneficiary_ids', 'sales_contact', 'tags'];
function parseJsonFields(row) {
  if (!row) return row;
  for (const k of JSON_KEYS) {
    if (row[k]) { try { row[k] = JSON.parse(row[k]); } catch (_) {} }
  }
  if ('guaranteed_renewable' in row) row.guaranteed_renewable = !!row.guaranteed_renewable;
  return row;
}

// ─── family_members ────────────────────────────────────────

function upsertMember(input) {
  const db = new Database(DB_PATH);
  const existing = db.prepare(
    'SELECT * FROM family_members WHERE name = ? AND relation = ?'
  ).get(input.name, input.relation);

  if (existing) {
    const updates = [];
    const vals = [];
    if (input.birth_year !== undefined) { updates.push('birth_year = ?'); vals.push(input.birth_year); }
    if (input.risk_profile != null) { updates.push('risk_profile = ?'); vals.push(JSON.stringify(input.risk_profile)); }
    if (input.health_disclosure != null) { updates.push('health_disclosure = ?'); vals.push(JSON.stringify(input.health_disclosure)); }
    if (updates.length > 0) {
      updates.push('updated_at = ?'); vals.push(nowIso());
      vals.push(existing.member_id);
      db.prepare(`UPDATE family_members SET ${updates.join(', ')} WHERE member_id = ?`).run(...vals);
    }
    db.close();
    return getMember(existing.member_id);
  }

  const id = input.member_id || newId('mem');
  db.prepare(`INSERT INTO family_members
    (member_id, name, relation, birth_year, health_disclosure, risk_profile, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.name, input.relation, input.birth_year || null,
      input.health_disclosure ? JSON.stringify(input.health_disclosure) : null,
      input.risk_profile ? JSON.stringify(input.risk_profile) : null,
      nowIso(), nowIso());
  db.close();
  return getMember(id);
}

function getMember(memberId) {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT * FROM family_members WHERE member_id = ?').get(memberId);
  db.close();
  return parseJsonFields(row);
}

function listMembers() {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT * FROM family_members ORDER BY relation, name').all();
  db.close();
  return rows.map(parseJsonFields);
}

function appendHealthDisclosure(memberId, addition) {
  const m = getMember(memberId);
  if (!m) throw new Error(`member ${memberId} not found`);
  const current = m.health_disclosure || { conditions: [] };
  if (addition.conditions !== undefined && !Array.isArray(addition.conditions)) {
    throw new Error('conditions must be an array');
  }
  const newConds = (addition.conditions || []).concat(current.conditions || []);
  const merged = { ...current, ...addition, conditions: newConds };
  const db = new Database(DB_PATH);
  db.prepare('UPDATE family_members SET health_disclosure = ?, updated_at = ? WHERE member_id = ?')
    .run(JSON.stringify(merged), nowIso(), memberId);
  db.close();
  return getMember(memberId);
}

// ─── insurance_policies ────────────────────────────────────
const VALID_POLICY_STATUS = ['active', 'expired', 'cancelled', 'pending',
  'lapse', 'reinstated', 'surrendered', 'matured', 'claim', 'claimed'];

function insertPolicy(input) {
  const db = new Database(DB_PATH);
  const id = input.policy_id || newId('pol');
  const now = nowIso();
  db.prepare(`INSERT INTO insurance_policies (
    policy_id, family_member_id, policy_holder_id, beneficiary_ids,
    category, insurer, product_name, policy_number, sum_insured, annual_premium,
    payment_method, payment_period, coverage_period,
    start_date, end_date, next_renewal_date,
    sales_channel, sales_contact, cash_value_path,
    health_disclosure_summary, waiting_period_end, guaranteed_renewable,
    status, raw_text, ai_summary, tags, source, created_at, updated_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?, ?,?,?,?,?, ?,?)`)
    .run(
      id, input.family_member_id, input.policy_holder_id || null,
      input.beneficiary_ids ? JSON.stringify(input.beneficiary_ids) : null,
      input.category, input.insurer || null, input.product_name || null,
      input.policy_number || null, input.sum_insured || null, input.annual_premium || null,
      input.payment_method || null, input.payment_period || null, input.coverage_period || null,
      input.start_date || null, input.end_date || null, input.next_renewal_date || null,
      input.sales_channel || null, input.sales_contact ? JSON.stringify(input.sales_contact) : null,
      input.cash_value_path || null, input.health_disclosure_summary || null,
      input.waiting_period_end || null, input.guaranteed_renewable ? 1 : 0,
      input.status || 'active', input.raw_text || null, input.ai_summary || null,
      input.tags ? JSON.stringify(input.tags) : null, input.source || 'cli', now, now,
    );
  db.close();
  return getPolicy(id);
}

function getPolicy(policyId) {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT * FROM insurance_policies WHERE policy_id = ?').get(policyId);
  db.close();
  return parseJsonFields(row);
}

function listPolicies(opts = {}) {
  const db = new Database(DB_PATH, { readonly: true });
  const conditions = [];
  const vals = [];
  if (opts.status) { conditions.push('status = ?'); vals.push(opts.status); }
  if (opts.familyMemberId) { conditions.push('family_member_id = ?'); vals.push(opts.familyMemberId); }
  if (opts.category) { conditions.push('category = ?'); vals.push(opts.category); }
  if (opts.salesChannel) { conditions.push('sales_channel = ?'); vals.push(opts.salesChannel); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(`SELECT * FROM insurance_policies ${where} ORDER BY created_at DESC`).all(...vals);
  db.close();
  return rows.map(parseJsonFields);
}

function updatePolicyStatus(policyId, status) {
  if (!VALID_POLICY_STATUS.includes(status)) {
    throw new Error(`invalid status: ${status}; must be one of ${VALID_POLICY_STATUS.join(', ')}`);
  }
  const db = new Database(DB_PATH);
  db.prepare('UPDATE insurance_policies SET status = ?, updated_at = ? WHERE policy_id = ?')
    .run(status, nowIso(), policyId);
  db.close();
}

function dateWindow(daysAhead) {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + daysAhead);
  return [today, horizon.toISOString().slice(0, 10)];
}

function listPoliciesRenewingSoon(daysAhead) {
  const [today, horizonStr] = dateWindow(daysAhead);
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`SELECT * FROM insurance_policies
    WHERE next_renewal_date >= ? AND next_renewal_date <= ? AND status = 'active'
    ORDER BY next_renewal_date ASC`).all(today, horizonStr);
  db.close();
  return rows.map(parseJsonFields);
}

function listPoliciesExpiringSoon(daysAhead) {
  const [today, horizonStr] = dateWindow(daysAhead);
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`SELECT * FROM insurance_policies
    WHERE end_date >= ? AND end_date <= ? AND status = 'active'
    ORDER BY end_date ASC`).all(today, horizonStr);
  db.close();
  return rows.map(parseJsonFields);
}

// ─── cash_assets ────────────────────────────────────────────
const VALID_CASH_TYPES = ['活期', '货基', '短期理财', 'personal_pension', '其他'];

function insertCashAsset(input) {
  if (!VALID_CASH_TYPES.includes(input.type)) {
    throw new Error(`invalid cash type: ${input.type}; must be one of ${VALID_CASH_TYPES.join(', ')}`);
  }
  const db = new Database(DB_PATH);
  const id = input.asset_id || newId('cash');
  const now = nowIso();
  db.prepare(`INSERT INTO cash_assets
    (asset_id, type, account_alias, balance, currency, as_of_date, notes, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, input.type, input.account_alias || null, input.balance || 0,
      input.currency || 'CNY', input.as_of_date || null, input.notes || null, now, now);
  db.close();
  return getCashAsset(id);
}

function getCashAsset(id) {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT * FROM cash_assets WHERE asset_id = ?').get(id);
  db.close();
  return row || null;
}

function listCashAssets() {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT * FROM cash_assets ORDER BY type, account_alias').all();
  db.close();
  return rows;
}

function deleteCashAsset(id) {
  const db = new Database(DB_PATH);
  db.prepare('DELETE FROM cash_assets WHERE asset_id = ?').run(id);
  db.close();
}

// ─── insurance_claims ───────────────────────────────────────
const VALID_CLAIM_STATUS = ['submitted', 'under_review', 'approved', 'rejected', 'paid'];
const INITIAL_CLAIM_STATUS = ['submitted'];

function insertClaim(input) {
  if (!INITIAL_CLAIM_STATUS.includes(input.status)) {
    throw new Error(`claims must be created with status 'submitted' (got '${input.status}'); use updateClaimStatus for transitions`);
  }
  const db = new Database(DB_PATH);
  const id = input.claim_id || newId('clm');
  const now = nowIso();
  db.prepare(`INSERT INTO insurance_claims (
    claim_id, policy_id, claim_date, claim_reason, claim_amount, status,
    paid_amount, paid_date, rejection_reason, notes, raw_text, created_at, updated_at
  ) VALUES (?,?,?,?,?,?, ?,?,?,?,?, ?,?)`)
    .run(id, input.policy_id, input.claim_date || null, input.claim_reason || null,
      input.claim_amount || null, input.status, input.paid_amount || null,
      input.paid_date || null, input.rejection_reason || null, input.notes || null,
      input.raw_text || null, now, now);
  db.close();
  return getClaim(id);
}

function getClaim(claimId) {
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT * FROM insurance_claims WHERE claim_id = ?').get(claimId);
  db.close();
  return row || null;
}

function updateClaim(claimId, fields) {
  const allowed = ['claim_date', 'claim_reason', 'claim_amount', 'status', 'paid_amount', 'paid_date', 'rejection_reason', 'notes', 'raw_text'];
  const sets = []; const vals = [];
  for (const k of allowed) {
    if (fields[k] !== undefined) { sets.push(`${k} = ?`); vals.push(fields[k]); }
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?'); vals.push(nowIso());
  vals.push(claimId);
  const db = new Database(DB_PATH);
  db.prepare(`UPDATE insurance_claims SET ${sets.join(', ')} WHERE claim_id = ?`).run(...vals);
  db.close();
}

function listClaimsByPolicy(policyId) {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT * FROM insurance_claims WHERE policy_id = ? ORDER BY claim_date DESC').all(policyId);
  db.close();
  return rows;
}

function listClaimsSince(daysBack) {
  const since = new Date(); since.setDate(since.getDate() - daysBack);
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT * FROM insurance_claims WHERE claim_date >= ? ORDER BY claim_date DESC').all(since.toISOString().slice(0, 10));
  db.close();
  return rows;
}

module.exports = {
  upsertMember, getMember, listMembers, appendHealthDisclosure,
  insertPolicy, getPolicy, listPolicies, updatePolicyStatus,
  listPoliciesRenewingSoon, listPoliciesExpiringSoon,
  dateWindow,
  VALID_POLICY_STATUS,
  insertCashAsset, getCashAsset, listCashAssets, deleteCashAsset,
  VALID_CASH_TYPES,
  insertClaim, getClaim, updateClaim, listClaimsByPolicy, listClaimsSince,
  VALID_CLAIM_STATUS,
};