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

describe('week_plan_updates CRUD', () => {
  const sampleUpdate = {
    id: 'wpu_test_001',
    item_id: 'wpi_test_001',
    plan_id: 'wp_2026_w24',
    update_date: '2026-06-09',
    status_after: 'partial',
    progress_note: '进展 60%',
    source: 'cli',
  };

  test('insertWeekPlanUpdate returns the id', () => {
    const id = db.insertWeekPlanUpdate(sampleUpdate);
    expect(id).toBe('wpu_test_001');
  });

  test('getLatestUpdateForItem returns the most recent', () => {
    db.insertWeekPlanUpdate({
      id: 'wpu_test_002',
      item_id: 'wpi_test_001',
      plan_id: 'wp_2026_w24',
      update_date: '2026-06-10',
      status_after: 'done',
      progress_note: '完成',
      source: 'cli',
    });
    const latest = db.getLatestUpdateForItem('wpi_test_001');
    expect(latest.status_after).toBe('done');
    expect(latest.update_date).toBe('2026-06-10');
  });

  test('getUpdatesForItem returns full history (chronological)', () => {
    const updates = db.getUpdatesForItem('wpi_test_001');
    expect(updates.length).toBe(2);
    expect(updates[0].update_date).toBe('2026-06-09');
    expect(updates[1].update_date).toBe('2026-06-10');
  });
});

const { getOrCreateCurrentWeekPlan, getCurrentWeekPlan } = require('../lib/weekplan');

describe('weekplan.getOrCreateCurrentWeekPlan', () => {
  // Clean up any plan for the current ISO week that was created by earlier
  // describes in this file, so test 1 (which asserts the just-created plan's
  // initial status) starts from a fresh state.
  beforeAll(() => {
    const { getIsoWeek } = require('../lib/iso-week');
    const { weekIso } = getIsoWeek(new Date());
    const existing = db.getWeekPlanByIso(weekIso);
    if (existing) {
      const Database = require('better-sqlite3');
      const conn = new Database(process.env.CAPTURE_YOU_TEST_DB_PATH);
      conn.prepare('DELETE FROM week_plan_updates WHERE plan_id = ?').run(existing.id);
      conn.prepare('DELETE FROM week_plan_items WHERE plan_id = ?').run(existing.id);
      conn.prepare('DELETE FROM week_plans WHERE id = ?').run(existing.id);
      conn.close();
    }
  });

  test('creates a plan for the current ISO week if none exists', () => {
    const plan = getOrCreateCurrentWeekPlan();
    expect(plan).toBeDefined();
    expect(plan.week_iso).toMatch(/^\d{4}-W\d{2}$/);
    expect(plan.status).toBe('planning');
  });

  test('returns existing plan on second call (idempotent)', () => {
    const p1 = getOrCreateCurrentWeekPlan();
    const p2 = getOrCreateCurrentWeekPlan();
    expect(p2.id).toBe(p1.id);
  });

  test('plan dates are Mon-Fri of the ISO week', () => {
    const p = getOrCreateCurrentWeekPlan();
    const start = new Date(p.start_date + 'T00:00:00');
    const end = new Date(p.end_date + 'T00:00:00');
    // 0=Sun, 1=Mon, ..., 6=Sat
    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(5);   // Friday
  });
});

const { addItem, getPlanWithItems } = require('../lib/weekplan');

describe('weekplan.addItem', () => {
  test('adds a new item to a plan', () => {
    const plan = getOrCreateCurrentWeekPlan();
    const itemId = addItem(plan.id, {
      title: '测试 item',
      priority: 'P1',
      assignee: '我',
    });
    expect(itemId).toMatch(/^wpi_/);
  });

  test('appends items to the same plan', () => {
    const plan = getOrCreateCurrentWeekPlan();
    addItem(plan.id, { title: 'item 2' });
    addItem(plan.id, { title: 'item 3' });
    const full = getPlanWithItems(plan.id);
    expect(full.items.length).toBeGreaterThanOrEqual(3);
  });
});

const { checkinItem } = require('../lib/weekplan');

describe('weekplan.checkinItem', () => {
  test('inserts an update and updates item status', () => {
    const plan = getOrCreateCurrentWeekPlan();
    const itemId = addItem(plan.id, { title: 'checkin test item' });
    checkinItem({
      item_id: itemId,
      plan_id: plan.id,
      status_after: 'partial',
      progress_note: '进展 50%',
    });
    const item = db.getWeekPlanItem(itemId);
    expect(item.status).toBe('partial');
    const latest = db.getLatestUpdateForItem(itemId);
    expect(latest.progress_note).toBe('进展 50%');
  });

  test('progress_note is optional', () => {
    const plan = getOrCreateCurrentWeekPlan();
    const itemId = addItem(plan.id, { title: 'note-less checkin' });
    checkinItem({
      item_id: itemId,
      plan_id: plan.id,
      status_after: 'done',
    });
    const latest = db.getLatestUpdateForItem(itemId);
    expect(latest.status_after).toBe('done');
  });
});

const { renderPlan, generateCheckinMessage } = require('../lib/weekplan');

describe('weekplan.renderPlan', () => {
  test('renders plan header + items as readable text', () => {
    const plan = getOrCreateCurrentWeekPlan();
    // Clear items first
    for (const it of db.getWeekPlanItems(plan.id)) {
      db.updateWeekPlanItemStatus(it.id, 'pending');
    }
    addItem(plan.id, { title: '完成 Notion 集成', priority: 'P0' });
    addItem(plan.id, { title: '修合同 bug', priority: 'P1', assignee: '张总' });

    const text = renderPlan(plan.id);
    expect(text).toContain('📋 Week Plan');
    expect(text).toContain(plan.week_iso);
    expect(text).toContain('完成 Notion 集成');
    expect(text).toContain('修合同 bug');
    expect(text).toContain('P0');
  });
});

describe('weekplan.generateCheckinMessage', () => {
  test('produces a check-in prompt with all items', () => {
    const plan = getOrCreateCurrentWeekPlan();
    // Wipe leftover items from earlier tests so the numbered list is deterministic.
    // (db has no deleteWeekPlanItem; use direct SQL, same pattern as the
    // getOrCreateCurrentWeekPlan beforeAll.)
    const Database = require('better-sqlite3');
    const conn = new Database(process.env.CAPTURE_YOU_TEST_DB_PATH);
    conn.prepare('DELETE FROM week_plan_updates WHERE plan_id = ?').run(plan.id);
    conn.prepare('DELETE FROM week_plan_items WHERE plan_id = ?').run(plan.id);
    conn.close();
    addItem(plan.id, { title: '完成 Notion 集成', priority: 'P0' });
    addItem(plan.id, { title: '修合同 bug', priority: 'P1', assignee: '张总' });

    const text = generateCheckinMessage(plan.id);
    expect(text).toContain('🌆');
    expect(text).toContain('check-in');
    expect(text).toMatch(/1\..*完成 Notion 集成/);
    expect(text).toMatch(/2\..*修合同 bug/);
  });
});

const { carryoverFromLastWeek, getOrCreateWeekPlan } = require('../lib/weekplan');

describe('weekplan.carryoverFromLastWeek', () => {
  test('copies unfinished items from last week to a new plan', () => {
    // Create last week's plan
    const last = getOrCreateWeekPlan(2026, 23);
    addItem(last.id, { title: '未完成项 1', priority: 'P0' });
    addItem(last.id, { title: '已完成项', priority: 'P1' });
    // Mark one as done, one stays pending
    const items = db.getWeekPlanItems(last.id);
    db.updateWeekPlanItemStatus(items[1].id, 'done');

    // Create this week's plan
    const current = getOrCreateWeekPlan(2026, 24);
    const beforeCount = db.getWeekPlanItems(current.id).length;

    const copied = carryoverFromLastWeek(2026, 24);
    expect(copied).toBe(1); // Only the pending one

    const currentItems = db.getWeekPlanItems(current.id);
    expect(currentItems.length).toBe(beforeCount + 1);
    const copiedItem = currentItems.find((it) => it.title === '未完成项 1');
    expect(copiedItem).toBeDefined();
    expect(copiedItem.status).toBe('pending'); // Reset to pending
    expect(copiedItem.priority).toBe('P0');
  });

  test('creates new item ids (does not reuse old ones)', () => {
    const last = getOrCreateWeekPlan(2026, 23);
    addItem(last.id, { title: 'old item' });
    const oldItem = db.getWeekPlanItems(last.id)[0];

    getOrCreateWeekPlan(2026, 24); // ensure current exists
    carryoverFromLastWeek(2026, 24);

    const currentItems = db.getWeekPlanItems(`wp_2026_w24`);
    const copied = currentItems.find((it) => it.title === 'old item');
    expect(copied.id).not.toBe(oldItem.id);
    expect(copied.id).toMatch(/^wpi_/);
  });
});

const { spawnSync } = require('child_process');

describe('weekplan CLI', () => {
  const CLI = path.join(__dirname, '..', 'lib', 'weekplan.js');

  test('--help prints usage', () => {
    const r = spawnSync('node', [CLI, '--help'], { encoding: 'utf-8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stdout).toContain('create');
    expect(r.stdout).toContain('list');
    expect(r.stdout).toContain('show');
    expect(r.stdout).toContain('skip');
    expect(r.stdout).toContain('checkin-bot');
    expect(r.stdout).toContain('carryover');
  });

  test('list command runs without error', () => {
    // Note: jest's testEnvironment does not pass env vars to child processes
    // by default, so we explicitly forward process.env to spawnSync. This lets
    // the child CLI see CAPTURE_YOU_TEST_DB_PATH and read the test DB.
    const r = spawnSync('node', [CLI, 'list'], { encoding: 'utf-8', env: process.env });
    expect(r.status).toBe(0);
  });
});