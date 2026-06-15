/**
 * lib/insurance/gap-rules.js — 缺口分析
 * 两套规则并行：双十法则 + 家庭风险矩阵；finalSuggested = max
 */
const HAZARD_OCCUPATIONS = ['construction', 'mining', 'driver_long_haul', 'electrician', 'pilot'];

function sumInsuredFor(policies, categoryKey) {
  return policies
    .filter(p => String(p.category).split('+').includes(categoryKey))
    .reduce((s, p) => s + (Number(p.sum_insured) || 0), 0);
}

// ─── 双十法则 ──────────────────────────────────────────────
function suggestLifeRule10(ctx) {
  // max() is structurally identical to suggestLifeMatrix today; keep the form
  // so the two-formula parallel in computeGap has symmetric shape to read.
  const { annualIncome = 0, mortgageBalance = 0 } = ctx;
  return Math.max(annualIncome * 10, annualIncome * 10 + mortgageBalance);
}
function suggestCriticalIllnessRule10(ctx) {
  // 1.2x represents the 3-5 year recovery period; the max() with the 1.0x base
  // is kept for symmetry with suggestCriticalIllnessMatrix.
  const { annualExpense = 0 } = ctx;
  return Math.max(annualExpense * 5, annualExpense * 5 * 1.2);
}
function suggestAccidentRule10(ctx) {
  return (ctx.annualIncome || 0) * 10;
}

// ─── 家庭风险矩阵 ──────────────────────────────────────────
function suggestLifeMatrix(ctx) { return suggestLifeRule10(ctx); }
function suggestCriticalIllnessMatrix(ctx) { return suggestCriticalIllnessRule10(ctx); }
function suggestAccidentMatrix(ctx) {
  const base = (ctx.annualIncome || 0) * 10;
  return base * (HAZARD_OCCUPATIONS.includes(ctx.occupation) ? 1.5 : 1);
}
function suggestMedicalMatrix(ctx) {
  return ctx.hasGuaranteedRenewable ? 'covered' : 'partial';
}
function suggestEmergencyFund(ctx) {
  const monthsRange = ctx.hasStableJob ? [6, 12] : [9, 12];
  const monthlyExpense = (ctx.annualExpense || 0) / 12;
  return { min: monthlyExpense * monthsRange[0], max: monthlyExpense * monthsRange[1], months: monthsRange };
}

// ─── 合并两套规则 ──────────────────────────────────────────
function computeGap(ctx, policies, cashTotal) {
  const life = { rule10: suggestLifeRule10(ctx), matrix: suggestLifeMatrix(ctx),
    existing: sumInsuredFor(policies, 'life') };
  life.finalSuggested = Math.max(life.rule10, life.matrix);
  life.gap = Math.max(0, life.finalSuggested - life.existing);

  const ci = { rule10: suggestCriticalIllnessRule10(ctx), matrix: suggestCriticalIllnessMatrix(ctx),
    existing: sumInsuredFor(policies, 'critical_illness') };
  ci.finalSuggested = Math.max(ci.rule10, ci.matrix);
  ci.gap = Math.max(0, ci.finalSuggested - ci.existing);

  const acc = { rule10: suggestAccidentRule10(ctx), matrix: suggestAccidentMatrix(ctx),
    existing: sumInsuredFor(policies, 'accident') };
  acc.finalSuggested = Math.max(acc.rule10, acc.matrix);
  acc.gap = Math.max(0, acc.finalSuggested - acc.existing);

  const med = { matrix: suggestMedicalMatrix(ctx),
    existing: policies.some(p => String(p.category).split('+').includes('health')
      && p.guaranteed_renewable && p.status === 'active') };
  med.covered = med.matrix === 'covered' && med.existing;

  const ef = { matrix: suggestEmergencyFund(ctx), existing: cashTotal || 0 };
  ef.gap = Math.max(0, ef.matrix.min - ef.existing);

  return { life, critical_illness: ci, accident: acc, medical: med, emergencyFund: ef };
}

function isDataSufficient(ctx) {
  return typeof ctx.annualIncome === 'number' && ctx.annualIncome > 0
    && typeof ctx.annualExpense === 'number' && ctx.annualExpense > 0;
}

module.exports = {
  suggestLifeRule10, suggestCriticalIllnessRule10, suggestAccidentRule10,
  suggestLifeMatrix, suggestCriticalIllnessMatrix, suggestAccidentMatrix,
  suggestMedicalMatrix, suggestEmergencyFund,
  computeGap, isDataSufficient, HAZARD_OCCUPATIONS, sumInsuredFor,
};
