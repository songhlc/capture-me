# Data Model

随手记 / 项目 / 性格 / weekplan 数据存储与 Markdown 文件格式。

## 数据存储

> **随手记**（notes）：SQLite + Markdown 双写，SQLite 为查询主库，Markdown 为可读备份。
> **项目**（projects）：SQLite 唯一数据源；Markdown 为 `export` 导出视图，非写入源。

### 目录结构

```
~/.claude/skills/capture-me/   # 技能根目录
├── memory/                    # 用户数据（升级时保留）
│   ├── capture-log.md       # 随手记原始记录
│   └── promises.md          # 承诺与待办追踪
├── sqlite/
│   └── capture.db           # SQLite 数据库
├── templates/               # 模板文件
└── [*.js]                  # 功能脚本

# memory/ 目录兼容旧版结构
memory/
├── capture-log.md           # 随手记原始记录
├── promises.md             # 承诺与待办追踪
├── tag-taxonomy.md         # 标签分类体系
└── personality.md          # 性格画像
```

### SQLite 表结构

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  date TEXT,              -- 2026-04-09
  time TEXT,              -- 14:32
  raw_text TEXT,          -- 原始输入
  ai_summary TEXT,        -- 大模型生成的摘要
  category TEXT,          -- work/life/health/idea/todo/goal
  tags TEXT,              -- JSON 数组：["@work", "@people/张总"]
  extracted_entities TEXT, -- JSON：{people:[], emails:[], amounts:[], locations:[], times:[]}
  is_todo INTEGER,        -- 是否含待办
  todo_due TEXT,          -- 截止日期
  todo_done INTEGER,      -- 是否完成
  source TEXT             -- cli/capture-me
);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  project_name TEXT,
  iteration TEXT,
  assignees TEXT,          -- JSON
  status TEXT,            -- active/paused/blocked/completed
  overall_progress REAL,
  deadline TEXT,
  last_note_id TEXT,
  progress_detail TEXT,   -- JSON
  blockers TEXT,          -- JSON
  last_updated TEXT,
  created_at TEXT
);

CREATE TABLE personality (
  id INTEGER PRIMARY KEY,
  dimension TEXT,         -- 性格维度
  evidence TEXT,          -- 支撑证据（note id 列表）
  last_updated TEXT
);

CREATE INDEX idx_notes_date ON notes(date);
CREATE INDEX idx_notes_category ON notes(category);
CREATE INDEX idx_notes_tags ON notes(tags);
```

### Markdown 文件格式

```markdown
# 2026-04-09

## 14:32
今天跟张总确认了合同细节，下周签约，他的邮箱是 zhang@xxx.com。

AI摘要：确认合同细节，约定下周签约
标签：#工作 #合同 #张总
待办：跟进签约 ⏳ 下周

---

## 18:45
最近总觉得累，睡得也不好。

AI摘要：近期身体状态不佳
标签：#健康 #状态
⚠️ 已连续记录 3 次「疲惫」，建议关注
```

---

