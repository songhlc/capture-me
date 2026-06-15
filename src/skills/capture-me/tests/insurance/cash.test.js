/**
 * tests/insurance/cash.test.js — cash_assets CRUD + cash.js summary helpers
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-ins-cash-' + process.pid);
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-cash.db');

process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

describe('lib/insurance/cash.js — cash_assets CRUD + summary', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEST_DB_DIR)) {
      fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    const db = require('../../lib/db');
    db.initDb();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmdirSync(TEST_DB_DIR, { recursive: true });
    }
  });

  test('cash.totalCash() 空表时返回 0 而不是抛错', () => {
    const cash = require('../../lib/insurance/cash');
    expect(cash.listCash()).toEqual([]);
    expect(cash.totalCash()).toBe(0);
  });

  test("cash.addCash({type: '股票'}) 非法 type 抛 /invalid cash type/", () => {
    const cash = require('../../lib/insurance/cash');
    expect(() => cash.addCash({ type: '股票', balance: 100 })).toThrow(/invalid cash type/);
    expect(cash.listCash()).toEqual([]);
  });

  test("cash.addCash({type: '活期', balance: 50000}) 返回 asset_id 以 cash_ 开头", () => {
    const cash = require('../../lib/insurance/cash');
    const a = cash.addCash({ type: '活期', balance: 50000, account_alias: '招行活期' });
    expect(a.asset_id).toMatch(/^cash_/);
    expect(a.type).toBe('活期');
    expect(a.balance).toBe(50000);
    expect(a.account_alias).toBe('招行活期');
    expect(a.currency).toBe('CNY');
  });

  test("cash.addCash({type: 'personal_pension', ...}) 接受个人养老金类型", () => {
    const cash = require('../../lib/insurance/cash');
    const a = cash.addCash({ type: 'personal_pension', balance: 12000, account_alias: '建行养老金' });
    expect(a.asset_id).toMatch(/^cash_/);
    expect(a.type).toBe('personal_pension');
    expect(a.balance).toBe(12000);
  });

  test('cash.summarizeByType() 按 type 汇总余额', () => {
    const cash = require('../../lib/insurance/cash');
    expect(cash.summarizeByType()).toEqual({
      '活期': 50000,
      personal_pension: 12000,
    });
  });

  test('cash.totalCash() 返回所有现金/类现金资产总额', () => {
    const cash = require('../../lib/insurance/cash');
    expect(cash.totalCash()).toBe(62000);
  });

  test("cash.getCash('cash_nope') 不存在 id 返回 null", () => {
    const cash = require('../../lib/insurance/cash');
    expect(cash.getCash('cash_nope')).toBeNull();
  });

  test("cash.deleteCash('cash_nope') 不存在 id 不抛错且无副作用", () => {
    const cash = require('../../lib/insurance/cash');
    const before = cash.listCash();
    expect(() => cash.deleteCash('cash_nope')).not.toThrow();
    expect(cash.listCash()).toEqual(before);
  });

  test('cash.deleteCash(id) 删除指定资产行', () => {
    const cash = require('../../lib/insurance/cash');
    const a = cash.addCash({ type: '其他', balance: 999 });
    expect(cash.getCash(a.asset_id)).not.toBeNull();
    cash.deleteCash(a.asset_id);
    expect(cash.getCash(a.asset_id)).toBeNull();
  });
});
