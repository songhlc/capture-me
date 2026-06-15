/**
 * tests/insurance/db-family.test.js — family_members CRUD
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-ins-family-' + process.pid);
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-family.db');

process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

describe('lib/insurance/db.js — family_members CRUD', () => {
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

  test('upsertMember({name, relation}) 返回 member_id 并新建一行', () => {
    const insDb = require('../../lib/insurance/db');
    const m = insDb.upsertMember({ name: '老婆', relation: 'spouse' });
    expect(m.member_id).toMatch(/^mem_/);
    expect(m.name).toBe('老婆');
    expect(m.relation).toBe('spouse');
  });

  test('upsertMember 在 (name, relation) 已存在时复用同一 member_id（幂等）', () => {
    const insDb = require('../../lib/insurance/db');
    const first = insDb.upsertMember({ name: '儿子', relation: 'child' });
    const second = insDb.upsertMember({ name: '儿子', relation: 'child', birth_year: 2018 });
    expect(second.member_id).toBe(first.member_id);
    expect(second.birth_year).toBe(2018);
  });

  test('appendHealthDisclosure 把新 conditions 合并进已有 JSON', () => {
    const insDb = require('../../lib/insurance/db');
    const m = insDb.upsertMember({ name: '我', relation: 'self' });
    insDb.appendHealthDisclosure(m.member_id, { conditions: ['高血压'] });
    const updated = insDb.appendHealthDisclosure(m.member_id, { conditions: ['糖尿病'] });
    expect(updated.health_disclosure.conditions).toEqual(expect.arrayContaining(['高血压', '糖尿病']));
  });

  test('listMembers 返回所有家庭成员', () => {
    const insDb = require('../../lib/insurance/db');
    const list = insDb.listMembers();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.every(m => m.member_id)).toBe(true);
  });

  test('upsertMember 复用时保留 risk_profile 和 health_disclosure（与 birth_year 一致）', () => {
    const insDb = require('../../lib/insurance/db');
    const first = insDb.upsertMember({
      name: '岳父', relation: 'parent',
      birth_year: 1960,
      risk_profile: { smoker: false, occupation: 'retired' },
      health_disclosure: { conditions: ['高血压'], notes: '长期服药' }
    });
    const second = insDb.upsertMember({ name: '岳父', relation: 'parent' });
    expect(second.member_id).toBe(first.member_id);
    expect(second.birth_year).toBe(1960);
    expect(second.risk_profile).toEqual({ smoker: false, occupation: 'retired' });
    expect(second.health_disclosure).toEqual({ conditions: ['高血压'], notes: '长期服药' });
  });

  test('appendHealthDisclosure 对不存在的 memberId 抛错', () => {
    const insDb = require('../../lib/insurance/db');
    expect(() => insDb.appendHealthDisclosure('mem_nonexistent_xxx', { conditions: ['foo'] }))
      .toThrow(/not found/);
  });

  test('appendHealthDisclosure 传入 conditions: [] 是 no-op', () => {
    const insDb = require('../../lib/insurance/db');
    const m = insDb.upsertMember({ name: '岳母', relation: 'parent' });
    const after = insDb.appendHealthDisclosure(m.member_id, { conditions: [] });
    expect(after.health_disclosure).toBeDefined();
  });
});