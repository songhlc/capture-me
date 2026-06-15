/**
 * db.js 单元测试 — Insurance Manager 模块表
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-db-insurance-test');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-insurance.db');

process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

describe('db.js - Insurance Manager 表结构', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEST_DB_DIR)) {
      fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    const db = require('../lib/db');
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

  test('initDb 创建 4 张 insurance 表', () => {
    const db = new Database(TEST_DB_PATH, { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((row) => row.name);
    db.close();

    expect(tables).toContain('family_members');
    expect(tables).toContain('insurance_policies');
    expect(tables).toContain('cash_assets');
    expect(tables).toContain('insurance_claims');
  });

  test('initDb 创建 9 个 insurance 索引', () => {
    const db = new Database(TEST_DB_PATH, { readonly: true });
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_policies_%' OR (type='index' AND name LIKE 'idx_claims_%') ORDER BY name"
    ).all().map((row) => row.name);
    db.close();

    const expected = [
      'idx_policies_member',
      'idx_policies_holder',
      'idx_policies_category',
      'idx_policies_renewal',
      'idx_policies_status',
      'idx_policies_channel',
      'idx_claims_policy',
      'idx_claims_date',
      'idx_claims_status',
    ];
    for (const name of expected) {
      expect(indexes).toContain(name);
    }
  });
});
