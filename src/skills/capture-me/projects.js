#!/usr/bin/env node
/**
 * projects.js — 项目管理命令
 * 用法:
 *   node projects.js [active|paused|all]  # 列出项目
 *   node projects.js pause <项目名>       # 暂停项目
 *   node projects.js resume <项目名>       # 恢复项目
 *   node projects.js <项目名>             # 查看项目详情
 *   node projects.js export              # 导出 Markdown 到 memory/work-progress.md
 *
 * 数据源：SQLite (projects 表) — 唯一数据源
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');
const MEMORY_DIR = path.join(__dirname, 'memory');
const WORK_PROGRESS_PATH = path.join(MEMORY_DIR, 'work-progress.md');

// ─── 数据库操作（内联避免循环依赖） ─────────────────────────

function ensureDb(readonly = true) {
  if (!fs.existsSync(DB_PATH)) return null;
  return new Database(DB_PATH, { readonly });
}

function getProjects(status) {
  const db = ensureDb();
  if (!db) return [];

  let results;
  if (status && status !== 'all') {
    results = db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY last_updated DESC').all(status);
  } else {
    results = db.prepare('SELECT * FROM projects ORDER BY last_updated DESC').all();
  }
  db.close();

  for (const p of results) {
    if (p.assignees) try { p.assignees = JSON.parse(p.assignees); } catch (e) {}
    if (p.progress_detail) try { p.progress_detail = JSON.parse(p.progress_detail); } catch (e) {}
    if (p.blockers) try { p.blockers = JSON.parse(p.blockers); } catch (e) {}
  }

  return results;
}

function getProjectByName(projectName) {
  const db = ensureDb();
  if (!db) return null;

  const project = db.prepare('SELECT * FROM projects WHERE project_name LIKE ?').get(`%${projectName}%`);
  db.close();

  if (!project) return null;
  if (project.assignees) try { project.assignees = JSON.parse(project.assignees); } catch (e) {}
  if (project.progress_detail) try { project.progress_detail = JSON.parse(project.progress_detail); } catch (e) {}
  if (project.blockers) try { project.blockers = JSON.parse(project.blockers); } catch (e) {}
  return project;
}

function updateProjectStatus(projectName, newStatus) {
  if (!fs.existsSync(DB_PATH)) return false;
  const db = ensureDb(false);
  const result = db.prepare('UPDATE projects SET status = ?, last_updated = ? WHERE project_name LIKE ?')
    .run(newStatus, new Date().toISOString(), `%${projectName}%`);
  db.close();
  return result.changes > 0;
}

// ─── 格式化输出 ──────────────────────────────────────────

function formatProjectCard(project) {
  const statusEmoji = { active: '🔄', paused: '⏸️', blocked: '⚠️', completed: '✅' };
  const emoji = statusEmoji[project.status] || '🔄';
  const iter = project.iteration ? `[${project.iteration}]` : '';
  const assignees = project.assignees ? project.assignees.join('、') : '未指定';

  const lines = [`${emoji} ${iter} ${project.project_name} | ${assignees}`];

  if (project.tasks || (project.progress_detail && project.progress_detail.tasks)) {
    const tasks = project.tasks || project.progress_detail.tasks;
    const progress = project.overall_progress || 0;
    const taskStr = tasks.slice(0, 3).map(t => `${t.name} ${t.current}/${t.total}`).join(', ');
    lines.push(`   进度: ${progress}% (${taskStr}${tasks.length > 3 ? '...' : ''})`);
  } else if (project.overall_progress > 0) {
    lines.push(`   进度: ${project.overall_progress}%`);
  }

  lines.push(`   状态: ${project.status === 'active' ? '进行中' : project.status === 'paused' ? '已暂停' : project.status === 'blocked' ? '阻塞' : '已完成'}`);

  if (project.blockers && project.blockers.length > 0) {
    lines.push(`   阻塞: ${project.blockers[0]}`);
  }
  if (project.last_updated) {
    lines.push(`   更新: ${new Date(project.last_updated).toLocaleDateString('zh-CN')}`);
  }

  return lines.join('\n');
}

function formatProjectDetail(project) {
  const lines = [];
  const border = '═'.repeat(50);
  const statusMap = { active: '进行中', paused: '已暂停', blocked: '阻塞', completed: '已完成' };

  lines.push(`\n\x1b[36m╔${border}╗\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m${project.project_name}\x1b[0m\x1b[36m${' '.repeat(Math.max(0, 45 - project.project_name.length))}║\x1b[0m`);
  lines.push(`\x1b[36m╠${border}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  \x1b[1m📋 基本信息\x1b[0m${' '.repeat(35)}\x1b[36m║\x1b[0m`);
  lines.push(`\x1b[36m╠${border}╣\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  迭代版本：${project.iteration || '未设置'}\x1b[36m${' '.repeat(Math.max(0, 32))}║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  负责人：${project.assignees ? project.assignees.join('、') : '未指定'}\x1b[36m${' '.repeat(Math.max(0, 33))}║\x1b[0m`);
  lines.push(`\x1b[36m║\x1b[0m  状态：${statusMap[project.status] || project.status}\x1b[36m${' '.repeat(Math.max(0, 30))}║\x1b[0m`);

  if (project.tasks || (project.progress_detail && project.progress_detail.tasks)) {
    const tasks = project.tasks || project.progress_detail.tasks;
    lines.push(`\x1b[36m╠${border}╣\x1b[0m`);
    lines.push(`\x1b[36m║\x1b[0m  \x1b[1m📝 任务详情\x1b[0m${' '.repeat(35)}\x1b[36m║\x1b[0m`);
    lines.push(`\x1b[36m╠${border}╣\x1b[0m`);
    for (const task of tasks) {
      const pct = task.total > 0 ? Math.round(task.current / task.total * 100) : 0;
      lines.push(`\x1b[36m║\x1b[0m  ${task.name}: ${task.current}/${task.total} (${pct}%)\x1b[36m${' '.repeat(Math.max(0, 35 - task.name.length - String(pct).length))}║\x1b[0m`);
    }
  }

  if (project.blockers && project.blockers.length > 0) {
    lines.push(`\x1b[36m╠${border}╣\x1b[0m`);
    lines.push(`\x1b[36m║\x1b[0m  \x1b[1m⚠️ 阻塞原因\x1b[0m${' '.repeat(35)}\x1b[36m║\x1b[0m`);
    lines.push(`\x1b[36m╠${border}╣\x1b[0m`);
    for (const blocker of project.blockers) {
      lines.push(`\x1b[36m║\x1b[0m  · ${blocker}\x1b[36m${' '.repeat(Math.max(0, 44 - blocker.length))}║\x1b[0m`);
    }
  }

  lines.push(`\x1b[36m╚${border}╝\x1b[0m`);
  return lines.join('\n');
}

function formatProjectsList(projects, statusFilter) {
  if (projects.length === 0) {
    const msg = statusFilter === 'active' ? '暂无进行中的项目' :
                statusFilter === 'paused' ? '暂无已暂停的项目' :
                statusFilter === 'blocked' ? '暂无阻塞的项目' : '暂无项目记录';
    return `\n📋 项目列表\n${'═'.repeat(50)}\n\n${msg}\n`;
  }

  const label = { all: '所有', active: '进行中', paused: '已暂停', blocked: '阻塞' }[statusFilter] || '所有';
  const lines = [`\n📋 ${label}项目 (${projects.length})`, `${'═'.repeat(50)}`, ''];
  for (const p of projects) { lines.push(formatProjectCard(p), ''); }
  return lines.join('\n');
}

// ─── Markdown 导出 ────────────────────────────────────────

function exportToMarkdown() {
  const projects = getProjects('all');
  if (projects.length === 0) {
    console.log('没有项目数据可导出');
    return;
  }

  // 按迭代分组
  const byIter = {};
  for (const p of projects) {
    const iter = p.iteration || '其他';
    if (!byIter[iter]) byIter[iter] = [];
    byIter[iter].push(p);
  }

  const today = new Date().toISOString().split('T')[0];
  const lines = [`# 工作专项追踪`, '', `> 最后更新：${today}`, ''];

  const iterOrder = Object.keys(byIter).sort().reverse();
  const statusLabel = { active: '进行中', paused: '已暂停', completed: '收尾中' };

  for (const iter of iterOrder) {
    const projs = byIter[iter];
    const mainStatus = projs[0].status;
    const label = statusLabel[mainStatus] || statusLabel.completed;
    lines.push(`## ${iter} 迭代专项（${label}）`, '');
    lines.push('| 事项 | 负责人 | 关键进展 | 风险/待跟进 |');
    lines.push('|------|--------|----------|-------------|');

    for (const p of projs) {
      const name = p.project_name;
      const owner = p.assignees ? p.assignees.join('、') : '';
      const progress = p.progress_detail && p.progress_detail.tasks
        ? p.progress_detail.tasks.map(t => `${t.name}${t.current}/${t.total}`).join(', ')
        : (p.overall_progress > 0 ? `${p.overall_progress}%` : '-');
      const risk = p.blockers && p.blockers.length > 0 ? `⚠️ ${p.blockers[0]}` : '-';
      lines.push(`| **${name}** | ${owner} | ${progress} | ${risk} |`);
    }
    lines.push('');
  }

  const content = lines.join('\n');
  if (!fs.existsSync(MEMORY_DIR)) fs.mkdirSync(MEMORY_DIR, { recursive: true });
  fs.writeFileSync(WORK_PROGRESS_PATH, content, 'utf-8');
  console.log(`✓ 已导出到 ${WORK_PROGRESS_PATH}`);
}

// ─── CLI 入口 ────────────────────────────────────────────

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const arg = args.slice(1).join(' ');

  if (!cmd || ['active', 'paused', 'blocked', 'all'].includes(cmd)) {
    const status = cmd === 'blocked' ? 'blocked' : cmd;
    console.log(formatProjectsList(getProjects(status), status || 'active'));
    return;
  }

  if (cmd === 'export') {
    exportToMarkdown();
    return;
  }

  if (cmd === 'pause') {
    if (!arg) { console.log('用法: node projects.js pause <项目名>'); return; }
    const ok = updateProjectStatus(arg, 'paused');
    console.log(ok ? `✓ 项目 "${arg}" 已暂停` : `⚠️ 未找到项目 "${arg}"`);
    return;
  }

  if (cmd === 'resume') {
    if (!arg) { console.log('用法: node projects.js resume <项目名>'); return; }
    const ok = updateProjectStatus(arg, 'active');
    console.log(ok ? `✓ 项目 "${arg}" 已恢复` : `⚠️ 未找到项目 "${arg}"`);
    return;
  }

  if (cmd) {
    const project = getProjectByName(cmd);
    if (project) console.log(formatProjectDetail(project));
    else console.log(`⚠️ 未找到项目 "${cmd}"`);
    return;
  }

  console.log(formatProjectsList(getProjects('active'), 'active'));
}

if (require.main === module) {
  main();
}

module.exports = { getProjects, getProjectByName, updateProjectStatus, exportToMarkdown };
