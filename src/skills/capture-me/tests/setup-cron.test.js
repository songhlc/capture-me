/**
 * setup-cron.test.js — launchd 注册逻辑测试（不真调 launchctl）
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('setup-cron (DRY_RUN)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'weekplan-setupcron-'));
  const origEnv = { ...process.env };
  let setupCron;

  beforeAll(() => {
    process.env.SETUP_CRON_DRY_RUN = '1';
    process.env.SETUP_CRON_PLIST_DIR = tmpDir;
    // 必须重新 require 以让模块读到 env
    jest.resetModules();
    setupCron = require('../lib/setup-cron');
  });

  afterAll(() => {
    process.env = { ...origEnv };
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('check() returns missing before install', () => {
    const r = setupCron.check();
    expect(r.ok).toBe(false);
    expect(r.missing.length).toBe(4);
    expect(r.present.length).toBe(0);
  });

  test('install() writes 4 plists (3 weekplan + 1 insurance-reminder)', () => {
    const results = setupCron.install();
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.every((r) => r.dryRun)).toBe(true);

    const files = fs.readdirSync(tmpDir).sort();
    expect(files).toHaveLength(4);
    expect(files.every((f) => f.endsWith('.plist'))).toBe(true);
  });

  test('plist content has Label + ProgramArguments + StartCalendarInterval', () => {
    const files = fs.readdirSync(tmpDir);
    for (const f of files) {
      const xml = fs.readFileSync(path.join(tmpDir, f), 'utf8');
      expect(xml).toMatch(/<key>Label<\/key>/);
      expect(xml).toMatch(/<key>ProgramArguments<\/key>/);
      expect(xml).toMatch(/<key>StartCalendarInterval<\/key>/);
      expect(xml).toMatch(/<key>Hour<\/key>/);
    }
  });

  test('check() returns ok after install', () => {
    const r = setupCron.check();
    expect(r.ok).toBe(true);
    expect(r.missing).toHaveLength(0);
    expect(r.present).toHaveLength(4);
  });

  test('insurance-reminder plist uses 5 Weekday entries (Mon-Fri 09:00)', () => {
    const insTask = setupCron.TASKS.find((t) => t.label.endsWith('insurance-reminder'));
    expect(insTask).toBeDefined();
    const xml = fs.readFileSync(setupCron._pathOf(insTask), 'utf8');
    const weekdayMatches = xml.match(/<key>Weekday<\/key>/g) || [];
    expect(weekdayMatches.length).toBe(5);
    expect(xml).toMatch(/<key>Hour<\/key>\s*<integer>9<\/integer>/);
  });

  test('monday plist uses Weekday=1 Hour=9', () => {
    const mondayTask = setupCron.TASKS.find((t) => t.label.endsWith('monday-create'));
    const xml = fs.readFileSync(setupCron._pathOf(mondayTask), 'utf8');
    expect(xml).toMatch(/<key>Weekday<\/key>\s*<integer>1<\/integer>/);
    expect(xml).toMatch(/<key>Hour<\/key>\s*<integer>9<\/integer>/);
  });

  test('daily plist uses 5 Weekday entries (Mon-Fri 18:00)', () => {
    const dailyTask = setupCron.TASKS.find((t) => t.label.endsWith('daily-checkin'));
    const xml = fs.readFileSync(setupCron._pathOf(dailyTask), 'utf8');
    const weekdayMatches = xml.match(/<key>Weekday<\/key>/g) || [];
    expect(weekdayMatches.length).toBe(5);
    expect(xml).toMatch(/<key>Hour<\/key>\s*<integer>18<\/integer>/);
  });

  test('friday plist uses Weekday=5 Hour=17 Minute=30', () => {
    const fridayTask = setupCron.TASKS.find((t) => t.label.endsWith('friday-report'));
    const xml = fs.readFileSync(setupCron._pathOf(fridayTask), 'utf8');
    expect(xml).toMatch(/<key>Weekday<\/key>\s*<integer>5<\/integer>/);
    expect(xml).toMatch(/<key>Hour<\/key>\s*<integer>17<\/integer>/);
    expect(xml).toMatch(/<key>Minute<\/key>\s*<integer>30<\/integer>/);
  });

  test('uninstall() removes all plists', () => {
    const results = setupCron.uninstall();
    expect(results.every((r) => r.removed)).toBe(true);
    expect(fs.readdirSync(tmpDir)).toHaveLength(0);
  });
});
