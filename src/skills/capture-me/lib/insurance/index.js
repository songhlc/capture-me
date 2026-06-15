/**
 * lib/insurance/index.js — 公共 API 入口
 *
 * addPolicy(parsed, healthDisclosureText)
 *   从 validateParsedPolicy 输出录保单（处理三方角色 → member_id）
 *   healthDisclosureText 可选：用户口头回答的健康告知文本
 *
 * 其他方法为各子模块的透传。
 */
const db = require('./db');
const parser = require('./parser');
const analyzer = require('./analyzer');
const report = require('./report');
const reminder = require('./reminder');
const gapRules = require('./gap-rules');
const cash = require('./cash');
const claims = require('./claims');

/**
 * 从 LLM 解析后的结构化 JSON 录保单（处理三方角色 → member_id 转换）。
 * @param {object} parsed validateParsedPolicy() 输出
 * @param {string} [healthDisclosureText] 可选：用户口头回答的健康告知文本
 * @returns {object} { policy_id, memberIds, summary }
 */
function addPolicy(parsed, healthDisclosureText) {
  const ph = db.upsertMember(parsed._roles.policy_holder);
  const insured = db.upsertMember(parsed._roles.insured);
  const beneficiaries = (parsed._roles.beneficiaries || []).map(b => db.upsertMember(b));

  if (healthDisclosureText) {
    db.appendHealthDisclosure(insured.member_id, {
      conditions: [{
        name: healthDisclosureText,
        disclosed: true,
        disclosed_at: new Date().toISOString().slice(0, 10),
      }],
    });
    parsed.health_disclosure_summary = healthDisclosureText;
  }

  const policyInput = {
    ...parsed,
    family_member_id: insured.member_id,
    policy_holder_id: ph.member_id,
    beneficiary_ids: beneficiaries.map(b => b.member_id),
  };
  delete policyInput._roles;

  const policy = db.insertPolicy(policyInput);
  return {
    policy_id: policy.policy_id,
    memberIds: {
      policy_holder: ph.member_id,
      insured: insured.member_id,
      beneficiaries: beneficiaries.map(b => b.member_id),
    },
    summary: {
      product_name: policy.product_name,
      category: policy.category,
      sum_insured: policy.sum_insured,
      annual_premium: policy.annual_premium,
      next_renewal_date: policy.next_renewal_date,
      sales_contact: policy.sales_contact,
      health_disclosure: policy.health_disclosure_summary,
    },
  };
}

function getPolicy(id) { return db.getPolicy(id); }
function listPolicies(opts) { return db.listPolicies(opts); }
function addCash(input) { return cash.addCash(input); }
function listCash() { return cash.listCash(); }
function addClaim(input) { return claims.addClaim(input); }
function listClaims(policyId) { return claims.listClaimsByPolicy(policyId); }
function buildReport(ctx) { return analyzer.buildHealthCheck(ctx); }
function renderTerminal(data) { return report.renderTerminal(data); }
function writeMarkdown(data) { return report.writeMarkdown(data); }
function runReminders() { return reminder.runCheckReminders(); }
function computeGap(ctx, policies, cashTotal) { return gapRules.computeGap(ctx, policies, cashTotal); }
function summarizeByType() { return cash.summarizeByType(); }

module.exports = {
  addPolicy, getPolicy, listPolicies,
  addCash, listCash, summarizeByType,
  addClaim, listClaims,
  buildReport, renderTerminal, writeMarkdown,
  runReminders,
  computeGap,
  buildParsePrompt: parser.buildParsePrompt,
  validateParsedPolicy: parser.validateParsedPolicy,
  parsePolicyText: parser.parsePolicyText,
};
