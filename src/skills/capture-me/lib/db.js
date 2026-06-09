#!/usr/bin/env node
/**
 * db.js — SQLite 数据库操作
 * 初始化、插入、查询、更新
 */

const fs = require('fs');
const path = require('path');
const SKILL_DIR = path.join(__dirname, '..');
const Database = require('better-sqlite3');

const DB_DIR = process.env.CAPTURE_YOU_TEST_DB_PATH
  ? path.dirname(process.env.CAPTURE_YOU_TEST_DB_PATH)
  : path.join(SKILL_DIR, 'sqlite');
const DB_PATH = process.env.CAPTURE_YOU_TEST_DB_PATH || path.join(DB_DIR, 'capture.db');

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    const touchDb = new Database(DB_PATH);
    touchDb.close();
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

  // ─── Mirror 镜子模块表 ────────────────────────────────────
  // 承诺追踪表
  db.exec(`
    CREATE TABLE IF NOT EXISTS commitments (
      id TEXT PRIMARY KEY,
      commitment_text TEXT NOT NULL,
      created_at TEXT,
      source_note_id TEXT,
      target_behavior TEXT,
      triggered_count INTEGER DEFAULT 0,
      resolved INTEGER DEFAULT 0,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_commitments_resolved ON commitments(resolved);
  `);

  // 情绪时间线表
  db.exec(`
    CREATE TABLE IF NOT EXISTS emotion_timeline (
      id TEXT PRIMARY KEY,
      date TEXT,
      emotion_word TEXT,
      intensity INTEGER,
      context TEXT,
      source_note_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_emotion_date ON emotion_timeline(date);
  `);

  // 关系追踪表
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationship_tracking (
      id TEXT PRIMARY KEY,
      person_name TEXT UNIQUE,
      mention_count INTEGER DEFAULT 0,
      positive_count INTEGER DEFAULT 0,
      negative_count INTEGER DEFAULT 0,
      last_mentioned TEXT,
      last_emotion TEXT
    );
  `);

  // 盲区记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS blindspots (
      id TEXT PRIMARY KEY,
      pattern_type TEXT,
      description TEXT,
      evidence TEXT,
      first_detected TEXT,
      occurrences INTEGER DEFAULT 1,
      notified INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_blindspots_type ON blindspots(pattern_type);
  `);

  // 镜子通知日志
  db.exec(`
    CREATE TABLE IF NOT EXISTS mirror_alerts (
      id TEXT PRIMARY KEY,
      alert_type TEXT,
      title TEXT,
      body TEXT,
      sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
      dismissed INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_alerts_type ON mirror_alerts(alert_type);

    CREATE TABLE IF NOT EXISTS profile_signals (
      id TEXT PRIMARY KEY,
      dimension TEXT,
      signal TEXT,
      confidence REAL,
      source TEXT DEFAULT 'observe',
      conversation_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_reinforced TEXT DEFAULT (datetime('now')),
      detail TEXT,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_signals_dimension ON profile_signals(dimension);
    CREATE INDEX IF NOT EXISTS idx_signals_created ON profile_signals(created_at);

    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      raw_text TEXT NOT NULL,
      ai_summary TEXT,
      dimension TEXT DEFAULT 'general',
      source TEXT DEFAULT 'observe',
      status TEXT DEFAULT 'collected',
      brainstorm_notes TEXT,
      promoted_to_todo_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      brainstormed_at TEXT,
      promoted_at TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
    CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at);

    CREATE TABLE IF NOT EXISTS journeys (
      id TEXT PRIMARY KEY,
      place_name TEXT NOT NULL,
      place_type TEXT DEFAULT 'city',
      location TEXT,
      visited_at TEXT,
      notes TEXT,
      mood TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // ─── Week Plan 模块表 ─────────────────────────────────────
  // 周计划主表
  db.exec(`
    CREATE TABLE IF NOT EXISTS week_plans (
      id TEXT PRIMARY KEY,
      week_iso TEXT UNIQUE NOT NULL,
      year INTEGER NOT NULL,
      week_num INTEGER NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT DEFAULT 'planning',
      carryover_from_id TEXT,
      template_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 计划项
  db.exec(`
    CREATE TABLE IF NOT EXISTS week_plan_items (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      project TEXT,
      priority TEXT,
      assignee TEXT DEFAULT '我',
      expected_outcome TEXT,
      status TEXT DEFAULT 'pending',
      sort_order INTEGER DEFAULT 0,
      source TEXT DEFAULT 'weekplan',
      auto_detected_from_note_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wpi_plan_id ON week_plan_items(plan_id);
    CREATE INDEX IF NOT EXISTS idx_wpi_status ON week_plan_items(status);
  `);

  // 每日 check-in 累积
  db.exec(`
    CREATE TABLE IF NOT EXISTS week_plan_updates (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      plan_id TEXT NOT NULL,
      update_date TEXT NOT NULL,
      status_after TEXT NOT NULL,
      progress_note TEXT,
      source TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_wpu_item_id ON week_plan_updates(item_id);
    CREATE INDEX IF NOT EXISTS idx_wpu_update_date ON week_plan_updates(update_date);
  `);

  // 模板注册表（PR1 只建表，CRUD 在 PR2）
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_report_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sections_json TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      is_builtin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 周报渲染记录（PR1 只建表，CRUD 在 PR2）
  db.exec(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      template_id TEXT NOT NULL,
      rendered_markdown TEXT NOT NULL,
      channel_outputs TEXT,
      status TEXT DEFAULT 'pending',
      pushed_at TEXT,
      error_log TEXT,
      created_at TEXT DEFAULT (datetime('now'))
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

// ─── Mirror / Commitments ────────────────────────────────────

const COMMITMENT_TRIGGERS = [
  // 标准承诺句式: [regex, prefix_to_strip, capture_group_for_behavior]
  [/我要 ?(.+)/i, null, 1],
  [/下次不(.+)/i, null, 1],
  [/一定 ?(.+)/i, null, 1],
  [/打算 ?(.+)/i, null, 1],
  [/计划 ?(.+)/i, null, 1],
  [/这次一定 ?(.+)/i, null, 1],
  [/以后 ?(.+)/i, null, 1],
  [/从现在起 ?(.+)/i, null, 1],
  [/决定 ?(.+)/i, null, 1],
  [/必须 ?(.+)/i, null, 1],
  // 时间开头：无主语，下周/明天/周末 + 行为
  [/^(下周(?:开始|每天|要)?(.+))/i, '下周', 2],
  [/^(?:从?明天(?:起|开始|要)?(.+))/i, "明天", 1],
  [/^(周末(?:去|开始|要)?(.+))/i, '周末', 2],
  [/^(我周末.+)/i, null, 0],
  [/^(我周末一定要.+)/i, null, 0],
  // 我型：我说/我要/我下周...
  [/^(我下周.+)/i, "我下周", 0],
  [/^(我明天.+)/i, null, 0],
  [/^(我决定.+)/i, null, 0],
];

/**
 * 从文本中提取承诺类语句
 * @param {string} text
 * @returns {object|null} { trigger, behavior, original }
 */
function extractCommitment(text) {
  const trimmed = text.trim();
  for (const entry of COMMITMENT_TRIGGERS) {
    const regex = Array.isArray(entry) ? entry[0] : entry;
    const match = trimmed.match(regex);
    if (match) {
      if (Array.isArray(entry)) {
        const [, prefix, group] = entry;
        let behavior = match[group] || match[0];
        if (prefix && behavior.startsWith(prefix)) {
          behavior = behavior.slice(prefix.length).trim();
        }
        return {
          trigger: match[0],
          behavior: behavior,
          original: trimmed,
        };
      } else {
        return {
          trigger: match[0],
          behavior: match[1] || match[0],
          original: trimmed,
        };
      }
    }
  }
  return null;
}

function insertCommitment(commitment) {
  const db = new Database(DB_PATH);
  const id = commitment.id || `commit-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const stmt = db.prepare(`
    INSERT INTO commitments (id, commitment_text, created_at, source_note_id, target_behavior, triggered_count, resolved)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    commitment.commitment_text,
    commitment.created_at || new Date().toISOString(),
    commitment.source_note_id || null,
    commitment.target_behavior || null,
    commitment.triggered_count || 0,
    commitment.resolved || 0
  );
  db.close();
  return id;
}

function getUnresolvedCommitments() {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM commitments WHERE resolved = 0 ORDER BY created_at DESC');
  const results = stmt.all();
  db.close();
  return results;
}

function incrementCommitmentTrigger(id) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare('UPDATE commitments SET triggered_count = triggered_count + 1 WHERE id = ?');
  stmt.run(id);
  db.close();
}

function resolveCommitment(id) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare('UPDATE commitments SET resolved = 1, resolved_at = ? WHERE id = ?');
  stmt.run(new Date().toISOString(), id);
  db.close();
}

function getCommitmentsByNoteId(noteId) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM commitments WHERE source_note_id = ?');
  const results = stmt.all(noteId);
  db.close();
  return results;
}

// ─── Mirror / Alerts ─────────────────────────────────────────

function insertMirrorAlert(alert) {
  const db = new Database(DB_PATH);
  const id = alert.id || `alert-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const stmt = db.prepare(`
    INSERT INTO mirror_alerts (id, alert_type, title, body, sent_at, dismissed)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    alert.alert_type,
    alert.title,
    alert.body,
    alert.sent_at || new Date().toISOString(),
    alert.dismissed || 0
  );
  db.close();
  return id;
}

function getRecentAlerts(limit = 10) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM mirror_alerts WHERE dismissed = 0 ORDER BY sent_at DESC LIMIT ?');
  const results = stmt.all(limit);
  db.close();
  return results;
}

function dismissAlert(id) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare('UPDATE mirror_alerts SET dismissed = 1 WHERE id = ?');
  stmt.run(id);
  db.close();
}

// ─── Mirror / Emotion Timeline ───────────────────────────────

function insertEmotion(emotion) {
  const db = new Database(DB_PATH);
  const id = emotion.id || `emotion-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`;
  const stmt = db.prepare(`
    INSERT INTO emotion_timeline (id, date, emotion_word, intensity, context, source_note_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    emotion.date || new Date().toISOString().split('T')[0],
    emotion.emotion_word,
    emotion.intensity || 3,
    emotion.context || null,
    emotion.source_note_id || null,
    new Date().toISOString()
  );
  db.close();
  return id;
}

function getEmotionTrend(days = 7) {
  const db = new Database(DB_PATH, { readonly: true });
  const since = new Date();
  since.setDate(since.getDate() - days);
  const stmt = db.prepare(`
    SELECT date, emotion_word, intensity, context
    FROM emotion_timeline
    WHERE date >= ?
    ORDER BY date ASC
  `);
  const results = stmt.all(since.toISOString().split('T')[0]);
  db.close();
  return results;
}

function getEmotionStats(days = 30) {
  const db = new Database(DB_PATH, { readonly: true });
  const since = new Date();
  since.setDate(since.getDate() - days);
  const emotions = db.prepare(`
    SELECT emotion_word, intensity, date
    FROM emotion_timeline
    WHERE date >= ?
    ORDER BY date ASC
  `).all(since.toISOString().split('T')[0]);
  db.close();

  if (emotions.length === 0) {
    return { count: 0, avgIntensity: 0, distribution: { positive: 0, neutral: 0, negative: 0 } };
  }

  // 情绪分布
  const POSITIVE = ['开心', '高兴', '兴奋', '满足', '愉快', '轻松', '不错', '顺利', '成功', '突破', '成就感', '舒服'];
  const NEGATIVE = ['焦虑', '担心', '担忧', '不安', '紧张', '压力', '累', '疲惫', '困', '郁闷', '烦躁', '沮丧', '失落', '失望', '伤心', '难过', '压力大'];

  const distribution = { positive: 0, neutral: 0, negative: 0 };
  let totalIntensity = 0;

  for (const e of emotions) {
    totalIntensity += e.intensity || 3;
    if (POSITIVE.some(kw => e.emotion_word && e.emotion_word.includes(kw))) {
      distribution.positive++;
    } else if (NEGATIVE.some(kw => e.emotion_word && e.emotion_word.includes(kw))) {
      distribution.negative++;
    } else {
      distribution.neutral++;
    }
  }

  return {
    count: emotions.length,
    avgIntensity: totalIntensity / emotions.length,
    distribution,
  };
}

function detectEmotionAnomaly(days = 7, threshold = 0.3) {
  // 比较最近 N 天 vs 前 N 天
  const now = new Date();
  const recentStart = new Date(now);
  recentStart.setDate(recentStart.getDate() - days);
  const olderStart = new Date(recentStart);
  olderStart.setDate(olderStart.getDate() - days);

  const db = new Database(DB_PATH, { readonly: true });
  
  const recent = db.prepare(`
    SELECT emotion_word, intensity
    FROM emotion_timeline
    WHERE date >= ?
  `).all(recentStart.toISOString().split('T')[0]);
  
  const older = db.prepare(`
    SELECT emotion_word, intensity
    FROM emotion_timeline
    WHERE date >= ? AND date < ?
  `).all(olderStart.toISOString().split('T')[0], recentStart.toISOString().split('T')[0]);
  
  db.close();

  const POSITIVE = ['开心', '高兴', '兴奋', '满足', '愉快', '轻松', '不错', '顺利', '成功', '突破', '成就感', '舒服'];
  const NEGATIVE = ['焦虑', '担心', '担忧', '不安', '紧张', '压力', '累', '疲惫', '困', '郁闷', '烦躁', '沮丧', '失落', '失望', '伤心', '难过', '压力大'];

  function calcScore(notes) {
    if (notes.length === 0) return 0.5;
    let score = 0;
    for (const n of notes) {
      if (POSITIVE.some(kw => n.emotion_word && n.emotion_word.includes(kw))) score += 1;
      else if (NEGATIVE.some(kw => n.emotion_word && n.emotion_word.includes(kw))) score -= 1;
    }
    return (score + notes.length) / (notes.length * 2); // 归一化到 0-1
  }

  const recentScore = calcScore(recent);
  const olderScore = calcScore(older);

  const change = recentScore - olderScore;

  return {
    recentScore,
    olderScore,
    change,
    isAnomaly: Math.abs(change) >= threshold,
    direction: change < 0 ? '下降' : change > 0 ? '上升' : '持平',
  };
}

// ─── Mirror / Relationship Tracking ──────────────────────────

function upsertRelationship(personName, emotion) {
  const db = new Database(DB_PATH);
  const sentiment = emotion === 'positive' ? 1 : emotion === 'negative' ? -1 : 0;
  
  const existing = db.prepare('SELECT * FROM relationship_tracking WHERE person_name = ?').get(personName);
  
  if (existing) {
    const stmt = db.prepare(`
      UPDATE relationship_tracking
      SET mention_count = mention_count + 1,
          positive_count = positive_count + ?,
          negative_count = negative_count + ?,
          last_mentioned = ?,
          last_emotion = ?
      WHERE person_name = ?
    `);
    const posInc = sentiment === 1 ? 1 : 0;
    const negInc = sentiment === -1 ? 1 : 0;
    stmt.run(posInc, negInc, new Date().toISOString(), emotion, personName);
  } else {
    const stmt = db.prepare(`
      INSERT INTO relationship_tracking (id, person_name, mention_count, positive_count, negative_count, last_mentioned, last_emotion)
      VALUES (?, ?, 1, ?, ?, ?, ?)
    `);
    stmt.run(`rel-${Date.now()}`, personName, sentiment === 1 ? 1 : 0, sentiment === -1 ? 1 : 0, new Date().toISOString(), emotion);
  }
  
  db.close();
}

function getRelationships() {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM relationship_tracking ORDER BY mention_count DESC');
  const results = stmt.all();
  db.close();
  return results;
}

/**
 * 从最近 N 条笔记中同步关系数据
 * 扫描笔记的 extracted_entities.people 字段，结合情绪分析，更新 relationship_tracking
 */
function syncRelationshipsFromNotes(days = 7) {
  const db = new Database(DB_PATH, { readonly: true });
  const since = new Date();
  since.setDate(since.getDate() - days);

  const notes = db.prepare(`
    SELECT id, date, raw_text, extracted_entities, ai_summary
    FROM notes
    WHERE date >= ?
    ORDER BY date DESC
  `).all(since.toISOString().split('T')[0]);
  db.close();

  if (!notes || notes.length === 0) return { synced: 0 };

  const emotionKeywords = {
    positive: ['开心', '高兴', '顺利', '成功', '兴奋', '满足', '愉快', '突破', '感谢', '温暖', '舒服', '期待'],
    negative: ['焦虑', '担心', '生气', '烦躁', '失落', '沮丧', '伤心', '郁闷', '压力', '累', '疲惫', '害怕', '讨厌'],
  };

  function detectEmotion(text) {
    const t = text || '';
    const pos = emotionKeywords.positive.some(kw => t.includes(kw));
    const neg = emotionKeywords.negative.some(kw => t.includes(kw));
    if (pos && !neg) return 'positive';
    if (neg && !pos) return 'negative';
    if (pos && neg) return 'mixed';
    return null;
  }

  let count = 0;
  for (const note of notes) {
    let entities = [];
    try {
      if (note.extracted_entities) {
        entities = JSON.parse(note.extracted_entities);
        if (!Array.isArray(entities)) entities = [];
      }
    } catch {}

    const people = entities.filter(e => e && (e.type === 'people' || e.type === 'person' || e.name));

    const noteText = (note.raw_text || '') + ' ' + (note.ai_summary || '');
    const emotion = detectEmotion(noteText);

    for (const person of people) {
      const name = person.name || person;
      if (typeof name !== 'string' || name.length < 2) continue;
      upsertRelationship(name, emotion || 'neutral');
      count++;
    }
  }

  return { synced: count };
}

// ─── Profile Signals（被动观察模式）──────────────────────────────

function insertProfileSignal(signal) {
  const db = new Database(DB_PATH);
  const id = signal.id || `sig_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const stmt = db.prepare(`
    INSERT INTO profile_signals (id, dimension, signal, confidence, source, conversation_id, created_at, last_reinforced, detail, meta)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?)
  `);
  stmt.run(id, signal.dimension, signal.signal, signal.confidence || 0.5, signal.source || 'observe', signal.conversation_id || null, signal.detail || null, signal.meta || null);
  db.close();
  return id;
}

function getProfileSignals(dimension = null, limit = 100) {
  const db = new Database(DB_PATH, { readonly: true });
  let stmt;
  if (dimension) {
    stmt = db.prepare('SELECT * FROM profile_signals WHERE dimension = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(dimension, limit);
  }
  stmt = db.prepare('SELECT * FROM profile_signals ORDER BY created_at DESC LIMIT ?');
  const results = stmt.all(limit);
  db.close();
  return results;
}

function getProfileSignalStats() {
  const db = new Database(DB_PATH, { readonly: true });
  const total = db.prepare('SELECT COUNT(*) as c FROM profile_signals').get().c;
  const today = db.prepare(`SELECT COUNT(*) as c FROM profile_signals WHERE date(created_at) = date('now')`).get().c;
  const byDim = db.prepare('SELECT dimension, COUNT(*) as c FROM profile_signals GROUP BY dimension').all();
  db.close();
  return { total, today, byDimension: byDim };
}

function updateSignalReinforce(id) {
  const db = new Database(DB_PATH);
  db.prepare("UPDATE profile_signals SET last_reinforced = datetime('now') WHERE id = ?").run(id);
  db.close();
}

// ─── Ideas ───────────────────────────────────────────────────

function insertIdea(idea) {
  const db = new Database(DB_PATH);
  const id = idea.id || `idea_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const stmt = db.prepare(`
    INSERT INTO ideas (id, raw_text, ai_summary, dimension, source, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'collected', datetime('now'), datetime('now'))
  `);
  stmt.run(id, idea.raw_text, idea.ai_summary || idea.raw_text, idea.dimension || 'general', idea.source || 'observe');
  db.close();
  return id;
}

function getIdeas(status = null, limit = 100) {
  const db = new Database(DB_PATH, { readonly: true });
  let stmt;
  if (status) {
    stmt = db.prepare('SELECT * FROM ideas WHERE status = ? ORDER BY created_at DESC LIMIT ?');
    return stmt.all(status, limit);
  }
  stmt = db.prepare('SELECT * FROM ideas ORDER BY created_at DESC LIMIT ?');
  const results = stmt.all(limit);
  db.close();
  return results;
}

function updateIdeaStatus(id, status, brainstormNotes = null) {
  const db = new Database(DB_PATH);
  if (brainstormNotes !== null) {
    const stmt = db.prepare("UPDATE ideas SET status = ?, brainstorm_notes = ?, brainstormed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?");
    stmt.run(status, brainstormNotes, id);
  } else {
    const stmt = db.prepare("UPDATE ideas SET status = ?, updated_at = datetime('now') WHERE id = ?");
    stmt.run(status, id);
  }
  db.close();
}

function promoteIdeaToTodo(id, todoId) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare("UPDATE ideas SET status = ?, promoted_to_todo_id = ?, promoted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?");
  stmt.run('promoted', todoId, id);
  db.close();
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

// ─── Week Plans CRUD ────────────────────────────────────────

function insertWeekPlan(plan) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare(`
    INSERT INTO week_plans (id, week_iso, year, week_num, start_date, end_date, status, carryover_from_id, template_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    plan.id,
    plan.week_iso,
    plan.year,
    plan.week_num,
    plan.start_date,
    plan.end_date,
    plan.status || 'planning',
    plan.carryover_from_id || null,
    plan.template_id || null
  );
  db.close();
  return plan.id;
}

function getWeekPlan(id) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM week_plans WHERE id = ?');
  const plan = stmt.get(id);
  db.close();
  return plan;
}

function getWeekPlanByIso(weekIso) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM week_plans WHERE week_iso = ?');
  const plan = stmt.get(weekIso);
  db.close();
  return plan;
}

function updateWeekPlanStatus(id, status) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare(`
    UPDATE week_plans SET status = ?, updated_at = datetime('now') WHERE id = ?
  `);
  stmt.run(status, id);
  db.close();
}

// ─── Week Plan Items CRUD ───────────────────────────────────

function generateItemId() {
  return `wpi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function insertWeekPlanItem(item) {
  const db = new Database(DB_PATH);
  const id = item.id || generateItemId();
  const stmt = db.prepare(`
    INSERT INTO week_plan_items
      (id, plan_id, title, description, project, priority, assignee, expected_outcome, status, sort_order, source, auto_detected_from_note_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    id,
    item.plan_id,
    item.title,
    item.description || null,
    item.project || null,
    item.priority || null,
    item.assignee || '我',
    item.expected_outcome || null,
    item.status || 'pending',
    item.sort_order || 0,
    item.source || 'weekplan',
    item.auto_detected_from_note_id || null
  );
  db.close();
  return id;
}

function getWeekPlanItem(id) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM week_plan_items WHERE id = ?');
  const item = stmt.get(id);
  db.close();
  return item;
}

function getWeekPlanItems(planId) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare(`
    SELECT * FROM week_plan_items
    WHERE plan_id = ?
    ORDER BY sort_order ASC, created_at ASC
  `);
  const items = stmt.all(planId);
  db.close();
  return items;
}

function getWeekPlanItemsByStatus(planId, status) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare(`
    SELECT * FROM week_plan_items
    WHERE plan_id = ? AND status = ?
    ORDER BY sort_order ASC
  `);
  const items = stmt.all(planId, status);
  db.close();
  return items;
}

function updateWeekPlanItemStatus(id, status) {
  const db = new Database(DB_PATH);
  const stmt = db.prepare(`
    UPDATE week_plan_items
    SET status = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  stmt.run(status, id);
  db.close();
}

function updateWeekPlanItem(id, fields) {
  const db = new Database(DB_PATH);
  const allowed = ['title', 'description', 'project', 'priority', 'assignee', 'expected_outcome', 'sort_order'];
  const sets = [];
  const vals = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(fields[key]);
    }
  }
  if (sets.length === 0) {
    db.close();
    return;
  }
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  const stmt = db.prepare(`UPDATE week_plan_items SET ${sets.join(', ')} WHERE id = ?`);
  stmt.run(...vals);
  db.close();
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
  // Mirror / Commitments
  extractCommitment,
  insertCommitment,
  getUnresolvedCommitments,
  incrementCommitmentTrigger,
  resolveCommitment,
  getCommitmentsByNoteId,
  // Mirror / Alerts
  insertMirrorAlert,
  getRecentAlerts,
  dismissAlert,
  // Mirror / Emotion
  insertEmotion,
  getEmotionTrend,
  getEmotionStats,
  detectEmotionAnomaly,
  // Mirror / Relationships
  upsertRelationship,
  getRelationships,
  // Profile Observer
  insertProfileSignal,
  getProfileSignals,
  getProfileSignalStats,
  updateSignalReinforce,
  // Ideas
  insertIdea,
  getIdeas,
  updateIdeaStatus,
  promoteIdeaToTodo,
  // Relationship
  syncRelationshipsFromNotes,
  // Journey
  insertJourney,
  getJourneys,
  getJourneyStats,
  // Week Plans
  insertWeekPlan,
  getWeekPlan,
  getWeekPlanByIso,
  updateWeekPlanStatus,
  // Week Plan Items
  insertWeekPlanItem,
  getWeekPlanItem,
  getWeekPlanItems,
  getWeekPlanItemsByStatus,
  updateWeekPlanItemStatus,
  updateWeekPlanItem,
};

// ─── Journey ─────────────────────────────────────────────────

function insertJourney(journey) {
  const db = new Database(DB_PATH);
  const id = journey.id || `journey_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const stmt = db.prepare(`
    INSERT INTO journeys (id, place_name, place_type, location, visited_at, notes, mood, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    id,
    journey.place_name,
    journey.place_type || 'city',
    journey.location || null,
    journey.visited_at || new Date().toISOString().split('T')[0],
    journey.notes || null,
    journey.mood || null
  );
  db.close();
  return id;
}

function getJourneys(limit = 100) {
  const db = new Database(DB_PATH, { readonly: true });
  const stmt = db.prepare('SELECT * FROM journeys ORDER BY visited_at DESC LIMIT ?');
  const results = stmt.all(limit);
  db.close();
  return results;
}

function getJourneyStats() {
  const db = new Database(DB_PATH, { readonly: true });
  const total = db.prepare('SELECT COUNT(*) as c FROM journeys').get().c;
  const byType = db.prepare('SELECT place_type, COUNT(*) as c FROM journeys GROUP BY place_type').all();
  const lastPlace = db.prepare('SELECT * FROM journeys ORDER BY visited_at DESC LIMIT 1').get();
  db.close();
  return { total, byType, lastPlace };
}
