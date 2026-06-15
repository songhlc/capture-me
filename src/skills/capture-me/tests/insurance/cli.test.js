/**
 * tests/insurance/cli.test.js — bin/insurance CLI 入口测试
 *
 * 用 child_process.execFileSync 跑真实子进程，验证 CLI 子命令。
 * 测试隔离：CAPTURE_YOU_TEST_DB_PATH 指向临时 sqlite，
 *           CAPTURE_ME_INSURANCE_REPORTS_DIR 指向临时目录，
 *           WEEKPLAN_DRY_RUN=1 防止 reminder 真发通知。
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-ins-cli-' + process.pid);
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
const TEST_REPORTS_DIR = path.join(os.tmpdir(), 'capture-me-ins-cli-reports-' + process.pid);

process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;
process.env.CAPTURE_ME_INSURANCE_REPORTS_DIR = TEST_REPORTS_DIR;
process.env.WEEKPLAN_DRY_RUN = '1';

const CLI = path.join(__dirname, '..', '..', 'lib', 'insurance', 'cli.js');

beforeAll(() => {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  fs.mkdirSync(TEST_REPORTS_DIR, { recursive: true });
  require('../../lib/db').initDb();
});

afterAll(() => {
  fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
});

describe('bin/insurance — CLI entry', () => {
  test('--help prints usage', () => {
    const r = execFileSync('node', [CLI, '--help'], { encoding: 'utf-8', env: process.env });
    expect(r).toContain('Usage:');
    expect(r).toContain('add-policy');
    expect(r).toContain('report');
    expect(r).toContain('renewals');
  });

  test('add-policy --json records a policy and prints summary', () => {
    const policyJson = JSON.stringify({
      category: 'health',
      insurer: '平安',
      product_name: '平安e生保',
      policy_number: 'PH001',
      sum_insured: 2000000,
      annual_premium: 800,
      payment_method: '年缴',
      payment_period: '1年',
      start_date: '2026-06-01',
      policy_holder: { name: '我', relation: 'self' },
      insured: { name: '我', relation: 'self' },
      beneficiaries: [],
      sales_channel: 'online',
      sales_contact: { name: '李销售', phone: '13800001111' },
      guaranteed_renewable: true,
      raw_text: '平安e生保 200万保额 年缴800',
    });
    const r = execFileSync('node', [CLI, 'add-policy', '--json', policyJson], {
      encoding: 'utf-8',
      env: process.env,
    });
    expect(r).toContain('保单已录入');
    expect(r).toContain('平安e生保');
    expect(r).toContain('health');
    expect(r).toContain('¥2,000,000');
    expect(r).toContain('¥800');
    expect(r).toContain('李销售');
  });

  test('report --income N --expense N prints full report', () => {
    const r = execFileSync(
      'node',
      [CLI, 'report', '--income', '500000', '--expense', '200000'],
      { encoding: 'utf-8', env: process.env }
    );
    expect(r).toContain('A. 资产概览');
    expect(r).toContain('免责声明');
  });
});
