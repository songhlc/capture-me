/**
 * tests/insurance/report.test.js — 终端 + Markdown 渲染
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

const TEST_REPORTS_DIR = path.join(os.tmpdir(), 'capture-me-ins-reports-' + process.pid);
process.env.CAPTURE_ME_INSURANCE_REPORTS_DIR = TEST_REPORTS_DIR;

const report = require('../../lib/insurance/report');

const BASE_DATA = {
  generatedAt: '2026-06-15T10:00:00.000Z',
  A_assets: {
    policyCount: 5,
    memberCount: 3,
    annualPremiumTotal: 36000,
    cashTotal: 80000,
    personalPensionTotal: 12000,
    cashCoverageMonths: 6,
  },
  B_coverage: {
    life: { count: 2, totalInsured: 1000000, status: 'covered' },
    health: { count: 1, totalInsured: 200000, status: 'covered' },
    accident: { count: 1, totalInsured: 500000, status: 'covered' },
    critical_illness: { count: 0, totalInsured: 0, status: 'missing' },
    annuity: { count: 1, totalInsured: 300000, status: 'covered' },
    pension: { count: 0, totalInsured: 0, status: 'missing' },
  },
  C_suggested: {
    data_sufficient: true,
    life: { rule10: 500000, matrix: 1500000, final: 1500000 },
    critical_illness: { rule10: 360000, matrix: 800000, final: 800000 },
    accident: { rule10: 180000, matrix: 300000, final: 300000 },
  },
  D_gaps: [
    { type: 'ci_gap', label: '重疾差额', amount: 500000 },
    { type: 'category_missing', category: 'pension', label: 'pension 类保单缺失' },
  ],
  E_claims: {
    total: 2,
    paid: 2,
    rejected: 0,
    pending: 0,
  },
  F_personalization: { notes: [], hook: 'agent_personalize' },
  disclaimer: '--- 免责声明：本报告由 capture-me 自动生成，仅供规划参考，不构成投保建议 ---',
};

function deepMerge(target, source) {
  if (source == null || typeof source !== 'object') return target;
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const k of Object.keys(source)) {
    const sv = source[k];
    const tv = out[k];
    if (sv != null && typeof sv === 'object' && !Array.isArray(sv)
        && tv != null && typeof tv === 'object' && !Array.isArray(tv)) {
      out[k] = deepMerge(tv, sv);
    } else {
      out[k] = sv;
    }
  }
  return out;
}

function makeBaseData(overrides = {}) {
  return deepMerge(JSON.parse(JSON.stringify(BASE_DATA)), overrides);
}

describe('lib/insurance/report.js — terminal + markdown renderer', () => {
  beforeAll(() => {
    if (fs.existsSync(TEST_REPORTS_DIR)) {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_REPORTS_DIR)) {
      fs.rmSync(TEST_REPORTS_DIR, { recursive: true, force: true });
    }
  });

  test('renderTerminal returns string containing all 6 section titles + 免责声明', () => {
    const data = makeBaseData();
    const out = report.renderTerminal(data);
    expect(typeof out).toBe('string');
    expect(out).toContain('【A. 资产概览】');
    expect(out).toContain('【B. 险种覆盖】');
    expect(out).toContain('【C. 保额建议】');
    expect(out).toContain('【D. 缺口清单】');
    expect(out).toContain('【E. 理赔回顾】');
    expect(out).toContain('【F. AI 个性化建议');
    expect(out).toContain('免责声明');
  });

  test('writeMarkdown writes a .md file under REPORTS_DIR with title + disclaimer', () => {
    const data = makeBaseData();
    const file = report.writeMarkdown(data);
    expect(typeof file).toBe('string');
    expect(file.endsWith('-体检.md')).toBe(true);
    expect(file.startsWith(TEST_REPORTS_DIR)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toContain('# 家庭保险体检报告');
    expect(content).toContain('免责声明');
  });

  test('renderTerminal empty D_gaps → "✓ 无显著缺口"', () => {
    const data = makeBaseData({ D_gaps: [] });
    const out = report.renderTerminal(data);
    expect(out).toMatch(/✓ 无显著缺口/);
  });

  test('renderTerminal data_sufficient=false → "⚠️ 数据不足"', () => {
    const data = makeBaseData({ C_suggested: { data_sufficient: false } });
    const out = report.renderTerminal(data);
    expect(out).toMatch(/⚠️ 数据不足/);
  });

  test('writeMarkdown empty D_gaps → "✓ 无显著缺口"', () => {
    const data = makeBaseData({ D_gaps: [] });
    const file = report.writeMarkdown(data);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toMatch(/✓ 无显著缺口/);
  });

  test('writeMarkdown data_sufficient=false → "⚠️ 数据不足"', () => {
    const data = makeBaseData({ C_suggested: { data_sufficient: false } });
    const file = report.writeMarkdown(data);
    const content = fs.readFileSync(file, 'utf8');
    expect(content).toMatch(/⚠️ 数据不足/);
  });
});
