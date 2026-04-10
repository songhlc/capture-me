---
name: capture-me
description: 习惯养成 → 定期复盘 → 自我提升：自然语言随手记，AI 解析存储，成长追踪
user-invocable: true
argument-hint: "[init|note|query|review|profile|stat|projects] [内容]"
---


# 知己 / Capture-You — AI 增强型习惯养成与复盘提升系统

## 系统架构

```
┌─────────────────────────────────────────────┐
│  用户入口（自然语言）                        │
│  /capture-me 今天跟张总确认合同，下周签约   │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  随手记存储层                               │
│  · 接收原始输入                             │
│  · 写入 SQLite + Markdown                  │
│  · 输出解析指令                            │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  大模型解析（上下文）                       │
│  · 意图识别（记录/查询/复盘/待办）          │
│  · 实体提取（人名/邮箱/金额/地点/时间）   │
│  · 标签生成 + 摘要                         │
│  · 更新 SQLite 记录                         │
└─────────────────────────────────────────────┘
```

## 核心设计原则

**存储与解析分离**：
- `capture.js` 只负责接收原始输入和存储
- 解析工作由大模型在对话上下文中完成
- 不依赖外部 API，不使用正则匹配做"AI解析"

**工作流程**：
1. 用户输入 `/capture-me <内容>`
2. capture.js 存储原始内容，输出结构化解析指令
3. 大模型看到指令，理解用户意图，提取结构化信息
4. 大模型回复 JSON 格式的解析结果
5. 数据被结构化存储，支持查询和复盘

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

## 核心命令

| 命令 | 功能 |
|------|------|
| `init` | 初始化用户画像（多步问卷引导） |
| `note <内容>` | 自然语言记录，规则实时处理 |
| `query <关键词>` | 搜索历史笔记 |
| `query todos` | 查看所有待办 |
| `review week` | 生成周报 |
| `review month` | 生成月报 |
| `profile` | 查看个人性格画像 |
| `stat` | 查看记录统计 |
| `projects [状态]` | 查看项目列表（active/paused/all） |
| `projects export` | 导出项目列表到 Markdown |

---

## AI 处理流程

### 记录时（capture）

1. 接收原始文本
2. 写入 Markdown + SQLite（原始内容）
3. 输出结构化解析指令
4. 大模型在上下文中解析，生成 JSON 结果
5. 大模型回复解析结果
6. （可选）若含待办 → 写入 Apple Reminders

### 复盘时（review）

1. 拉取本周/本月所有笔记
2. 按时间线排列，提取关键事件
3. 生成结构化周报：做了什么 / 学到什么 / 待改进 / 下周重点
4. 更新性格画像证据链

---

## 意图识别规则

### 记录类
- "今天... ""昨天... ""最近..."
- 无明确动词的陈述句

### 待办类
- 含截止时间："周五前完成"
- 承诺句式："答应张三做..."
- 提醒句式："记得给...打电话"

### 查询类
- "查一下..."、"看看..."
- "最近记了什么"
- "有哪些待办"

### 复盘类
- "周报"、"月报"
- "review"

---

## 实体提取

大模型在上下文中自动提取：

| 实体类型 | 识别示例 | 提取结果 |
|----------|----------|----------|
| 人名 | "给张总发"、"和李总开会" | ["张总", "李总"] |
| 邮箱 | "联系 zhang@xxx.com" | ["zhang@xxx.com"] |
| 金额 | "合同款50万"、"项目预算500万" | ["50万", "500万"] |
| 地点 | "在国贸开会"、"去望京" | ["国贸", "望京"] |
| 时间 | "下午3点"、"14:30" | ["下午3点", "14:30"] |
| 日期/时间 | "明天"、"周五"、"下周一" | 转换为具体日期时间 |
| 截止日期 | "周五前完成" | 自动识别为待办截止时间 |

**解析示例**：
```
输入：今天给张总发邮件确认合同，邮箱zhang@company.com，合同款50万，下周一在国贸开会

大模型解析：
{
  "summary": "确认合同细节，约定下周签约",
  "category": "work",
  "tags": ["@work", "@people/张总", "@deadline/周一"],
  "entities": {
    "people": ["张总"],
    "emails": ["zhang@company.com"],
    "amounts": ["50万"],
    "locations": ["国贸"],
    "times": ["下周一"]
  },
  "is_todo": true,
  "todo_due": "下周一"
}
```

---

## 标签体系（tag-taxonomy.md）

### 一级分类

| 标签 | 含义 | 示例 |
|------|------|------|
| @work | 工作事务 | 会议、邮件、汇报、项目跟进 |
| @investment | 投资相关 | 股票、基金、加密货币、房产 |
| @life | 生活琐事 | 购物、医疗、日常安排 |
| @project | 特定项目 | 项目专属标签，下钻用二级标签 |
| @idea | 想法与灵感 | 产品 idea、功能建议 |
| @learn | 学习与研究 | 读书笔记、技术学习 |
| @people | 人际关联 | 某总、某同事、某朋友 |
| @decision | 决定与结论 | 已拍板的结论性记录 |
| @health | 健康相关 | 睡眠、运动、饮食 |
| @goal | 目标相关 | 年度目标、阶段目标 |

### 二级标签

```
@work/email    — 邮件相关
@work/meeting  — 会议
@work/report   — 汇报/报告
@work/followup — 需要跟进的

@people/老板    — 上级
@people/colleague — 同事
@people/partner — 合作伙伴

@project/xxx   — 按项目名
```

### 时间标签

```
@deadline/今天
@deadline/明天
@deadline/周五
@deadline/下周
@deadline/月底
```

### 状态标签

```
@pending   — 待处理（默认）
@done      — 已完成
@overdue   — 已逾期
@someday   — 将来某时
```

---

## Apple Reminders 集成

使用 macOS `reminders` CLI：

```bash
# 创建提醒
reminders add "给某总发邮件确认合同" --list "提醒" --date "2026-04-13 09:00"

# 列出所有提醒
reminders list

# 完成提醒
reminders complete "给某总发邮件确认合同"
```

默认 list 名称：`提醒`（可在 config.yaml 修改）

---

## 性格分析（渐进式）

基于记录内容，持续更新以下维度：

### 情绪仪表盘
- 近30天情绪分布（积极/平缓/低落）
- 情绪触发词分析
- 情绪趋势预警

### 能量状态追踪
- 平均能量评分
- 高/低能量时段识别
- 关联因素发现（如熬夜→第二天能量下降）

### 关系网络
- 高频联系人统计
- 关系类型分布（商务/项目协作/私人）

### 执行力分析
- 待办完成率
- 逾期未完成统计
- 模式识别（工作类 vs 自我成长类）

### 思维特征
- 认知风格（分析型/创意型）
- 风险意识评估
- 决策依据偏好

### 健康基线
- 睡眠评分趋势
- 运动记录统计
- 健康关注度变化

### 价值观线索
- 多次出现的关注点
- 行为模式分析

---

## 输出格式

### 记录确认
```
✓ 已捕获
  内容：「今天跟张总确认合同，下周签约」
  ID：capture-1744232400000

请分析以上记录，提取结构化信息：
```json
{
  "action": "parse_capture",
  "note_id": "capture-1744232400000",
  "raw_text": "今天跟张总确认合同，下周签约",
  "extract": {
    "summary": "一句话摘要",
    "category": "work|life|health|idea",
    "tags": ["@work", "@people/张总"],
    "entities": {...},
    "is_todo": true,
    "todo_due": "下周一"
  }
}
```
```

### 大模型解析结果（用户回复）
```json
{
  "action": "parsed",
  "note_id": "capture-1744232400000",
  "summary": "确认合同细节，约定下周签约",
  "category": "work",
  "tags": ["@work", "@people/张总", "@deadline/下周"],
  "entities": {
    "people": ["张总"],
    "emails": [],
    "amounts": [],
    "locations": [],
    "times": []
  },
  "is_todo": true,
  "todo_due": "2026-04-14"
}
```

### 周报格式
```
📋 本周回顾 — 2026-04-07 ~ 2026-04-13
══════════════════════════════════════

## 📌 做了什么
· 确认合同细节，跟进签约事宜
· 完成项目评审会议

## 💡 学到什么
· ...

## ⚠️ 待改进
· 睡眠质量下降，需要调整作息

## 🎯 下周重点
· 签约跟进
· 项目启动

──────────────────────────────────────
📊 本周数据
  记录数：12 条
  待办完成：3/5
  情绪：🟢 积极 5次 🟡 平缓 6次 🔴 低落 1次
```

### 成就解锁通知
当满足成就条件时，capture 后会显示：
```
╔━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╗
║  🎉 新成就解锁！                              ║
╠━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╣
║  🌱 初来乍到 — 记录了第一条笔记，继续保持！     ║
╚━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╝
```

### 统计仪表盘格式
```
📊 CAPTURE-YOU 仪表盘
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 💡 连续记录
  连续记录 3 天（最长 7）

## 📝 记录概览
  总记录   42    条
  本周新增 15   条  +3
  本月新增 42    条

## 📈 30天趋势
  ▁▂▃▅▆▇█▇▅▃▂▁▂▃▄▅▆▇█▇▅▃▂▁
  日均 1.4 条  30 天有记录

## 📋 待办状态
  完成率  ████████░░ 80%  (8/10)
  ⏳ 2 待处理
  本周消化 3/5（60%）

## 📂 分类分布
  work      ████████████████████  29 条
  life      ██████               10 条
  idea      █                     1 条

## 💡 即时洞察
  🔥 已连续记录 3 天，保持这个节奏
  📅 本周↑3条
  📋 2 条待办在手
```

### 性格画像格式（v2.0）
```
🎭 性格画像 v2.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 🏷️ 人格标签
  ⚙️ 稳定推进  🌤️ 心态平和  🔋 能量偏低
  完成率50%  平缓60%  低能量100%

## 📊 五维对比（本周 vs 上周）
  情绪  ████████░░ 75% ← 60% ↑15%
  能量  ██████░░░░ 55% ← 40% ↑15%
  人际  █████████░ 85% ← 80% ↑5%
  执行  ████░░░░░░ 40% ← 35% ↑5%
  健康  █████░░░░░ 50% ← 45% ↑5%

## 📅 本周 vs 上周
  记录数：↑20条
  积极情绪：↑25%
  完成率：↑50%
  高能量：持平

## 😊 情绪仪表盘
  积极 ████░░░░░░ 40%  17次
  平缓 ██████░░░░ 60%  25次
  低落 ░░░░░░░░░░  0%   0次

## 👥 关系网络
  李总 ●●●●● 14次
  张总 ●●●●○  4次

## 🎯 执行力
  完成率 █████░░░░░ 50%
  ⏳ 2待处理

## 🏃 健康追踪
  睡眠  ●  0  运动  ●  0  饮食  ●  0
  晚睡率 █████░░░░░ 50%  (1/2天)

## 🏆 已解锁成就 (4)
  📋 项目管理者  2026/4/10
  🌙 深夜记录员  2026/4/10
  🔥 记录狂魔    2026/4/10
  🌱 初来乍到    2026/4/10
```

---

## 定期任务

### 每周日早 9 点 — 周报生成
```bash
0 9 * * 0 cd ~/.claude/skills/capture-me && node review.js week
```

### 每月最后一天 — 月报生成
```bash
0 18 28-31 * * cd ~/.claude/skills/capture-me && node review.js month
```

### 每日晚 9 点 — 待办过期检查
```bash
0 21 * * * cd ~/.claude/skills/capture-me && node check-todos.js
```

---

## 配置文件（config.yaml）

```yaml
capture-me:
  data_dir: ~/.claude/skills/capture-me
  memory_dir: memory  # 用户数据目录

  reminders:
    list_name: 提醒
    default_time: "09:00"

  ai:
    enabled: true
    model: claude-sonnet-4-20250514
    summarization: true
    entity_extraction: true

  storage:
    markdown: true
    sqlite: true
    sqlite_path: ~/.claude/skills/capture-me/sqlite/capture.db

  personality:
    enabled: true
    update_interval: daily  # daily | weekly

  categories:
    - work
    - life
    - health
    - idea
    - todo
    - goal
    - investment
```

---

## 实现文件

```
capture-me/
├── SKILL.md              # 本文档
├── capture.js           # 记录解析主逻辑
├── achievements.js      # 隐藏成就系统
├── review.js            # 周报/月报生成
├── profile.js           # 性格画像生成
├── stat.js              # 统计信息
├── query.js            # 搜索查询
├── db.js               # SQLite 操作
├── setup.js            # 初始化问卷引导
├── import.js           # 数据导入
├── backup.js           # 数据备份
├── projects.js         # 项目管理（数据源：SQLite）
├── migrate-projects.js  # 项目迁移工具（Markdown → SQLite）
├── config.yaml         # 配置文件
└── memory/             # 用户数据（升级时保留）
    ├── capture-log.md
    ├── promises.md
    └── work-progress.md  # 项目 Markdown 视图（由 SQLite 导出）
```

---

## 与现有 memory 文件的集成

| 文件 | 角色 | 说明 |
|------|------|------|
| `memory/capture-log.md` | 随手记原始记录 | 追加 AI 摘要字段 |
| `memory/promises.md` | 承诺追踪 | 追加 AI 摘要字段 |
| `memory/work-progress.md` | 项目 Markdown 视图 | 由 `projects.js export` 从 SQLite 导出生成 |
| `memory/tag-taxonomy.md` | 标签体系 | 保持不变，作为事实源 |
| `memory/personality.md` | 性格画像 | 新增，渐进式更新 |

> **数据流**：`capture.js` 写入 SQLite → 大模型解析更新记录 → `projects.js` 从 SQLite 读取 → `projects.js export` 导出 Markdown 视图

---

## 触发方式

1. `/capture-me init` — 初始化用户画像（多步问卷）
2. `/capture-me <内容>` — 直接记录任意内容
3. `/capture-me query <关键词>` — 搜索历史
4. `/capture-me review week` — 生成周报
5. `/capture-me profile` — 查看性格画像
6. `/capture-me stat` — 查看统计
7. `/capture-me projects` — 查看项目列表
8. `/capture-me projects export` — 导出项目 Markdown
