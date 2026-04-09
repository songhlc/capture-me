---
name: capture-you
description: 随手捕捉 → AI 解析 → 自动归类 → 双存储（Markdown + SQLite）→ Apple Reminders 定时提醒 + 性格画像
user-invocable: true
argument-hint: "[init|note|query|todos|done|review|profile|stat] [内容]"
---

# Capture-You — AI 增强型随手捕捉系统

## 系统架构

```
┌─────────────────────────────────────────────┐
│  用户入口（自然语言 note 命令）               │
│  note 今天跟张总确认合同，下周签约            │1
└──────────────┬──────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────┐
│  AI 理解层（模型无关，可插拔）                │
│  · 意图识别（记录/查询/复盘/待办）            │
│  · 实体提取（人名/时间/地点/邮箱/金额）       │
│  · 标签生成                                  │
│  · 摘要压缩                                  │
└──────────────┬──────────────────────────────┘
               │
        ┌──────┴──────┐
        ▼             ▼
┌──────────────┐  ┌──────────────┐
│ Markdown 文件 │  │ SQLite 索引  │
│ 原始内容存储  │  │ 加速检索     │
└──────────────┘  └──────────────┘
```

## 数据存储

### 目录结构

```
~/.capture-you/           # 或 $PROJECT_ROOT/memory/
├── notes/                # 原始 Markdown 文件
│   ├── 2026/
│   │   ├── 04/
│   │   │   ├── 2026-04-09.md
│   │   │   └── 2026-04-10.md
├── sqlite/
│   └── capture.db       # SQLite 数据库
└── config.yaml          # 用户配置、分类体系

# 兼容现有 memory/ 结构
memory/
├── capture-log.md       # 随手记原始记录
├── promises.md          # 承诺与待办追踪
├── tag-taxonomy.md      # 标签分类体系
└── personality.md        # 性格画像
```

### SQLite 表结构

```sql
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  date TEXT,              -- 2026-04-09
  time TEXT,              -- 14:32
  raw_text TEXT,          -- 原始输入
  ai_summary TEXT,        -- AI 生成的摘要
  category TEXT,          -- work/life/health/idea/todo/goal
  tags TEXT,              -- JSON 数组：["张总","合同","签约"]
  extracted_entities TEXT, -- JSON：{people:[], dates:[], emails:[]}
  is_todo INTEGER,        -- 是否含待办
  todo_due TEXT,          -- 截止日期
  todo_done INTEGER,      -- 是否完成
  source TEXT             -- cli/feishu/capture-you
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
| `init` | 初始化用户画像（首次使用引导） |
| `note <内容>` | 自然语言记录，AI 实时处理 |
| `query <关键词>` | 搜索历史笔记 |
| `todos` | 查看所有待办 |
| `done <id>` | 标记待办完成 |
| `review week` | 生成周报 |
| `review month` | 生成月报 |
| `profile` | 查看个人性格画像 |
| `stat` | 查看记录统计 |

---

## AI 处理流程

### 记录时（note）

1. 接收原始文本
2. 判断意图：记录 / 待办 / 查询 / 复盘
3. 若是记录 → 实体提取 + 标签生成 + 摘要 + 识别是否含待办
4. 写入 Markdown + 写入 SQLite
5. 若含待办 → 写入 Apple Reminders（可配）
6. 返回确认（简短）

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

从文本中自动提取：

| 实体类型 | 识别示例 | 提取结果 |
|----------|----------|----------|
| 人名 | "张总说"、"和李总开会" | ["张总", "李总"] |
| 时间 | "下周一"、"周五下午3点" | ["2026-04-13 09:00"] |
| 日期 | "4月15日" | ["2026-04-15"] |
| 邮箱 | "zhang@xxx.com" | ["zhang@xxx.com"] |
| 金额 | "合同款50万" | ["500000"] |
| 地点 | "在国贸开会" | ["国贸"] |

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
reminders add "给某总发邮件确认合同" --list "Inbox" --date "2026-04-13 09:00"

# 列出所有提醒
reminders list

# 完成提醒
reminders complete "给某总发邮件确认合同"
```

默认 list 名称：`Inbox`（可在 config.yaml 修改）

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
  AI摘要：确认合同细节，约定下周签约
  标签：@work @people/张总 @deadline/下周
  待办：跟进签约 ⏳ 下周
  去向：notes/2026/04/09.md + SQLite
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

### 性格画像格式
```
capture-you profile
═══════════════════════════════════════
# 性格画像 v1.0（持续更新）

## 📊 情绪仪表盘
  近30天情绪分布：
  🟢 积极：12次（40%）
  🟡 平缓：14次（47%）
  🔴 低落：4次（13%）

## ⚡ 能量状态追踪
  平均能量：6.2/10
  高能量时段：周三、周四
  低能量时段：周六

## 👥 关系网络
  高频联系人：张总（商务）、李总（项目）

## 🎯 执行力分析
  待办完成率：72%
  逾期未完成：3条
```

---

## 定期任务

### 每周日早 9 点 — 周报生成
```bash
0 9 * * 0 cd ~/.claude/skills/capture-you && node review.js week
```

### 每月最后一天 — 月报生成
```bash
0 18 28-31 * * cd ~/.claude/skills/capture-you && node review.js month
```

### 每日晚 9 点 — 待办过期检查
```bash
0 21 * * * cd ~/.claude/skills/capture-you && node check-todos.js
```

---

## 配置文件（config.yaml）

```yaml
capture-you:
  data_dir: ~/.capture-you
  memory_dir: memory  # 兼容现有结构

  reminders:
    list_name: Inbox
    default_time: "09:00"

  ai:
    enabled: true
    model: claude-sonnet-4-20250514
    summarization: true
    entity_extraction: true

  storage:
    markdown: true
    sqlite: true
    sqlite_path: ~/.capture-you/sqlite/capture.db

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
capture-you/
├── SKILL.md              # 本文档
├── capture.js           # 记录解析主逻辑
├── review.js            # 周报/月报生成
├── profile.js           # 性格画像生成
├── stat.js             # 统计信息
├── query.js            # 搜索查询
├── db.js               # SQLite 操作
├── config.yaml         # 配置文件
└── scripts/
    ├── init-db.sh      # 初始化数据库
    └── check-todos.js  # 待办过期检查
```

---

## 与现有 memory 文件的集成

现有文件保持兼容，自动升级：

| 现有文件 | 角色 | 升级说明 |
|----------|------|----------|
| `memory/capture-log.md` | 随手记主文件 | 追加 AI 摘要字段 |
| `memory/promises.md` | 承诺追踪 | 迁移至 SQLite + Markdown 双存储 |
| `memory/tag-taxonomy.md` | 标签体系 | 保持不变，作为事实源 |
| `memory/personality.md` | 性格画像 | 新增，渐进式更新 |

---

## 触发方式

1. `/capture-you init` — 初始化用户画像（首次使用）
2. `/capture-you` — 激活持续捕捉模式
3. `/capture-you note <内容>` — 快速记录
4. 直接说「帮我记」「记一下」— 触发捕捉
5. 「查一下...」「看看承诺」— 查询模式
