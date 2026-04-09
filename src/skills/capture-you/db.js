#!/usr/bin/env node
/**
 * db.js — SQLite 数据库操作
 * 初始化、插入、查询、更新
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SKILL_DIR = path.join(__dirname);
const DB_DIR = path.join(SKILL_DIR, 'sqlite');
const DB_PATH = path.join(DB_DIR, 'capture.db');

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
}

function initDb() {
  ensureDir();

  const db = new Database(DB_PATH);

  // 创建 notes 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      date TEXT,
      time TEXT,
      raw_text TEXT,
      ai_summary TEXT,
      category TEXT,
      tags TEXT,
      extracted_entities TEXT,
      is_todo INTEGER DEFAULT 0,
      todo_due TEXT,
      todo_done INTEGER DEFAULT 0,
      source TEXT DEFAULT 'cli',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);
    CREATE INDEX IF NOT EXISTS idx_notes_category ON notes(category);
    CREATE INDEX IF NOT EXISTS idx_notes_is_todo ON notes(is_todo);
  `);

  // 创建 personality 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS personality (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dimension TEXT UNIQUE,
      evidence TEXT,
      last_updated TEXT
    );
  `);

  // 创建 projects 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      project_name TEXT NOT NULL,
      iteration TEXT,
      assignees TEXT,
      status TEXT DEFAULT 'active',
      overall_progress REAL DEFAULT 0,
      deadline TEXT,
      last_note_id TEXT,
      progress_detail TEXT,
      blockers TEXT,
      last_updated TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(project_name);
    CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status);
    CREATE INDEX IF NOT EXISTS idx_projects_iteration ON projects(iteration);
  `);

  db.close();
  console.log('✓ 数据库初始化完成:', DB_PATH);
}

function insertNote(note) {
  const db = new Database(DB_PATH);

  const stmt = db.prepare(`
    INSERT INTO notes (id, date, time, raw_text, ai_summary, category, tags, extracted_entities, is_todo, todo_due, todo_done, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    note.id,
    note.date,
    note.time,
    note.raw_text,
    note.ai_summary || null,
    note.category || null,
    note.tags || null,
    note.extracted_entities || null,
    note.is_todo ? 1 : 0,
    note.todo_due || null,
    note.todo_done ? 1 : 0,
    note.source || 'cli'
  );

  db.close();
  return note.id;
}

function getNoteById(id) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM notes WHERE id = ?');
  const note = stmt.get(id);
  db.close();
  return note;
}

function updateTodoStatus(id, done) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare('UPDATE notes SET todo_done = ? WHERE id = ?');
  stmt.run(done ? 1 : 0, id);
  db.close();
}

function getTodos(includeDone = false) {
  const db = new Database(DB_PATH, { readonly: true });
  let stmt;
  if (includeDone) {
    stmt = db.prepare('SELECT * FROM notes WHERE is_todo = 1 ORDER BY date DESC, time DESC');
  } else {
    stmt = db.prepare('SELECT * FROM notes WHERE is_todo = 1 AND todo_done = 0 ORDER BY date ASC, time ASC');
  }
  const results = stmt.all();
  db.close();
  return results;
}

function getNotesByDateRange(startDate, endDate) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare(`
    SELECT * FROM notes
    WHERE date >= ? AND date <= ?
    ORDER BY date ASC, time ASC
  `);
  const results = stmt.all(startDate, endDate);
  db.close();
  return results;
}

function deleteNote(id) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare('DELETE FROM notes WHERE id = ?');
  stmt.run(id);
  db.close();
}

function updatePersonality(dimension, evidence) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare(`
    INSERT INTO personality (dimension, evidence, last_updated)
    VALUES (?, ?, ?)
    ON CONFLICT(dimension) DO UPDATE SET
      evidence = excluded.evidence,
      last_updated = excluded.last_updated
  `);
  stmt.run(dimension, JSON.stringify(evidence), new Date().toISOString());
  db.close();
}

function getPersonality(dimension) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM personality WHERE dimension = ?');
  const result = stmt.get(dimension);
  db.close();
  return result;
}

function getAllPersonality() {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM personality ORDER BY dimension');
  const results = stmt.all();
  db.close();
  return results;
}

// ─── Projects CRUD ──────────────────────────────────────────

function generateProjectId(projectName, iteration) {
  const str = `${projectName}-${iteration || 'default'}`;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return 'proj-' + Math.abs(hash).toString(16);
}

function insertProject(project) {
  const db = new Database(DB_PATH);
  const id = project.id || generateProjectId(project.project_name, project.iteration);

  const stmt = db.prepare(`
    INSERT INTO projects (id, project_name, iteration, assignees, status, overall_progress, deadline, last_note_id, progress_detail, blockers, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    id,
    project.project_name,
    project.iteration || null,
    project.assignees ? JSON.stringify(project.assignees) : null,
    project.status || 'active',
    project.overall_progress || 0,
    project.deadline || null,
    project.last_note_id || null,
    project.progress_detail ? JSON.stringify(project.progress_detail) : null,
    project.blockers ? JSON.stringify(project.blockers) : null,
    new Date().toISOString()
  );

  db.close();
  return id;
}

function getProject(id) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM projects WHERE id = ?');
  const project = stmt.get(id);
  db.close();

  if (project && project.assignees) {
    try {
      project.assignees = JSON.parse(project.assignees);
    } catch (e) {}
  }
  if (project && project.progress_detail) {
    try {
      project.progress_detail = JSON.parse(project.progress_detail);
    } catch (e) {}
  }
  if (project && project.blockers) {
    try {
      project.blockers = JSON.parse(project.blockers);
    } catch (e) {}
  }

  return project;
}

function getProjects(status) {
  const db = new Database(DB_PATH, { readonly: true });
  let stmt;
  if (status && status !== 'all') {
    stmt = db.prepare('SELECT * FROM projects WHERE status = ? ORDER BY last_updated DESC');
    var results = stmt.all(status);
  } else {
    stmt = db.prepare('SELECT * FROM projects ORDER BY last_updated DESC');
    results = stmt.all();
  }
  db.close();

  // Parse JSON fields
  for (const project of results) {
    if (project.assignees) {
      try {
        project.assignees = JSON.parse(project.assignees);
      } catch (e) {}
    }
    if (project.progress_detail) {
      try {
        project.progress_detail = JSON.parse(project.progress_detail);
      } catch (e) {}
    }
    if (project.blockers) {
      try {
        project.blockers = JSON.parse(project.blockers);
      } catch (e) {}
    }
  }

  return results;
}

function updateProjectStatus(id, status) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare('UPDATE projects SET status = ?, last_updated = ? WHERE id = ?');
  stmt.run(status, new Date().toISOString(), id);
  db.close();
}

function updateProjectFromNote(projectData, noteId) {
  const db = new Database(DB_PATH);

  // Check if project exists
  const existing = db.prepare('SELECT id FROM projects WHERE id = ?').get(projectData.id);

  if (existing) {
    // Update existing project
    const stmt = db.prepare(`
      UPDATE projects SET
        iteration = ?,
        assignees = ?,
        status = ?,
        overall_progress = ?,
        deadline = ?,
        last_note_id = ?,
        progress_detail = ?,
        blockers = ?,
        last_updated = ?
      WHERE id = ?
    `);

    stmt.run(
      projectData.iteration || null,
      projectData.assignees ? JSON.stringify(projectData.assignees) : null,
      projectData.status || 'active',
      projectData.overall_progress || 0,
      projectData.deadline || null,
      noteId,
      projectData.progress_detail ? JSON.stringify(projectData.progress_detail) : null,
      projectData.blockers ? JSON.stringify(projectData.blockers) : null,
      new Date().toISOString(),
      projectData.id
    );
  } else {
    // Insert new project
    const stmt = db.prepare(`
      INSERT INTO projects (id, project_name, iteration, assignees, status, overall_progress, deadline, last_note_id, progress_detail, blockers, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      projectData.id,
      projectData.project_name,
      projectData.iteration || null,
      projectData.assignees ? JSON.stringify(projectData.assignees) : null,
      projectData.status || 'active',
      projectData.overall_progress || 0,
      projectData.deadline || null,
      noteId,
      projectData.progress_detail ? JSON.stringify(projectData.progress_detail) : null,
      projectData.blockers ? JSON.stringify(projectData.blockers) : null,
      new Date().toISOString()
    );
  }

  db.close();
}

function calculateProjectProgress(tasks) {
  if (!tasks || tasks.length === 0) return 0;

  let totalProgress = 0;
  let totalWeight = 0;

  for (const task of tasks) {
    const weight = task.total || 1;
    const progress = task.current || 0;
    totalProgress += (progress / (task.total || 1)) * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? Math.round((totalProgress / totalWeight) * 100) : 0;
}

// CLI
if (require.main === module) {
  const cmd = process.argv[2];

  if (cmd === 'init') {
    initDb();
  } else if (cmd === 'todos') {
    const todos = getTodos();
    console.log('待办列表：');
    for (const t of todos) {
      const done = t.todo_done ? '✓' : '☐';
      console.log(`  ${done} [${t.id.slice(0, 8)}] ${t.raw_text.slice(0, 50)} ${t.todo_due || ''}`);
    }
  } else if (cmd === 'stats') {
    const db = new Database(DB_PATH, { readonly: true });
    const total = db.prepare('SELECT COUNT(*) as c FROM notes').get().c;
    const todos = db.prepare('SELECT COUNT(*) as c FROM notes WHERE is_todo = 1').get().c;
    console.log(`总记录: ${total}, 待办: ${todos}`);
    db.close();
  } else {
    console.log('用法: node db.js [init|todos|stats]');
  }
}

module.exports = {
  initDb,
  insertNote,
  getNoteById,
  updateTodoStatus,
  getTodos,
  getNotesByDateRange,
  deleteNote,
  updatePersonality,
  getPersonality,
  getAllPersonality,
  // Projects
  generateProjectId,
  insertProject,
  getProject,
  getProjects,
  updateProjectStatus,
  updateProjectFromNote,
  calculateProjectProgress,
};
