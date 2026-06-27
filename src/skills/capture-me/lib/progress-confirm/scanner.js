/**
 * lib/progress-confirm/scanner.js — 扫描活跃项目的 progress_detail
 *
 * 输出 Markdown / JSON 两种格式（CLI 友好）：
 *   - markdown: 给 OpenClaw agent 拿去组装飞书卡片
 *   - json:     给下游 parse/apply 程序化消费
 *
 * 行为：
 *   1. 查 projects 表 status='active' 的所有项目
 *   2. 把每个项目的 progress_detail 升级到 v2
 *   3. items 为空 → 自动从 week_plan_updates 回填
 *   4. 输出
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SKILL_DIR = path.resolve(__dirname, '..', '..');
const DB_PATH = process.env.CAPTURE_ME_DB_PATH || path.join(SKILL_DIR, 'sqlite', 'capture.db');

const { resolveProgressDetail } = require('./schema');
const { getIsoWeek } = require('../iso-week');

function openDb(readonly = true) {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`数据库不存在: ${DB_PATH}`);
  }
  return new Database(DB_PATH, { readonly });
}

/**
 * 扫描所有 active 项目
 *
 * @param {object} [options]
 * @param {string} [options.weekIso]
 * @param {boolean} [options.backfill=true]
 * @returns {Array<{
 *   project_id, project_name, iteration, assignees, items, source
 * }>}
 */
function scanActiveProjects(options = {}) {
  const { weekIso = getIsoWeek(new Date()), backfill = true } = options;

  const db = openDb();
  try {
    const rows = db
      .prepare(
        `SELECT id, project_name, iteration, assignees, progress_detail, overall_progress
         FROM projects
         WHERE status = 'active'
         ORDER BY iteration DESC, project_name`,
      )
      .all();

    const projects = [];
    for (const row of rows) {
      let assignees = [];
      try {
        assignees = row.assignees ? JSON.parse(row.assignees) : [];
      } catch (_) {}

      const { detail, source } = backfill
        ? resolveProgressDetail(db, row, weekIso)
        : { detail: resolveProgressDetail(db, row, weekIso).detail, source: 'existing' };

      projects.push({
        project_id: row.id,
        project_name: row.project_name,
        iteration: row.iteration,
        assignees,
        overall_progress: row.overall_progress,
        items: detail.items,
        source,
      });
    }

    return projects;
  } finally {
    db.close();
  }
}

const STATUS_BADGE = {
  active: '🟢 在做',
  done: '✅ 完成',
  drop: '🗑️ 删除',
  blocked: '🔴 阻塞',
};

/**
 * 把扫描结果渲染成 Markdown（OpenClaw agent 拿去组装飞书卡片）
 *
 * @param {Array} projects
 * @param {string} weekIso
 * @returns {string}
 */
function renderScanMarkdown(projects, weekIso) {
  const lines = [`📋 **周度进展确认 — ${weekIso}**`, ''];

  if (projects.length === 0) {
    lines.push('（暂无 active 项目）');
    return lines.join('\n');
  }

  for (const proj of projects) {
    const iter = proj.iteration ? `[${proj.iteration}]` : '';
    const owner = proj.assignees && proj.assignees.length > 0 ? proj.assignees.join('、') : '未指定';

    lines.push(`### ${proj.project_name} ${iter}`);
    lines.push(`负责人：${owner}`);
    lines.push('');

    proj.items.forEach((item, i) => {
      const badge = STATUS_BADGE[item.status] || item.status;
      lines.push(`${i + 1}. ${item.title} — ${badge}`);

      if (item._progress_note) {
        lines.push(`   ↳ ${item._progress_note}`);
      }

      if (item._empty) {
        lines.push(`   ↳ （请直接回复本项目的处理方式）`);
      }
    });

    lines.push('');
    lines.push(
      `> 回复示例：\`${proj.project_name}: 1 还做, 2 完成, 3 删, 4 阻塞\``,
    );
    lines.push('');
  }

  lines.push('---');
  lines.push(`共 ${projects.length} 个项目。回复所有项目后我会一次性处理。`);

  return lines.join('\n');
}

module.exports = {
  scanActiveProjects,
  renderScanMarkdown,
  DB_PATH,
};