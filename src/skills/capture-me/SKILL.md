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
| `weekplan [create\|list\|show\|skip\|checkin]` | Week Plan 模式（周一规划、每日 check-in、自动 carryover）|
| `weekplan setup` | 一次性注册 3 个 launchd 定时任务（周一09:00 创建 / 工作日18:00 进展 / 周五17:30 周报） |

---

## ⚠️ Agent 行为约定：首次使用 weekplan 自动注册定时任务

任何 Agent（Claude Code / OpenClaw / Hermes / Codex / ...）在用户**首次**调用 `weekplan` 任意子命令时，**必须**先执行：

```bash
node lib/weekplan.js setup --check
```

若退出码 ≠ 0（缺定时任务），Agent **必须主动询问**：

> "检测到 weekplan 还没注册定时任务，是否要自动注册？
>  · 周一 09:00 — 提醒创建本周计划
>  · 工作日 18:00 — 提醒补齐专项进展
>  · 周五 17:30 — 自动生成本周周报
>  消息出口会自动复用你当前 Agent 的通知通道（飞书/钉钉/Apple Reminders，按平台探测）。"

用户同意后执行：

```bash
node lib/weekplan.js setup
```

**通知通道探测顺序**（zero-config）：
1. `$WEEKPLAN_NOTIFY_CMD` / `$OPENCLAW_NOTIFY_CMD` / `$HERMES_NOTIFY_CMD`（命令模板，用 `{msg}` 占位）
2. PATH 中的 `openclaw notify` / `hermes notify`
3. `terminal-notifier` / `osascript`（macOS）
4. stdout 兜底

Agent 不应让用户填写飞书 token / webhook —— 通道复用 Agent 平台已有的对接。

如需卸载：`node lib/weekplan.js setup --remove`。

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

## 实现文件（Skill 规范结构）

```
capture-me/
├── SKILL.md              # Skill 元数据
├── README.md             # 项目说明
├── ROADMAP.md           # 开发路线图
├── package.json         # npm 配置
├── config.yaml          # 配置文件
├── bin/                  # CLI 入口
│   ├── capture-me       # 主命令
│   ├── trigger          # 触发检查
│   ├── observe-core     # 观察统计
│   └── dashboard        # 仪表盘
├── lib/                  # 功能模块
│   ├── capture.js       # 记录解析主逻辑
│   ├── db.js            # SQLite 操作
│   ├── mirror.js        # 认知镜子（承诺追踪）
│   ├── review.js        # 周报/月报生成
│   ├── profile.js       # 性格画像生成
│   ├── personality.js   # 大五人格 + MBTI + SDT
│   ├── brainstorm.js    # 头脑风暴引擎
│   ├── blindspot.js     # 盲区探测
│   ├── trigger.js       # 主动触发引擎
│   ├── observe-core.js  # 被动观察核心库
│   ├── observe-async.js # 异步观察写入
│   ├── external-data.js # 外部数据接入
│   ├── config.js       # 配置管理
│   ├── dashboard.js    # Web 仪表盘
│   ├── stat.js          # 统计信息
│   ├── query.js        # 搜索查询
│   ├── setup.js        # 初始化引导
│   ├── projects.js     # 项目管理
│   └── achievements.js # 成就系统
├── scripts/             # 工具脚本
│   ├── init-db.sh
│   ├── install.sh
│   └── check-todos.js
├── references/          # 参考文档
│   └── HOOK-INTEGRATION.md  # Hook 集成说明
├── sqlite/             # 数据库
│   └── capture.db
├── memory/             # 用户数据
├── templates/          # 模板文件
├── logs/              # 日志
└── queue/             # 失败队列
```

### OpenClaw Hook（独立部署）

```
~/.openclaw/hooks/capture-me-observer/
├── HOOK.md           # Hook 元数据
├── handler.js       # OpenClaw 事件处理
└── write-signals.js # 异步写入（调用 capture-me/lib/observe-async.js）
```

Hook 调用关系：
```
OpenClaw message:preprocessed
    ↓
handler.js (OpenClaw Hook)
    ↓
observe-async.js (capture-me/lib)
    ↓
profile_signals 表 (capture-me/sqlite/capture.db)
```

### OpenClaw Cron（定时任务）

```
~/.openclaw/cron/
e14a590f-f43b-45ee-b324-e503eaf29c75
  name: capture-me-daily-trigger
  schedule: 0 9 * * * @ Asia/Shanghai
  command: node .../bin/trigger check
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

## 被动观察模式（Observer）

### 架构设计

capture-me 的被动观察是一个**多 Agent 共用的信号收集核心库**，不同 Agent 通过各自的 hook 机制调用。

```
┌─────────────────────────────────────────────────────────────┐
│                    各 Agent Hook 实现                        │
├─────────────────────────────────────────────────────────────┤
│  OpenClaw Hook    → message:preprocessed 事件              │
│  Claude Code Hook → post-processing hook                   │
│  Codex Hook       → post-response hook                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              capture-me 核心库                             │
│  observe-core.js                                          │
│  ├── extractSignals(text, source) → 信号[]                │
│  ├── analyzeAndStore(text, source) → 同步写入              │
│  └── analyzeAndStoreAsync(text, source) → 异步静默写入    │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│              profile_signals 表                             │
│  ~/.claude/skills/capture-me/sqlite/capture.db             │
└─────────────────────────────────────────────────────────────┘
```

### 信号维度（8个）

| 维度 | 说明 | 触发词示例 |
|------|------|-----------|
| work | 工作相关信息 | 开会、项目、加班、老板 |
| life | 日常生活 | 吃饭、购物、出行、休息 |
| habit | 习惯行为 | 每天、熬夜、习惯、早起 |
| emotion | 情绪状态 | 开心、焦虑、累、兴奋 |
| preference | 偏好倾向 | 喜欢、讨厌、希望、想要 |
| goal | 目标计划 | 目标、打算、计划、决定 |
| relation | 人际关系 | 老婆、同事、朋友、家人 |
| health | 健康状态 | 睡眠、运动、身体、疲惫 |

### OpenClaw 集成

OpenClaw Hook 位于：`~/.openclaw/hooks/capture-me-observer/`

```javascript
// handler.js — OpenClaw Hook
const { spawn } = require('child_process');
const path = require('path');

async function handler(event) {
  if (event.type !== 'message' || event.action !== 'preprocessed') return;
  
  const { content, conversationId } = event.context || {};
  if (!content || content.trim().length < 3) return;

  spawn('node', [
    path.join(CAPTURE_ME_DIR, 'observe-async.js'),
    JSON.stringify({ text: content, source: 'openclaw', conversation_id: conversationId })
  ], { detached: true, stdio: 'ignore' }).unref();
}
```

### CLI 用法

```bash
# 分析文本
node observe-core.js "我最近工作压力很大"

# 查看统计
node observe-core.js --stat

# 重试失败队列
node observe-core.js --retry
```

### 失败处理

- 异步写入失败时，暂存到 `queue/failed-*.json`
- 日志记录到 `logs/observe-*.log`
- 可手动运行 `--retry` 重试

---

## 工作内容捕获（Work Capture）

工作相关记录的核心原则：**SQLite 为主存储，Markdown 按需写入**

### 工作记录识别

当输入包含以下特征时，自动识别为工作记录：
- 提及具体项目名（如 YNF2MDF、客户名）
- 技术术语（架构、部署、代码、API）
- 会议、汇报、邮件相关
- 进度更新、里程碑

### 工作记录标签体系

```
@work                    — 通用工作事务
@work/project/项目名     — 特定项目（如 @work/project/YNF2MDF）
@work/meeting            — 会议记录
@work/email              — 邮件相关
@work/report             — 汇报/报告
@work/followup           — 需要跟进的
@work/decision           — 决策结论
@progress/项目名         — 项目进度（如 @progress/YNF2MDF）
```

### 简化捕获流程

工作内容捕获路径（推荐）：

```
用户输入 → capture.js → SQLite(notes表) → 解析 → projects表更新
                                ↓
                         Markdown(按需)
```

**当前流程问题**：capture.js 会在捕获时同时写入 `capture-log.md` 和 `promises.md`，每次都要：
1. `ensureMemoryFiles()` — 检查/创建文件
2. `appendToCaptureLog()` — 读全文 → 找插入点 → 修改 → 写回
3. `appendToPromises()` — 读全文 → 正则替换 → 写回

**优化后的流程**：对于纯工作记录，直接写 SQLite，Markdown 同步由 `projects.js export` 统一处理。

### 项目进度自动更新

当记录包含项目名且标注进度时，自动更新 projects 表：

```
输入：YNF2MDF 扩展脚本都转完了

解析结果：
{
  "summary": "YNF2MDF扩展脚本转换完成",
  "category": "work",
  "tags": ["@work", "@work/project/YNF2MDF", "@progress/YNF2MDF"],
  "is_project_update": true,
  "project_name": "YNF2MDF",
  "project_progress_delta": +20
}
```

### 大模型解析指令（工作记录）

```json
{
  "action": "parse_capture",
  "note_id": "capture-xxx",
  "raw_text": "YNF2MDF 扩展脚本都转完了",
  "extract": {
    "summary": "一句话摘要",
    "category": "work",
    "tags": ["@work", "@work/project/项目名"],
    "entities": {...},
    "is_project_update": true/false,
    "project_name": "项目名",
    "project_progress_delta": 10,
    "is_todo": false
  }
}
```

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
