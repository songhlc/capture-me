# Capture-Me 保险管家 (Insurance Manager) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an insurance & emergency-assets manager to capture-me: structured capture of policies (with three-party roles), cash assets, claims; gap analysis (双十 + 家庭风险矩阵 two-formula parallel); renewal/expiry reminders; terminal + markdown health-check report with compliance footer.

**Architecture:** New `lib/insurance/` sub-module (sibling to `lib/weekplan/`). 4 new SQLite tables (`family_members` / `insurance_policies` / `cash_assets` / `insurance_claims`) + 9 indexes, extended inside the existing `lib/db.js` `initDb()`. Parser is a prompt-builder + JSON-validator (not a direct LLM call) — agent in conversation runs the LLM, script validates and normalizes. Cron extends `lib/setup-cron.js` with 1 new task (工作日 09:00 跑 `insurance check-reminders`); notifications reuse `lib/notify.js`. Reports written to `memory/insurance-reports/`, cash-value tables to `memory/insurance-cashvalue-tables/`.

**Tech Stack:** Node 18+, better-sqlite3, Jest, existing capture-me patterns (argv-based CLI with `if (require.main === module)`, `process.env.CAPTURE_YOU_TEST_DB_PATH` for test isolation, `SETUP_CRON_DRY_RUN=1` for cron tests).

**Spec:** `~/.claude/skills/capture-me/2026-06-14-insurance-manager-design.md` (v2)

---

## File Structure

### New files
- `lib/insurance/index.js` — public API aggregator
- `lib/insurance/db.js` — DB CRUD helpers (4 tables)
- `lib/insurance/parser.js` — NL → structured: prompt builder + JSON validator
- `lib/insurance/gap-rules.js` — two-formula gap calculator (双十 + 家庭风险矩阵)
- `lib/insurance/analyzer.js` — health-check report assembler (6 sections A-F)
- `lib/insurance/report.js` — terminal + markdown renderer (with disclaimer footer)
- `lib/insurance/reminder.js` — renewal/expiry detection (7/30/60 day windows, bank-card hint)
- `lib/insurance/cash.js` — cash-assets CRUD wrapper (with `personal_pension` type)
- `lib/insurance/claims.js` — claims CRUD + status machine
- `lib/insurance/cli.js` — CLI argument dispatcher
- `bin/insurance` — CLI entry
- `bin/dispatch.js` — unified cron shim (weekplan + insurance)
- `tests/insurance/` — 9 test files (db × 2, parser, gap-rules, analyzer, report, reminder, cash, claims, cli)
- `memory/insurance-reports/.gitkeep`
- `memory/insurance-cashvalue-tables/.gitkeep`

### Modified files
- `lib/db.js` — extend `initDb()` with 4 new tables + 9 indexes
- `lib/setup-cron.js` — add 4th task in `TASKS` array, switch `LABEL_PREFIX` to `me.capture.insurance`, route via `bin/dispatch.js`
- `SKILL.md` — add `## 保险管家（Insurance Manager）` section
- `README.md` — add row in feature list
- `tests/setup-cron.test.js` — update counts from 3 to 4

### Why split into 9 lib files (vs 1 monolith)
Mirrors the spec's logical units so each file stays focused and TDD-able in isolation. `lib/insurance/index.js` re-exports for callers; `bin/insurance` only depends on `index.js`. Parser, gap-rules, analyzer, report, reminder are pure functions (no DB) so they unit-test fast without a SQLite fixture.

---


## Task 1: Extend `initDb()` with 4 insurance tables + 9 indexes

**Files:**
- Modify: `lib/db.js` (insert before the final `db.close();` in `initDb()`)
- Create: `tests/db-insurance.test.js`

- [ ] **Step 1: Write the failing test** — create `tests/db-insurance.test.js` that sets `CAPTURE_YOU_TEST_DB_PATH` to a temp file, calls `db.initDb()`, then asserts that `sqlite_master` contains all 4 tables and 9 indexes (`idx_policies_member`, `idx_policies_holder`, `idx_policies_category`, `idx_policies_renewal`, `idx_policies_status`, `idx_policies_channel`, `idx_claims_policy`, `idx_claims_date`, `idx_claims_status`).

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/db-insurance.test.js 2>&1 | tail -10
```

Expected: FAIL — `family_members` not in the table list.

- [ ] **Step 3: Extend `initDb()` in `lib/db.js`**

Insert before the final `db.close();` of `initDb()` (around line 284):

```js
    // ─── Insurance Manager 模块表 ────────────────────────────
    db.exec(`
      CREATE TABLE IF NOT EXISTS family_members (
        member_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        relation TEXT NOT NULL,
        birth_year INTEGER,
        health_disclosure TEXT,
        risk_profile TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS insurance_policies (
        policy_id TEXT PRIMARY KEY,
        family_member_id TEXT NOT NULL,
        policy_holder_id TEXT,
        beneficiary_ids TEXT,
        category TEXT NOT NULL,
        insurer TEXT,
        product_name TEXT,
        policy_number TEXT,
        sum_insured REAL,
        annual_premium REAL,
        payment_method TEXT,
        payment_period TEXT,
        coverage_period TEXT,
        start_date TEXT,
        end_date TEXT,
        next_renewal_date TEXT,
        sales_channel TEXT,
        sales_contact TEXT,
        cash_value_path TEXT,
        health_disclosure_summary TEXT,
        waiting_period_end TEXT,
        guaranteed_renewable INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        raw_text TEXT,
        ai_summary TEXT,
        tags TEXT,
        source TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (family_member_id) REFERENCES family_members(member_id),
        FOREIGN KEY (policy_holder_id) REFERENCES family_members(member_id)
      );
      CREATE INDEX IF NOT EXISTS idx_policies_member ON insurance_policies(family_member_id);
      CREATE INDEX IF NOT EXISTS idx_policies_holder ON insurance_policies(policy_holder_id);
      CREATE INDEX IF NOT EXISTS idx_policies_category ON insurance_policies(category);
      CREATE INDEX IF NOT EXISTS idx_policies_renewal ON insurance_policies(next_renewal_date);
      CREATE INDEX IF NOT EXISTS idx_policies_status ON insurance_policies(status);
      CREATE INDEX IF NOT EXISTS idx_policies_channel ON insurance_policies(sales_channel);
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS cash_assets (
        asset_id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        account_alias TEXT,
        balance REAL,
        currency TEXT DEFAULT 'CNY',
        as_of_date TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS insurance_claims (
        claim_id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        claim_date TEXT,
        claim_reason TEXT,
        claim_amount REAL,
        status TEXT NOT NULL,
        paid_amount REAL,
        paid_date TEXT,
        rejection_reason TEXT,
        notes TEXT,
        raw_text TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (policy_id) REFERENCES insurance_policies(policy_id)
      );
      CREATE INDEX IF NOT EXISTS idx_claims_policy ON insurance_claims(policy_id);
      CREATE INDEX IF NOT EXISTS idx_claims_date ON insurance_claims(claim_date);
      CREATE INDEX IF NOT EXISTS idx_claims_status ON insurance_claims(status);
    `);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/db-insurance.test.js 2>&1 | tail -10
```

Expected: PASS — 2 tests pass.

- [ ] **Step 5: Regression check**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest 2>&1 | tail -5
```

Expected: all prior tests still pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/db.js tests/db-insurance.test.js
git commit -m "feat(insurance): add 4 insurance tables + 9 indexes to initDb"
```

---

## Task 2: `lib/insurance/db.js` — `family_members` CRUD

**Files:**
- Create: `lib/insurance/db.js` (with only family section for now; other sections added in later tasks)
- Create: `tests/insurance/db-family.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/db-family.test.js` covers:
  - `upsertMember({name, relation})` returns `{member_id: /^mem_/}` and creates a new row
  - `upsertMember` reuses existing member when `(name, relation)` matches (idempotent)
  - `appendHealthDisclosure(memberId, {conditions: [...]})` merges into existing `health_disclosure` JSON
  - `listMembers()` returns all members

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/db-family.test.js 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/insurance/db.js` (family section only)**

```js
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
    if (input.risk_profile !== undefined) { updates.push('risk_profile = ?'); vals.push(JSON.stringify(input.risk_profile)); }
    if (input.health_disclosure !== undefined) { updates.push('health_disclosure = ?'); vals.push(JSON.stringify(input.health_disclosure)); }
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
  const newConds = (addition.conditions || []).concat(current.conditions || []);
  const merged = { ...current, ...addition, conditions: newConds };
  const db = new Database(DB_PATH);
  db.prepare('UPDATE family_members SET health_disclosure = ?, updated_at = ? WHERE member_id = ?')
    .run(JSON.stringify(merged), nowIso(), memberId);
  db.close();
  return getMember(memberId);
}

module.exports = {
  upsertMember, getMember, listMembers, appendHealthDisclosure,
  // (other tables added in Tasks 3-5)
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/db-family.test.js 2>&1 | tail -10
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/db.js tests/insurance/db-family.test.js
git commit -m "feat(insurance): family_members CRUD with health_disclosure merging"
```

---

## Task 3: `lib/insurance/db.js` — `insurance_policies` CRUD

**Files:**
- Modify: `lib/insurance/db.js` (append policy section before `module.exports`)
- Create: `tests/insurance/db-policies.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/db-policies.test.js` covers:
  - `insertPolicy` records three-party roles (`family_member_id`, `policy_holder_id`, `beneficiary_ids: [id]`)
  - `getPolicy` returns `beneficiary_ids` as JS array
  - `updatePolicyStatus` enforces status machine (rejects invalid status)
  - `listPoliciesRenewingSoon(30)` returns policies with `next_renewal_date` in window
  - `listPoliciesExpiringSoon(60)` returns policies with `end_date` in window

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/db-policies.test.js 2>&1 | tail -10
```

Expected: FAIL — `insDb.insertPolicy is not a function`.

- [ ] **Step 3: Append policy CRUD to `lib/insurance/db.js`**

Insert before `module.exports`:

```js
// ─── insurance_policies ─────────────────────────────────────
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

function listPoliciesRenewingSoon(daysAhead) {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(); horizon.setDate(horizon.getDate() + daysAhead);
  const horizonStr = horizon.toISOString().slice(0, 10);
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`SELECT * FROM insurance_policies
    WHERE next_renewal_date >= ? AND next_renewal_date <= ? AND status = 'active'
    ORDER BY next_renewal_date ASC`).all(today, horizonStr);
  db.close();
  return rows.map(parseJsonFields);
}

function listPoliciesExpiringSoon(daysAhead) {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(); horizon.setDate(horizon.getDate() + daysAhead);
  const horizonStr = horizon.toISOString().slice(0, 10);
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare(`SELECT * FROM insurance_policies
    WHERE end_date >= ? AND end_date <= ? AND status = 'active'
    ORDER BY end_date ASC`).all(today, horizonStr);
  db.close();
  return rows.map(parseJsonFields);
}
```

Add to `module.exports`:

```js
    insertPolicy, getPolicy, listPolicies, updatePolicyStatus,
    listPoliciesRenewingSoon, listPoliciesExpiringSoon,
    VALID_POLICY_STATUS,
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/db-policies.test.js 2>&1 | tail -10
```

Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/db.js tests/insurance/db-policies.test.js
git commit -m "feat(insurance): insurance_policies CRUD + renewal/expiry queries"
```

---

## Task 4: `cash_assets` CRUD + `lib/insurance/cash.js`

**Files:**
- Modify: `lib/insurance/db.js`
- Create: `lib/insurance/cash.js`
- Create: `tests/insurance/cash.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/cash.test.js` covers:
  - `cash.addCash({type: '活期', balance: 50000})` returns `{asset_id: /^cash_/}`
  - `cash.addCash({type: 'personal_pension', ...})` accepted
  - `cash.summarizeByType()` returns `{活期: 50000, personal_pension: 12000}`
  - `cash.totalCash()` returns sum
  - `cash.deleteCash(id)` removes the row

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/cash.test.js 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../lib/insurance/cash'`.

- [ ] **Step 3: Add `cash_assets` CRUD to `lib/insurance/db.js`**

Insert before `module.exports`:

```js
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
```

Add to `module.exports`: `insertCashAsset, getCashAsset, listCashAssets, deleteCashAsset, VALID_CASH_TYPES`.

- [ ] **Step 4: Create `lib/insurance/cash.js`**

```js
/**
 * lib/insurance/cash.js — 现金/应急资产封装
 */
const insDb = require('./db');

function addCash(input) { return insDb.insertCashAsset(input); }
function listCash() { return insDb.listCashAssets(); }
function getCash(id) { return insDb.getCashAsset(id); }
function deleteCash(id) { return insDb.deleteCashAsset(id); }

function summarizeByType() {
  const all = listCash();
  const sum = {};
  for (const a of all) {
    sum[a.type] = (sum[a.type] || 0) + (a.balance || 0);
  }
  return sum;
}

function totalCash() {
  return listCash().reduce((s, a) => s + (a.balance || 0), 0);
}

module.exports = { addCash, listCash, getCash, deleteCash, summarizeByType, totalCash };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/cash.test.js 2>&1 | tail -10
```

Expected: PASS — 5 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/db.js lib/insurance/cash.js tests/insurance/cash.test.js
git commit -m "feat(insurance): cash_assets CRUD + cash.js summary helpers"
```

---

## Task 5: `insurance_claims` CRUD + `lib/insurance/claims.js` (state machine)

**Files:**
- Modify: `lib/insurance/db.js`
- Create: `lib/insurance/claims.js`
- Create: `tests/insurance/claims.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/claims.test.js` covers:
  - `claims.addClaim({status: 'submitted', ...})` returns `{claim_id: /^clm_/}`
  - `claims.updateClaimStatus(id, 'under_review')` then `claims.markPaid(id, amount, date)` results in `status=paid`, `paid_amount`, `paid_date`
  - `claims.markRejected(id, reason)` sets `status=rejected`, `rejection_reason`
  - `claims.listClaimsByPolicy(policyId)` returns rows
  - `claims.recentClaims(365)` returns last 1 year
  - `claims.countRejectedLastYear()` returns count

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/claims.test.js 2>&1 | tail -10
```

Expected: FAIL.

- [ ] **Step 3: Add `insurance_claims` CRUD to `lib/insurance/db.js`**

Insert before `module.exports`:

```js
// ─── insurance_claims ───────────────────────────────────────
const VALID_CLAIM_STATUS = ['submitted', 'under_review', 'approved', 'rejected', 'paid'];

function insertClaim(input) {
  if (!VALID_CLAIM_STATUS.includes(input.status)) {
    throw new Error(`invalid claim status: ${input.status}; must be one of ${VALID_CLAIM_STATUS.join(', ')}`);
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
```

Add to `module.exports`: `insertClaim, getClaim, updateClaim, listClaimsByPolicy, listClaimsSince, VALID_CLAIM_STATUS`.

- [ ] **Step 4: Create `lib/insurance/claims.js`**

```js
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
  if (c.status === 'submitted') insDb.updateClaim(claimId, { status: 'approved' });
  if (!['approved', 'submitted'].includes(c.status)) {
    throw new Error(`cannot mark paid from status: ${c.status}`);
  }
  insDb.updateClaim(claimId, { status: 'paid', paid_amount: amount, paid_date: date });
  return getClaim(claimId);
}

function markRejected(claimId, reason) {
  const c = getClaim(claimId);
  if (!c) throw new Error(`claim ${claimId} not found`);
  if (!['submitted', 'under_review'].includes(c.status)) {
    throw new Error(`cannot reject from status: ${c.status}`);
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
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/claims.test.js 2>&1 | tail -10
```

Expected: PASS — 6 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/db.js lib/insurance/claims.js tests/insurance/claims.test.js
git commit -m "feat(insurance): insurance_claims CRUD + state machine"
```

---

## Task 6: `lib/insurance/parser.js` — NL → structured policy

**Files:**
- Create: `lib/insurance/parser.js`
- Create: `tests/insurance/parser.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/parser.test.js` covers:

```js
const parser = require('../../lib/insurance/parser');

describe('parser.buildParsePrompt', () => {
  test('提示词包含三类角色 + 健康告知提醒', () => {
    const prompt = parser.buildParsePrompt('平安福 2023...');
    expect(prompt).toMatch(/投保人/);
    expect(prompt).toMatch(/被保人/);
    expect(prompt).toMatch(/受益人/);
    expect(prompt).toMatch(/健康告知/);
  });
});

describe('parser.validateParsedPolicy', () => {
  const baseValid = {
    category: 'critical_illness+life',
    policy_holder: { name: '我', relation: 'self' },
    insured: { name: '老婆', relation: 'spouse' },
    beneficiaries: [{ name: '儿子', relation: 'child' }],
  };

  test('完整输入 + 年缴自动算 next_renewal_date', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      sum_insured: 500000, annual_premium: 8000,
      payment_method: '年缴', start_date: '2023-06-15' });
    expect(p.status).toBe('active');
    expect(p.next_renewal_date).toBe('2024-06-15');
  });

  test('月缴 → +1 月', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      payment_method: '月缴', start_date: '2025-01-01' });
    expect(p.next_renewal_date).toBe('2025-02-01');
  });

  test('趸交 → next_renewal_date 为 null', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      payment_method: '趸交', start_date: '2024-01-01' });
    expect(p.next_renewal_date).toBeNull();
  });

  test('混合险 category 接受 + 连接', () => {
    const p = parser.validateParsedPolicy({ ...baseValid, category: 'health+critical_illness' });
    expect(p.category).toBe('health+critical_illness');
  });

  test('缺 category 抛错', () => {
    expect(() => parser.validateParsedPolicy({ ...baseValid, category: null })).toThrow(/category/);
  });

  test('空受益人数组合法', () => {
    const p = parser.validateParsedPolicy({ ...baseValid, beneficiaries: [] });
    expect(p.beneficiary_ids).toEqual([]);
  });

  test('非法 payment_method 抛错', () => {
    expect(() => parser.validateParsedPolicy({ ...baseValid, payment_method: '半年缴' }))
      .toThrow(/payment_method/);
  });
});

describe('parser.parsePolicyText', () => {
  test('parsePolicyText 接受 llmFn 注入', async () => {
    const result = await parser.parsePolicyText('某保单', async () => ({
      category: 'health',
      policy_holder: { name: '我', relation: 'self' },
      insured: { name: '我', relation: 'self' },
      beneficiaries: [],
    }));
    expect(result.category).toBe('health');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/parser.test.js 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module`.

- [ ] **Step 3: Implement `lib/insurance/parser.js`**

```js
/**
 * lib/insurance/parser.js — 自然语言 → 保单结构化
 *
 * 解析流程：
 *   1.  buildParsePrompt(text)    → 给 LLM 的指令（agent 在对话中跑 LLM）
 *   2.  LLM 返回 JSON
 *   3.  validateParsedPolicy(json) → 校验 + 规范化（含 next_renewal_date 计算）
 *
 * 设计原则：解析由 LLM 完成，脚本只做模板/校验，避免正则"AI 解析"。
 */

const VALID_CATEGORIES = ['life', 'health', 'accident', 'critical_illness', 'annuity', 'pension'];
const VALID_PAYMENT_METHODS = ['年缴', '月缴', '季缴', '趸交'];
const VALID_RELATIONS = ['self', 'spouse', 'child', 'parent', 'other'];
const VALID_SALES_CHANNELS = ['agent', 'broker', 'online', 'bank', 'other'];

function buildParsePrompt(rawText) {
  return `你是保险结构化助手。把以下保单描述解析为 JSON（**只输出 JSON，不要解释**）：

原始文本：
"""
${rawText}
"""

JSON Schema（字段不全填 null，不要捏造）：
{
  "category": "life | health | accident | critical_illness | annuity | pension | 混合险用+连接",
  "insurer": "保险公司简称",
  "product_name": "产品名",
  "policy_number": "保单号（若有）",
  "sum_insured": 保额（元）,
  "annual_premium": 年缴保费（元；月缴则 ×12）,
  "payment_method": "年缴 | 月缴 | 季缴 | 趸交",
  "payment_period": "缴费年期，如 20年缴 / 终身 / 5年期",
  "coverage_period": "保障年期",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD（长期险可空）",
  "policy_holder": { "name": "投保人称呼", "relation": "self|spouse|child|parent|other" },
  "insured": { "name": "被保人称呼", "relation": "self|spouse|child|parent|other" },
  "beneficiaries": [{ "name": "受益人称呼", "relation": "self|spouse|child|parent|other" }],
  "sales_channel": "agent | broker | online | bank | other",
  "sales_contact": { "name": "销售姓名", "phone": "销售电话" },
  "health_disclosure": "本次投保的健康告知要点（无则 null）",
  "guaranteed_renewable": true|false,
  "raw_text": "原始文本"
}

注意：
1. 三方角色（投保人/被保人/受益人）**必须分别解析**。丈夫给妻子买（投保人=我，被保人=老婆）、父母给孩子买都是常见情况。
2. 混合险（如"重疾+寿险"）用 + 连接 category。
3. 没提到的字段填 null。
4. **健康告知**是理赔拒赔主因，必须主动询问用户（CLI 录入后追问）。`;
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
function addYears(dateStr, years) {
  const d = new Date(dateStr);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

function validateParsedPolicy(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('parsed policy is empty or not an object');
  }
  if (!parsed.category) throw new Error('category is required');
  const cats = String(parsed.category).split('+');
  for (const c of cats) {
    if (!VALID_CATEGORIES.includes(c)) {
      throw new Error(`invalid category segment: ${c}; must be one of ${VALID_CATEGORIES.join(', ')} or join with +`);
    }
  }
  if (!parsed.policy_holder?.name || !parsed.policy_holder?.relation) {
    throw new Error('policy_holder.{name,relation} is required');
  }
  if (!VALID_RELATIONS.includes(parsed.policy_holder.relation)) {
    throw new Error(`invalid policy_holder.relation: ${parsed.policy_holder.relation}`);
  }
  if (!parsed.insured?.name || !parsed.insured?.relation) {
    throw new Error('insured.{name,relation} is required');
  }
  if (!VALID_RELATIONS.includes(parsed.insured.relation)) {
    throw new Error(`invalid insured.relation: ${parsed.insured.relation}`);
  }
  if (!Array.isArray(parsed.beneficiaries)) {
    throw new Error('beneficiaries must be an array (use [] for none)');
  }
  for (const b of parsed.beneficiaries) {
    if (!b.name || !b.relation) throw new Error('each beneficiary needs {name, relation}');
    if (!VALID_RELATIONS.includes(b.relation)) {
      throw new Error(`invalid beneficiary.relation: ${b.relation}`);
    }
  }
  if (parsed.payment_method && !VALID_PAYMENT_METHODS.includes(parsed.payment_method)) {
    throw new Error(`invalid payment_method: ${parsed.payment_method}`);
  }
  if (parsed.sales_channel && !VALID_SALES_CHANNELS.includes(parsed.sales_channel)) {
    throw new Error(`invalid sales_channel: ${parsed.sales_channel}`);
  }

  let nextRenewal = null;
  if (parsed.start_date) {
    if (parsed.payment_method === '年缴') nextRenewal = addYears(parsed.start_date, 1);
    else if (parsed.payment_method === '月缴') nextRenewal = addMonths(parsed.start_date, 1);
    else if (parsed.payment_method === '季缴') nextRenewal = addMonths(parsed.start_date, 3);
  }

  return {
    family_member_id: parsed.family_member_id || null,
    policy_holder_id: parsed.policy_holder_id || null,
    beneficiary_ids: parsed.beneficiary_ids || [],
    category: parsed.category,
    insurer: parsed.insurer || null,
    product_name: parsed.product_name || null,
    policy_number: parsed.policy_number || null,
    sum_insured: parsed.sum_insured ? Number(parsed.sum_insured) : null,
    annual_premium: parsed.annual_premium ? Number(parsed.annual_premium) : null,
    payment_method: parsed.payment_method || null,
    payment_period: parsed.payment_period || null,
    coverage_period: parsed.coverage_period || null,
    start_date: parsed.start_date || null,
    end_date: parsed.end_date || null,
    next_renewal_date: nextRenewal,
    sales_channel: parsed.sales_channel || null,
    sales_contact: parsed.sales_contact || null,
    health_disclosure_summary: parsed.health_disclosure || null,
    guaranteed_renewable: !!parsed.guaranteed_renewable,
    status: 'active',
    raw_text: parsed.raw_text || null,
    ai_summary: parsed.ai_summary || null,
    tags: parsed.tags || null,
    source: 'cli',
    _roles: {
      policy_holder: parsed.policy_holder,
      insured: parsed.insured,
      beneficiaries: parsed.beneficiaries,
    },
  };
}

async function parsePolicyText(rawText, llmFn) {
  if (typeof llmFn !== 'function') {
    throw new Error('llmFn is required; agent should call LLM with buildParsePrompt() output');
  }
  const prompt = buildParsePrompt(rawText);
  const parsed = await llmFn(prompt);
  return validateParsedPolicy(parsed);
}

module.exports = {
  buildParsePrompt, validateParsedPolicy, parsePolicyText,
  VALID_CATEGORIES, VALID_PAYMENT_METHODS, VALID_RELATIONS, VALID_SALES_CHANNELS,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/parser.test.js 2>&1 | tail -10
```

Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/parser.js tests/insurance/parser.test.js
git commit -m "feat(insurance): parser — buildParsePrompt + validateParsedPolicy + parsePolicyText"
```

---

## Task 7: `lib/insurance/gap-rules.js` — 双十 + 家庭风险矩阵并行

**Files:**
- Create: `lib/insurance/gap-rules.js`
- Create: `tests/insurance/gap-rules.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/gap-rules.test.js` covers (representative cases below; full test file should have ~11 tests):

```js
const rules = require('../../lib/insurance/gap-rules');

describe('双十法则 (rule of 10/5)', () => {
  test('寿险 = max(收入 × 10, 收入 × 10 + 房贷)', () => {
    expect(rules.suggestLifeRule10({ annualIncome: 500000, mortgageBalance: 1000000 }))
      .toBe(6000000);
  });
  test('重疾 = max(年支出 × 5, 年支出 × 5 × 1.2)', () => {
    expect(rules.suggestCriticalIllnessRule10({ annualExpense: 200000 })).toBe(1200000);
  });
  test('意外 = 收入 × 10', () => {
    expect(rules.suggestAccidentRule10({ annualIncome: 500000 })).toBe(5000000);
  });
});

describe('家庭风险矩阵 (family matrix)', () => {
  test('高风险职业意外险 1.5x', () => {
    const office = rules.suggestAccidentMatrix({ annualIncome: 500000, occupation: 'office' });
    const hazard = rules.suggestAccidentMatrix({ annualIncome: 500000, occupation: 'construction' });
    expect(hazard).toBe(office * 1.5);
  });
  test('医疗险 = covered | partial', () => {
    expect(rules.suggestMedicalMatrix({ hasGuaranteedRenewable: true })).toBe('covered');
    expect(rules.suggestMedicalMatrix({ hasGuaranteedRenewable: false })).toBe('partial');
  });
  test('应急金 6-12 个月', () => {
    const r = rules.suggestEmergencyFund({ annualExpense: 200000, hasStableJob: true });
    expect(r.months).toEqual([6, 12]);
    expect(r.min).toBe(100000);
  });
});

describe('computeGap (合并两套 + 现有保单)', () => {
  test('返回 5 维度，finalSuggested = max(rule10, matrix)', () => {
    const ctx = { annualIncome: 500000, annualExpense: 200000,
      mortgageBalance: 1000000, occupation: 'office',
      hasGuaranteedRenewable: true, hasStableJob: true };
    const existing = [
      { category: 'life', sum_insured: 3000000 },
      { category: 'critical_illness', sum_insured: 500000 },
    ];
    const gap = rules.computeGap(ctx, existing, 100000);
    expect(gap.life.existing).toBe(3000000);
    expect(gap.life.finalSuggested).toBe(6000000);
    expect(gap.life.gap).toBe(3000000);
    expect(gap.critical_illness.gap).toBe(700000); // 1.2M - 500k
  });
});

describe('isDataSufficient', () => {
  test('缺年收入/支出时 false', () => {
    expect(rules.isDataSufficient({ annualExpense: 100000 })).toBe(false);
    expect(rules.isDataSufficient({ annualIncome: 500000 })).toBe(false);
  });
  test('两者都有时 true', () => {
    expect(rules.isDataSufficient({ annualIncome: 500000, annualExpense: 100000 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/gap-rules.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement `lib/insurance/gap-rules.js`**

```js
/**
 * lib/insurance/gap-rules.js — 缺口分析
 * 两套规则并行：双十法则 + 家庭风险矩阵；finalSuggested = max
 */
const HAZARD_OCCUPATIONS = ['construction', 'mining', 'driver_long_haul', 'electrician', 'pilot'];

function sumInsuredFor(policies, categoryKey) {
  return policies
    .filter(p => String(p.category).split('+').includes(categoryKey))
    .reduce((s, p) => s + (Number(p.sum_insured) || 0), 0);
}

// ─── 双十法则 ──────────────────────────────────────────────
function suggestLifeRule10(ctx) {
  const { annualIncome = 0, mortgageBalance = 0 } = ctx;
  return Math.max(annualIncome * 10, annualIncome * 10 + mortgageBalance);
}
function suggestCriticalIllnessRule10(ctx) {
  const { annualExpense = 0 } = ctx;
  return Math.max(annualExpense * 5, annualExpense * 5 * 1.2);
}
function suggestAccidentRule10(ctx) {
  return (ctx.annualIncome || 0) * 10;
}

// ─── 家庭风险矩阵 ──────────────────────────────────────────
function suggestLifeMatrix(ctx) { return suggestLifeRule10(ctx); }
function suggestCriticalIllnessMatrix(ctx) { return suggestCriticalIllnessRule10(ctx); }
function suggestAccidentMatrix(ctx) {
  const base = (ctx.annualIncome || 0) * 10;
  return base * (HAZARD_OCCUPATIONS.includes(ctx.occupation) ? 1.5 : 1);
}
function suggestMedicalMatrix(ctx) {
  return ctx.hasGuaranteedRenewable ? 'covered' : 'partial';
}
function suggestEmergencyFund(ctx) {
  const monthsRange = ctx.hasStableJob ? [6, 12] : [9, 12];
  const monthlyExpense = (ctx.annualExpense || 0) / 12;
  return { min: monthlyExpense * monthsRange[0], max: monthlyExpense * monthsRange[1], months: monthsRange };
}

// ─── 合并两套规则 ──────────────────────────────────────────
function computeGap(ctx, policies, cashTotal) {
  const life = { rule10: suggestLifeRule10(ctx), matrix: suggestLifeMatrix(ctx),
    existing: sumInsuredFor(policies, 'life') };
  life.finalSuggested = Math.max(life.rule10, life.matrix);
  life.gap = Math.max(0, life.finalSuggested - life.existing);

  const ci = { rule10: suggestCriticalIllnessRule10(ctx), matrix: suggestCriticalIllnessMatrix(ctx),
    existing: sumInsuredFor(policies, 'critical_illness') };
  ci.finalSuggested = Math.max(ci.rule10, ci.matrix);
  ci.gap = Math.max(0, ci.finalSuggested - ci.existing);

  const acc = { rule10: suggestAccidentRule10(ctx), matrix: suggestAccidentMatrix(ctx),
    existing: sumInsuredFor(policies, 'accident') };
  acc.finalSuggested = Math.max(acc.rule10, acc.matrix);
  acc.gap = Math.max(0, acc.finalSuggested - acc.existing);

  const med = { matrix: suggestMedicalMatrix(ctx),
    existing: policies.some(p => String(p.category).split('+').includes('health')
      && p.guaranteed_renewable && p.status === 'active') };
  med.covered = med.matrix === 'covered' && med.existing;

  const ef = { matrix: suggestEmergencyFund(ctx), existing: cashTotal || 0 };
  ef.gap = Math.max(0, ef.matrix.min - ef.existing);

  return { life, critical_illness: ci, accident: acc, medical: med, emergencyFund: ef };
}

function isDataSufficient(ctx) {
  return typeof ctx.annualIncome === 'number' && ctx.annualIncome > 0
    && typeof ctx.annualExpense === 'number' && ctx.annualExpense > 0;
}

module.exports = {
  suggestLifeRule10, suggestCriticalIllnessRule10, suggestAccidentRule10,
  suggestLifeMatrix, suggestCriticalIllnessMatrix, suggestAccidentMatrix,
  suggestMedicalMatrix, suggestEmergencyFund,
  computeGap, isDataSufficient, HAZARD_OCCUPATIONS, sumInsuredFor,
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/gap-rules.test.js 2>&1 | tail -10
```

Expected: PASS — ~11 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/gap-rules.js tests/insurance/gap-rules.test.js
git commit -m "feat(insurance): gap-rules — 双十 + 家庭风险矩阵 two-formula parallel"
```

---

## Task 8: `lib/insurance/analyzer.js` — 6-section health check

**Files:**
- Create: `lib/insurance/analyzer.js`
- Create: `tests/insurance/analyzer.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/analyzer.test.js` covers:
  - `analyzer.buildHealthCheck(ctx)` returns object with keys `A_assets`, `B_coverage`, `C_suggested`, `D_gaps`, `E_claims`, `F_personalization`, `disclaimer`
  - `A_assets.cashTotal` sums cash; `personalPensionTotal` sub-sums `personal_pension` type
  - `D_gaps` contains `type: 'orphan_policy'` entry when a `sales_channel='agent'` policy has no `sales_contact`
  - `D_gaps` contains `type: 'claim_rejection'` when rejected claims exist in last 1 year
  - `disclaimer` regex matches `/不构成任何投保/` and `/持牌保险经纪人/`

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/analyzer.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement `lib/insurance/analyzer.js`**

```js
/**
 * lib/insurance/analyzer.js — 体检报告装配（6 sections A-F）
 *
 * 输入：ctx { annualIncome, annualExpense, mortgageBalance, occupation,
 *           hasGuaranteedRenewable, hasStableJob } 从对话采集
 */
const insDb = require('./db');
const cash = require('./cash');
const claims = require('./claims');
const gapRules = require('./gap-rules');

const DISCLAIMER_FOOTER = `---
📌 免责声明：本报告由 capture-me 保险管家自动生成，
仅供家庭资产规划参考，**不构成任何投保/退保/理赔建议**。
实际决策建议咨询持牌保险经纪人或代理人。
---`;

function buildHealthCheck(ctx) {
  const policies = insDb.listPolicies({ status: 'active' });
  const allMembers = insDb.listMembers();
  const allCash = cash.listCash();
  const cashSummary = cash.summarizeByType();
  const recentClaims = claims.recentClaims(365);
  const totalAnnualPremium = policies.reduce((s, p) => s + (Number(p.annual_premium) || 0), 0);

  // A. 资产概览
  const A_assets = {
    annualPremiumTotal: totalAnnualPremium,
    cashTotal: cash.totalCash(),
    personalPensionTotal: cashSummary['personal_pension'] || 0,
    cashByType: cashSummary,
    policyCount: policies.length,
    memberCount: allMembers.length,
    monthlyExpense: ctx.annualExpense ? ctx.annualExpense / 12 : null,
    cashCoverageMonths: ctx.annualExpense && cash.totalCash() > 0
      ? (cash.totalCash() / (ctx.annualExpense / 12)).toFixed(1) : null,
  };

  // B. 险种覆盖
  const allCategories = ['life', 'health', 'accident', 'critical_illness', 'annuity', 'pension'];
  const B_coverage = {};
  for (const cat of allCategories) {
    const matched = policies.filter(p => String(p.category).split('+').includes(cat) && p.status === 'active');
    B_coverage[cat] = {
      count: matched.length,
      totalInsured: matched.reduce((s, p) => s + (Number(p.sum_insured) || 0), 0),
      status: matched.length > 0 ? 'covered' : 'missing',
    };
  }

  // C. 保额建议
  const gap = gapRules.computeGap(ctx, policies, cash.totalCash());
  const C_suggested = {
    data_sufficient: gapRules.isDataSufficient(ctx),
    life: { rule10: gap.life.rule10, matrix: gap.life.matrix, final: gap.life.finalSuggested },
    critical_illness: { rule10: gap.critical_illness.rule10, matrix: gap.critical_illness.matrix, final: gap.critical_illness.finalSuggested },
    accident: { rule10: gap.accident.rule10, matrix: gap.accident.matrix, final: gap.accident.finalSuggested },
    medical: { covered: gap.medical.covered, existing_guaranteed: gap.medical.existing },
    emergencyFund: gap.emergencyFund.matrix,
  };

  // D. 缺口清单
  const D_gaps = [];
  if (gap.life.gap > 0) D_gaps.push({ type: 'life_gap', label: '寿险差额', amount: gap.life.gap });
  if (gap.critical_illness.gap > 0) D_gaps.push({ type: 'ci_gap', label: '重疾差额', amount: gap.critical_illness.gap });
  if (gap.accident.gap > 0) D_gaps.push({ type: 'accident_gap', label: '意外险差额', amount: gap.accident.gap });
  if (!gap.medical.covered) D_gaps.push({ type: 'medical_gap', label: '百万医疗险缺失或非保证续保' });
  if (gap.emergencyFund.gap > 0) D_gaps.push({ type: 'emergency_fund_gap', label: '应急金不足', amount: gap.emergencyFund.gap });
  for (const cat of allCategories) {
    if (B_coverage[cat].status === 'missing') {
      D_gaps.push({ type: 'category_missing', category: cat, label: `${cat} 类保单缺失` });
    }
  }
  for (const p of policies) {
    if (p.sales_channel === 'agent' && !p.sales_contact) {
      D_gaps.push({ type: 'orphan_policy', policy_id: p.policy_id,
        product_name: p.product_name, label: `孤儿单：${p.product_name} 无销售联系方式` });
    }
  }
  const rejectedCount = recentClaims.filter(c => c.status === 'rejected').length;
  if (rejectedCount > 0) {
    D_gaps.push({ type: 'claim_rejection',
      label: `⚠️ 最近 1 年有 ${rejectedCount} 笔拒赔，建议核对合同健康告知条款`, count: rejectedCount });
  }

  // E. 理赔回顾
  const E_claims = {
    total: recentClaims.length,
    paid: recentClaims.filter(c => c.status === 'paid').length,
    rejected: rejectedCount,
    pending: recentClaims.filter(c => ['submitted', 'under_review', 'approved'].includes(c.status)).length,
    items: recentClaims.slice(0, 10),
  };

  // F. LLM 个性化层（v1 stub）
  const F_personalization = { notes: [], hook: 'agent_personalize' };
  if (ctx.mortgageBalance > 0) F_personalization.notes.push('有房贷：寿险建议覆盖房贷余额（已在矩阵中体现）');
  if (cashSummary['personal_pension'] > 0) {
    F_personalization.notes.push('个人养老金账户已开通：年缴上限 12,000 元，可享税优');
  }

  return {
    generatedAt: new Date().toISOString(),
    A_assets, B_coverage, C_suggested, D_gaps, E_claims, F_personalization,
    disclaimer: DISCLAIMER_FOOTER,
  };
}

module.exports = { buildHealthCheck, DISCLAIMER_FOOTER };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/analyzer.test.js 2>&1 | tail -10
```

Expected: PASS — 3 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/analyzer.js tests/insurance/analyzer.test.js
git commit -m "feat(insurance): analyzer — 6-section health check + disclaimer + orphan detection"
```

---

## Task 9: `lib/insurance/report.js` — terminal + markdown renderer

**Files:**
- Create: `lib/insurance/report.js`
- Create: `memory/insurance-reports/.gitkeep`
- Create: `memory/insurance-cashvalue-tables/.gitkeep`
- Create: `tests/insurance/report.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/report.test.js` covers:
  - `renderTerminal(data)` returns string containing all 6 section titles + `免责声明`
  - `writeMarkdown(data)` writes a `.md` file under `REPORTS_DIR` and returns the path; the file contains `# 家庭保险体检报告` and the disclaimer

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/report.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Create memory dirs**

```bash
mkdir -p /Users/windknow/.claude/skills/capture-me/memory/insurance-reports
mkdir -p /Users/windknow/.claude/skills/capture-me/memory/insurance-cashvalue-tables
touch /Users/windknow/.claude/skills/capture-me/memory/insurance-reports/.gitkeep
touch /Users/windknow/.claude/skills/capture-me/memory/insurance-cashvalue-tables/.gitkeep
```

- [ ] **Step 4: Implement `lib/insurance/report.js`**

```js
/**
 * lib/insurance/report.js — 体检报告渲染
 * renderTerminal(data)   → 终端彩色输出
 * writeMarkdown(data)    → 落盘 memory/insurance-reports/YYYY-MM-DD-体检.md
 */
const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = process.env.CAPTURE_ME_INSURANCE_REPORTS_DIR
  || path.join(SKILL_DIR, 'memory', 'insurance-reports');

function fmtMoney(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function renderTerminal(data) {
  const L = [];
  L.push('━'.repeat(60));
  L.push('🏠 家庭保险体检报告');
  L.push(`   生成于 ${data.generatedAt}`);
  L.push('━'.repeat(60));
  L.push('');

  L.push('【A. 资产概览】');
  L.push(`  · 在生效保单：${data.A_assets.policyCount} 张 / 家庭成员：${data.A_assets.memberCount} 人`);
  L.push(`  · 年总保费：¥${fmtMoney(data.A_assets.annualPremiumTotal)}`);
  L.push(`  · 现金/应急资产：¥${fmtMoney(data.A_assets.cashTotal)}`);
  if (data.A_assets.personalPensionTotal > 0) {
    L.push(`  · 个人养老金账户：¥${fmtMoney(data.A_assets.personalPensionTotal)}（税优）`);
  }
  if (data.A_assets.cashCoverageMonths) {
    L.push(`  · 应急金覆盖：${data.A_assets.cashCoverageMonths} 个月支出`);
  } else {
    L.push('  · ⚠️ 应急金未录入或年支出未知');
  }
  L.push('');

  L.push('【B. 险种覆盖】');
  for (const [cat, v] of Object.entries(data.B_coverage)) {
    const tag = v.status === 'covered' ? '✓' : '✗';
    L.push(`  ${tag} ${cat.padEnd(16)} ${v.count} 张 / ¥${fmtMoney(v.totalInsured)}`);
  }
  L.push('');

  L.push('【C. 保额建议】');
  if (!data.C_suggested.data_sufficient) {
    L.push('  ⚠️ 数据不足：需补年收入 / 年支出 / 房贷余额');
  } else {
    L.push(`  · 寿险：双十 ${fmtMoney(data.C_suggested.life.rule10)} / 矩阵 ${fmtMoney(data.C_suggested.life.matrix)} → 取大 ${fmtMoney(data.C_suggested.life.final)}`);
    L.push(`  · 重疾：双十 ${fmtMoney(data.C_suggested.critical_illness.rule10)} / 矩阵 ${fmtMoney(data.C_suggested.critical_illness.matrix)} → 取大 ${fmtMoney(data.C_suggested.critical_illness.final)}`);
    L.push(`  · 意外：双十 ${fmtMoney(data.C_suggested.accident.rule10)} / 矩阵 ${fmtMoney(data.C_suggested.accident.matrix)} → 取大 ${fmtMoney(data.C_suggested.accident.final)}`);
  }
  L.push('');

  L.push('【D. 缺口清单】');
  if (data.D_gaps.length === 0) L.push('  ✓ 无显著缺口');
  else for (const g of data.D_gaps) {
    const amount = g.amount ? ` ¥${fmtMoney(g.amount)}` : '';
    L.push(`  · ${g.label}${amount}`);
  }
  L.push('');

  L.push('【E. 理赔回顾】 最近 1 年');
  L.push(`  · 总数：${data.E_claims.total} / 已支付：${data.E_claims.paid} / 拒赔：${data.E_claims.rejected} / 处理中：${data.E_claims.pending}`);
  if (data.E_claims.rejected > 0) L.push('  ⚠️ 存在拒赔记录，建议核对合同健康告知条款');
  L.push('');

  L.push('【F. AI 个性化建议（agent 待补）】');
  if (data.F_personalization.notes.length === 0) {
    L.push('  · （无可自动生成项；agent 可在对话中补全）');
  } else {
    for (const n of data.F_personalization.notes) L.push(`  · ${n}`);
  }
  L.push('');

  L.push(data.disclaimer);
  return L.join('\n');
}

function writeMarkdown(data) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(REPORTS_DIR, `${today}-体检.md`);

  const md = [];
  md.push(`# 家庭保险体检报告\n\n> 生成于 ${data.generatedAt}\n`);
  md.push(`## A. 资产概览\n`);
  md.push(`- 在生效保单：${data.A_assets.policyCount} 张 / 家庭成员：${data.A_assets.memberCount} 人`);
  md.push(`- 年总保费：¥${fmtMoney(data.A_assets.annualPremiumTotal)}`);
  md.push(`- 现金/应急资产：¥${fmtMoney(data.A_assets.cashTotal)}`);
  if (data.A_assets.personalPensionTotal > 0) {
    md.push(`- **个人养老金账户**：¥${fmtMoney(data.A_assets.personalPensionTotal)}（税优）`);
  }
  if (data.A_assets.cashCoverageMonths) md.push(`- 应急金覆盖：${data.A_assets.cashCoverageMonths} 个月支出`);
  md.push('');

  md.push(`## B. 险种覆盖\n`);
  md.push(`| 险种 | 状态 | 张数 | 总保额 |\n|------|------|------|--------|`);
  for (const [cat, v] of Object.entries(data.B_coverage)) {
    const tag = v.status === 'covered' ? '✓ 已覆盖' : '✗ 缺失';
    md.push(`| ${cat} | ${tag} | ${v.count} | ¥${fmtMoney(v.totalInsured)} |`);
  }
  md.push('');

  md.push(`## C. 保额建议（双十 + 家庭风险矩阵并行）\n`);
  if (!data.C_suggested.data_sufficient) {
    md.push(`⚠️ 数据不足：需补年收入 / 年支出 / 房贷余额`);
  } else {
    md.push(`| 险种 | 双十法则 | 家庭风险矩阵 | 取大 |\n|------|----------|--------------|------|`);
    md.push(`| 寿险 | ¥${fmtMoney(data.C_suggested.life.rule10)} | ¥${fmtMoney(data.C_suggested.life.matrix)} | **¥${fmtMoney(data.C_suggested.life.final)}** |`);
    md.push(`| 重疾 | ¥${fmtMoney(data.C_suggested.critical_illness.rule10)} | ¥${fmtMoney(data.C_suggested.critical_illness.matrix)} | **¥${fmtMoney(data.C_suggested.critical_illness.final)}** |`);
    md.push(`| 意外 | ¥${fmtMoney(data.C_suggested.accident.rule10)} | ¥${fmtMoney(data.C_suggested.accident.matrix)} | **¥${fmtMoney(data.C_suggested.accident.final)}** |`);
  }
  md.push('');

  md.push(`## D. 缺口清单\n`);
  if (data.D_gaps.length === 0) md.push(`✓ 无显著缺口`);
  else for (const g of data.D_gaps) {
    const amount = g.amount ? ` ¥${fmtMoney(g.amount)}` : '';
    md.push(`- ${g.label}${amount}`);
  }
  md.push('');

  md.push(`## E. 理赔回顾（最近 1 年）\n`);
  md.push(`- 总数：${data.E_claims.total}`);
  md.push(`- 已支付：${data.E_claims.paid} / 拒赔：${data.E_claims.rejected} / 处理中：${data.E_claims.pending}`);
  if (data.E_claims.rejected > 0) md.push(`\n⚠️ **存在拒赔记录，建议核对合同健康告知条款**`);
  md.push('');

  md.push(`## F. AI 个性化建议\n`);
  if (data.F_personalization.notes.length === 0) md.push(`（agent 可在对话中补充）`);
  else for (const n of data.F_personalization.notes) md.push(`- ${n}`);
  md.push('');

  md.push(data.disclaimer);
  md.push('');

  fs.writeFileSync(file, md.join('\n'), 'utf8');
  return file;
}

module.exports = { renderTerminal, writeMarkdown, REPORTS_DIR };
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/report.test.js 2>&1 | tail -10
```

Expected: PASS — 2 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/report.js memory/ tests/insurance/report.test.js
git commit -m "feat(insurance): report renderer (terminal + markdown with disclaimer)"
```

---

## Task 10: `lib/insurance/reminder.js` — 续保/到期检测

**Files:**
- Create: `lib/insurance/reminder.js`
- Create: `tests/insurance/reminder.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/reminder.test.js` covers (set `WEEKPLAN_DRY_RUN=1` to keep tests offline):
  - Policy with `next_renewal_date` 5 days out → message contains `7 天内` + bank-card hint `提前 3 天确认绑定银行卡余额` + sales contact
  - Policy with `next_renewal_date` 20 days out → message contains `30 天内`
  - Policy with `end_date` 50 days out → message contains `60 天内`
  - Empty DB → returns `null`
  - `runCheckReminders()` returns `{sent: false, reason: 'no_upcoming'}` when no reminders

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/reminder.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement `lib/insurance/reminder.js`**

```js
/**
 * lib/insurance/reminder.js — 续保/到期提醒
 * buildReminderMessage()  生成单条汇总（命中 7/30/60 任一窗口才返回）
 * runCheckReminders()     CLI 入口：跑一次检查 + notify
 */
const insDb = require('./db');
const { notify } = require('../notify');

const WINDOWS = [
  { days: 7,  label: '7 天内',  includeBankHint: true },
  { days: 30, label: '30 天内', includeBankHint: false },
  { days: 60, label: '60 天内', includeBankHint: false, isExpiry: true },
];

function daysFromNow(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / (1000 * 60 * 60 * 24));
}

function buildReminderMessage() {
  const lines = ['📅 续保/到期提醒\n'];
  let anyHit = false;

  for (const win of WINDOWS) {
    if (win.isExpiry) {
      const expiring = insDb.listPoliciesExpiringSoon(win.days);
      if (expiring.length === 0) continue;
      anyHit = true;
      lines.push(`【${win.label} 到期保单】`);
      for (const p of expiring) {
        const days = daysFromNow(p.end_date);
        lines.push(`• ${p.product_name}`);
        lines.push(`  到期: ${p.end_date} (${days} 天后)`);
        lines.push(`  状态: 即将过期，请确认续保`);
      }
      lines.push('');
    } else {
      const renewing = insDb.listPoliciesRenewingSoon(win.days);
      if (renewing.length === 0) continue;
      anyHit = true;
      lines.push(`【${win.label} 续保保单】`);
      for (const p of renewing) {
        const days = daysFromNow(p.next_renewal_date);
        lines.push(`• ${p.product_name}`);
        lines.push(`  下次缴费: ${p.next_renewal_date} (${days} 天后)`);
        if (p.annual_premium) lines.push(`  ¥${Number(p.annual_premium).toLocaleString('zh-CN')}`);
        if (win.includeBankHint) {
          lines.push(`  ⚠️ **建议提前 3 天确认绑定银行卡余额**（断缴 → 失效）`);
        }
        if (p.sales_contact) {
          const c = typeof p.sales_contact === 'string' ? JSON.parse(p.sales_contact) : p.sales_contact;
          lines.push(`  销售联系: ${c.name || ''} ${c.phone || ''}`);
        }
      }
      lines.push('');
    }
  }

  if (!anyHit) return null;
  lines.push('查看完整保单：/capture-me insurance query');
  lines.push('体检报告：/capture-me insurance report');
  return lines.join('\n');
}

function runCheckReminders() {
  const msg = buildReminderMessage();
  if (!msg) return { sent: false, message: null, reason: 'no_upcoming' };
  notify(msg, { title: '保险管家' });
  return { sent: true, message: msg };
}

module.exports = { buildReminderMessage, runCheckReminders, daysFromNow, WINDOWS };
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/reminder.test.js 2>&1 | tail -10
```

Expected: PASS — 4 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/reminder.js tests/insurance/reminder.test.js
git commit -m "feat(insurance): reminder — 7/30/60 day windows + bank card hint"
```

---

## Task 11: `lib/insurance/index.js` — public API aggregator

**Files:**
- Create: `lib/insurance/index.js`

- [ ] **Step 1: Implement the aggregator**

```js
/**
 * lib/insurance/index.js — 公共 API 入口
 *
 * addPolicy(parsed)         从 validateParsedPolicy 输出录保单（处理三方角色 → member_id）
 * addCash / listCash / ...  透传 cash
 * addClaim / listClaims     透传 claims
 * buildReport(ctx)          跑体检报告
 * renderTerminal(data)      终端输出
 * writeMarkdown(data)       落盘 memory/insurance-reports/
 * runReminders()            跑提醒
 * computeGap(ctx, policies, cashTotal)  单独跑缺口
 */
const db = require('./db');
const parser = require('./parser');
const analyzer = require('./analyzer');
const report = require('./report');
const reminder = require('./reminder');
const gapRules = require('./gap-rules');
const cash = require('./cash');
const claims = require('./claims');

function addPolicy(parsed, healthDisclosureText) {
  const ph = db.upsertMember(parsed._roles.policy_holder);
  const insured = db.upsertMember(parsed._roles.insured);
  const beneficiaries = (parsed._roles.beneficiaries || []).map(b => db.upsertMember(b));

  if (healthDisclosureText) {
    db.appendHealthDisclosure(insured.member_id, {
      conditions: [{ name: healthDisclosureText, disclosed: true,
        disclosed_at: new Date().toISOString().slice(0, 10) }],
    });
    parsed.health_disclosure_summary = healthDisclosureText;
  }

  const policyInput = {
    ...parsed,
    family_member_id: insured.member_id,
    policy_holder_id: ph.member_id,
    beneficiary_ids: beneficiaries.map(b => b.member_id),
  };
  delete policyInput._roles;

  const policy = db.insertPolicy(policyInput);
  return {
    policy_id: policy.policy_id,
    memberIds: { policy_holder: ph.member_id, insured: insured.member_id,
      beneficiaries: beneficiaries.map(b => b.member_id) },
    summary: {
      product_name: policy.product_name, category: policy.category,
      sum_insured: policy.sum_insured, annual_premium: policy.annual_premium,
      next_renewal_date: policy.next_renewal_date,
      sales_contact: policy.sales_contact, health_disclosure: policy.health_disclosure_summary,
    },
  };
}

function getPolicy(id) { return db.getPolicy(id); }
function listPolicies(opts) { return db.listPolicies(opts); }
function addCash(input) { return cash.addCash(input); }
function listCash() { return cash.listCash(); }
function addClaim(input) { return claims.addClaim(input); }
function listClaims(policyId) { return claims.listClaimsByPolicy(policyId); }
function buildReport(ctx) { return analyzer.buildHealthCheck(ctx); }
function renderTerminal(data) { return report.renderTerminal(data); }
function writeMarkdown(data) { return report.writeMarkdown(data); }
function runReminders() { return reminder.runCheckReminders(); }
function computeGap(ctx, policies, cashTotal) { return gapRules.computeGap(ctx, policies, cashTotal); }
function summarizeByType() { return cash.summarizeByType(); }

module.exports = {
  addPolicy, getPolicy, listPolicies,
  addCash, listCash, summarizeByType,
  addClaim, listClaims,
  buildReport, renderTerminal, writeMarkdown,
  runReminders, computeGap,
  buildParsePrompt: parser.buildParsePrompt,
  validateParsedPolicy: parser.validateParsedPolicy,
  parsePolicyText: parser.parsePolicyText,
};
```

- [ ] **Step 2: Run all insurance tests to ensure integration works**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/ 2>&1 | tail -15
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/insurance/index.js
git commit -m "feat(insurance): public API aggregator with three-party role resolution"
```

---

## Task 12: `bin/insurance` + `lib/insurance/cli.js` — CLI entry

**Files:**
- Create: `bin/insurance`
- Create: `lib/insurance/cli.js`
- Create: `tests/insurance/cli.test.js`

- [ ] **Step 1: Write the failing test** — `tests/insurance/cli.test.js` uses `child_process.execFileSync('node', [cli, ...])` to verify:
  - `node bin/insurance --help` prints usage
  - `node bin/insurance add-policy --json '<json>'` records a policy and prints summary
  - `node bin/insurance report --income 500000 --expense 200000` prints report (terminal output contains `A. 资产概览` and `免责声明`)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/cli.test.js 2>&1 | tail -10
```

- [ ] **Step 3: Implement `bin/insurance`**

```bash
#!/bin/bash
# bin/insurance — 保险管家 CLI 入口
DIR="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$DIR/lib/insurance/cli.js" "$@"
```

- [ ] **Step 4: Implement `lib/insurance/cli.js`**

```js
#!/usr/bin/env node
/**
 * lib/insurance/cli.js — 保险管家 CLI
 *
 * add-policy --json '<json>'           录保单
 * add-cash --json '<json>'             录现金资产
 * add-claim --json '<json>'            录理赔
 * query [keyword]                      查保单
 * renewals                             查 60/30/7 天内续保/到期
 * gap --income N --expense N           单独跑缺口分析
 * report --income N --expense N        体检报告（终端 + 落盘）
 * check-reminders                      跑续保/到期提醒（cron 调用）
 * rules-review                         用户偶发：评估规则（v1 stub）
 */
const insurance = require('./index');
const args = process.argv.slice(2);
const [cmd, ...rest] = args;

function usage() {
  console.log(`Usage: node lib/insurance/cli.js <command> [args]

Commands:
  add-policy --json '<json>'           录保单
  add-cash --json '<json>'             录现金资产
  add-claim --json '<json>'            录理赔
  query [keyword]                      查保单
  renewals                             查 60/30/7 天内续保/到期
  gap --income N --expense N           单独跑缺口分析
  report --income N --expense N        体检报告（终端 + 落盘）
  check-reminders                      跑续保/到期提醒（cron 调用）
  rules-review                         用户偶发：评估规则（v1 stub）
`);
}

function readFlag(rest, flag) {
  const idx = rest.indexOf(flag);
  return idx >= 0 ? rest[idx + 1] : null;
}

if (!cmd || cmd === '--help' || cmd === '-h') { usage(); process.exit(0); }

try {
  if (cmd === 'add-policy') {
    const json = readFlag(rest, '--json');
    if (!json) { console.error("Usage: add-policy --json '<json>'"); process.exit(1); }
    const validated = insurance.validateParsedPolicy(JSON.parse(json));
    const healthDisclosure = readFlag(rest, '--health-disclosure');
    const result = insurance.addPolicy(validated, healthDisclosure);
    console.log(`✓ 保单已录入: ${result.policy_id}`);
    console.log(`  投保人/被保人/受益人:`, JSON.stringify(result.memberIds));
    console.log(`  ${result.summary.product_name} | ${result.summary.category}`);
    if (result.summary.sum_insured) console.log(`  保额 ¥${Number(result.summary.sum_insured).toLocaleString('zh-CN')}`);
    if (result.summary.annual_premium) console.log(`  年缴 ¥${Number(result.summary.annual_premium).toLocaleString('zh-CN')}`);
    if (result.summary.next_renewal_date) console.log(`  下次续保: ${result.summary.next_renewal_date}`);
    if (result.summary.sales_contact) {
      const c = result.summary.sales_contact;
      console.log(`  销售: ${c.name || ''} ${c.phone || ''} — 注意保存此联系方式`);
    }
    if (result.summary.health_disclosure) console.log(`  健康告知: ${result.summary.health_disclosure}`);
    console.log('');
    console.log('体检报告: node bin/insurance report --income N --expense N');
  } else if (cmd === 'add-cash') {
    const json = readFlag(rest, '--json');
    if (!json) { console.error("Usage: add-cash --json '<json>'"); process.exit(1); }
    const a = insurance.addCash(JSON.parse(json));
    console.log(`✓ 现金资产已录入: ${a.asset_id}`);
    console.log(`  ${a.type} | ${a.account_alias || ''} | ¥${Number(a.balance).toLocaleString('zh-CN')}`);
  } else if (cmd === 'add-claim') {
    const json = readFlag(rest, '--json');
    if (!json) { console.error("Usage: add-claim --json '<json>'"); process.exit(1); }
    const c = insurance.addClaim(JSON.parse(json));
    console.log(`✓ 理赔已录入: ${c.claim_id} (${c.status})`);
  } else if (cmd === 'query') {
    const kw = rest[0];
    const all = insurance.listPolicies();
    const filtered = kw ? all.filter(p =>
      (p.product_name || '').includes(kw) || (p.insurer || '').includes(kw) || (p.category || '').includes(kw)) : all;
    if (filtered.length === 0) console.log('(无匹配保单)');
    else for (const p of filtered) console.log(`  [${p.policy_id}] ${p.product_name || '(无名)'} | ${p.category} | ¥${p.sum_insured || '?'} | ${p.status}`);
  } else if (cmd === 'renewals') {
    const today = new Date();
    for (const p of insurance.listPolicies()) {
      if (!p.next_renewal_date) continue;
      const days = Math.round((new Date(p.next_renewal_date) - today) / (1000 * 60 * 60 * 24));
      if (days >= 0 && days <= 60) console.log(`  ${p.product_name} | 续保 ${p.next_renewal_date} (${days} 天后) | ${p.annual_premium ? '¥' + Number(p.annual_premium).toLocaleString('zh-CN') : ''}`);
    }
  } else {
    const ctx = {
      annualIncome: Number(readFlag(rest, '--income')) || 0,
      annualExpense: Number(readFlag(rest, '--expense')) || 0,
      mortgageBalance: Number(readFlag(rest, '--mortgage')) || 0,
      occupation: readFlag(rest, '--occupation') || 'office',
      hasGuaranteedRenewable: rest.includes('--guaranteed-renewable'),
      hasStableJob: rest.includes('--stable-job'),
    };
    if (cmd === 'gap') {
      const data = insurance.buildReport(ctx);
      console.log('【缺口分析】');
      if (data.D_gaps.length === 0) console.log('  ✓ 无显著缺口');
      else for (const g of data.D_gaps) console.log(`  · ${g.label}${g.amount ? ' ¥' + g.amount.toLocaleString('zh-CN') : ''}`);
    } else if (cmd === 'report') {
      const data = insurance.buildReport(ctx);
      console.log(insurance.renderTerminal(data));
      const file = insurance.writeMarkdown(data);
      console.log('');
      console.log(`📄 Markdown 落盘: ${file}`);
    } else if (cmd === 'check-reminders') {
      const r = insurance.runReminders();
      if (!r.sent) console.log('(本周无保单到期或续保)');
    } else if (cmd === 'rules-review') {
      console.log('规则评估（v1 stub）：当前规则基于 2026-06 spec，无新反馈需评估。');
      console.log('未来版本会读 policy_check_feedback 表 → 跑 LLM 评估规则覆盖度。');
    } else {
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
    }
  }
} catch (e) {
  console.error(`Error: ${e.message}`);
  process.exit(1);
}
```

- [ ] **Step 5: Make `bin/insurance` executable**

```bash
chmod +x /Users/windknow/.claude/skills/capture-me/bin/insurance
```

- [ ] **Step 6: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/insurance/cli.test.js 2>&1 | tail -10
```

Expected: PASS — 3 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add bin/insurance lib/insurance/cli.js tests/insurance/cli.test.js
git commit -m "feat(insurance): CLI entry with all subcommands"
```

---

## Task 13: `lib/setup-cron.js` — add insurance-reminder task

**Files:**
- Modify: `lib/setup-cron.js` (LABEL_PREFIX + TASKS + plistFor target)
- Create: `bin/dispatch.js`
- Modify: `tests/setup-cron.test.js` (update counts 3 → 4 + add insurance task test)

- [ ] **Step 1: Update `tests/setup-cron.test.js`**

In existing tests, change:
- `expect(r.missing.length).toBe(3)` → `expect(r.missing.length).toBe(4)`
- `expect(results).toHaveLength(3)` → `expect(results).toHaveLength(4)`
- `expect(files).toHaveLength(3)` → `expect(files).toHaveLength(4)`
- `expect(r.present.length).toBe(3)` → `expect(r.present.length).toBe(4)`

Append a new test:

```js
  test('insurance-reminder plist exists with 5 weekday entries at 09:00', () => {
    const insTask = setupCron.TASKS.find((t) => t.label.endsWith('insurance-reminder'));
    expect(insTask).toBeDefined();
    const xml = fs.readFileSync(setupCron._pathOf(insTask), 'utf8');
    expect(xml).toMatch(/me\.capture\.insurance\.insurance-reminder/);
    const weekdayMatches = xml.match(/<key>Weekday<\/key>/g) || [];
    expect(weekdayMatches.length).toBe(5);
    expect(xml).toMatch(/<key>Hour<\/key>\s*<integer>9<\/integer>/);
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/setup-cron.test.js 2>&1 | tail -15
```

- [ ] **Step 3: Create `bin/dispatch.js`**

```js
#!/usr/bin/env node
/**
 * bin/dispatch.js — unified cron entry, routes by command name
 * (one plist-friendly shim for both weekplan and insurance)
 */
const cmd = process.argv[2];
if (cmd === 'checkin-bot' || cmd === 'auto-report' || cmd === 'setup') {
  require('../lib/weekplan.js');
} else if (cmd === 'check-reminders') {
  require('../lib/insurance/cli.js');
} else {
  console.error(`dispatch: unknown command ${cmd}`);
  process.exit(1);
}
```

```bash
chmod +x /Users/windknow/.claude/skills/capture-me/bin/dispatch.js
```

- [ ] **Step 4: Modify `lib/setup-cron.js`**

```js
// Change LABEL_PREFIX:
const LABEL_PREFIX = 'me.capture.insurance';   // was: 'me.capture.weekplan'

// Add new constant:
const DISPATCH_JS = path.resolve(__dirname, '..', 'bin', 'dispatch.js');

// Update TASKS array — rename existing 3 labels with 'weekplan-' prefix, add 4th:
const TASKS = [
  {
    label: `${LABEL_PREFIX}.weekplan-monday-create`,
    desc: '周一 09:00 提醒创建本周计划',
    args: ['checkin-bot', '--remind-create', '--send'],
    schedule: [{ Weekday: 1, Hour: 9, Minute: 0 }],
  },
  {
    label: `${LABEL_PREFIX}.weekplan-daily-checkin`,
    desc: '工作日 18:00 提醒补齐进展',
    args: ['checkin-bot', '--remind-update', '--send'],
    schedule: [1, 2, 3, 4, 5].map((d) => ({ Weekday: d, Hour: 18, Minute: 0 })),
  },
  {
    label: `${LABEL_PREFIX}.weekplan-friday-report`,
    desc: '周五 17:30 自动生成本周周报',
    args: ['auto-report', '--send'],
    schedule: [{ Weekday: 5, Hour: 17, Minute: 30 }],
  },
  // ─── Insurance（新）───
  {
    label: `${LABEL_PREFIX}.insurance-reminder`,
    desc: '工作日 09:00 检查续保/到期保单',
    args: ['check-reminders'],
    schedule: [1, 2, 3, 4, 5].map((d) => ({ Weekday: d, Hour: 9, Minute: 0 })),
  },
];

// In plistFor(), change:
const argXml = [NODE_BIN, DISPATCH_JS, ...task.args]
  .map((a) => `    <string>${escapeXml(a)}</string>`)
  .join('\n');
// (was: NODE_BIN, WEEKPLAN_JS, ...task.args)
```

> **迁移说明**：原 `LABEL_PREFIX='me.capture.weekplan'` 改为 `me.capture.insurance`，**3 条已注册任务**改用 `weekplan-*` 后缀，**新任务**用 `insurance-reminder` 后缀。已注册到 launchd 的旧 plist 仍可继续运行（plist 内容包含完整 label + program 路径）；setup 重新跑会写出新 label 的 plist 并覆盖。建议在升级提示中告知用户 `node lib/setup-cron.js --check` 确认 4 条都已注册。

- [ ] **Step 5: Run test to verify it passes**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest tests/setup-cron.test.js 2>&1 | tail -10
```

Expected: PASS — all tests pass with 4 tasks.

- [ ] **Step 6: Run all tests for regression**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add lib/setup-cron.js bin/dispatch.js tests/setup-cron.test.js
git commit -m "feat(insurance): add insurance-reminder task to setup-cron (4 tasks total)"
```

---

## Task 14: Update `SKILL.md` + `README.md`

**Files:**
- Modify: `SKILL.md` (add insurance section + table rows)
- Modify: `README.md` (add feature row)

- [ ] **Step 1: Add rows to `SKILL.md` "核心命令" table** (after the weekplan row):

```markdown
| `insurance add-policy` | 录入保单（对话 + 结构化，**三方角色独立识别**） |
| `insurance add-cash` | 录入现金/应急资产（含 `personal_pension` 个人养老金账户） |
| `insurance add-claim` | 录入理赔记录（与保单关联；拒赔记录标红） |
| `insurance query` / `renewals` | 查保单库 / 查 60/30/7 天内续保/到期 |
| `insurance gap` / `report` | 单独跑缺口分析 / 体检报告（**双十 + 家庭风险矩阵**两套并行 + 免责声明） |
| `insurance setup` | 注册 1 个 launchd 定时任务（工作日 09:00 检查续保/到期） |
```

- [ ] **Step 2: Insert `## 保险管家（Insurance Manager）` section** in `SKILL.md` before `## AI 处理流程`:

```markdown
## 保险管家（Insurance Manager）

保单结构化录入 / 家庭体检报告 / 续保提醒 / 缺口分析（双十 + 家庭风险矩阵）。

### 触发词
- `/capture-me insurance add-policy` — 录入保单
- `/capture-me insurance add-cash` — 录入现金/应急资产
- `/capture-me insurance add-claim` — 录入理赔
- `/capture-me insurance query` / `renewals` — 查询
- `/capture-me insurance gap` / `report` — 缺口分析 / 体检报告
- `/capture-me insurance check-reminders` — 跑提醒（cron 自动）

### 数据模型
4 张表（`family_members` / `insurance_policies` / `cash_assets` / `insurance_claims`） + 9 个索引。

**三方角色独立 FK**：`family_member_id`（被保人） / `policy_holder_id`（投保人） / `beneficiary_ids`（受益人 JSON 数组）。

### 解析模式
- 录入时由 Agent 在对话中调 LLM 解析为 JSON（`buildParsePrompt` 提供 prompt 模板）
- 脚本侧只做 `validateParsedPolicy` 校验 + 规范化
- 缺啥问啥，逐项对话补齐；不阻塞录入
- **健康告知是理赔拒赔主因（国内 60% 拒赔由此导致），必须主动询问**

### 缺口分析方法论
两套规则并行（取较大值）：
- **双十法则**：寿险 = 收入 × 10 + 房贷；重疾 = 年支出 × 5 × 1.2；意外 = 收入 × 10
- **家庭风险矩阵**：在双十基础上加职业系数（高风险 1.5x）、保证续保判定、应急金 6-12 个月

### 体检报告
6 段输出（A 资产 / B 险种覆盖 / C 建议 / D 缺口 / E 理赔 / F LLM 个性化），**必含合规章节**。

报告落盘：`memory/insurance-reports/YYYY-MM-DD-体检.md`。

### 续保/到期提醒
- 工作日 09:00 跑 `insurance check-reminders`
- 7/30/60 天三档窗口
- 7 天内保单**强制**带"建议提前 3 天确认绑定银行卡余额"提示
- 通知走 `lib/notify.js` 复用 weekplan 通道

### 孤儿单
`insurance_policies.sales_contact` 缺失的保单在体检报告中标"⚠️ 孤儿单 — 断缴或理赔时风险大"。
```

- [ ] **Step 3: Add row in `README.md`** (find the feature highlights table or list and add):

```markdown
| **家庭保险管家** | 保单结构化录入 / 体检报告 / 续保提醒 / 缺口分析（双十 + 家庭风险矩阵） |
```

- [ ] **Step 4: Smoke test**

```bash
cd /Users/windknow/.claude/skills/capture-me && bash bin/insurance --help 2>&1 | head -20
```

Expected: prints usage with all subcommands.

- [ ] **Step 5: Run all tests**

```bash
cd /Users/windknow/.claude/skills/capture-me && npx jest 2>&1 | tail -5
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/windknow/.claude/skills/capture-me
git add SKILL.md README.md
git commit -m "docs(insurance): SKILL.md insurance section + README feature line"
```

---

## Task 15: End-to-end manual smoke test

**Files:** (no code changes)

- [ ] **Step 1: Run the e2e scenario**

```bash
cd /Users/windknow/.claude/skills/capture-me
export CAPTURE_YOU_TEST_DB_PATH="$(mktemp -d)/test.db"
export CAPTURE_ME_INSURANCE_REPORTS_DIR="$(mktemp -d)"
export WEEKPLAN_DRY_RUN=1
mkdir -p "$(dirname $CAPTURE_YOU_TEST_DB_PATH)" "$CAPTURE_ME_INSURANCE_REPORTS_DIR"

# Init
node lib/db.js init

# 录一张带三方角色的保单
node bin/insurance add-policy --json '{"category":"critical_illness+life","insurer":"平安","product_name":"平安福 2023","sum_insured":500000,"annual_premium":8000,"payment_method":"年缴","payment_period":"30年缴","start_date":"2023-06-15","policy_holder":{"name":"我","relation":"self"},"insured":{"name":"老婆","relation":"spouse"},"beneficiaries":[{"name":"儿子","relation":"child"}],"sales_channel":"agent","sales_contact":{"name":"张经理","phone":"13800000000"}}' --health-disclosure '轻度高血压二级已告知'

# 录现金资产
node bin/insurance add-cash --json '{"type":"活期","account_alias":"招行活期","balance":50000,"as_of_date":"2026-06-14"}'
node bin/insurance add-cash --json '{"type":"personal_pension","account_alias":"个人养老金","balance":12000,"as_of_date":"2026-06-14"}'

# 录理赔
POLICY_ID=$(node -e 'const d=require("./lib/insurance"); const p=d.listPolicies()[0]; console.log(p.policy_id)')
node bin/insurance add-claim --json "{\"policy_id\":\"$POLICY_ID\",\"claim_date\":\"2026-05-10\",\"claim_reason\":\"意外骨折\",\"claim_amount\":12000,\"status\":\"submitted\"}"

# 体检报告
node bin/insurance report --income 500000 --expense 200000 --mortgage 1000000 --stable-job --guaranteed-renewable

# 跑提醒
node bin/insurance check-reminders
```

Expected outputs:
- 保单已录入，policy_id 以 `pol_` 开头
- 现金资产 / 理赔录入成功
- 体检报告终端输出含 `A. 资产概览` ~ `F. AI 个性化建议` + `免责声明`
- Markdown 落盘到 `$CAPTURE_ME_INSURANCE_REPORTS_DIR/<日期>-体检.md`
- 提醒若无 60 天内保单则返回 `(本周无保单到期或续保)`；否则打印命中信息

- [ ] **Step 2: Verify markdown file exists**

```bash
ls -la "$CAPTURE_ME_INSURANCE_REPORTS_DIR/" | grep 体检
```

Expected: at least one `YYYY-MM-DD-体检.md` file.

- [ ] **Step 3: Inspect a slice of the markdown**

```bash
head -30 "$CAPTURE_ME_INSURANCE_REPORTS_DIR"/*-体检.md
```

Expected: contains `# 家庭保险体检报告` and 6 section headings + disclaimer.

- [ ] **Step 4: Cleanup test artifacts**

```bash
rm -rf "$(dirname $CAPTURE_YOU_TEST_DB_PATH)" "$CAPTURE_ME_INSURANCE_REPORTS_DIR"
unset CAPTURE_YOU_TEST_DB_PATH CAPTURE_ME_INSURANCE_REPORTS_DIR WEEKPLAN_DRY_RUN
```

- [ ] **Step 5: Commit any final tweaks**

If any test artifacts leaked into git, no commit needed. Otherwise:
```bash
cd /Users/windknow/.claude/skills/capture-me
git status  # should be clean
```

---

## Self-Review Checklist

Before executing this plan, the spec author reviewed:

1. **Spec coverage:**
   - 4 张表 (Task 1) ✓
   - family_members CRUD (Task 2) ✓
   - insurance_policies CRUD (Task 3) ✓
   - cash_assets CRUD (Task 4) ✓
   - insurance_claims CRUD + 状态机 (Task 5) ✓
   - Parser NL → 结构化 + 三方角色识别 (Task 6) ✓
   - 缺口分析 双十 + 矩阵 (Task 7) ✓
   - 体检报告 6 段 (Task 8) ✓
   - 终端 + markdown 渲染 + 免责声明 (Task 9) ✓
   - 续保/到期 7/30/60 + 银行卡余额检查 (Task 10) ✓
   - 公共 API (Task 11) ✓
   - CLI (Task 12) ✓
   - setup-cron 集成 (Task 13) ✓
   - SKILL.md / README.md (Task 14) ✓
   - 端到端手测 (Task 15) ✓

2. **Type consistency:**
   - `policy_id` (snake_case) used in DB and `addPolicy` return — consistent
   - `member_id` — consistent
   - `family_member_id` / `policy_holder_id` / `beneficiary_ids` — consistent with spec §3
   - `next_renewal_date` is `YYYY-MM-DD` string — consistent
   - `claim_id` — consistent
   - `_roles` is parser-internal sentinel (stripped before insert) — explicit `delete policyInput._roles` in `addPolicy`

3. **Placeholder scan:** no "TBD" / "TODO" / "implement later" / "fill in details" in the plan.

4. **Test count:** ~14+ unit tests + 3 CLI tests = 17+ across 10 files. Matches spec §8 expectation.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-14-insurance-manager.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
