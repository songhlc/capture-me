/**
 * notify.test.js — 通知抽象层测试
 */

const { notify, detectChannel, _shellQuote } = require('../lib/notify');

describe('shellQuote', () => {
  test('quotes simple string', () => {
    expect(_shellQuote('hello world')).toBe("'hello world'");
  });
  test('escapes embedded single quote', () => {
    expect(_shellQuote("it's")).toBe("'it'\\''s'");
  });
});

describe('detectChannel', () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
  });

  test('env template has highest priority', () => {
    process.env.WEEKPLAN_NOTIFY_CMD = 'echo {msg}';
    const ch = detectChannel();
    expect(ch.kind).toBe('tpl');
    expect(ch.source).toBe('env');
  });

  test('OPENCLAW_NOTIFY_CMD also detected as tpl/env', () => {
    delete process.env.WEEKPLAN_NOTIFY_CMD;
    process.env.OPENCLAW_NOTIFY_CMD = 'openclaw msg {msg}';
    const ch = detectChannel();
    expect(ch.kind).toBe('tpl');
    expect(ch.source).toBe('env');
  });

  test('falls back to a known kind when no env', () => {
    delete process.env.WEEKPLAN_NOTIFY_CMD;
    delete process.env.OPENCLAW_NOTIFY_CMD;
    delete process.env.HERMES_NOTIFY_CMD;
    const ch = detectChannel();
    expect(['agent', 'terminal-notifier', 'osascript', 'stdout']).toContain(ch.kind);
  });
});

describe('notify (DRY_RUN)', () => {
  const origEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...origEnv, WEEKPLAN_DRY_RUN: '1' };
  });
  afterEach(() => {
    process.env = { ...origEnv };
  });

  test('dry-run never sends', () => {
    const r = notify('hello', { channel: { kind: 'tpl', tpl: 'false {msg}', source: 'env' } });
    expect(r.sent).toBe(false);
  });

  test('dry-run with stdout channel', () => {
    const r = notify('hi', { channel: { kind: 'stdout', source: 'fallback' } });
    expect(r.sent).toBe(false);
    expect(r.kind).toBe('stdout');
  });
});

describe('notify (stdout real send)', () => {
  test('stdout channel writes message', () => {
    const orig = process.stdout.write.bind(process.stdout);
    let captured = '';
    process.stdout.write = (s) => { captured += s; return true; };
    try {
      const r = notify('hi-test', { channel: { kind: 'stdout', source: 'fallback' }, title: 'T' });
      expect(r.sent).toBe(true);
      expect(captured).toContain('hi-test');
      expect(captured).toContain('[T]');
    } finally {
      process.stdout.write = orig;
    }
  });
});
