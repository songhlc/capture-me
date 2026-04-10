/**
 * db.js 单元测试
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// 测试用临时数据库
const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-db-test');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-capture.db');

// 在加载模块前设置测试路径
process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

describe('db.js - 数据库初始化', () => {
  beforeAll(() => {
    if (!fs.existsSync(TEST_DB_DIR)) {
      fs.mkdirSync(TEST_DB_DIR, { recursive: true });
    }
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    if (fs.existsSync(TEST_DB_DIR)) {
      fs.rmdirSync(TEST_DB_DIR, { recursive: true });
    }
  });

  test('测试目录存在', () => {
    expect(fs.existsSync(TEST_DB_DIR)).toBe(true);
  });
});

describe('db.js - 数据操作', () => {
  // 加载被测试模块
  const db = require('../db');

  const testNote = {
    id: `test-${Date.now()}`,
    date: '2026-04-09',
    time: '14:32',
    raw_text: '测试记录内容',
    ai_summary: 'AI摘要',
    category: 'work',
    tags: JSON.stringify(['@work', '@test']),
    extracted_entities: JSON.stringify({ people: ['张总'], emails: [] }),
    is_todo: false,
    todo_due: null,
    todo_done: 0,
    source: 'test',
  };

  test('insertNote 返回 note id', () => {
    const id = db.insertNote(testNote);
    expect(id).toBe(testNote.id);
  });

  test('getNoteById 能获取插入的记录', () => {
    const note = db.getNoteById(testNote.id);
    expect(note).toBeDefined();
    expect(note.raw_text).toBe('测试记录内容');
    expect(note.category).toBe('work');
  });

  test('getNoteById 对不存在的 id 返回 undefined', () => {
    const note = db.getNoteById('non-existent-id');
    expect(note).toBeUndefined();
  });

  test('updateTodoStatus 能更新待办状态', () => {
    const todoNote = {
      ...testNote,
      id: `test-todo-${Date.now()}`,
      is_todo: true,
      todo_due: '2026-04-10',
      todo_done: 0,
    };
    db.insertNote(todoNote);

    db.updateTodoStatus(todoNote.id, true);
    const updated = db.getNoteById(todoNote.id);
    expect(updated.todo_done).toBe(1);
  });

  test('getTodos 返回所有待办', () => {
    const todos = db.getTodos();
    expect(Array.isArray(todos)).toBe(true);
  });

  test('getTodos(includeDone=false) 只返回未完成的', () => {
    const pending = db.getTodos(false);
    for (const t of pending) {
      expect(t.todo_done).toBe(0);
    }
  });

  test('deleteNote 能删除记录', () => {
    const deleteNote = {
      ...testNote,
      id: `test-delete-${Date.now()}`,
    };
    db.insertNote(deleteNote);

    db.deleteNote(deleteNote.id);
    const deleted = db.getNoteById(deleteNote.id);
    expect(deleted).toBeUndefined();
  });
});

describe('db.js - 性格数据', () => {
  const db = require('../db');

  test('updatePersonality 能更新性格维度', () => {
    db.updatePersonality('情绪稳定', ['note1', 'note2']);
    const personality = db.getPersonality('情绪稳定');
    expect(personality).toBeDefined();
    expect(personality.dimension).toBe('情绪稳定');
  });

  test('getAllPersonality 返回所有性格数据', () => {
    const all = db.getAllPersonality();
    expect(Array.isArray(all)).toBe(true);
  });
});
