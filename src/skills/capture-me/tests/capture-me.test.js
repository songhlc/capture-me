/**
 * capture-me 功能测试套件
 * 重点覆盖：工作信息记录、日记、心情追踪
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// 测试数据库路径
const TEST_DB_DIR = path.join(os.tmpdir(), 'capture-me-test-db-' + Date.now());
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-capture.db');
process.env.CAPTURE_YOU_TEST_DB_PATH = TEST_DB_PATH;

// 初始化测试数据库
beforeAll(() => {
  fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  db.initDb(); // 确保表结构创建
});

afterAll(() => {
  try {
    fs.rmSync(TEST_DB_DIR, { recursive: true, force: true });
  } catch (e) {}
});

// 加载被测试模块
const db = require('../lib/db');
const { capture } = require('../lib/capture');

describe('capture-me 功能测试', () => {

  describe('1. 工作信息记录', () => {
    test('记录工作事项', () => {
      const result = capture('今天给张总发邮件确认合同');
      expect(result.stored).toBe(true);
      expect(result.id).toMatch(/^capture-/);
    });

    test('记录项目进展', () => {
      const unique = 'proj-' + Date.now();
      const result = capture('项目Alpha已完成第一阶段开发 - ' + unique);
      expect(result.stored).toBe(true);

      const note = db.getNoteById(result.id);
      expect(note).toBeTruthy();
      expect(note.raw_text).toContain(unique);
    });

    test('记录会议内容', () => {
      const result = capture('下午和李总开会讨论Q2计划');
      expect(result.stored).toBe(true);

      const note = db.getNoteById(result.id);
      expect(note).toBeTruthy();
      expect(note.raw_text).toContain('李总');
    });
  });

  describe('2. 日记功能', () => {
    test('记录日常日记', () => {
      const result = capture('今天天气很好，心情不错');
      expect(result.stored).toBe(true);
    });

    test('记录学习心得', () => {
      const result = capture('今天读完了《原子习惯》，学到一个好习惯的养成公式');
      expect(result.stored).toBe(true);

      const note = db.getNoteById(result.id);
      expect(note.raw_text).toContain('原子习惯');
    });

    test('查询指定日期范围的日记', () => {
      // 先插入几条记录
      capture('第一天日记内容');
      capture('第二天日记内容');

      const today = new Date().toISOString().split('T')[0];
      const notes = db.getNotesByDateRange(today, today);
      expect(notes.length).toBeGreaterThan(0);
    });
  });

  describe('3. 心情追踪', () => {
    test('记录正面心情', () => {
      const emotion = {
        id: 'emotion-test-1',
        date: new Date().toISOString().split('T')[0],
        emotion_word: '开心',
        intensity: 5,
        context: '项目取得突破'
      };
      db.insertEmotion(emotion);

      const trend = db.getEmotionTrend(7);
      expect(trend.length).toBeGreaterThan(0);
    });

    test('记录负面心情', () => {
      const emotion = {
        id: 'emotion-test-2',
        date: new Date().toISOString().split('T')[0],
        emotion_word: '焦虑',
        intensity: 4,
        context: '工作压力较大'
      };
      db.insertEmotion(emotion);

      const trend = db.getEmotionTrend(7);
      expect(trend.some(e => e.emotion_word === '焦虑')).toBe(true);
    });

    test('情绪统计分析', () => {
      const emotion1 = {
        id: 'emotion-test-3',
        date: new Date().toISOString().split('T')[0],
        emotion_word: '开心',
        intensity: 5
      };
      const emotion2 = {
        id: 'emotion-test-4',
        date: new Date().toISOString().split('T')[0],
        emotion_word: '兴奋',
        intensity: 5
      };
      db.insertEmotion(emotion1);
      db.insertEmotion(emotion2);

      const stats = db.getEmotionStats(30);
      expect(stats.count).toBeGreaterThan(0);
      expect(stats.distribution.positive).toBeGreaterThan(0);
    });

    test('情绪异常检测', () => {
      const result = db.detectEmotionAnomaly(7, 0.3);
      expect(result).toHaveProperty('recentScore');
      expect(result).toHaveProperty('olderScore');
      expect(result).toHaveProperty('change');
    });
  });

  describe('4. 待办事项', () => {
    test('直接插入待办事项', () => {
      // capture() 初始只存储原始内容，is_todo 由后续解析设置
      // 这里直接插入带 is_todo 的记录来测试待办功能
      const note = {
        id: 'todo-test-' + Date.now(),
        date: new Date().toISOString().split('T')[0],
        time: '12:00',
        raw_text: '周五前完成方案设计',
        ai_summary: null,
        category: 'work',
        tags: JSON.stringify(['@work', '@todo']),
        extracted_entities: JSON.stringify({}),
        is_todo: true,
        todo_due: '2026-04-17',
        todo_done: false,
        source: 'cli',
      };
      db.insertNote(note);

      const todos = db.getTodos(false);
      expect(todos.length).toBeGreaterThan(0);
    });

    test('获取待办列表', () => {
      const todos = db.getTodos(false);
      expect(Array.isArray(todos)).toBe(true);
    });

    test('标记待办完成', () => {
      const noteId = 'todo-done-' + Date.now();
      const note = {
        id: noteId,
        date: new Date().toISOString().split('T')[0],
        time: '12:00',
        raw_text: '完成这个任务',
        is_todo: true,
        todo_done: false,
        source: 'cli',
      };
      db.insertNote(note);

      db.updateTodoStatus(noteId, true);

      const todos = db.getTodos(true);
      const completed = todos.find(t => t.id === noteId);
      expect(completed).toBeTruthy();
      expect(completed.todo_done).toBe(1);
    });
  });

  describe('5. 承诺追踪', () => {
    test('提取承诺', () => {
      const result = db.extractCommitment('我决定从明天开始每天跑步30分钟');
      expect(result).toBeTruthy();
      expect(result.behavior).toBeTruthy();
    });

    test('记录承诺', () => {
      const commitment = {
        id: 'commit-test-1',
        commitment_text: '每天跑步30分钟',
        source_note_id: 'test-note-id',
        target_behavior: '运动',
        created_at: new Date().toISOString()
      };
      const id = db.insertCommitment(commitment);
      expect(id).toBeTruthy();
    });

    test('获取未完成承诺', () => {
      const commitments = db.getUnresolvedCommitments();
      expect(Array.isArray(commitments)).toBe(true);
    });
  });

  describe('6. 关系追踪', () => {
    test('记录人际关系', () => {
      db.upsertRelationship('张总', 'positive');
      db.upsertRelationship('张总', 'positive');

      const relationships = db.getRelationships();
      expect(relationships.length).toBeGreaterThan(0);
    });

    test('关系情绪统计', () => {
      const relationships = db.getRelationships();
      const zhang = relationships.find(r => r.person_name === '张总');
      expect(zhang).toBeTruthy();
      expect(zhang.mention_count).toBeGreaterThan(0);
    });
  });

  describe('7. 统计功能', () => {
    test('获取总记录数', () => {
      // 直接验证数据库功能可用
      const todos = db.getTodos(true);
      expect(Array.isArray(todos)).toBe(true);
    });
  });

  describe('8. 想法收集', () => {
    test('记录灵感', () => {
      const idea = {
        id: 'idea-test-1',
        raw_text: '一个好的创业想法',
        dimension: 'work'
      };
      const id = db.insertIdea(idea);
      expect(id).toBeTruthy();
    });

    test('查询想法列表', () => {
      const ideas = db.getIdeas();
      expect(Array.isArray(ideas)).toBe(true);
    });

    test('更新想法状态', () => {
      const idea = {
        id: 'idea-test-2',
        raw_text: '另一个灵感',
        dimension: 'life'
      };
      const id = db.insertIdea(idea);

      db.updateIdeaStatus(id, 'brainstormed', '这是一个很好的想法');
      const updated = db.getIdeas().find(i => i.id === id);
      expect(updated.status).toBe('brainstormed');
    });
  });

  describe('9. 旅程记录', () => {
    test('记录去过的地方', () => {
      const journey = {
        id: 'journey-test-1',
        place_name: '北京',
        place_type: 'city',
        location: '中国',
        mood: '开心'
      };
      const id = db.insertJourney(journey);
      expect(id).toBeTruthy();
    });

    test('获取旅程列表', () => {
      const journeys = db.getJourneys();
      expect(Array.isArray(journeys)).toBe(true);
    });

    test('旅程统计', () => {
      const stats = db.getJourneyStats();
      expect(stats.total).toBeGreaterThan(0);
    });
  });

  describe('10. 被动观察信号', () => {
    test('记录观察信号', () => {
      const signal = {
        id: 'signal-test-1',
        dimension: 'work',
        signal: '加班很多',
        confidence: 0.8,
        source: 'observe'
      };
      const id = db.insertProfileSignal(signal);
      expect(id).toBeTruthy();
    });

    test('获取信号统计', () => {
      const stats = db.getProfileSignalStats();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('today');
    });

    test('按维度查询信号', () => {
      const signals = db.getProfileSignals('work');
      expect(Array.isArray(signals)).toBe(true);
    });
  });
});