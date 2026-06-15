/**
 * lib/insurance/report.js — 体检报告渲染
 * renderTerminal(data)   → 终端彩色输出
 * writeMarkdown(data)    → 落盘 memory/insurance-reports/YYYY-MM-DD-体检.md
 */
const fs = require('fs');
const path = require('path');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = process.env.CAPTURE_ME_INSURANCE_REPORTS_DIR
  || path.join(SKILL_DIR, 'memory', 'insurance-reports');

const B_LABELS = {
  life: '寿险',
  health: '医疗',
  accident: '意外',
  critical_illness: '重疾',
  annuity: '年金',
  pension: '养老',
};

function fmtMoney(n) {
  if (n == null) return '—';
  return Number(n).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function renderTerminal(data) {
  const L = [];
  L.push('━'.repeat(60));
  L.push('🏠 家庭保险体检报告');
  L.push(`   生成于 ${data.generatedAt}`);
  L.push('━'.repeat(60));
  L.push('');

  L.push('【A. 资产概览】');
  L.push(`  · 在生效保单：${data.A_assets.policyCount} 张 / 家庭成员：${data.A_assets.memberCount} 人`);
  L.push(`  · 年总保费：¥${fmtMoney(data.A_assets.annualPremiumTotal)}`);
  L.push(`  · 现金/应急资产：¥${fmtMoney(data.A_assets.cashTotal)}`);
  if (data.A_assets.personalPensionTotal > 0) {
    L.push(`  · 个人养老金账户：¥${fmtMoney(data.A_assets.personalPensionTotal)}（税优）`);
  }
  if (data.A_assets.cashCoverageMonths) {
    L.push(`  · 应急金覆盖：${data.A_assets.cashCoverageMonths} 个月支出`);
  } else {
    L.push('  · ⚠️ 应急金未录入或年支出未知');
  }
  L.push('');

  L.push('【B. 险种覆盖】');
  for (const [cat, v] of Object.entries(data.B_coverage)) {
    const tag = v.status === 'covered' ? '✓' : '✗';
    L.push(`  ${tag} ${(B_LABELS[cat] || cat).padEnd(8)} ${v.count} 张 / ¥${fmtMoney(v.totalInsured)}`);
  }
  L.push('');

  L.push('【C. 保额建议】');
  if (!data.C_suggested.data_sufficient) {
    L.push('  ⚠️ 数据不足：需补年收入 / 年支出 / 房贷余额');
  } else {
    L.push(`  · 寿险：双十 ${fmtMoney(data.C_suggested.life.rule10)} / 矩阵 ${fmtMoney(data.C_suggested.life.matrix)} → 取大 ${fmtMoney(data.C_suggested.life.final)}`);
    L.push(`  · 重疾：双十 ${fmtMoney(data.C_suggested.critical_illness.rule10)} / 矩阵 ${fmtMoney(data.C_suggested.critical_illness.matrix)} → 取大 ${fmtMoney(data.C_suggested.critical_illness.final)}`);
    L.push(`  · 意外：双十 ${fmtMoney(data.C_suggested.accident.rule10)} / 矩阵 ${fmtMoney(data.C_suggested.accident.matrix)} → 取大 ${fmtMoney(data.C_suggested.accident.final)}`);
  }
  L.push('');

  L.push('【D. 缺口清单】');
  if (data.D_gaps.length === 0) L.push('  ✓ 无显著缺口');
  else for (const g of data.D_gaps) {
    const amount = g.amount ? ` ¥${fmtMoney(g.amount)}` : '';
    L.push(`  · ${g.label}${amount}`);
  }
  L.push('');

  L.push('【E. 理赔回顾】 最近 1 年');
  L.push(`  · 总数：${data.E_claims.total} / 已支付：${data.E_claims.paid} / 拒赔：${data.E_claims.rejected} / 处理中：${data.E_claims.pending}`);
  if (data.E_claims.rejected > 0) L.push('  ⚠️ 存在拒赔记录，建议核对合同健康告知条款');
  L.push('');

  L.push('【F. AI 个性化建议（agent 待补）】');
  if (data.F_personalization.notes.length === 0) {
    L.push('  · （无可自动生成项；agent 可在对话中补全）');
  } else {
    for (const n of data.F_personalization.notes) L.push(`  · ${n}`);
  }
  L.push('');

  L.push(data.disclaimer);
  return L.join('\n');
}

function writeMarkdown(data) {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const file = path.join(REPORTS_DIR, `${today}-体检.md`);

  const md = [];
  md.push(`# 家庭保险体检报告\n\n> 生成于 ${data.generatedAt}\n`);
  md.push(`## A. 资产概览\n`);
  md.push(`- 在生效保单：${data.A_assets.policyCount} 张 / 家庭成员：${data.A_assets.memberCount} 人`);
  md.push(`- 年总保费：¥${fmtMoney(data.A_assets.annualPremiumTotal)}`);
  md.push(`- 现金/应急资产：¥${fmtMoney(data.A_assets.cashTotal)}`);
  if (data.A_assets.personalPensionTotal > 0) {
    md.push(`- **个人养老金账户**：¥${fmtMoney(data.A_assets.personalPensionTotal)}（税优）`);
  }
  if (data.A_assets.cashCoverageMonths) md.push(`- 应急金覆盖：${data.A_assets.cashCoverageMonths} 个月支出`);
  md.push('');

  md.push(`## B. 险种覆盖\n`);
  md.push(`| 险种 | 状态 | 张数 | 总保额 |\n|------|------|------|--------|`);
  for (const [cat, v] of Object.entries(data.B_coverage)) {
    const tag = v.status === 'covered' ? '✓ 已覆盖' : '✗ 缺失';
    md.push(`| ${B_LABELS[cat] || cat} | ${tag} | ${v.count} | ¥${fmtMoney(v.totalInsured)} |`);
  }
  md.push('');

  md.push(`## C. 保额建议（双十 + 家庭风险矩阵并行）\n`);
  if (!data.C_suggested.data_sufficient) {
    md.push(`⚠️ 数据不足：需补年收入 / 年支出 / 房贷余额`);
  } else {
    md.push(`| 险种 | 双十法则 | 家庭风险矩阵 | 取大 |\n|------|----------|--------------|------|`);
    md.push(`| 寿险 | ¥${fmtMoney(data.C_suggested.life.rule10)} | ¥${fmtMoney(data.C_suggested.life.matrix)} | **¥${fmtMoney(data.C_suggested.life.final)}** |`);
    md.push(`| 重疾 | ¥${fmtMoney(data.C_suggested.critical_illness.rule10)} | ¥${fmtMoney(data.C_suggested.critical_illness.matrix)} | **¥${fmtMoney(data.C_suggested.critical_illness.final)}** |`);
    md.push(`| 意外 | ¥${fmtMoney(data.C_suggested.accident.rule10)} | ¥${fmtMoney(data.C_suggested.accident.matrix)} | **¥${fmtMoney(data.C_suggested.accident.final)}** |`);
  }
  md.push('');

  md.push(`## D. 缺口清单\n`);
  if (data.D_gaps.length === 0) md.push(`✓ 无显著缺口`);
  else for (const g of data.D_gaps) {
    const amount = g.amount ? ` ¥${fmtMoney(g.amount)}` : '';
    md.push(`- ${g.label}${amount}`);
  }
  md.push('');

  md.push(`## E. 理赔回顾（最近 1 年）\n`);
  md.push(`- 总数：${data.E_claims.total}`);
  md.push(`- 已支付：${data.E_claims.paid} / 拒赔：${data.E_claims.rejected} / 处理中：${data.E_claims.pending}`);
  if (data.E_claims.rejected > 0) md.push(`\n⚠️ **存在拒赔记录，建议核对合同健康告知条款**`);
  md.push('');

  md.push(`## F. AI 个性化建议\n`);
  if (data.F_personalization.notes.length === 0) md.push(`（agent 可在对话中补充）`);
  else for (const n of data.F_personalization.notes) md.push(`- ${n}`);
  md.push('');

  md.push(data.disclaimer);
  md.push('');

  fs.writeFileSync(file, md.join('\n'), 'utf8');
  return file;
}

module.exports = { renderTerminal, writeMarkdown, REPORTS_DIR };