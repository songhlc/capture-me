/**
 * lib/insurance/analyzer.js — 体检报告装配（6 sections A-F）
 *
 * 输入：ctx { annualIncome, annualExpense, mortgageBalance, occupation,
 *           hasGuaranteedRenewable, hasStableJob } 从对话采集
 */
const insDb = require('./db');
const cash = require('./cash');
const claims = require('./claims');
const gapRules = require('./gap-rules');

const DISCLAIMER_FOOTER = `---
📌 免责声明：本报告由 capture-me 保险管家自动生成，
仅供家庭资产规划参考，**不构成任何投保/退保/理赔建议**。
实际决策建议咨询持牌保险经纪人或代理人。
---`;

function buildHealthCheck(ctx) {
  const policies = insDb.listPolicies({ status: 'active' });
  const allMembers = insDb.listMembers();
  const cashSummary = cash.summarizeByType();
  const recentClaims = claims.recentClaims(365);
  const totalAnnualPremium = policies.reduce((s, p) => s + (Number(p.annual_premium) || 0), 0);

  // A. 资产概览
  const A_assets = {
    annualPremiumTotal: totalAnnualPremium,
    cashTotal: cash.totalCash(),
    personalPensionTotal: cashSummary['personal_pension'] || 0,
    cashByType: cashSummary,
    policyCount: policies.length,
    memberCount: allMembers.length,
    monthlyExpense: ctx.annualExpense ? ctx.annualExpense / 12 : null,
    cashCoverageMonths: ctx.annualExpense && cash.totalCash() > 0
      ? (cash.totalCash() / (ctx.annualExpense / 12)).toFixed(1) : null,
  };

  // B. 险种覆盖
  const allCategories = ['life', 'health', 'accident', 'critical_illness', 'annuity', 'pension'];
  const B_coverage = {};
  for (const cat of allCategories) {
    const matched = policies.filter(p => String(p.category).split('+').includes(cat) && p.status === 'active');
    B_coverage[cat] = {
      count: matched.length,
      totalInsured: matched.reduce((s, p) => s + (Number(p.sum_insured) || 0), 0),
      status: matched.length > 0 ? 'covered' : 'missing',
    };
  }

  // C. 保额建议
  const gap = gapRules.computeGap(ctx, policies, cash.totalCash());
  const C_suggested = {
    data_sufficient: gapRules.isDataSufficient(ctx),
    life: { rule10: gap.life.rule10, matrix: gap.life.matrix, final: gap.life.finalSuggested },
    critical_illness: { rule10: gap.critical_illness.rule10, matrix: gap.critical_illness.matrix, final: gap.critical_illness.finalSuggested },
    accident: { rule10: gap.accident.rule10, matrix: gap.accident.matrix, final: gap.accident.finalSuggested },
    medical: { covered: gap.medical.covered, existing_guaranteed: gap.medical.existing },
    emergencyFund: gap.emergencyFund.matrix,
  };

  // D. 缺口清单
  const D_gaps = [];
  if (gap.life.gap > 0) D_gaps.push({ type: 'life_gap', label: '寿险差额', amount: gap.life.gap });
  if (gap.critical_illness.gap > 0) D_gaps.push({ type: 'ci_gap', label: '重疾差额', amount: gap.critical_illness.gap });
  if (gap.accident.gap > 0) D_gaps.push({ type: 'accident_gap', label: '意外险差额', amount: gap.accident.gap });
  if (!gap.medical.covered) D_gaps.push({ type: 'medical_gap', label: '百万医疗险缺失或非保证续保' });
  if (gap.emergencyFund.gap > 0) D_gaps.push({ type: 'emergency_fund_gap', label: '应急金不足', amount: gap.emergencyFund.gap });
  for (const cat of allCategories) {
    if (B_coverage[cat].status === 'missing') {
      D_gaps.push({ type: 'category_missing', category: cat, label: `${cat} 类保单缺失` });
    }
  }
  for (const p of policies) {
    if (p.sales_channel === 'agent' && !p.sales_contact) {
      D_gaps.push({ type: 'orphan_policy', policy_id: p.policy_id,
        product_name: p.product_name, label: `孤儿单：${p.product_name} 无销售联系方式` });
    }
  }
  const rejectedCount = recentClaims.filter(c => c.status === 'rejected').length;
  if (rejectedCount > 0) {
    D_gaps.push({ type: 'claim_rejection',
      label: `⚠️ 最近 1 年有 ${rejectedCount} 笔拒赔，建议核对合同健康告知条款`, count: rejectedCount });
  }

  // E. 理赔回顾
  const E_claims = {
    total: recentClaims.length,
    paid: recentClaims.filter(c => c.status === 'paid').length,
    rejected: rejectedCount,
    pending: recentClaims.filter(c => ['submitted', 'under_review', 'approved'].includes(c.status)).length,
    items: recentClaims.slice(0, 10),
  };

  // F. LLM 个性化层（v1 stub）
  const F_personalization = { notes: [], hook: 'agent_personalize' };
  if (ctx.mortgageBalance > 0) F_personalization.notes.push('有房贷：寿险建议覆盖房贷余额（已在矩阵中体现）');
  if (cashSummary['personal_pension'] > 0) {
    F_personalization.notes.push('个人养老金账户已开通：年缴上限 12,000 元，可享税优');
  }

  return {
    generatedAt: new Date().toISOString(),
    A_assets, B_coverage, C_suggested, D_gaps, E_claims, F_personalization,
    disclaimer: DISCLAIMER_FOOTER,
  };
}

module.exports = { buildHealthCheck, DISCLAIMER_FOOTER };
