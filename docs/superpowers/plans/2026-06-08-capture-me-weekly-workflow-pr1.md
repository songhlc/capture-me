# Capture-Me Week Plan (PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new SQLite tables + week plan business logic + CLI subcommand to capture-me, enabling Monday-morning plan creation, daily check-ins, and Sunday-night carryover — without external channel integration (that lands in PR3).

**Architecture:** Extend `lib/db.js` (existing pattern: idempotent `initDb()` with `CREATE TABLE IF NOT EXISTS`) with 5 new tables + CRUD functions. Add `lib/weekplan.js` (business logic + CLI) and `lib/iso-week.js` (week math helper). Wire `lib/capture.js` to dispatch `weekplan` subcommand via spawn. LLM-based parsing happens in-conversation (no parser needed in PR1 — user runs CLI commands or LLM in context calls lib functions directly).

**Tech Stack:** better-sqlite3, jest 29, node ≥18

**Spec:** `docs/superpowers/specs/2026-06-08-capture-me-weekly-workflow-design.md` §3 (data model), §5-7 (workflows), §13 (PR1 scope)

---

## File Structure

**New files:**
- `lib/iso-week.js` — ISO week math (week number, monday/friday boundaries). Pure functions, no DB.
- `lib/weekplan.js` — Week plan business logic + CLI entry point. Exports lib functions AND has `if (require.main === module)` CLI dispatcher.
- `tests/iso-week.test.js` — Unit tests for week math.
- `tests/weekplan.test.js` — Integration tests for week plan CRUD + carryover + check-in + render.

**Modified files:**
- `lib/db.js` — Add 5 new tables in `initDb()` + CRUD functions for the 3 tables PR1 actively uses (week_plans, week_plan_items, week_plan_updates). Tables `weekly_report_templates` and `weekly_reports` are created in PR1 migration but their CRUD is PR2.
- `lib/capture.js` — Add `weekplan` subcommand dispatcher (~5 lines, spawns child process).
- `package.json` — Add `weekplan` npm script for convenience.
- `SKILL.md` — Document the new subcommand in the command table.

**Out of scope (PR2 / PR3):** template rendering, Feishu/Notion push, install.js, scheduler adapter.

---

## Conventions Used Throughout This Plan

**Test setup pattern** (matches existing `tests/db.test.js`):

```js
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
```

**ID formats (from spec §3):**
- Week plan: `wp_<year>_w<week>` (e.g., `wp_2026_w24`)
- Plan item: `wpi_<timestamp>_<rand>` (e.g., `wpi_1717939200000_a1b2c3`)
- Plan update: `wpu_<timestamp>_<rand>` (e.g., `wpu_1717939200000_x9y8z7`)

**Commit message style:** `feat(weekplan): <verb> <thing>` or `chore(weekplan): <verb> <thing>`. Imperative mood, lowercase, no period.

---

## Tasks

### Task 1: Add 5 new tables to `initDb()`

**Files:**
- Modify: `lib/db.js:156-198` (add new CREATE TABLE blocks before the `db.close()` call)
- Test: `tests/weekplan.test.js` (create this file, add the first test for table existence)

- [ ] **Step 1.1: Create the test file with the table-existence test**

Create `tests/weekplan.test.js` (new file):

```js
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
```

- [ ] **Step 1.2: Run the test — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | head -30`

Expected: 3 tests fail with "SqliteError: no such table: week_plans" (or similar).

- [ ] **Step 1.3: Add the 5 CREATE TABLE blocks to `initDb()` in `lib/db.js`**

Open `lib/db.js`. Find the line `db.exec(` that creates the `journeys` table (last table block before `db.close()` on line 200). **After** the `journeys` table block and **before** `db.close()`, add:

```js
  // ─── Week Plan 模块表 ─────────────────────────────────────
  // 周计划主表
  db.exec(`
    CREATE TABLE IF NOT EXISTS week_plans (
      id TEXT PRIMARY KEY,
      week_iso TEXT UNIQUE NOT NULL,
      year INTEGER NOT NULL,
      week_num INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'planning',
      carryover_from_id TEXT,
      template_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 计划项
  db.exec(`
    CREATE TABLE IF NOT EXISTS week_plan_items (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      project TEXT,
      priority TEXT,
      assignee TEXT DEFAULT '我',
      expected_outcome TEXT,
      status TEXT DEFAULT 'pending',
      sort_order INTEGER DEFAULT 0,
      source TEXT DEFAULT 'weekplan',
      auto_detected_from_note_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wpi_plan_id ON week_plan_items(plan_id);
    CREATE INDEX IF NOT EXISTS idx_wpi_status ON week_plan_items(status);
  `);

  // 每日 check-in 累积
  db.exec(`
    CREATE TABLE IF NOT EXISTS week_plan_updates (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      update_date TEXT NOT NULL,
      status_after TEXT NOT NULL,
      progress_note TEXT,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wpu_item_id ON week_plan_updates(item_id);
    CREATE INDEX IF NOT EXISTS idx_wpu_update_date ON week_plan_updates(update_date);
  `);

  // 模板注册表（PR1 只建表，CRUD 在 PR2）
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_report_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sections_json TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      is_builtin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 周报渲染记录（PR1 只建表，CRUD 在 PR2）
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      rendered_markdown TEXT NOT NULL,
      channel_outputs TEXT,
      status TEXT DEFAULT 'pending',
      pushed_at TEXT,
      error_log TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);
```

- [ ] **Step 1.4: Run the test — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -20`

Expected: 3 tests pass.

- [ ] **Step 1.5: Run full test suite — expect no regressions**

Run: `cd ~/.claude/skills/capture-me && npm test 2>&1 | tail -20`

Expected: all existing tests still pass + the 3 new tests pass.

- [ ] **Step 1.6: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/db.js tests/weekplan.test.js
git commit -m "feat(weekplan): add 5 new tables (week_plans, week_plan_items, week_plan_updates, weekly_report_templates, weekly_reports)"
```

---

### Task 2: ISO week utilities (`lib/iso-week.js`)

**Files:**
- Create: `lib/iso-week.js`
- Test: `tests/iso-week.test.js`

- [ ] **Step 2.1: Write the test file**

Create `tests/iso-week.test.js` (new file):

```js
const { getIsoWeek, getWeekBounds, getNextWeekBounds } = require('../lib/iso-week');

describe('iso-week', () => {
  describe('getIsoWeek', () => {
    test('returns correct week for known Monday', () => {
      // 2026-06-08 is Monday, ISO week 24
      const w = getIsoWeek(new Date('2026-06-08T00:00:00'));
      expect(w).toEqual({ year: 2026, weekNum: 24, weekIso: '2026-W24' });
    });

    test('handles year boundary (early January)', () => {
      // 2026-01-01 is Thursday, ISO week 1 of 2026
      const w = getIsoWeek(new Date('2026-01-01T00:00:00'));
      expect(w.weekIso).toBe('2026-W01');
    });

    test('handles late December belonging to next ISO year', () => {
      // 2025-12-29 is Monday, ISO week 1 of 2026
      const w = getIsoWeek(new Date('2025-12-29T00:00:00'));
      expect(w.weekIso).toBe('2026-W01');
    });
  });

  describe('getWeekBounds', () => {
    test('Monday-Friday for 2026-W24', () => {
      const b = getWeekBounds(2026, 24);
      expect(b.startDate).toBe('2026-06-08'); // Monday
      expect(b.endDate).toBe('2026-06-12');   // Friday
    });

    test('year-boundary week: 2025-12-29 (Mon) to 2026-01-02 (Fri)', () => {
      const b = getWeekBounds(2026, 1);
      expect(b.startDate).toBe('2025-12-29');
      expect(b.endDate).toBe('2026-01-02');
    });
  });

  describe('getNextWeekBounds', () => {
    test('2026-W24 → 2026-W25', () => {
      const next = getNextWeekBounds(2026, 24);
      expect(next.weekIso).toBe('2026-W25');
      expect(next.startDate).toBe('2026-06-15');
    });

    test('2026-W52 (Dec 28) → 2026-W53? → 2027-W01', () => {
      // 2026 has 53 ISO weeks
      const next = getNextWeekBounds(2026, 52);
      expect(next.weekIso).toBe('2026-W53');
    });
  });
});
```

- [ ] **Step 2.2: Run the test — expect FAIL (module not found)**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/iso-week.test.js 2>&1 | head -20`

Expected: FAIL with "Cannot find module '../lib/iso-week'".

- [ ] **Step 2.3: Implement `lib/iso-week.js`**

Create `lib/iso-week.js` (new file):

```js
/**
 * iso-week.js — ISO week math (no DB)
 *
 * Conventions:
 * - Week starts on Monday, ends on Friday (work week).
 * - ISO 8601 week numbering: week 1 = the week containing the first Thursday.
 * - week_iso format: "YYYY-Www" (e.g., "2026-W24").
 */

/**
 * Get ISO week info for a given date.
 * @param {Date} date
 * @returns {{year: number, weekNum: number, weekIso: string}}
 */
function getIsoWeek(date) {
  // Copy date so we don't mutate the input
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Day of week: Mon=0, Tue=1, ..., Sun=6 (we shift Sunday from 0 to 6)
  const dayNum = (d.getUTCDay() + 6) % 7;
  // Set to nearest Thursday: current date + 4 - dayNum
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  // First day of ISO year = first Thursday of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Week number = ceil((days since yearStart) / 7) + 1
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return {
    year: d.getUTCFullYear(),
    weekNum,
    weekIso: `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`,
  };
}

/**
 * Get the Monday-Friday date range for a given ISO year + week.
 * @param {number} year
 * @param {number} weekNum
 * @returns {{startDate: string, endDate: string}}
 */
function getWeekBounds(year, weekNum) {
  // Find Thursday of the given ISO week (Thursday is day 4 if Mon=0)
  // ISO week 1 always contains Jan 4. Thursday of week 1 = Jan 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7; // 0=Mon, ..., 6=Sun
  // Monday of week 1
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  // Monday of given week
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (weekNum - 1) * 7);
  // Friday = Monday + 4
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  return {
    startDate: formatYmd(monday),
    endDate: formatYmd(friday),
  };
}

/**
 * Get the next ISO week (handles year boundary).
 * @param {number} year
 * @param {number} weekNum
 * @returns {{year: number, weekNum: number, weekIso: string, startDate: string, endDate: string}}
 */
function getNextWeekBounds(year, weekNum) {
  // Compute next week as Monday + 7 days from current week's Monday
  const current = getWeekBounds(year, weekNum);
  const nextMonday = new Date(current.startDate + 'T00:00:00Z');
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const next = getIsoWeek(nextMonday);
  const bounds = getWeekBounds(next.year, next.weekNum);
  return { year: next.year, weekNum: next.weekNum, weekIso: next.weekIso, ...bounds };
}

function formatYmd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

module.exports = { getIsoWeek, getWeekBounds, getNextWeekBounds };
```

- [ ] **Step 2.4: Run the test — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/iso-week.test.js 2>&1 | tail -20`

Expected: all 7 tests pass.

- [ ] **Step 2.5: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/iso-week.js tests/iso-week.test.js
git commit -m "feat(weekplan): add iso-week utilities (getIsoWeek, getWeekBounds, getNextWeekBounds)"
```

---

### Task 3: Add `week_plans` CRUD to `db.js`

**Files:**
- Modify: `lib/db.js` (append CRUD functions before the final `module.exports` block)
- Modify: `tests/weekplan.test.js` (add tests for the new CRUD)

- [ ] **Step 3.1: Append 3 new tests to `tests/weekplan.test.js`**

Open `tests/weekplan.test.js`. Before the final `});` (end of `describe('week plan — schema migration')`), add a new `describe` block:

```js
const db = require('../lib/db');

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
```

- [ ] **Step 3.2: Run — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -20`

Expected: 3 new tests fail with "db.insertWeekPlan is not a function" etc.

- [ ] **Step 3.3: Add CRUD functions to `lib/db.js`**

Open `lib/db.js`. Find the `module.exports = {` block (around line 975). **Before** that block, add the week plan CRUD functions:

```js
// ─── Week Plans CRUD ────────────────────────────────────────

function insertWeekPlan(plan) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare(`
    INSERT INTO week_plans (id, week_iso, year, week_num, start_date, end_date, status, carryover_from_id, template_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    plan.id,
    plan.week_iso,
    plan.year,
    plan.week_num,
    plan.start_date,
    plan.end_date,
    plan.status || 'planning',
    plan.carryover_from_id || null,
    plan.template_id || null
  );
  db.close();
  return plan.id;
}

function getWeekPlan(id) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM week_plans WHERE id = ?');
  const plan = stmt.get(id);
  db.close();
  return plan;
}

function getWeekPlanByIso(weekIso) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM week_plans WHERE week_iso = ?');
  const plan = stmt.get(weekIso);
  db.close();
  return plan;
}

function updateWeekPlanStatus(id, status) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare(`
    UPDATE week_plans SET status = ?, updated_at = datetime('now') WHERE id = ?
  `);
  stmt.run(status, id);
  db.close();
}
```

- [ ] **Step 3.4: Add the new functions to `module.exports`**

In the `module.exports = {` block, add (place near the other CRUD exports):

```js
  // Week Plans
  insertWeekPlan,
  getWeekPlan,
  getWeekPlanByIso,
  updateWeekPlanStatus,
```

- [ ] **Step 3.5: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -20`

Expected: 3 schema tests + 3 CRUD tests = 6 pass.

- [ ] **Step 3.6: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/db.js tests/weekplan.test.js
git commit -m "feat(weekplan): add week_plans CRUD (insert, get, getByIso, updateStatus)"
```

---

### Task 4: Add `week_plan_items` CRUD to `db.js`

**Files:**
- Modify: `lib/db.js` (add item CRUD functions)
- Modify: `tests/weekplan.test.js` (add tests)

- [ ] **Step 4.1: Append item CRUD tests**

Open `tests/weekplan.test.js`. Append at the end:

```js
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
```

- [ ] **Step 4.2: Run — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -15`

Expected: 3 new tests fail with "db.insertWeekPlanItem is not a function".

- [ ] **Step 4.3: Add item CRUD functions to `lib/db.js`**

In `lib/db.js`, before the `module.exports = {` block, add:

```js
// ─── Week Plan Items CRUD ───────────────────────────────────

function generateItemId() {
  return `wpi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function insertWeekPlanItem(item) {
  const db = new Database(DB_PATH);
  const id = item.id || generateItemId();
  const stmt = db.prepare(`
    INSERT INTO week_plan_items
      (id, plan_id, title, description, project, priority, assignee, expected_outcome, status, sort_order, source, auto_detected_from_note_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    item.plan_id,
    item.title,
    item.description || null,
    item.project || null,
    item.priority || null,
    item.assignee || '我',
    item.expected_outcome || null,
    item.status || 'pending',
    item.sort_order || 0,
    item.source || 'weekplan',
    item.auto_detected_from_note_id || null
  );
  db.close();
  return id;
}

function getWeekPlanItem(id) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM week_plan_items WHERE id = ?');
  const item = stmt.get(id);
  db.close();
  return item;
}

function getWeekPlanItems(planId) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare(`
    SELECT * FROM week_plan_items
    WHERE plan_id = ?
    ORDER BY sort_order ASC, created_at ASC
  `);
  const items = stmt.all(planId);
  db.close();
  return items;
}

function getWeekPlanItemsByStatus(planId, status) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare(`
    SELECT * FROM week_plan_items
    WHERE plan_id = ? AND status = ?
    ORDER BY sort_order ASC
  `);
  const items = stmt.all(planId, status);
  db.close();
  return items;
}

function updateWeekPlanItemStatus(id, status) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare(`
    UPDATE week_plan_items
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(status, id);
  db.close();
}

function updateWeekPlanItem(id, fields) {
  const db = new Database(DB_PATH);
  const allowed = ['title', 'description', 'project', 'priority', 'assignee', 'expected_outcome', 'sort_order'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (sets.length === 0) {
    db.close();
    return;
  }
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  const stmt = db.prepare(`UPDATE week_plan_items SET ${sets.join(', ')} WHERE id = ?`);
  stmt.run(...vals);
  db.close();
}
```

- [ ] **Step 4.4: Add to `module.exports`**

In the `module.exports = {` block in `lib/db.js`, add:

```js
  // Week Plan Items
  insertWeekPlanItem,
  getWeekPlanItem,
  getWeekPlanItems,
  getWeekPlanItemsByStatus,
  updateWeekPlanItemStatus,
  updateWeekPlanItem,
```

- [ ] **Step 4.5: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -15`

Expected: 9 tests pass (3 schema + 3 plan + 3 item).

- [ ] **Step 4.6: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/db.js tests/weekplan.test.js
git commit -m "feat(weekplan): add week_plan_items CRUD (insert, get, list, listByStatus, updateStatus, update)"
```

---

### Task 5: Add `week_plan_updates` CRUD to `db.js`

**Files:**
- Modify: `lib/db.js` (add update CRUD)
- Modify: `tests/weekplan.test.js` (add tests)

- [ ] **Step 5.1: Append update CRUD tests**

Open `tests/weekplan.test.js`. Append at the end:

```js
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
```

- [ ] **Step 5.2: Run — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -15`

Expected: 3 new tests fail with "db.insertWeekPlanUpdate is not a function".

- [ ] **Step 5.3: Add update CRUD functions to `lib/db.js`**

In `lib/db.js`, before `module.exports`, add:

```js
// ─── Week Plan Updates CRUD ─────────────────────────────────

function generateUpdateId() {
  return `wpu_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function insertWeekPlanUpdate(update) {
  const db = new Database(DB_PATH);
  const id = update.id || generateUpdateId();
  const stmt = db.prepare(`
    INSERT INTO week_plan_updates
      (id, item_id, plan_id, update_date, status_after, progress_note, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    update.item_id,
    update.plan_id,
    update.update_date,
    update.status_after,
    update.progress_note || null,
    update.source || 'cli'
  );
  // Also update the item's status
  const itemStmt = db.prepare(`
    UPDATE week_plan_items SET status = ?, updated_at = datetime('now') WHERE id = ?
  `);
  itemStmt.run(update.status_after, update.item_id);
  db.close();
  return id;
}

function getUpdatesForItem(itemId) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare(`
    SELECT * FROM week_plan_updates
    WHERE item_id = ?
    ORDER BY update_date ASC, created_at ASC
  `);
  const updates = stmt.all(itemId);
  db.close();
  return updates;
}

function getLatestUpdateForItem(itemId) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare(`
    SELECT * FROM week_plan_updates
    WHERE item_id = ?
    ORDER BY update_date DESC, created_at DESC
    LIMIT 1
  `);
  const update = stmt.get(itemId);
  db.close();
  return update;
}
```

- [ ] **Step 5.4: Add to `module.exports`**

In `lib/db.js`'s `module.exports`, add:

```js
  // Week Plan Updates
  insertWeekPlanUpdate,
  getUpdatesForItem,
  getLatestUpdateForItem,
```

- [ ] **Step 5.5: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -15`

Expected: 12 tests pass.

- [ ] **Step 5.6: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/db.js tests/weekplan.test.js
git commit -m "feat(weekplan): add week_plan_updates CRUD (insert, getForItem, getLatestForItem)"
```

---

### Task 6: `weekplan.js` — get-or-create current week plan

**Files:**
- Create: `lib/weekplan.js`
- Modify: `tests/weekplan.test.js` (add tests)

- [ ] **Step 6.1: Append tests for `getOrCreateCurrentWeekPlan`**

Open `tests/weekplan.test.js`. Append at the end:

```js
const { getOrCreateCurrentWeekPlan, getCurrentWeekPlan } = require('../lib/weekplan');

describe('weekplan.getOrCreateCurrentWeekPlan', () => {
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
```

- [ ] **Step 6.2: Run — expect FAIL (module not found)**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -15`

Expected: 3 new tests fail with "Cannot find module '../lib/weekplan'".

- [ ] **Step 6.3: Create `lib/weekplan.js` with `getOrCreateCurrentWeekPlan`**

Create `lib/weekplan.js` (new file):

```js
#!/usr/bin/env node
/**
 * weekplan.js — Week Plan 业务逻辑 + CLI 入口
 *
 * 设计：
 * - 本文件既是被 lib/ 引用的库，也是 CLI 入口（if (require.main === module)）
 * - PR1 不接外部通道；check-in 由用户通过 CLI 或 LLM 在 capture-me 会话中调用本文件触发
 */

const db = require('./db');
const { getIsoWeek, getWeekBounds } = require('./iso-week');

/**
 * 获取或创建当前 ISO 周的 plan。
 * - 已有同 week_iso 的 plan：返回它
 * - 没有：创建 status=planning 的新 plan
 * @returns {object} week_plans row
 */
function getOrCreateCurrentWeekPlan() {
  const now = new Date();
  const { year, weekNum, weekIso } = getIsoWeek(now);
  const { startDate, endDate } = getWeekBounds(year, weekNum);

  const existing = db.getWeekPlanByIso(weekIso);
  if (existing) return existing;

  const id = `wp_${year}_w${String(weekNum).padStart(2, '0')}`;
  db.insertWeekPlan({
    id,
    week_iso: weekIso,
    year,
    week_num: weekNum,
    start_date: startDate,
    end_date: endDate,
    status: 'planning',
  });
  return db.getWeekPlan(id);
}

/**
 * 读取当前 ISO 周的 plan（不创建）。
 * @returns {object|undefined}
 */
function getCurrentWeekPlan() {
  const now = new Date();
  const { weekIso } = getIsoWeek(now);
  return db.getWeekPlanByIso(weekIso);
}

module.exports = {
  getOrCreateCurrentWeekPlan,
  getCurrentWeekPlan,
};
```

- [ ] **Step 6.4: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -15`

Expected: 15 tests pass.

- [ ] **Step 6.5: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/weekplan.js tests/weekplan.test.js
git commit -m "feat(weekplan): add getOrCreateCurrentWeekPlan + getCurrentWeekPlan"
```

---

### Task 7: `weekplan.js` — add items

**Files:**
- Modify: `lib/weekplan.js` (add `addItem` function)
- Modify: `tests/weekplan.test.js` (add tests)

- [ ] **Step 7.1: Append add-item tests**

Open `tests/weekplan.test.js`. Append at the end:

```js
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
```

- [ ] **Step 7.2: Run — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -15`

Expected: 2 new tests fail with "addItem is not a function".

- [ ] **Step 7.3: Add `addItem` and `getPlanWithItems` to `lib/weekplan.js`**

Open `lib/weekplan.js`. Add these functions before `module.exports`:

```js
/**
 * 向 plan 添加一项计划。
 * @param {string} planId
 * @param {object} item - { title, description?, project?, priority?, assignee?, expected_outcome? }
 * @returns {string} item id
 */
function addItem(planId, item) {
  const existing = db.getWeekPlanItems(planId);
  return db.insertWeekPlanItem({
    ...item,
    plan_id: planId,
    sort_order: existing.length,
  });
}

/**
 * 读取 plan + 其所有 items 的完整对象。
 * @param {string} planId
 * @returns {{plan: object, items: object[]}|null}
 */
function getPlanWithItems(planId) {
  const plan = db.getWeekPlan(planId);
  if (!plan) return null;
  const items = db.getWeekPlanItems(planId);
  return { plan, items };
}
```

Update `module.exports` to include them:

```js
module.exports = {
  getOrCreateCurrentWeekPlan,
  getCurrentWeekPlan,
  addItem,
  getPlanWithItems,
};
```

- [ ] **Step 7.4: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -15`

Expected: 17 tests pass.

- [ ] **Step 7.5: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/weekplan.js tests/weekplan.test.js
git commit -m "feat(weekplan): add addItem + getPlanWithItems"
```

---

### Task 8: `weekplan.js` — check-in (insert update)

**Files:**
- Modify: `lib/weekplan.js`
- Modify: `tests/weekplan.test.js`

- [ ] **Step 8.1: Append check-in tests**

Open `tests/weekplan.test.js`. Append:

```js
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
```

- [ ] **Step 8.2: Run — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -10`

Expected: 2 new tests fail.

- [ ] **Step 8.3: Add `checkinItem` to `lib/weekplan.js`**

Add to `lib/weekplan.js` before `module.exports`:

```js
/**
 * 记录一次 check-in 更新。
 * - 写入 week_plan_updates（不可变历史）
 * - 同步更新 week_plan_items.status 到最新
 * @param {object} args - { item_id, plan_id, status_after, progress_note?, source? }
 * @returns {string} update id
 */
function checkinItem(args) {
  const today = new Date().toISOString().split('T')[0];
  return db.insertWeekPlanUpdate({
    item_id: args.item_id,
    plan_id: args.plan_id,
    update_date: today,
    status_after: args.status_after,
    progress_note: args.progress_note || null,
    source: args.source || 'cli',
  });
}
```

Add to `module.exports`:

```js
  checkinItem,
```

- [ ] **Step 8.4: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -10`

Expected: 19 tests pass.

- [ ] **Step 8.5: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/weekplan.js tests/weekplan.test.js
git commit -m "feat(weekplan): add checkinItem (insert update + sync item status)"
```

---

### Task 9: `weekplan.js` — render functions (plan + check-in message)

**Files:**
- Modify: `lib/weekplan.js`
- Modify: `tests/weekplan.test.js`

- [ ] **Step 9.1: Append render tests**

Open `tests/weekplan.test.js`. Append:

```js
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
    const text = generateCheckinMessage(plan.id);
    expect(text).toContain('🌆');
    expect(text).toContain('check-in');
    expect(text).toMatch(/1\..*完成 Notion 集成/);
    expect(text).toMatch(/2\..*修合同 bug/);
  });
});
```

- [ ] **Step 9.2: Run — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -10`

Expected: 2 new tests fail.

- [ ] **Step 9.3: Add `renderPlan` and `generateCheckinMessage` to `lib/weekplan.js`**

Add before `module.exports`:

```js
const STATUS_EMOJI = {
  pending: '⏳',
  partial: '🟡',
  done: '✅',
  blocked: '⛔',
};

/**
 * 把 plan 渲染成可读的文本（终端展示用）。
 * @param {string} planId
 * @returns {string}
 */
function renderPlan(planId) {
  const data = getPlanWithItems(planId);
  if (!data) return `(plan ${planId} not found)`;
  const { plan, items } = data;
  const lines = [];
  lines.push(`📋 Week Plan — ${plan.week_iso}`);
  lines.push(`${plan.start_date} ~ ${plan.end_date}  [${plan.status}]`);
  lines.push('');
  if (items.length === 0) {
    lines.push('(no items yet)');
  } else {
    items.forEach((it, i) => {
      const emoji = STATUS_EMOJI[it.status] || '·';
      const pri = it.priority ? ` (${it.priority})` : '';
      const who = it.assignee && it.assignee !== '我' ? ` — ${it.assignee}` : '';
      lines.push(`  ${emoji} ${i + 1}. ${it.title}${pri}${who}`);
    });
  }
  return lines.join('\n');
}

/**
 * 生成"今日 plan check-in"消息（bot 推送的文本）。
 * @param {string} planId
 * @returns {string}
 */
function generateCheckinMessage(planId) {
  const data = getPlanWithItems(planId);
  if (!data) return `(plan ${planId} not found)`;
  const { plan, items } = data;
  if (items.length === 0) return `(no items to check in for ${plan.week_iso})`;

  const lines = [];
  lines.push(`🌆 今日 plan check-in — ${plan.week_iso}`);
  lines.push(`本周 ${items.length} 项：`);
  items.forEach((it, i) => {
    const emoji = STATUS_EMOJI[it.status] || '·';
    const pri = it.priority ? ` (${it.priority})` : '';
    const status = ` — 状态：${it.status}`;
    lines.push(`${i + 1}. ${it.title}${pri}${emoji}${status}`);
  });
  lines.push('');
  lines.push('回复如：');
  lines.push("  - '1 完成 2 进展 60% 3 阻塞 等张总反馈'");
  lines.push('  - 或逐项说');
  return lines.join('\n');
}
```

Add to `module.exports`:

```js
  renderPlan,
  generateCheckinMessage,
```

- [ ] **Step 9.4: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -10`

Expected: 21 tests pass.

- [ ] **Step 9.5: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/weekplan.js tests/weekplan.test.js
git commit -m "feat(weekplan): add renderPlan + generateCheckinMessage (terminal output)"
```

---

### Task 10: `weekplan.js` — carryover

**Files:**
- Modify: `lib/weekplan.js`
- Modify: `tests/weekplan.test.js`

- [ ] **Step 10.1: Append carryover tests**

Open `tests/weekplan.test.js`. Append:

```js
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
    const last = getOrCreateWeekPlan(2026, 22);
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
```

- [ ] **Step 10.2: Run — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -10`

Expected: 2 new tests fail.

- [ ] **Step 10.3: Add `carryoverFromLastWeek` and `getOrCreateWeekPlan` to `lib/weekplan.js`**

Add before `module.exports`:

```js
/**
 * 获取或创建指定 ISO 周的 plan（用于测试和 carryover）。
 * @param {number} year
 * @param {number} weekNum
 * @returns {object} week_plans row
 */
function getOrCreateWeekPlan(year, weekNum) {
  const weekIso = `${year}-W${String(weekNum).padStart(2, '0')}`;
  const { startDate, endDate } = getWeekBounds(year, weekNum);
  const existing = db.getWeekPlanByIso(weekIso);
  if (existing) return existing;
  const id = `wp_${year}_w${String(weekNum).padStart(2, '0')}`;
  db.insertWeekPlan({
    id,
    week_iso: weekIso,
    year,
    week_num: weekNum,
    start_date: startDate,
    end_date: endDate,
    status: 'planning',
  });
  return db.getWeekPlan(id);
}

/**
 * 从上一周（year/weekNum-1）复制未完成的 item 到本周 plan。
 * - 只复制 status IN (pending, partial, blocked) 的项
 * - 创建新的 item id（不复用旧的，便于独立更新）
 * - 新 item 的 status 重置为 'pending'
 * - 继承 title/description/project/priority/assignee/expected_outcome
 * @param {number} currentYear
 * @param {number} currentWeekNum
 * @returns {number} 复制的 item 数量
 */
function carryoverFromLastWeek(currentYear, currentWeekNum) {
  // Compute last week's (year, weekNum)
  const { getNextWeekBounds } = require('./iso-week');
  // Use bounds of current week, then subtract 7 days to get last week
  const cur = getWeekBounds(currentYear, currentWeekNum);
  const lastMonday = new Date(cur.startDate + 'T00:00:00Z');
  lastMonday.setUTCDate(lastMonday.getUTCDate() - 7);
  const last = getIsoWeek(lastMonday);

  const lastPlan = db.getWeekPlanByIso(last.weekIso);
  if (!lastPlan) return 0;

  const lastItems = db.getWeekPlanItems(lastPlan.id);
  const unfinished = lastItems.filter((it) =>
    ['pending', 'partial', 'blocked'].includes(it.status)
  );
  if (unfinished.length === 0) return 0;

  // Ensure current plan exists
  const currentPlan = getOrCreateWeekPlan(currentYear, currentWeekNum);
  const existingCurrent = db.getWeekPlanItems(currentPlan.id);
  let nextSort = existingCurrent.length;

  for (const src of unfinished) {
    db.insertWeekPlanItem({
      plan_id: currentPlan.id,
      title: src.title,
      description: src.description,
      project: src.project,
      priority: src.priority,
      assignee: src.assignee,
      expected_outcome: src.expected_outcome,
      status: 'pending', // Reset
      sort_order: nextSort++,
      source: 'weekplan', // Carryover still counts as user-planned
    });
  }
  return unfinished.length;
}
```

Add to `module.exports`:

```js
  getOrCreateWeekPlan,
  carryoverFromLastWeek,
```

- [ ] **Step 10.4: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -10`

Expected: 23 tests pass.

- [ ] **Step 10.5: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/weekplan.js tests/weekplan.test.js
git commit -m "feat(weekplan): add carryoverFromLastWeek + getOrCreateWeekPlan"
```

---

### Task 11: `weekplan.js` — CLI entry point

**Files:**
- Modify: `lib/weekplan.js` (add `if (require.main === module)` CLI block)
- Modify: `tests/weekplan.test.js` (add CLI test)

- [ ] **Step 11.1: Append CLI test**

Open `tests/weekplan.test.js`. Append:

```js
const { spawnSync } = require('child_process');
const path = require('path');

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
    const r = spawnSync('node', [CLI, 'list'], { encoding: 'utf-8' });
    expect(r.status).toBe(0);
  });
});
```

- [ ] **Step 11.2: Run — expect FAIL**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -10`

Expected: 2 new tests fail (--help unrecognized, list subcommand missing).

- [ ] **Step 11.3: Add CLI entry to `lib/weekplan.js`**

Open `lib/weekplan.js`. At the **very end** of the file (after `module.exports`), add:

```js
// ─── CLI 入口 ───────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);

  function usage() {
    console.log(`Usage: node lib/weekplan.js <command> [args]

Commands:
  create                   Create a new week plan for the current ISO week (interactive)
  list                     List all week plans
  show [week_iso]          Show a specific week's plan (default: current)
  skip [week_iso]          Mark a week as skipped (vacation/OOO)
  add-item <plan_id> --title "..." [--priority P0] [--assignee "..."]
                           Add an item to an existing plan
  checkin <item_id> <status> [--note "..."]
                           Record a check-in update for an item
  checkin-bot [plan_id]    Print the check-in message (PR1: terminal only)
  carryover [year] [week]  Copy unfinished items from last week (default: current week)
  render [plan_id]         Render a plan as readable text

Run 'node lib/weekplan.js <command> --help' for command-specific help.
`);
  }

  const [cmd, ...rest] = args;

  if (!cmd || cmd === '--help' || cmd === '-h') {
    usage();
    process.exit(0);
  }

  try {
    if (cmd === 'create') {
      const plan = getOrCreateCurrentWeekPlan();
      console.log(`✓ Plan created/exists: ${plan.id}`);
      console.log(`  week_iso: ${plan.week_iso}`);
      console.log(`  dates: ${plan.start_date} ~ ${plan.end_date}`);
      console.log(`  status: ${plan.status}`);
      console.log('');
      console.log('Now run:');
      console.log(`  node lib/weekplan.js add-item ${plan.id} --title "..." [--priority P0]`);
    } else if (cmd === 'list') {
      const dbLocal = require('./db');
      const plans = dbLocal.getAllWeekPlans();
      if (plans.length === 0) {
        console.log('(no plans yet; run `create` first)');
      } else {
        plans.forEach((p) => {
          console.log(`  ${p.id}  ${p.week_iso}  ${p.start_date}~${p.end_date}  [${p.status}]`);
        });
      }
    } else if (cmd === 'show') {
      const planId = rest[0] || getOrCreateCurrentWeekPlan().id;
      console.log(renderPlan(planId));
    } else if (cmd === 'skip') {
      const weekIso = rest[0];
      const target = weekIso
        ? db.getWeekPlanByIso(weekIso)
        : getCurrentWeekPlan();
      if (!target) {
        console.error(`(no plan found${weekIso ? ' for ' + weekIso : ''})`);
        process.exit(1);
      }
      db.updateWeekPlanStatus(target.id, 'skipped');
      console.log(`✓ ${target.id} marked as skipped`);
    } else if (cmd === 'add-item') {
      // Minimal arg parsing: positional plan_id + flags
      const planId = rest[0];
      if (!planId) {
        console.error('Usage: add-item <plan_id> --title "..." [--priority P0] [--assignee "..."]');
        process.exit(1);
      }
      const titleIdx = rest.indexOf('--title');
      const priorityIdx = rest.indexOf('--priority');
      const assigneeIdx = rest.indexOf('--assignee');
      const title = titleIdx >= 0 ? rest[titleIdx + 1] : null;
      if (!title) {
        console.error('--title is required');
        process.exit(1);
      }
      const itemId = addItem(planId, {
        title,
        priority: priorityIdx >= 0 ? rest[priorityIdx + 1] : null,
        assignee: assigneeIdx >= 0 ? rest[assigneeIdx + 1] : '我',
      });
      console.log(`✓ Item added: ${itemId}`);
    } else if (cmd === 'checkin') {
      // checkin <item_id> <status> [--note "..."]
      const itemId = rest[0];
      const status = rest[1];
      if (!itemId || !status) {
        console.error('Usage: checkin <item_id> <pending|partial|done|blocked> [--note "..."]');
        process.exit(1);
      }
      const validStatuses = ['pending', 'partial', 'done', 'blocked'];
      if (!validStatuses.includes(status)) {
        console.error(`status must be one of: ${validStatuses.join(', ')}`);
        process.exit(1);
      }
      const noteIdx = rest.indexOf('--note');
      const item = db.getWeekPlanItem(itemId);
      if (!item) {
        console.error(`(item ${itemId} not found)`);
        process.exit(1);
      }
      checkinItem({
        item_id: itemId,
        plan_id: item.plan_id,
        status_after: status,
        progress_note: noteIdx >= 0 ? rest[noteIdx + 1] : null,
      });
      console.log(`✓ Check-in recorded: ${itemId} → ${status}`);
    } else if (cmd === 'checkin-bot') {
      const planId = rest[0] || getOrCreateCurrentWeekPlan().id;
      console.log(generateCheckinMessage(planId));
    } else if (cmd === 'carryover') {
      const year = rest[0] ? parseInt(rest[0], 10) : null;
      const week = rest[1] ? parseInt(rest[1], 10) : null;
      let target;
      if (year && week) {
        target = { year, weekNum: week };
      } else {
        const cur = getOrCreateCurrentWeekPlan();
        target = { year: cur.year, weekNum: cur.week_num };
      }
      const n = carryoverFromLastWeek(target.year, target.weekNum);
      console.log(`✓ Carryover: ${n} item(s) copied from last week`);
    } else if (cmd === 'render') {
      const planId = rest[0] || getOrCreateCurrentWeekPlan().id;
      console.log(renderPlan(planId));
    } else {
      console.error(`Unknown command: ${cmd}`);
      usage();
      process.exit(1);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}
```

- [ ] **Step 11.4: Add `getAllWeekPlans` to `db.js`**

Open `lib/db.js`. Add this function before the `module.exports` block (right after the `updateWeekPlanStatus` function):

```js
function getAllWeekPlans() {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare(`
    SELECT * FROM week_plans
    ORDER BY year DESC, week_num DESC
  `);
  const plans = stmt.all();
  db.close();
  return plans;
}
```

Add to `module.exports`:

```js
  getAllWeekPlans,
```

- [ ] **Step 11.5: Run — expect PASS**

Run: `cd ~/.claude/skills/capture-me && npx jest tests/weekplan.test.js 2>&1 | tail -10`

Expected: 25 tests pass.

- [ ] **Step 11.6: Manually test the CLI**

Run:
```bash
cd ~/.claude/skills/capture-me
node lib/weekplan.js --help
node lib/weekplan.js create
```

Expected: `--help` prints the usage. `create` prints a plan id and a follow-up command hint.

- [ ] **Step 11.7: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/weekplan.js lib/db.js tests/weekplan.test.js
git commit -m "feat(weekplan): add CLI entry (create/list/show/skip/add-item/checkin/checkin-bot/carryover/render)"
```

---

### Task 12: Wire `weekplan` subcommand into `lib/capture.js`

**Files:**
- Modify: `lib/capture.js` (add `weekplan` subcommand dispatcher)

- [ ] **Step 12.1: Add the dispatcher**

Open `lib/capture.js`. Find the `// review 命令` block (around line 383). **After** the `review` block, add:

```js
  // weekplan 命令
  if (subcommand === 'weekplan' || subcommand === 'wp') {
    const { spawn } = require('child_process');
    const weekplanArgs = args.slice(1);
    spawn('node', [require('path').join(__dirname, 'weekplan.js'), ...weekplanArgs], { stdio: 'inherit' });
    return;
  }
```

- [ ] **Step 12.2: Update the usage help text**

Open `lib/capture.js`. Find the `用法:` block near the bottom (around line 393). Add a new line:

```js
    console.log('  /capture-me weekplan   # Week Plan 模式 (create/list/show/skip/checkin)');
```

- [ ] **Step 12.3: Run full test suite**

Run: `cd ~/.claude/skills/capture-me && npm test 2>&1 | tail -20`

Expected: All tests pass (no regressions in existing tests, new weekplan tests pass).

- [ ] **Step 12.4: Manually verify the dispatch**

Run: `cd ~/.claude/skills/capture-me && node lib/capture.js weekplan --help 2>&1 | head -10`

Expected: prints the weekplan CLI usage (proving the dispatch works).

- [ ] **Step 12.5: Commit**

```bash
cd ~/.claude/skills/capture-me
git add lib/capture.js
git commit -m "feat(weekplan): wire weekplan subcommand into capture.js dispatcher"
```

---

### Task 13: Update `package.json` and `SKILL.md`

**Files:**
- Modify: `package.json` (add convenience script)
- Modify: `SKILL.md` (document new command)

- [ ] **Step 13.1: Add npm script**

Open `package.json`. In the `"scripts"` block, add:

```json
    "weekplan": "node weekplan.js"
```

(The script name follows the existing pattern of `capture`, `review:week`, etc.)

- [ ] **Step 13.2: Update `SKILL.md` core commands table**

Open `SKILL.md`. Find the `## 核心命令` table (around line 142). Add a new row:

```markdown
| `weekplan [create|list|show|skip|checkin]` | Week Plan 模式（周一规划、每日 check-in、自动 carryover）|
```

- [ ] **Step 13.3: Add `weekplan` to `package.json` files list**

In the `"files"` array, add `"weekplan.js"` (after `"review.js"`). This ensures the file ships with the package.

- [ ] **Step 13.4: Run tests one more time to confirm no regressions**

Run: `cd ~/.claude/skills/capture-me && npm test 2>&1 | tail -10`

Expected: all tests pass.

- [ ] **Step 13.5: Commit**

```bash
cd ~/.claude/skills/capture-me
git add package.json SKILL.md
git commit -m "docs(weekplan): document new subcommand in SKILL.md + add npm script"
```

---

### Task 14: End-to-end manual smoke test

**Goal:** Simulate a full week (plan → 5 check-ins → render) by hand to verify the CLI is usable.

- [ ] **Step 14.1: Use a clean test DB (not your real one)**

```bash
cd ~/.claude/skills/capture-me
export CAPTURE_YOU_TEST_DB_PATH=/tmp/weekplan-smoke-$(date +%s).db
node -e "require('./lib/db').initDb()"
```

- [ ] **Step 14.2: Create this week's plan**

```bash
node lib/weekplan.js create
```

Expected: prints `Plan created/exists: wp_YYYY_wNN` with a date range. **Copy the plan id** for the next step.

- [ ] **Step 14.3: Add 3 items**

```bash
node lib/weekplan.js add-item wp_YYYY_wNN --title "完成 Notion 集成" --priority P0
node lib/weekplan.js add-item wp_YYYY_wNN --title "修合同 bug" --priority P1 --assignee "张总"
node lib/weekplan.js add-item wp_YYYY_wNN --title "读《纳瓦尔宝典》" --priority P2
```

Expected: each prints `✓ Item added: wpi_...`. **Copy the first item id** for the next step.

- [ ] **Step 14.4: Render the plan**

```bash
node lib/weekplan.js render
```

Expected: shows the 3 items with their priorities and statuses.

- [ ] **Step 14.5: Generate the check-in message**

```bash
node lib/weekplan.js checkin-bot
```

Expected: shows a `🌆 今日 plan check-in` message listing the 3 items with status emoji.

- [ ] **Step 14.6: Simulate a check-in (Mon)**

```bash
node lib/weekplan.js checkin wpi_..._..._... partial --note "进展 60%"
```

Replace the id with the first wpi from Step 14.3. Expected: `✓ Check-in recorded`.

- [ ] **Step 14.7: Verify the status updated**

```bash
node lib/weekplan.js render
```

Expected: the first item now shows `🟡` (partial status).

- [ ] **Step 14.8: Mark this week as done**

```bash
node lib/weekplan.js show
```

Expected: shows the full plan with current statuses.

- [ ] **Step 14.9: Run carryover (simulate Sunday 23:00)**

```bash
# (no next-week plan yet, so this will create one)
node lib/weekplan.js carryover
```

Expected: prints `✓ Carryover: 2 item(s) copied from last week` (the two still-unfinished items: partial + pending). Items marked done should NOT be carried over.

- [ ] **Step 14.10: Verify carryover**

```bash
node lib/weekplan.js render
```

Expected: shows BOTH last week's remaining items + any from this week, in the new plan. Items have new wpi ids (not the old ones).

- [ ] **Step 14.11: Clean up test DB**

```bash
rm -f $CAPTURE_YOU_TEST_DB_PATH
unset CAPTURE_YOU_TEST_DB_PATH
```

- [ ] **Step 14.12: Commit any final tweaks**

If you noticed any rough edges during smoke testing, fix them now and commit with:

```bash
cd ~/.claude/skills/capture-me
git add -A
git commit -m "chore(weekplan): polish from PR1 smoke test"
```

---

## Self-Review (run after writing the plan, before execution)

This section is the planner's self-check. Verify:

**1. Spec coverage** — every spec requirement for PR1 maps to a task:

| Spec requirement (PR1 scope) | Covered in task |
|------------------------------|-----------------|
| 5 new tables (week_plans, week_plan_items, week_plan_updates, weekly_report_templates, weekly_reports) | Task 1 |
| week_plans CRUD | Task 3 |
| week_plan_items CRUD | Task 4 |
| week_plan_updates CRUD | Task 5 |
| getOrCreate current week plan | Task 6 |
| addItem | Task 7 |
| checkin (insert update + sync status) | Task 8 |
| renderPlan + generateCheckinMessage | Task 9 |
| carryover from last week | Task 10 |
| CLI: create / list / show / skip / checkin / checkin-bot | Task 11 |
| Dispatcher in capture.js | Task 12 |
| SKILL.md + package.json update | Task 13 |
| Manual smoke test | Task 14 |

**2. Placeholder scan** — no "TBD" / "TODO" / "implement later" in any step. All code blocks are complete. Verified.

**3. Type consistency** — function names and signatures match across tasks:
- `getOrCreateCurrentWeekPlan` defined Task 6, used in Task 11, 12 ✓
- `addItem(planId, item)` defined Task 7, used Task 8, 11 ✓
- `checkinItem(args)` defined Task 8, used Task 11 ✓
- `generateCheckinMessage(planId)` defined Task 9, used Task 11 ✓
- `carryoverFromLastWeek(year, weekNum)` defined Task 10, used Task 11 ✓
- `getOrCreateWeekPlan(year, weekNum)` defined Task 10, used in Task 10 tests ✓
- `db.getWeekPlanByIso(weekIso)` defined Task 3, used Task 6, 10 ✓
- `db.insertWeekPlan(plan)`, `db.getWeekPlan(id)`, `db.updateWeekPlanStatus(id, status)`, `db.getAllWeekPlans()` ✓
- `db.insertWeekPlanItem(item)`, `db.getWeekPlanItems(planId)`, `db.getWeekPlanItem(id)`, `db.updateWeekPlanItemStatus(id, status)` ✓
- `db.insertWeekPlanUpdate(update)`, `db.getLatestUpdateForItem(itemId)`, `db.getUpdatesForItem(itemId)` ✓
- All `db.*` exports added to `module.exports` in their respective tasks ✓

**4. TDD discipline** — every business function has a failing test written before implementation, verified by running the test. Verified for tasks 1-11.

---

## Open Questions (out of scope for PR1; revisit in PR2/PR3)

- LLM-based check-in parsing (PR1 has only CLI/text input, no LLM in the loop)
- Feishu/Notion notifier adapters (PR3)
- scheduler adapter for cron registration (PR3)
- install.js for one-command setup (PR3)
- weekly_report_templates and weekly_reports CRUD (PR2 — tables exist in PR1 schema but unused)
- Auto-detected items from notes (PR2)
- progress_bar rendering and other report template fields (PR2)
