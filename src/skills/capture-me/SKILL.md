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

随手记（notes）SQLite + Markdown 双写；项目（projects）SQLite 唯一源。完整 schema 与 Markdown 文件格式见 `references/data-model.md`。

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

大模型在对话上下文自动提取人名 / 邮箱 / 金额 / 地点 / 时间 / 截止日期等实体。识别示例与解析样例见 `references/ai-extraction.md`。

## 标签体系

一级（@work / @life / @health / @people / @goal …）、二级、时间、状态标签 — 完整列表见 `references/tag-taxonomy.md`（与 `memory/tag-taxonomy.md` 同步）。

## 集成（Apple Reminders 等）

Apple Reminders CLI、通知通道等外部系统集成见 `references/integrations.md`；weekplan 通知探测层见 `lib/notify.js`。

## 性格分析（渐进式）

情绪 / 能量 / 关系 / 执行力 / 思维 / 健康 / 价值观 7 个维度持续更新，方法论详见 `references/personality-analysis.md`。

## 输出格式

记录确认 / 周报 / 成就解锁 / 仪表盘 / 性格画像 v2.0 的输出样例见 `references/output-formats.md`。

## 配置文件

完整 config.yaml 示例见 `references/config.md`。

## 文件结构与平台集成

完整目录结构、OpenClaw Hook、OpenClaw Cron 部署详见 `references/architecture.md`。

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

多 Agent 共用的信号收集核心库：8 个信号维度（work/life/habit/emotion/preference/goal/relation/health）、OpenClaw / Claude Code / Codex 集成、CLI 与失败处理 — 详见 `references/observer.md`。

## 工作内容捕获（Work Capture）

工作记录识别规则、工作标签体系、简化捕获流程、项目进度自动更新 — 详见 `references/work-capture.md`。

## 触发方式

- **主动调用** — 用户输入以 `/capture-me` 开头的任意自然语言进入随手记；显式子命令见上方[核心命令](#核心命令)表。
- **被动观察** — OpenClaw / Claude Code / Codex / Hermes 等 Agent 通过 hook 在对话中自动提取信号写入 `profile_signals` 表，无需用户主动调用；详见 `references/observer.md`。
- **定时触发** — `weekplan setup` 一次性注册 3 个 launchd 任务：周一 09:00 提醒建本周计划、工作日 18:00 提示补齐进展、周五 17:30 自动生成周报；通知通道自动复用当前 Agent 已对接的飞书/钉钉/Reminders。
