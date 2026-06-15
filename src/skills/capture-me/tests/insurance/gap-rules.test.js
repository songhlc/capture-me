const rules = require('../../lib/insurance/gap-rules');

describe('双十法则 (rule of 10/5)', () => {
  test('寿险 = max(收入 × 10, 收入 × 10 + 房贷)', () => {
    expect(rules.suggestLifeRule10({ annualIncome: 500000, mortgageBalance: 1000000 }))
      .toBe(6000000);
  });
  test('重疾 = max(年支出 × 5, 年支出 × 5 × 1.2)', () => {
    expect(rules.suggestCriticalIllnessRule10({ annualExpense: 200000 })).toBe(1200000);
  });
  test('意外 = 收入 × 10', () => {
    expect(rules.suggestAccidentRule10({ annualIncome: 500000 })).toBe(5000000);
  });
});

describe('家庭风险矩阵 (family matrix)', () => {
  test('高风险职业意外险 1.5x', () => {
    const office = rules.suggestAccidentMatrix({ annualIncome: 500000, occupation: 'office' });
    const hazard = rules.suggestAccidentMatrix({ annualIncome: 500000, occupation: 'construction' });
    expect(hazard).toBe(office * 1.5);
  });
  test('医疗险 = covered | partial', () => {
    expect(rules.suggestMedicalMatrix({ hasGuaranteedRenewable: true })).toBe('covered');
    expect(rules.suggestMedicalMatrix({ hasGuaranteedRenewable: false })).toBe('partial');
  });
  test('应急金 6-12 个月', () => {
    const r = rules.suggestEmergencyFund({ annualExpense: 200000, hasStableJob: true });
    expect(r.months).toEqual([6, 12]);
    expect(r.min).toBe(100000);
  });
});

describe('computeGap (合并两套 + 现有保单)', () => {
  test('返回 5 维度，finalSuggested = max(rule10, matrix)', () => {
    const ctx = { annualIncome: 500000, annualExpense: 200000,
      mortgageBalance: 1000000, occupation: 'office',
      hasGuaranteedRenewable: true, hasStableJob: true };
    const existing = [
      { category: 'life', sum_insured: 3000000 },
      { category: 'critical_illness', sum_insured: 500000 },
    ];
    const gap = rules.computeGap(ctx, existing, 100000);
    expect(gap.life.existing).toBe(3000000);
    expect(gap.life.finalSuggested).toBe(6000000);
    expect(gap.life.gap).toBe(3000000);
    expect(gap.critical_illness.gap).toBe(700000);
    expect(gap).toHaveProperty('accident.gap');
    expect(gap).toHaveProperty('medical.covered');
    expect(gap).toHaveProperty('emergencyFund.gap');
  });
});

describe('computeGap edge cases', () => {
  test('policies=[] → existing=0 for all dimensions', () => {
    const ctx = { annualIncome: 500000, annualExpense: 200000,
      mortgageBalance: 0, occupation: 'office',
      hasGuaranteedRenewable: false, hasStableJob: true };
    const gap = rules.computeGap(ctx, [], 0);
    expect(gap.life.existing).toBe(0);
    expect(gap.critical_illness.existing).toBe(0);
    expect(gap.accident.existing).toBe(0);
    expect(gap.life.gap).toBe(gap.life.finalSuggested);
  });

  test('existing > finalSuggested → gap = 0 (clamped)', () => {
    const ctx = { annualIncome: 100000, annualExpense: 50000,
      hasGuaranteedRenewable: true, hasStableJob: true };
    const existing = [{ category: 'life', sum_insured: 10000000 }];
    const gap = rules.computeGap(ctx, existing, 0);
    expect(gap.life.gap).toBe(0);
  });

  test('medical.covered=false when no policies exist', () => {
    const ctx = { annualIncome: 500000, annualExpense: 200000,
      hasGuaranteedRenewable: true, hasStableJob: true };
    const gap = rules.computeGap(ctx, [], 0);
    expect(gap.medical.covered).toBe(false);
  });

  test('emergency fund: hasStableJob=false → 9-12 months', () => {
    const r = rules.suggestEmergencyFund({ annualExpense: 120000, hasStableJob: false });
    expect(r.months).toEqual([9, 12]);
    expect(r.min).toBe(90000);
  });
});

describe('suggestAccidentMatrix non-hazard occupations', () => {
  test('occupation not in HAZARD_OCCUPATIONS → 1x (no 1.5x multiplier)', () => {
    const office = rules.suggestAccidentMatrix({ annualIncome: 500000, occupation: 'office' });
    const teacher = rules.suggestAccidentMatrix({ annualIncome: 500000, occupation: 'teacher' });
    expect(office).toBe(5000000);
    expect(teacher).toBe(5000000);
  });
});

describe('isDataSufficient', () => {
  test('缺年收入/支出时 false', () => {
    expect(rules.isDataSufficient({ annualExpense: 100000 })).toBe(false);
    expect(rules.isDataSufficient({ annualIncome: 500000 })).toBe(false);
  });
  test('两者都有时 true', () => {
    expect(rules.isDataSufficient({ annualIncome: 500000, annualExpense: 100000 })).toBe(true);
  });
});
