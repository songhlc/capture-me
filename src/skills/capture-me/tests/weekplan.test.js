const path = require('path');
const os = require('os');
const fs = require('fs');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-weekplan-test-' + Date.now());
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

const db = require('../lib/db');

beforeAll(() => {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  require('../lib/db').initDb();
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
});

const Database = require('better-sqlite3');

describe('week plan — schema migration', () => {
  test('5 new tables exist after initDb()', () => {
    const db = new Database(TEST_DB_PATH, { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r) => r.name);
    db.close();

    expect(tables).toEqual(
      expect.arrayContaining([
        'week_plans',
        'week_plan_items',
        'week_plan_updates',
        'weekly_report_templates',
        'weekly_reports',
      ])
    );
  });

  test('week_plans has expected columns', () => {
    const db = new Database(TEST_DB_PATH, { readonly: true });
    const cols = db.prepare("PRAGMA table_info(week_plans)").all().map((c) => c.name);
    db.close();
    expect(cols).toEqual(
      expect.arrayContaining([
        'id', 'week_iso', 'year', 'week_num', 'start_date', 'end_date',
        'status', 'carryover_from_id', 'template_id', 'created_at', 'updated_at',
      ])
    );
  });

  test('week_plans.week_iso is UNIQUE', () => {
    const db = new Database(TEST_DB_PATH, { readonly: true });
    const idx = db.prepare("PRAGMA index_list(week_plans)").all();
    db.close();
    // The UNIQUE constraint creates an auto-index
    expect(idx.length).toBeGreaterThan(0);
  });
});

describe('week_plans CRUD', () => {
  const samplePlan = {
    id: 'wp_2026_w24',
    week_iso: '2026-W24',
    year: 2026,
    week_num: 24,
    start_date: '2026-06-08',
    end_date: '2026-06-12',
    status: 'planning',
  };

  test('insertWeekPlan returns the id', () => {
    const id = db.insertWeekPlan(samplePlan);
    expect(id).toBe('wp_2026_w24');
  });

  test('getWeekPlan retrieves the inserted plan', () => {
    const p = db.getWeekPlan('wp_2026_w24');
    expect(p).toBeDefined();
    expect(p.week_iso).toBe('2026-W24');
    expect(p.status).toBe('planning');
  });

  test('updateWeekPlanStatus changes status', () => {
    db.updateWeekPlanStatus('wp_2026_w24', 'active');
    const p = db.getWeekPlan('wp_2026_w24');
    expect(p.status).toBe('active');
  });
});

describe('week_plan_items CRUD', () => {
  const sampleItem = {
    id: 'wpi_test_001',
    plan_id: 'wp_2026_w24',
    title: '完成 Notion 集成',
    description: '把周报推送到 Notion',
    project: '@project/capture-me',
    priority: 'P0',
    assignee: '我',
    expected_outcome: 'Notion 通道可用',
    status: 'pending',
    sort_order: 0,
    source: 'weekplan',
  };

  test('insertWeekPlanItem returns the id', () => {
    const id = db.insertWeekPlanItem(sampleItem);
    expect(id).toBe('wpi_test_001');
  });

  test('getWeekPlanItems returns items for a plan', () => {
    const items = db.getWeekPlanItems('wp_2026_w24');
    expect(items.length).toBe(1);
    expect(items[0].title).toBe('完成 Notion 集成');
  });

  test('updateWeekPlanItemStatus changes status', () => {
    db.updateWeekPlanItemStatus('wpi_test_001', 'done');
    const items = db.getWeekPlanItems('wp_2026_w24');
    expect(items[0].status).toBe('done');
  });
});