/**
 * tests/insurance/analyzer.test.js — 6-section health check (体检报告)
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-ins-analyzer-' + process.pid);
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-analyzer.db');

process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

describe('lib/insurance/analyzer.js — 6-section health check', () => {
  let selfMemberId;

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
    selfMemberId = self.member_id;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmdirSync(TEST_DB_DIR, { recursive: true });
    }
  });

  test('buildHealthCheck(ctx) 返回 6 个 section + disclaimer', () => {
    const analyzer = require('../../lib/insurance/analyzer');
    const ctx = { annualIncome: 500000, annualExpense: 200000,
      mortgageBalance: 0, occupation: 'office',
      hasGuaranteedRenewable: true, hasStableJob: true };
    const report = analyzer.buildHealthCheck(ctx);
    expect(report).toHaveProperty('A_assets');
    expect(report).toHaveProperty('B_coverage');
    expect(report).toHaveProperty('C_suggested');
    expect(report).toHaveProperty('D_gaps');
    expect(report).toHaveProperty('E_claims');
    expect(report).toHaveProperty('F_personalization');
    expect(report).toHaveProperty('disclaimer');
  });

  test('A_assets.cashTotal 汇总现金；personalPensionTotal 子汇总 personal_pension', () => {
    const insDb = require('../../lib/insurance/db');
    const cash = require('../../lib/insurance/cash');
    const analyzer = require('../../lib/insurance/analyzer');

    insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'life',
      sum_insured: 1000000,
      annual_premium: 5000,
      status: 'active',
    });
    cash.addCash({ type: '活期', balance: 80000 });
    cash.addCash({ type: '货基', balance: 20000 });
    cash.addCash({ type: 'personal_pension', balance: 12000, account_alias: '建行养老金' });

    const ctx = { annualIncome: 500000, annualExpense: 120000,
      hasGuaranteedRenewable: true, hasStableJob: true };
    const report = analyzer.buildHealthCheck(ctx);
    expect(report.A_assets.cashTotal).toBe(112000);
    expect(report.A_assets.personalPensionTotal).toBe(12000);
  });

  test("D_gaps 包含 orphan_policy: sales_channel='agent' 但无 sales_contact", () => {
    const insDb = require('../../lib/insurance/db');
    const analyzer = require('../../lib/insurance/analyzer');

    insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'health',
      product_name: 'XX重疾险',
      sales_channel: 'agent',
      status: 'active',
    });

    const ctx = { annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true };
    const report = analyzer.buildHealthCheck(ctx);
    const orphans = report.D_gaps.filter(g => g.type === 'orphan_policy');
    expect(orphans.length).toBeGreaterThan(0);
    expect(orphans[0]).toHaveProperty('product_name');
  });

  test('D_gaps 包含 claim_rejection: 最近 1 年有拒赔', () => {
    const insDb = require('../../lib/insurance/db');
    const claims = require('../../lib/insurance/claims');
    const analyzer = require('../../lib/insurance/analyzer');

    const pol = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'health',
      status: 'active',
    });
    const c = claims.addClaim({
      policy_id: pol.policy_id,
      claim_date: new Date().toISOString().slice(0, 10),
      claim_amount: 10000,
      status: 'submitted',
    });
    claims.markRejected(c.claim_id, '材料不全');

    const ctx = { annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true };
    const report = analyzer.buildHealthCheck(ctx);
    const rejections = report.D_gaps.filter(g => g.type === 'claim_rejection');
    expect(rejections.length).toBe(1);
    expect(rejections[0].count).toBeGreaterThanOrEqual(1);
  });

  test('disclaimer 含「不构成任何投保」+「持牌保险经纪人」', () => {
    const analyzer = require('../../lib/insurance/analyzer');
    const ctx = { annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true };
    const report = analyzer.buildHealthCheck(ctx);
    expect(report.disclaimer).toMatch(/不构成任何投保/);
    expect(report.disclaimer).toMatch(/持牌保险经纪人/);
  });

  test('cashCoverageMonths — "11.2" 字符串当 cash>0 且 annualExpense>0；null 当 annualExpense=0', () => {
    const analyzer = require('../../lib/insurance/analyzer');
    const withExpense = analyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 120000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(withExpense.A_assets.cashTotal).toBe(112000);
    expect(withExpense.A_assets.cashCoverageMonths).toBe('11.2');

    const noExpense = analyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 0,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(noExpense.A_assets.cashCoverageMonths).toBeNull();
  });

  test('D_gaps — life_gap/ci_gap/accident_gap/emergency_fund_gap 均出现且 amount > 0', () => {
    const analyzer = require('../../lib/insurance/analyzer');
    const report = analyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 300000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    const lifeGap = report.D_gaps.find(g => g.type === 'life_gap');
    const ciGap = report.D_gaps.find(g => g.type === 'ci_gap');
    const accGap = report.D_gaps.find(g => g.type === 'accident_gap');
    const efGap = report.D_gaps.find(g => g.type === 'emergency_fund_gap');
    expect(lifeGap).toBeDefined();
    expect(ciGap).toBeDefined();
    expect(accGap).toBeDefined();
    expect(efGap).toBeDefined();
    expect(lifeGap.amount).toBe(4000000);
    expect(ciGap.amount).toBe(1800000);
    expect(accGap.amount).toBe(5000000);
    expect(efGap.amount).toBeGreaterThan(0);
  });

  test('F_personalization.notes — 包含「有房贷」和「个人养老金」', () => {
    const analyzer = require('../../lib/insurance/analyzer');
    const report = analyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 120000,
      mortgageBalance: 500000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(report.F_personalization.notes.some(n => n.includes('有房贷'))).toBe(true);
    expect(report.F_personalization.notes.some(n => n.includes('个人养老金'))).toBe(true);
  });

  test('E_claims — pending ≥ 1（submitted）且 paid ≥ 1（paid）', () => {
    const insDb = require('../../lib/insurance/db');
    const claims = require('../../lib/insurance/claims');
    const analyzer = require('../../lib/insurance/analyzer');

    const pendingPol = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'health',
      status: 'active',
    });
    claims.addClaim({
      policy_id: pendingPol.policy_id,
      claim_date: new Date().toISOString().slice(0, 10),
      claim_amount: 5000,
      status: 'submitted',
    });

    const paidPol = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'health',
      status: 'active',
    });
    const paidClaim = claims.addClaim({
      policy_id: paidPol.policy_id,
      claim_date: new Date().toISOString().slice(0, 10),
      claim_amount: 8000,
      status: 'submitted',
    });
    claims.updateClaimStatus(paidClaim.claim_id, 'under_review');
    claims.updateClaimStatus(paidClaim.claim_id, 'approved');
    claims.markPaid(paidClaim.claim_id, 8000, new Date().toISOString().slice(0, 10));

    const report = analyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(report.E_claims.pending).toBeGreaterThanOrEqual(1);
    expect(report.E_claims.paid).toBeGreaterThanOrEqual(1);
  });

  test('C_suggested.data_sufficient — true 当 annualIncome>0 且 annualExpense>0；false 任一缺失', () => {
    const analyzer = require('../../lib/insurance/analyzer');
    const ok = analyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(ok.C_suggested.data_sufficient).toBe(true);

    const noIncome = analyzer.buildHealthCheck({
      annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(noIncome.C_suggested.data_sufficient).toBe(false);

    const noExpense = analyzer.buildHealthCheck({
      annualIncome: 500000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(noExpense.C_suggested.data_sufficient).toBe(false);

    const zeroIncome = analyzer.buildHealthCheck({
      annualIncome: 0, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(zeroIncome.C_suggested.data_sufficient).toBe(false);
  });

  test('B_coverage.life.totalInsured — 等于 fixture 中 life 保单的 sum_insured 之和', () => {
    const analyzer = require('../../lib/insurance/analyzer');
    const report = analyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(report.B_coverage.life.totalInsured).toBe(1000000);
  });
});

describe('lib/insurance/analyzer.js — empty fixture (no policies)', () => {
  const EMPTY_DB_DIR = path.join(os.tmpdir(), 'capture-me-ins-analyzer-empty-' + process.pid);
  const EMPTY_DB_PATH = path.join(EMPTY_DB_DIR, 'empty.db');
  let emptyAnalyzer;

  beforeAll(() => {
    if (!fs.existsSync(EMPTY_DB_DIR)) {
      fs.mkdirSync(EMPTY_DB_DIR, { recursive: true });
    }
    if (fs.existsSync(EMPTY_DB_PATH)) {
      fs.unlinkSync(EMPTY_DB_PATH);
    }
    process.env.CAPTURE_YOU_TEST_DB_PATH = EMPTY_DB_PATH;
    jest.resetModules();
    const db = require('../../lib/db');
    db.initDb();
    const insDb = require('../../lib/insurance/db');
    insDb.upsertMember({ name: '我', relation: 'self' });
    emptyAnalyzer = require('../../lib/insurance/analyzer');
  });

  afterAll(() => {
    if (fs.existsSync(EMPTY_DB_PATH)) {
      fs.unlinkSync(EMPTY_DB_PATH);
    }
    if (fs.existsSync(EMPTY_DB_DIR)) {
      fs.rmdirSync(EMPTY_DB_DIR, { recursive: true });
    }
  });

  test('D_gaps — 6 个 category_missing 全报告当无任何保单', () => {
    const report = emptyAnalyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    const missing = report.D_gaps.filter(g => g.type === 'category_missing');
    expect(missing.length).toBe(6);
    const categories = missing.map(g => g.category).sort();
    expect(categories).toEqual(['accident', 'annuity', 'critical_illness', 'health', 'life', 'pension']);
  });

  test('D_gaps — medical_gap 当 hasGuaranteedRenewable=false 且无 active health policy', () => {
    const report = emptyAnalyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: false, hasStableJob: true,
    });
    const medGaps = report.D_gaps.filter(g => g.type === 'medical_gap');
    expect(medGaps.length).toBe(1);
    expect(medGaps[0].label).toMatch(/百万医疗险/);
  });

  test('cashCoverageMonths — null 当 cash=0', () => {
    const report = emptyAnalyzer.buildHealthCheck({
      annualIncome: 500000, annualExpense: 120000,
      hasGuaranteedRenewable: true, hasStableJob: true,
    });
    expect(report.A_assets.cashTotal).toBe(0);
    expect(report.A_assets.cashCoverageMonths).toBeNull();
  });
});
