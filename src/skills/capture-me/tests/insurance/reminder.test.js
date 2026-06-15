/**
 * tests/insurance/reminder.test.js — 续保/到期提醒（7/30/60 天窗口 + 银行卡余额提示）
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-ins-reminder-' + process.pid);
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-reminder.db');

process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;
process.env.WEEKPLAN_DRY_RUN = '1';

function dateOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('lib/insurance/reminder.js — 续保/到期提醒', () => {
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

  beforeEach(() => {
    const db = new Database(TEST_DB_PATH);
    db.prepare('DELETE FROM insurance_policies').run();
    db.close();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmdirSync(TEST_DB_DIR, { recursive: true });
    }
  });

  test('next_renewal_date 5 天后 → 命中 7 天内窗口 + 银行卡余额提示 + 销售联系', () => {
    const insDb = require('../../lib/insurance/db');
    insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'critical_illness',
      product_name: '平安福重疾',
      annual_premium: 12000,
      next_renewal_date: dateOffset(5),
      sales_contact: { name: '张三', phone: '13800138000' },
      status: 'active',
    });

    const { buildReminderMessage } = require('../../lib/insurance/reminder');
    const msg = buildReminderMessage();

    expect(msg).not.toBeNull();
    expect(msg).toContain('7 天内');
    expect(msg).toContain('平安福重疾');
    expect(msg).toContain('提前 3 天确认绑定银行卡余额');
    expect(msg).toContain('张三');
    expect(msg).toContain('13800138000');
  });

  test('next_renewal_date 20 天后 → 命中 30 天内窗口（不含银行卡提示）', () => {
    const insDb = require('../../lib/insurance/db');
    insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'life',
      product_name: '终身寿险',
      annual_premium: 8000,
      next_renewal_date: dateOffset(20),
      status: 'active',
    });

    const { buildReminderMessage } = require('../../lib/insurance/reminder');
    const msg = buildReminderMessage();

    expect(msg).not.toBeNull();
    expect(msg).toContain('30 天内');
    expect(msg).toContain('终身寿险');
    expect(msg).not.toContain('提前 3 天确认绑定银行卡余额');
  });

  test('end_date 50 天后 → 命中 60 天内到期窗口', () => {
    const insDb = require('../../lib/insurance/db');
    insDb.insertPolicy({
      family_member_id: selfMemberId,
      category: 'accident',
      product_name: '意外险一年期',
      end_date: dateOffset(50),
      status: 'active',
    });

    const { buildReminderMessage } = require('../../lib/insurance/reminder');
    const msg = buildReminderMessage();

    expect(msg).not.toBeNull();
    expect(msg).toContain('60 天内');
    expect(msg).toContain('意外险一年期');
    expect(msg).toContain('即将过期');
  });

  test('空 DB → buildReminderMessage 返回 null，runCheckReminders 返回 {sent:false, reason:"no_upcoming"}', () => {
    const { buildReminderMessage, runCheckReminders } = require('../../lib/insurance/reminder');

    expect(buildReminderMessage()).toBeNull();

    const r = runCheckReminders();
    expect(r.sent).toBe(false);
    expect(r.reason).toBe('no_upcoming');
    expect(r.message).toBeNull();
  });

  test('runCheckReminders 命中 → {sent:true} + 调用 notify', () => {
    const insDb = require('../../lib/insurance/db');
    const soon = new Date(); soon.setDate(soon.getDate() + 5);
    insDb.insertPolicy({
      family_member_id: selfMemberId, category: 'life',
      product_name: '命中测试', sum_insured: 1000000, annual_premium: 10000,
      payment_method: '年缴', start_date: '2024-01-01',
      next_renewal_date: soon.toISOString().slice(0, 10),
    });
    const { runCheckReminders } = require('../../lib/insurance/reminder');
    const r = runCheckReminders();
    expect(r.sent).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.message).toContain('7 天内');
  });

  test('7-day boundary: offset=7 命中 7 天内窗口', () => {
    const insDb = require('../../lib/insurance/db');
    const at7 = new Date(); at7.setDate(at7.getDate() + 7);
    insDb.insertPolicy({
      family_member_id: selfMemberId, category: 'life',
      product_name: '边界7', sum_insured: 500000, annual_premium: 5000,
      payment_method: '年缴', start_date: '2024-01-01',
      next_renewal_date: at7.toISOString().slice(0, 10),
    });
    const { buildReminderMessage } = require('../../lib/insurance/reminder');
    const msg = buildReminderMessage();
    expect(msg).toMatch(/7 天内/);
    expect(msg).toMatch(/边界7/);
  });

  test('7-day boundary: offset=8 不命中 7 天内', () => {
    const insDb = require('../../lib/insurance/db');
    const at8 = new Date(); at8.setDate(at8.getDate() + 8);
    insDb.insertPolicy({
      family_member_id: selfMemberId, category: 'life',
      product_name: '边界8', sum_insured: 500000, annual_premium: 5000,
      payment_method: '年缴', start_date: '2024-01-01',
      next_renewal_date: at8.toISOString().slice(0, 10),
    });
    const { buildReminderMessage } = require('../../lib/insurance/reminder');
    const msg = buildReminderMessage();
    // 8 > 7: should NOT be in 7-day window
    expect(msg).not.toMatch(/7 天内/);
    // offset=8 is still within the 30-day window though
    expect(msg).toMatch(/30 天内/);
    expect(msg).toMatch(/边界8/);
  });
});
