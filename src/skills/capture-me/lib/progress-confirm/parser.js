/**
 * lib/progress-confirm/parser.js — 解析用户飞书回复，应用状态变更
 *
 * 设计原则（参考 insurance/parser.js）：
 *   - LLM 调用由调用方（OpenClaw agent）提供
 *   - 本模块只做：构造 prompt + 校验 LLM 返回的 JSON + 应用变更到内存中的 items
 *   - 实际写库由 applier.js 负责
 *
 * 用法（程序化）：
 *   const { buildPrompt, validateAndApply } = require('./parser');
 *   const prompt = buildPrompt(projects, replyText);
 *   const llmOutput = await callLLM(prompt);   // ← 由调用方注入
 *   const result = validateAndApply(projects, JSON.parse(llmOutput));
 */

const { VALID_STATUS } = require('./schema');

const STATUS_HINT = {
  active: '还做 / 继续 / active',
  done: '完成 / 做完 / done / ✅',
  drop: '删 / 不要 / drop / 不做了',
  blocked: '阻塞 / 卡住 / blocked / 有问题',
};

/**
 * 构造给 LLM 的 prompt
 *
 * @param {Array} projects - scanner 出来的项目列表
 * @param {string} replyText - 用户飞书回复原文
 * @returns {string}
 */
function buildPrompt(projects, replyText) {
  const projectsJson = JSON.stringify(
    projects.map((p) => ({
      project_id: p.project_id,
      project_name: p.project_name,
      items: p.items.map((it, i) => ({
        index: i + 1,
        id: it.id,
        title: it.title,
        current_status: it.status,
      })),
    })),
    null,
    2,
  );

  return `你是 capture-me 的状态解析助手。

用户回复原文：
"""
${replyText}
"""

当前项目与进展（编号仅在每个项目内独立，从 1 开始）：
${projectsJson}

请把用户的回复解析成严格 JSON，格式如下：
{
  "changes": [
    { "project_id": "项目 id", "item_id": "进展 id", "new_status": "active|done|drop|blocked", "note": "可选备注" }
  ]
}

状态映射规则：
- "${STATUS_HINT.active}" → "active"
- "${STATUS_HINT.done}" → "done"
- "${STATUS_HINT.drop}" → "drop"
- "${STATUS_HINT.blocked}" → "blocked"

注意：
1. 用户回复可能只提了几个项目，未提的不动。
2. 用户用了项目名缩写（如"YNF"）时按 project_name 模糊匹配。
3. 用户用了编号（如"YNF: 1 还做, 2 完成"）时按 index 匹配。
4. 模糊或矛盾的项不要猜测，跳过即可。
5. 只输出 JSON，不要任何解释或 markdown 代码块。`;
}

/**
 * 校验 LLM 输出并应用到内存中的 items（不改库）
 *
 * @param {Array} projects - scanner 出来的项目（含 items 引用）
 * @param {object} parsed - LLM 返回的 JSON
 * @returns {{ ok: boolean, applied: Array, errors: Array, projects: Array }}
 *   - projects 是 mutate 后的版本（item.status 字段会被改）
 */
function validateAndApply(projects, parsed) {
  const applied = [];
  const errors = [];

  if (!parsed || !Array.isArray(parsed.changes)) {
    return {
      ok: false,
      applied: [],
      errors: ['LLM 返回 JSON 缺少 changes 数组'],
      projects,
    };
  }

  // 建立 (project_id, item_id) → { project, item } 查找表
  const lookup = new Map();
  for (const proj of projects) {
    for (const item of proj.items) {
      lookup.set(`${proj.project_id}:${item.id}`, { project: proj, item });
    }
  }

  for (const change of parsed.changes) {
    const { project_id, item_id, new_status, note } = change;

    if (!project_id || !item_id) {
      errors.push(`change 缺字段: ${JSON.stringify(change)}`);
      continue;
    }

    if (!VALID_STATUS.has(new_status)) {
      errors.push(`非法状态: ${new_status}（${project_id}:${item_id}）`);
      continue;
    }

    const target = lookup.get(`${project_id}:${item_id}`);
    if (!target) {
      errors.push(`未找到 project_id=${project_id} item_id=${item_id} 的项`);
      continue;
    }

    const oldStatus = target.item.status;
    if (oldStatus === new_status) {
      // 状态没变，不算 applied，跳过
      continue;
    }

    // 标记新状态 + 备注（applier 会落库并更新 history）
    target.item._pending_new_status = new_status;
    target.item._pending_note = note || '';

    applied.push({
      project_id,
      project_name: target.project.project_name,
      item_id,
      item_title: target.item.title,
      old_status: oldStatus,
      new_status,
      note: note || null,
    });
  }

  return {
    ok: errors.length === 0,
    applied,
    errors,
    projects,
  };
}

module.exports = {
  buildPrompt,
  validateAndApply,
  STATUS_HINT,
};