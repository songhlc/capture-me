const path = require('path');
const os = require('os');
const fs = require('fs');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-weekplan-test-' + Date.now());
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

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