/**
 * lib/insurance/parser.js — 自然语言 → 保单结构化
 *
 * 解析流程：
 *   1.  buildParsePrompt(text)    → 给 LLM 的指令（agent 在对话中跑 LLM）
 *   2.  LLM 返回 JSON
 *   3.  validateParsedPolicy(json) → 校验 + 规范化（含 next_renewal_date 计算）
 *
 * 设计原则：解析由 LLM 完成，脚本只做模板/校验，避免正则"AI 解析"。
 */

const VALID_CATEGORIES = ['life', 'health', 'accident', 'critical_illness', 'annuity', 'pension'];
const VALID_PAYMENT_METHODS = ['年缴', '月缴', '季缴', '趸交'];
const VALID_RELATIONS = ['self', 'spouse', 'child', 'parent', 'other'];
const VALID_SALES_CHANNELS = ['agent', 'broker', 'online', 'bank', 'other'];

function buildParsePrompt(rawText) {
  return `你是保险结构化助手。把以下保单描述解析为 JSON（**只输出 JSON，不要解释**）：

原始文本：
"""
${rawText}
"""

JSON Schema（字段不全填 null，不要捏造）：
{
  "category": "life | health | accident | critical_illness | annuity | pension | 混合险用+连接",
  "insurer": "保险公司简称",
  "product_name": "产品名",
  "policy_number": "保单号（若有）",
  "sum_insured": 保额（元）,
  "annual_premium": 年缴保费（元；月缴则 ×12）,
  "payment_method": "年缴 | 月缴 | 季缴 | 趸交",
  "payment_period": "缴费年期，如 20年缴 / 终身 / 5年期",
  "coverage_period": "保障年期",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD（长期险可空）",
  "policy_holder": { "name": "投保人称呼", "relation": "self|spouse|child|parent|other" },
  "insured": { "name": "被保人称呼", "relation": "self|spouse|child|parent|other" },
  "beneficiaries": [{ "name": "受益人称呼", "relation": "self|spouse|child|parent|other" }],
  "sales_channel": "agent | broker | online | bank | other",
  "sales_contact": { "name": "销售姓名", "phone": "销售电话" },
  "health_disclosure": "本次投保的健康告知要点（无则 null）",
  "guaranteed_renewable": true|false,
  "raw_text": "原始文本"
}

注意：
1. 三方角色（投保人/被保人/受益人）**必须分别解析**。丈夫给妻子买（投保人=我，被保人=老婆）、父母给孩子买都是常见情况。
2. 混合险（如"重疾+寿险"）用 + 连接 category。
3. 没提到的字段填 null。
4. **健康告知**是理赔拒赔主因，必须主动询问用户（CLI 录入后追问）。`;
}

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr);
  const startDay = d.getDate();
  const targetMonth = d.getMonth() + months;
  const targetYear = d.getFullYear() + Math.floor(targetMonth / 12) * (targetMonth < 0 ? -1 : 0);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const targetDay = Math.min(startDay, daysInMonth(targetYear, normalizedMonth));
  const result = new Date(Date.UTC(targetYear, normalizedMonth, targetDay));
  return result.toISOString().slice(0, 10);
}

function addYears(dateStr, years) {
  const d = new Date(dateStr);
  const startDay = d.getDate();
  const targetYear = d.getFullYear() + years;
  const targetDay = Math.min(startDay, daysInMonth(targetYear, d.getMonth()));
  const result = new Date(Date.UTC(targetYear, d.getMonth(), targetDay));
  return result.toISOString().slice(0, 10);
}

function validateParsedPolicy(parsed) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('parsed policy is empty or not an object');
  }
  if (!parsed.category) throw new Error('category is required');
  const cats = String(parsed.category).split('+');
  for (const c of cats) {
    if (!VALID_CATEGORIES.includes(c)) {
      throw new Error(`invalid category segment: ${c}; must be one of ${VALID_CATEGORIES.join(', ')} or join with +`);
    }
  }
  if (!parsed.policy_holder?.name || !parsed.policy_holder?.relation) {
    throw new Error('policy_holder.{name,relation} is required');
  }
  if (!VALID_RELATIONS.includes(parsed.policy_holder.relation)) {
    throw new Error(`invalid policy_holder.relation: ${parsed.policy_holder.relation}`);
  }
  if (!parsed.insured?.name || !parsed.insured?.relation) {
    throw new Error('insured.{name,relation} is required');
  }
  if (!VALID_RELATIONS.includes(parsed.insured.relation)) {
    throw new Error(`invalid insured.relation: ${parsed.insured.relation}`);
  }
  if (!Array.isArray(parsed.beneficiaries)) {
    throw new Error('beneficiaries must be an array (use [] for none)');
  }
  for (const b of parsed.beneficiaries) {
    if (!b.name || !b.relation) throw new Error('each beneficiary needs {name, relation}');
    if (!VALID_RELATIONS.includes(b.relation)) {
      throw new Error(`invalid beneficiary.relation: ${b.relation}`);
    }
  }
  if (parsed.payment_method && !VALID_PAYMENT_METHODS.includes(parsed.payment_method)) {
    throw new Error(`invalid payment_method: ${parsed.payment_method}`);
  }
  if (parsed.sales_channel && !VALID_SALES_CHANNELS.includes(parsed.sales_channel)) {
    throw new Error(`invalid sales_channel: ${parsed.sales_channel}`);
  }

  let nextRenewal = null;
  if (parsed.start_date) {
    if (parsed.payment_method === '年缴') nextRenewal = addYears(parsed.start_date, 1);
    else if (parsed.payment_method === '月缴') nextRenewal = addMonths(parsed.start_date, 1);
    else if (parsed.payment_method === '季缴') nextRenewal = addMonths(parsed.start_date, 3);
  }

  /**
   * Returns the normalized policy object PLUS a `_roles` sentinel field
   * containing the original role descriptors (policy_holder, insured, beneficiaries).
   *
   * **Caller (lib/insurance/index.js addPolicy) MUST strip `_roles` before
   * calling `insDb.insertPolicy`**, and use it to resolve names → member_ids
   * via `upsertMember`. The DB layer does not know about role names.
   */
  return {
    family_member_id: parsed.family_member_id || null,
    policy_holder_id: parsed.policy_holder_id || null,
    beneficiary_ids: parsed.beneficiary_ids || [],
    category: parsed.category,
    insurer: parsed.insurer || null,
    product_name: parsed.product_name || null,
    policy_number: parsed.policy_number || null,
    sum_insured: parsed.sum_insured ? Number(parsed.sum_insured) : null,
    annual_premium: parsed.annual_premium ? Number(parsed.annual_premium) : null,
    payment_method: parsed.payment_method || null,
    payment_period: parsed.payment_period || null,
    coverage_period: parsed.coverage_period || null,
    start_date: parsed.start_date || null,
    end_date: parsed.end_date || null,
    next_renewal_date: nextRenewal,
    sales_channel: parsed.sales_channel || null,
    sales_contact: parsed.sales_contact || null,
    health_disclosure_summary: parsed.health_disclosure || null,
    guaranteed_renewable: !!parsed.guaranteed_renewable,
    status: 'active',
    raw_text: parsed.raw_text || null,
    ai_summary: parsed.ai_summary || null,
    tags: parsed.tags || null,
    source: 'cli',
    _roles: {
      policy_holder: parsed.policy_holder,
      insured: parsed.insured,
      beneficiaries: parsed.beneficiaries,
    },
  };
}

async function parsePolicyText(rawText, llmFn) {
  if (typeof llmFn !== 'function') {
    throw new Error('llmFn is required; agent should call LLM with buildParsePrompt() output');
  }
  const prompt = buildParsePrompt(rawText);
  const parsed = await llmFn(prompt);
  return validateParsedPolicy(parsed);
}

module.exports = {
  buildParsePrompt, validateParsedPolicy, parsePolicyText,
  VALID_CATEGORIES, VALID_PAYMENT_METHODS, VALID_RELATIONS, VALID_SALES_CHANNELS,
};
