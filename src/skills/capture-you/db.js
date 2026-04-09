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
};
