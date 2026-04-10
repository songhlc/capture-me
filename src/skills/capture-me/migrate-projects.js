#!/usr/bin/env node
/**
 * migrate-projects.js — 一次性迁移工具
 *
 * 将 memory/work-progress.md 的历史项目数据导入 SQLite。
 * 迁移完成后，projects 表为唯一数据源，Markdown 为导出视图。
 *
 * 用法：
 *   node migrate-projects.js     # 试运行（不写入）
 *   node migrate-projects.js --confirm  # 确认迁移
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, 'sqlite', 'capture.db');
const MEMORY_DIR = path.join(__dirname, 'memory');
const WORK_PROGRESS_PATH = path.join(MEMORY_DIR, 'work-progress.md');

// ─── Markdown 解析 ────────────────────────────────────────

function parseMarkdown(content) {
  const lines = content.split('\n');
  const projects = [];

  const iterRe = /^##\s+(\d+)\s+迭代专项[（(]([^）)]+)[）)]/;
  const rowRe = /^\|\s*\*\*(.+?)\*\*\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.*?)\s*\|$/;

  let currentIter = '';

  for (const line of lines) {
    const iterMatch = line.match(iterRe);
    if (iterMatch) { currentIter = iterMatch[1]; continue; }

    const rowMatch = line.match(rowRe);
    if (rowMatch && currentIter) {
      const name = rowMatch[1].trim();
      const owner = rowMatch[2].trim();
      const progress = rowMatch[3].trim();
      const risk = rowMatch[4].trim();

      let numericProgress = 0;
      const pctMatch = progress.match(/(\d+)\/(\d+)/);
      if (pctMatch) {
        const cur = parseInt(pctMatch[1]);
        const total = parseInt(pctMatch[2]);
        if (total > 0) numericProgress = Math.round(cur / total * 100);
      }

      const isBlocked = risk.includes('⚠️') || risk.includes('阻塞');
      const isDone = risk.includes('✅已完成');
      const isActive = !isDone && !isBlocked;

      projects.push({
        id: `proj-${Date.now()}-${projects.length}`,
        project_name: name,
        iteration: currentIter,
        assignees: owner ? JSON.stringify(owner.split('、')) : JSON.stringify([]),
        status: isDone ? 'completed' : isBlocked ? 'blocked' : 'active',
        overall_progress: numericProgress,
        deadline: null,
        last_note_id: null,
        progress_detail: JSON.stringify({ tasks: [] }),
        blockers: isBlocked ? JSON.stringify([risk.replace(/[⚠️]/g, '').trim()]) : JSON.stringify([]),
        last_updated: new Date().toISOString(),
        created_at: new Date().toISOString(),
        // extra
        _progress_text: progress,
        _risk_text: risk,
      });
    }
  }

  return projects;
}

// ─── 数据库操作 ────────────────────────────────────────────

function openDb(readonly = false) {
  return new Database(DB_PATH, { readonly });
}

function insertProject(db, project) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO projects
    (id, project_name, iteration, assignees, status, overall_progress, deadline,
     last_note_id, progress_detail, blockers, last_updated, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    project.id, project.project_name, project.iteration, project.assignees,
    project.status, project.overall_progress, project.deadline,
    project.last_note_id, project.progress_detail, project.blockers,
    project.last_updated, project.created_at
  );
}

// ─── 迁移逻辑 ──────────────────────────────────────────────

async function migrate(dryRun = true) {
  if (!fs.existsSync(WORK_PROGRESS_PATH)) {
    console.log('work-progress.md 不存在，无需迁移');
    return;
  }

  const content = fs.readFileSync(WORK_PROGRESS_PATH, 'utf-8');
  const projects = parseMarkdown(content);

  if (projects.length === 0) {
    console.log('未解析到任何项目');
    return;
  }

  console.log(`解析到 ${projects.length} 个项目：`);
  for (const p of projects) {
    const emoji = p.status === 'active' ? '🔄' : p.status === 'blocked' ? '⚠️' : '✅';
    console.log(`  ${emoji} [${p.iteration}] ${p.project_name} | ${p._risk_text}`);
  }
  console.log();

  if (dryRun) {
    console.log('（试运行模式，如需写入请加 --confirm）');
    return;
  }

  // 写入 SQLite
  const db = openDb(false);
  let count = 0;
  for (const p of projects) {
    insertProject(db, p);
    count++;
  }
  db.close();
  console.log(`✓ 已写入 ${count} 个项目到 SQLite`);
}

// ─── 入口 ────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = !args.includes('--confirm');

migrate(dryRun).catch(console.error);
