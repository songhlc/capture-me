const parser = require('../../lib/insurance/parser');

describe('parser.buildParsePrompt', () => {
  test('提示词包含三类角色 + 健康告知提醒', () => {
    const prompt = parser.buildParsePrompt('平安福 2023...');
    expect(prompt).toMatch(/投保人/);
    expect(prompt).toMatch(/被保人/);
    expect(prompt).toMatch(/受益人/);
    expect(prompt).toMatch(/健康告知/);
  });
});

describe('parser.validateParsedPolicy', () => {
  const baseValid = {
    category: 'critical_illness+life',
    policy_holder: { name: '我', relation: 'self' },
    insured: { name: '老婆', relation: 'spouse' },
    beneficiaries: [{ name: '儿子', relation: 'child' }],
  };

  test('完整输入 + 年缴自动算 next_renewal_date', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      sum_insured: 500000, annual_premium: 8000,
      payment_method: '年缴', start_date: '2023-06-15' });
    expect(p.status).toBe('active');
    expect(p.next_renewal_date).toBe('2024-06-15');
  });

  test('月缴 → +1 月', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      payment_method: '月缴', start_date: '2025-01-01' });
    expect(p.next_renewal_date).toBe('2025-02-01');
  });

  test('趸交 → next_renewal_date 为 null', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      payment_method: '趸交', start_date: '2024-01-01' });
    expect(p.next_renewal_date).toBeNull();
  });

  test('混合险 category 接受 + 连接', () => {
    const p = parser.validateParsedPolicy({ ...baseValid, category: 'health+critical_illness' });
    expect(p.category).toBe('health+critical_illness');
  });

  test('缺 category 抛错', () => {
    expect(() => parser.validateParsedPolicy({ ...baseValid, category: null })).toThrow(/category/);
  });

  test('空受益人数组合法', () => {
    const p = parser.validateParsedPolicy({ ...baseValid, beneficiaries: [] });
    expect(p.beneficiary_ids).toEqual([]);
  });

  test('非法 payment_method 抛错', () => {
    expect(() => parser.validateParsedPolicy({ ...baseValid, payment_method: '半年缴' }))
      .toThrow(/payment_method/);
  });
});

describe('parser.parsePolicyText', () => {
  test('parsePolicyText 接受 llmFn 注入', async () => {
    const result = await parser.parsePolicyText('某保单', async () => ({
      category: 'health',
      policy_holder: { name: '我', relation: 'self' },
      insured: { name: '我', relation: 'self' },
      beneficiaries: [],
    }));
    expect(result.category).toBe('health');
  });
});

describe('date arithmetic clamping', () => {
  const baseValid = {
    category: 'life',
    policy_holder: { name: '我', relation: 'self' },
    insured: { name: '我', relation: 'self' },
    beneficiaries: [],
  };

  test('2024-02-29 + 1 year → 2025-02-28 (闰年 clamp 到 2/28)', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      payment_method: '年缴', start_date: '2024-02-29' });
    expect(p.next_renewal_date).toBe('2025-02-28');
  });

  test('2025-01-31 + 1 month → 2025-02-28 (Jan 31 → Feb 末)', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      payment_method: '月缴', start_date: '2025-01-31' });
    expect(p.next_renewal_date).toBe('2025-02-28');
  });

  test('2025-03-31 + 1 month → 2025-04-30 (Mar 31 → Apr 末)', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      payment_method: '月缴', start_date: '2025-03-31' });
    expect(p.next_renewal_date).toBe('2025-04-30');
  });

  test('2024-02-29 季缴 +3m → 2024-05-29 (目标月有 29 号则保留)', () => {
    const p = parser.validateParsedPolicy({ ...baseValid,
      payment_method: '季缴', start_date: '2024-02-29' });
    expect(p.next_renewal_date).toBe('2024-05-29');
  });
});
