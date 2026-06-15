/**
 * tests/insurance/claims.test.js — insurance_claims CRUD + claims.js state machine
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-ins-claims-' + process.pid);
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-claims.db');

process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

describe('lib/insurance/claims.js — insurance_claims CRUD + state machine', () => {
  let polAId;
  let polBId;

  beforeAll(() => {
    if (!fs.existsSync(TEST_DB_DIR)) {
      fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    const db = require('../../lib/db');
    db.initDb();

    const insDb = require('../../lib/insurance/db');
    const self = insDb.upsertMember({ name: '我', relation: 'self' });
    const polA = insDb.insertPolicy({ family_member_id: self.member_id, category: 'health', insurer: '平安' });
    const polB = insDb.insertPolicy({ family_member_id: self.member_id, category: 'critical_illness', insurer: '中国人寿' });
    polAId = polA.policy_id;
    polBId = polB.policy_id;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmdirSync(TEST_DB_DIR, { recursive: true });
    }
  });

  test("claims.addClaim({status: 'submitted', ...}) 返回 claim_id 以 clm_ 开头", () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-01-15',
      claim_reason: '住院手术',
      claim_amount: 30000,
      status: 'submitted',
    });
    expect(c.claim_id).toMatch(/^clm_/);
    expect(c.status).toBe('submitted');
    expect(c.claim_amount).toBe(30000);
  });

  test('claims.updateClaimStatus(id, under_review) → markPaid(id, amount, date) 终态为 paid', () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-02-10',
      claim_amount: 50000,
      status: 'submitted',
    });
    const afterReview = claims.updateClaimStatus(c.claim_id, 'under_review');
    expect(afterReview.status).toBe('under_review');
    const paid = claims.markPaid(c.claim_id, 50000, '2026-03-01');
    expect(paid.status).toBe('paid');
    expect(paid.paid_amount).toBe(50000);
    expect(paid.paid_date).toBe('2026-03-01');
  });

  test("claims.markRejected(id, reason) 设置 status=rejected + rejection_reason", () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-04-01',
      claim_amount: 10000,
      status: 'submitted',
    });
    const rejected = claims.markRejected(c.claim_id, '材料不全');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejection_reason).toBe('材料不全');
  });

  test('claims.listClaimsByPolicy(policyId) 返回该保单下所有理赔行', () => {
    const claims = require('../../lib/insurance/claims');
    claims.addClaim({ policy_id: polBId, claim_date: '2026-05-01', claim_amount: 8000, status: 'submitted' });
    claims.addClaim({ policy_id: polBId, claim_date: '2026-05-15', claim_amount: 12000, status: 'submitted' });
    claims.addClaim({ policy_id: polBId, claim_date: '2026-05-20', claim_amount: 6000, status: 'submitted' });
    const rows = claims.listClaimsByPolicy(polBId);
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(r.policy_id).toBe(polBId);
  });

  test('claims.recentClaims(365) 返回最近 1 年内的理赔记录', () => {
    const claims = require('../../lib/insurance/claims');
    const all = claims.recentClaims(365);
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
    const horizon = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
    for (const r of all) {
      expect(r.claim_date >= horizon).toBe(true);
    }
  });

  test('claims.countRejectedLastYear() 返回最近 365 天被拒赔的数量', () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-06-01',
      claim_amount: 7000,
      status: 'submitted',
    });
    claims.markRejected(c.claim_id, '免责条款');
    const n = claims.countRejectedLastYear();
    expect(n).toBeGreaterThanOrEqual(1);
  });

  // ─── 状态机 negative tests ──────────────────────────────────

  test('claims.markPaid 从 rejected 状态抛错', () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-07-01',
      claim_amount: 2000,
      status: 'submitted',
    });
    claims.markRejected(c.claim_id, '材料不全');
    expect(() => claims.markPaid(c.claim_id, 2000, '2026-07-10')).toThrow(/cannot mark paid from status: rejected; allowed: none \(terminal\)/);
  });

  test('claims.markPaid 从 paid 状态抛错（已赔付的不能再 mark）', () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-07-05',
      claim_amount: 4000,
      status: 'submitted',
    });
    claims.updateClaimStatus(c.claim_id, 'under_review');
    claims.updateClaimStatus(c.claim_id, 'approved');
    claims.markPaid(c.claim_id, 4000, '2026-07-15');
    expect(() => claims.markPaid(c.claim_id, 4000, '2026-07-20')).toThrow(/cannot mark paid from status: paid; allowed: none \(terminal\)/);
  });

  test('claims.markRejected 从 approved 状态抛错', () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-08-01',
      claim_amount: 6000,
      status: 'submitted',
    });
    claims.updateClaimStatus(c.claim_id, 'under_review');
    claims.updateClaimStatus(c.claim_id, 'approved');
    expect(() => claims.markRejected(c.claim_id, '太迟了')).toThrow(/cannot reject from status: approved; allowed: paid/);
  });

  test('claims.markRejected 从 paid 状态抛错', () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-08-05',
      claim_amount: 3000,
      status: 'submitted',
    });
    claims.updateClaimStatus(c.claim_id, 'under_review');
    claims.updateClaimStatus(c.claim_id, 'approved');
    claims.markPaid(c.claim_id, 3000, '2026-08-20');
    expect(() => claims.markRejected(c.claim_id, '已赔付不可拒')).toThrow(/cannot reject from status: paid; allowed: none \(terminal\)/);
  });

  test('claims.updateClaimStatus(paid, submitted) 抛错（非法逆向转移）', () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-09-01',
      claim_amount: 9000,
      status: 'submitted',
    });
    claims.updateClaimStatus(c.claim_id, 'under_review');
    claims.updateClaimStatus(c.claim_id, 'approved');
    claims.markPaid(c.claim_id, 9000, '2026-09-15');
    expect(() => claims.updateClaimStatus(c.claim_id, 'submitted'))
      .toThrow(/invalid transition: paid → submitted; allowed:/);
  });

  test('claims.addClaim({status: "paid", ...}) 抛错（初始状态守卫）', () => {
    const claims = require('../../lib/insurance/claims');
    expect(() => claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-09-10',
      claim_amount: 1000,
      status: 'paid',
    })).toThrow(/claims must be created with status 'submitted' \(got 'paid'\)/);
  });

  test('claims.addClaim({status: "rejected", ...}) 抛错（初始状态守卫）', () => {
    const claims = require('../../lib/insurance/claims');
    expect(() => claims.addClaim({
      policy_id: polAId,
      claim_date: '2026-09-11',
      claim_amount: 1000,
      status: 'rejected',
    })).toThrow(/claims must be created with status 'submitted' \(got 'rejected'\)/);
  });

  // ─── happy-path 全流程测试 ───────────────────────────────

  test('submitted → under_review → approved → paid 全流程 happy path', () => {
    const claims = require('../../lib/insurance/claims');
    const c = claims.addClaim({
      policy_id: polBId,
      claim_date: '2026-10-01',
      claim_amount: 50000,
      claim_reason: '重疾确诊',
      status: 'submitted',
    });
    expect(c.status).toBe('submitted');

    const review = claims.updateClaimStatus(c.claim_id, 'under_review');
    expect(review.status).toBe('under_review');

    const approved = claims.updateClaimStatus(c.claim_id, 'approved');
    expect(approved.status).toBe('approved');

    const paid = claims.markPaid(c.claim_id, 50000, '2026-10-25');
    expect(paid.status).toBe('paid');
    expect(paid.paid_amount).toBe(50000);
    expect(paid.paid_date).toBe('2026-10-25');
  });
});
