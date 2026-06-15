/**
 * tests/insurance/db-policies.test.js — insurance_policies CRUD
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-ins-policies-' + process.pid);
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-policies.db');

process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('lib/insurance/db.js — insurance_policies CRUD', () => {
  let selfMemberId;
  let wifeMemberId;

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
    const wife = insDb.upsertMember({ name: '老婆', relation: 'spouse' });
    selfMemberId = self.member_id;
    wifeMemberId = wife.member_id;
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmdirSync(TEST_DB_DIR, { recursive: true });
    }
  });

  test('insertPolicy 记录三方角色 (family_member_id / policy_holder_id / beneficiary_ids)', () => {
    const insDb = require('../../lib/insurance/db');
    const p = insDb.insertPolicy({
      family_member_id: selfMemberId,
      policy_holder_id: wifeMemberId,
      beneficiary_ids: [wifeMemberId],
      category: 'health',
      insurer: '平安',
      product_name: '平安福',
      policy_number: 'PF-2024-001',
      sum_insured: 500000,
      annual_premium: 12000,
      start_date: '2024-01-01',
      end_date: '2025-01-01',
      next_renewal_date: '2025-12-15',
      status: 'active',
    });

    expect(p.policy_id).toMatch(/^pol_/);
    expect(p.family_member_id).toBe(selfMemberId);
    expect(p.policy_holder_id).toBe(wifeMemberId);
    expect(p.beneficiary_ids).toEqual([wifeMemberId]);
    expect(p.category).toBe('health');
    expect(p.insurer).toBe('平安');
    expect(p.status).toBe('active');
  });

  test('getPolicy 返回的 beneficiary_ids 是 JS 数组（不是 JSON 字符串）', () => {
    const insDb = require('../../lib/insurance/db');
    const p = insDb.insertPolicy({
      family_member_id: selfMemberId,
      beneficiary_ids: [selfMemberId, wifeMemberId],
      category: 'life',
    });
    const fetched = insDb.getPolicy(p.policy_id);
    expect(Array.isArray(fetched.beneficiary_ids)).toBe(true);
    expect(fetched.beneficiary_ids).toEqual([selfMemberId, wifeMemberId]);
  });

  test('updatePolicyStatus 拒绝非法 status（状态机）', () => {
    const insDb = require('../../lib/insurance/db');
    const p = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'accident',
    });
    insDb.updatePolicyStatus(p.policy_id, 'expired');
    const after = insDb.getPolicy(p.policy_id);
    expect(after.status).toBe('expired');

    expect(() => insDb.updatePolicyStatus(p.policy_id, 'bogus_status'))
      .toThrow(/invalid status/);

    insDb.updatePolicyStatus(p.policy_id, 'active');
    expect(insDb.getPolicy(p.policy_id).status).toBe('active');
  });

  test('listPoliciesRenewingSoon(30) 返回 next_renewal_date 在 30 天窗口内的 active 策略', () => {
    const insDb = require('../../lib/insurance/db');
    const inside = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'critical_illness',
      next_renewal_date: dateOffset(10),
      status: 'active',
    });
    const outside = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'critical_illness',
      next_renewal_date: dateOffset(60),
      status: 'active',
    });
    const cancelled = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'critical_illness',
      next_renewal_date: dateOffset(5),
      status: 'cancelled',
    });

    const renewingSoon = insDb.listPoliciesRenewingSoon(30);
    const ids = renewingSoon.map(p => p.policy_id);

    expect(ids).toContain(inside.policy_id);
    expect(ids).not.toContain(outside.policy_id);
    expect(ids).not.toContain(cancelled.policy_id);
  });

  test('listPoliciesExpiringSoon(60) 返回 end_date 在 60 天窗口内的 active 策略', () => {
    const insDb = require('../../lib/insurance/db');
    const inside = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'annuity',
      end_date: dateOffset(45),
      status: 'active',
    });
    const outside = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'annuity',
      end_date: dateOffset(120),
      status: 'active',
    });
    const expired = insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'annuity',
      end_date: dateOffset(20),
      status: 'expired',
    });

    const expiringSoon = insDb.listPoliciesExpiringSoon(60);
    const ids = expiringSoon.map(p => p.policy_id);

    expect(ids).toContain(inside.policy_id);
    expect(ids).not.toContain(outside.policy_id);
    expect(ids).not.toContain(expired.policy_id);
  });

  test('listPolicies({}) 返回所有策略', () => {
    const insDb = require('../../lib/insurance/db');
    const all = insDb.listPolicies({});
    expect(all.length).toBeGreaterThan(0);
    expect(all.every(p => p.policy_id)).toBe(true);
  });

  test('listPolicies({status}) 按状态过滤', () => {
    const insDb = require('../../lib/insurance/db');
    const active = insDb.listPolicies({ status: 'active' });
    expect(active.length).toBeGreaterThan(0);
    expect(active.every(p => p.status === 'active')).toBe(true);
  });

  test('listPolicies({familyMemberId}) 按家庭成员过滤', () => {
    const insDb = require('../../lib/insurance/db');
    const selfPolicies = insDb.listPolicies({ familyMemberId: selfMemberId });
    expect(selfPolicies.length).toBeGreaterThan(0);
    expect(selfPolicies.every(p => p.family_member_id === selfMemberId)).toBe(true);

    const wifePolicies = insDb.listPolicies({ familyMemberId: wifeMemberId });
    expect(wifePolicies.every(p => p.family_member_id === wifeMemberId)).toBe(true);
  });

  test('listPolicies({category}) 按险种分类过滤', () => {
    const insDb = require('../../lib/insurance/db');
    const health = insDb.listPolicies({ category: 'health' });
    expect(health.length).toBeGreaterThan(0);
    expect(health.every(p => p.category === 'health')).toBe(true);
  });

  test('listPolicies({salesChannel}) 按销售渠道过滤', () => {
    const insDb = require('../../lib/insurance/db');
    insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'health',
      sales_channel: 'agent',
      status: 'active',
    });
    const agent = insDb.listPolicies({ salesChannel: 'agent' });
    expect(agent.length).toBeGreaterThan(0);
    expect(agent.every(p => p.sales_channel === 'agent')).toBe(true);
  });

  test('listPolicies({status, category}) 多条件组合（AND）', () => {
    const insDb = require('../../lib/insurance/db');
    const filtered = insDb.listPolicies({ status: 'active', category: 'health' });
    expect(filtered.length).toBeGreaterThan(0);
    expect(filtered.every(p => p.status === 'active' && p.category === 'health')).toBe(true);
  });
});
