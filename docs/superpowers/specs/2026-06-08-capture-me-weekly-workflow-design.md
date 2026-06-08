# Capture-Me 周工作流：周报推送 + 模板系统 + Week Plan 模式

- **日期**：2026-06-08
- **状态**：设计已批准，待 writing-plans
- **作者**：brainstorming session
- **影响范围**：`~/.claude/skills/capture-me/` 全技能（含 lib/、bin/、templates/、config.yaml、SKILL.md）

---

## 1. 背景与目标

capture-me 现有"随手记 + 性格画像 + 周报"已稳定，但有 3 个缺口：

1. **周报没有外部出口** — `review.js` 只能在终端看，无法直接同步到用户的主战场（飞书/Notion）
2. **周报模板写死在代码里** — 改格式要改源码
3. **没有"先规划后追踪"的闭环** — 周报产出的是"过去发生了什么"，没有"未来要做什么 + 每天进展如何"

本次新增的 **周工作流** 把这 3 个缺口串成一个连贯体验：

- **Week Plan 模式**（周一早晨）：用户规划本周重点
- **每日 check-in**（周一-五 18:00）：飞书 bot 提醒，用户口述进展
- **周报生成 + 推送**（周六 18:00）：自动汇总 → 模板渲染 → 推到飞书 + Notion
- **模板系统**：默认模板 + 对话式可改

**用户决策记录**（brainstorming session 敲定）：

| 决策点 | 选型 | 备注 |
|--------|------|------|
| 整体形态 | A. 连贯工作流 | 非 3 个独立功能 |
| 运行环境依赖 | openclaw 或 hermas 二选一 | 假设已部署 + 飞书/Notion 通道就绪 |
| 推送通道 | 飞书 + Notion（多通道并存） | 首次使用 week plan 时询问，可后续改 |
| Week plan 交互 | C. 对话引导 + 智能重述 | 分步引导 + AI 重述确认 |
| Week plan 命名 | `week plan 模式`（identifier: `weekplan`） | 对仗 daily record / weekly review |
| 计划项字段 | 轻度结构化 + 每天补充 | title + description + AI 提取 project/priority |
| 默认周报模板 | 4 段：关键事项表 / 风险阻塞 / 项目总览 / 下周重点 | 用户明确指定 |
| 关键事项数据源 | C. 混合双源 | week_plan_items + AI 从 notes 识别 |
| Reminder 时间 | 固定 18:00（上海时区） | 后续可配置 |
| Reminder 交互 | 纯飞书消息 | 最轻量 |
| 自定义模板 | A. 对话式改 JSON | 存为 JSON，AI 用 Edit 工具改 |
| 周报触发 | 周六 18:00 | 数据范围 Mon-Fri |

---

## 2. 架构

**原则**：capture-me = 产品核心（业务逻辑 + 数据），不依赖任何具体运行环境。

```
┌──────────────────────────────────────────────────────────┐
│  capture-me (产品核心 — 环境无关)                         │
│  · lib/weekplan.js     — week plan CRUD + 对话引导       │
│  · lib/report.js       — 周报渲染（按模板）               │
│  · lib/template.js     — 模板管理（读/写/版本/切换）      │
│  · lib/adapters/                                        │
│      ├── scheduler/  (注册 cron 任务)                   │
│      │    ├── openclaw.js                              │
│      │    ├── hermas.js                                │
│      │    └── launchd.js   (macOS 兜底)                 │
│      ├── notifier/   (推送 markdown 到飞书/Notion)      │
│      │    ├── base.js                                  │
│      │    ├── feishu.js                                │
│      │    ├── notion.js     (markdown → Notion blocks) │
│      │    ├── openclaw.js  (透传)                       │
│      │    └── hermas.js    (透传)                       │
│      └── observer/   (可选 hook 安装)                   │
│  · lib/install.js    — 一键安装入口（注册 cron + hook） │
│  · bin/trigger       — 现有触发器，加 weekplan trigger   │
└──────┬──────────────────────────────────────┬────────────┘
       │                                      │
   本机 SQLite                          openclaw/hermas
   capture.db                           (环境)
```

**适配器接口契约**：

```js
// scheduler adapter
scheduler.register({ id, schedule, command, description })
scheduler.unregister(id)
scheduler.list() → [{id, schedule, command, ...}]

// notifier adapter (channel-agnostic)
notifier.push({ channel, title, content, options }) → { url, status }
// channel = "feishu" | "notion" | ...

// observer adapter
observer.install({ event, handler })
observer.uninstall(event)
```

**install.js 流程**（用户跑一次，开箱即用）：

1. `scheduler.detect()` 探测环境（openclaw / hermas / 无）→ 选对应 adapter
2. `notifier.detect()` 探测飞书/Notion 通道（用户 config.yaml 或环境变量）
3. 注册 3 个 cron 任务（见 §6）
4. 安装 observer hook（如适用）
5. 报告：哪些已注册、哪些被跳过、通道是否就绪

---

## 3. 数据模型

新增 4 张表（位于 `~/.claude/skills/capture-me/sqlite/capture.db`）。

```sql
-- 一周一条
CREATE TABLE week_plans (
  id TEXT PRIMARY KEY,                    -- wp_<year>_w<week>  例：wp_2026_w24
  week_iso TEXT UNIQUE NOT NULL,          -- 2026-W24
  year INTEGER NOT NULL,
  week_num INTEGER NOT NULL,
  start_date TEXT NOT NULL,               -- 周一 YYYY-MM-DD
  end_date TEXT NOT NULL,                 -- 周五 YYYY-MM-DD
  status TEXT DEFAULT 'planning',         -- planning/active/closed/skipped
  carryover_from_id TEXT,                 -- 上周未完成项自动带入（reference）
  template_id TEXT,                       -- 渲染用哪个模板（默认 default）
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 计划项（周一创建，全周累积）
CREATE TABLE week_plan_items (
  id TEXT PRIMARY KEY,                    -- wpi_<timestamp>_<rand>
  plan_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,                       -- 补充说明
  project TEXT,                           -- @project/xxx (AI 提取)
  priority TEXT,                          -- P0/P1/P2 (AI 提取)
  assignee TEXT DEFAULT '我',             -- "我"/"张总"/"李总"
  expected_outcome TEXT,                  -- 预期结果（check-in 时可补）
  status TEXT DEFAULT 'pending',          -- pending/partial/done/blocked
  sort_order INTEGER DEFAULT 0,
  source TEXT DEFAULT 'weekplan',         -- weekplan/auto_detected/manual
  auto_detected_from_note_id TEXT,        -- source=auto_detected 时填
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_wpi_plan_id ON week_plan_items(plan_id);
CREATE INDEX idx_wpi_status ON week_plan_items(status);

-- 每天 check-in 累积（不可变历史）
CREATE TABLE week_plan_updates (
  id TEXT PRIMARY KEY,                    -- wpu_<timestamp>_<rand>
  item_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,                  -- 冗余便于查询
  update_date TEXT NOT NULL,              -- YYYY-MM-DD
  status_after TEXT NOT NULL,             -- pending/partial/done/blocked
  progress_note TEXT,                     -- 用户口述
  source TEXT,                            -- feishu/cli/auto
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_wpu_item_id ON week_plan_updates(item_id);
CREATE INDEX idx_wpu_update_date ON week_plan_updates(update_date);

-- 模板注册表
CREATE TABLE weekly_report_templates (
  id TEXT PRIMARY KEY,                    -- tpl_default / tpl_user_<name>
  name TEXT NOT NULL,
  description TEXT,
  sections_json TEXT NOT NULL,            -- 见 §4 JSON 结构
  is_default INTEGER DEFAULT 0,
  is_builtin INTEGER DEFAULT 0,           -- 1 = 不可删
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 渲染记录（每次推送留痕）
CREATE TABLE weekly_reports (
  id TEXT PRIMARY KEY,                    -- wr_<timestamp>_<rand>
  plan_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  rendered_markdown TEXT NOT NULL,        -- 完整 markdown
  channel_outputs TEXT,                   -- JSON: {"feishu":{"url":"...","status":"pushed"}, "notion":{...}}
  status TEXT DEFAULT 'pending',          -- pending/pushed/failed/partial
  pushed_at TEXT,
  error_log TEXT,                         -- 失败原因
  created_at TEXT DEFAULT (datetime('now'))
);
```

**现有表复用**：

- `notes` — 普通随手记；auto_detected items 通过 `auto_detected_from_note_id` 反向关联
- `projects` — "项目总览"章节从这里拉（status=active）
- `profile_signals` — 不动
- `commitments` — 不动（commitments 是承诺追踪，week plan 是规划追踪，两者独立）

---

## 4. 默认周报模板

**存储**：`templates/weekly_report/default.json`（不可删，可改）

**4 段结构**（用户指定）：

| # | 章节 | 数据源 | 输出格式 |
|---|------|--------|----------|
| 1 | 📌 本周关键事项 | week_plan_items（hybrid: weekplan + auto_detected）| 表格：内容 / 状态 / 负责人 / 本周进展 / 下周计划事项 |
| 2 | ⚠️ 风险和阻塞 | week_plan_items.status=blocked ∪ notes 含 @risk 关键词 | 列表 |
| 3 | 📂 所有推进项目总览 | projects where status=active | 表格：项目 / 进度 / 状态 / 负责人 / 截止 |
| 4 | 🚧 下周重点事项 | week_plan_items.status IN (pending, partial) | 列表 |

**模板 JSON 结构**：

```json
{
  "name": "default",
  "description": "标准周报模板（4 段）",
  "sections": [
    {
      "type": "header",
      "config": {
        "title_template": "📋 周报 — {week_iso}",
        "subtitle_template": "{start_date} ~ {end_date}"
      }
    },
    {
      "type": "key_items",
      "config": {
        "title": "📌 本周关键事项",
        "source": "hybrid",
        "columns": ["内容", "状态", "负责人", "本周进展", "下周计划事项"],
        "row_template": "| {title} | {status_emoji} {status} | {assignee} | {progress_summary} | {next_steps} |",
        "empty_fallback": "_本周无关键事项_"
      }
    },
    {
      "type": "risks",
      "config": {
        "title": "⚠️ 风险和阻塞",
        "source": "week_plan_items.status=blocked + notes with @risk/阻塞/风险/卡住",
        "row_template": "- {description} _(影响: {impact}, 需: {need})_"
      }
    },
    {
      "type": "projects_overview",
      "config": {
        "title": "📂 所有推进项目总览",
        "source": "projects where status=active",
        "columns": ["项目", "进度", "状态", "负责人", "截止"],
        "row_template": "| {name} | {progress_bar} {progress}% | {status} | {assignee} | {deadline} |"
      }
    },
    {
      "type": "next_week",
      "config": {
        "title": "🚧 下周重点事项",
        "source": "auto: week_plan_items.status IN (pending, partial)",
        "row_template": "- {title} _(本周: {status})_"
      }
    }
  ]
}
```

**渲染产物**：`rendered_markdown` 是标准 markdown 表格，飞书 doc 和 Notion 都能渲染。

---

## 5. Week Plan 创建 workflow（周一 9:00 触发）

**触发**：scheduler adapter 注册的 `wp-create` cron，schedule `0 9 * * 1`。

**时序**：

```
[hermas/openclaw 9:00 触发]
    ↓
[bot 发消息]
  "📅 周一早上好，开始新一周的 week plan 吧。
   上周未完成：3 项。是否带入本周？"
    ↓
[用户回复] 在飞书里或 capture-me session 里
    ↓
[AI 对话引导 — capture-me 自己的会话，不是 bot]
  Q1: "上周哪几项带入？"（自动列出 carryover 项让勾选）
  Q2: "本周要新增哪几件重点？"
  Q3: "每项的优先级？"
  Q4: "每项的负责人？还是都你自己？"
  Q5: "AI 帮你重述一遍整份 plan，OK 吗？"
    ↓
[AI 渲染] 整份 plan → 写入 week_plans + week_plan_items
    ↓
[确认/调整] 落库
```

**首次使用额外一步**（满足用户"第一次使用初始化"诉求）：

```
🤖 开始你的 week plan 之前...

📡 周报推送到哪里？
  1. 飞书文档
  2. Notion 页面
  3. 两个都推
  4. 暂不设置

→ 选择: ___
```

用户选择 → 写入 `config.yaml` `capture-me.channels.enabled`。
后续改：`/capture-me channels` 重新设置。

**carryover 逻辑**：上周日 23:00 自动跑一次 carryover 计算（`scheduler` 加 `wp-carryover` cron，`0 23 * * 0`），把 status IN (pending, partial, blocked) 的项复制到下周 plan 的 items（保留原 item id，**复制**而非引用，便于独立更新）。

---

## 6. 每日 check-in workflow（周一-五 18:00 触发）

**触发**：`wp-checkin` cron，`0 18 * * 1-5`。

**时序**：

```
[hermas/openclaw 周一到五 18:00 触发]
    ↓
[bot 发消息]
  "🌆 今日 plan check-in
   本周 5 项：
   1. capture-me Notion 集成 (P0) — 状态：partial
   2. 合同转换引擎 (P0) — 状态：partial
   3. 客户需求评审 (P1) — 状态：pending
   4. 读《纳瓦尔宝典》(P2) — 状态：pending
   5. 锻炼 (P2) — 状态：pending

   回复如：
   - '1 完成 2 进展 60% 3 阻塞 等张总反馈 4 没动 5 跑步了'
   - 或逐项说"
    ↓
[用户回复] 飞书里直接打字
    ↓
[bot 解析] LLM 把回复解析成 N 条 week_plan_updates
    ↓
[写库] 每条 item 的 status 更新到最新值
    ↓
[反馈] "✅ 已记录 5 项更新"
```

**解析容错**：

- 用户回复模糊（"3 还行吧"）→ bot 反问一次（"3 的状态是 partial 还是 blocked？"）
- 2 次反问仍模糊 → 跳过该项，记录到 `week_plan_updates.status_after='pending'`（保持原状态）+ 在 `progress_note` 写 "用户回复模糊，跳过"

**3 个 cron 任务总览**：

| ID | 触发时间 | 命令 | 说明 |
|----|----------|------|------|
| `wp-create` | `0 9 * * 1`（周一 9:00） | `node lib/weekplan.js create` | 引导用户创建本周 plan |
| `wp-checkin` | `0 18 * * 1-5`（工作日 18:00） | `node lib/weekplan.js checkin-bot` | bot 发提醒消息（解析用户回复） |
| `wp-carryover` | `0 23 * * 0`（周日 23:00） | `node lib/weekplan.js carryover` | 把未完成项复制到下周 plan |
| `wp-report` | `0 18 * * 6`（周六 18:00） | `node lib/report.js generate-and-push` | 渲染 + 推送周报 |

---

## 7. 周报生成 + 推送 workflow（周六 18:00 触发）

**触发**：`wp-report` cron，`0 18 * * 6`。

**时序**：

```
[hermas/openclaw 周六 18:00 触发]
    ↓
[report.js render]
  1. 拉本周 week_plans + items + updates
  2. 拉 notes（auto_detected items 来源）
  3. 拉 projects（active 状态）
  4. 应用 plan.template_id 指向的模板（默认 default）
  5. 渲染成 markdown
  6. 写入 weekly_reports
    ↓
[notifier.push for each enabled channel]
  feishu: feishu.js → 创建新 doc → 拿 doc_url
  notion:  notion.js → markdown → Notion blocks → 创建新 page → 拿 page_url
    ↓
[更新 channel_outputs]
    ↓
[bot 发消息]
  "📋 本周周报已生成
   · 飞书: https://feishu.cn/doc/xxx
   · Notion: https://notion.so/xxx"
```

**Notion 通道的特殊处理**：

- Notion API 不接受原始 markdown，要拆成 block 结构（heading_1/2/3、paragraph、table、bulleted_list_item 等）
- `notion.js` 内部维护一个 markdown → Notion blocks 的转换器（基于 markdown-it AST）
- 父页面 ID 来自 `config.yaml` 的 `notion.parent_page_id`

**push 失败重试**：

- 单通道失败不影响其他通道
- 失败的写入 `queue/push-retry.json`，下个 cron 重试
- 同一份报告重试最多 3 次
- 第 4 次失败 → `weekly_reports.status=failed` + 告警用户

---

## 8. 自定义模板编辑（A. 对话式改 JSON）

**存储**：

- `templates/weekly_report/default.json` — 内置默认模板（is_builtin=1，**不可删**，可改）
- `templates/weekly_report/user_<name>.json` — 用户自定义副本

**编辑流程**（capture-me session 内）：

```
用户: "周报模板里'下周重点'章节前面加一个'本周亮点'章节，
       内容是本周完成度最高的 3 件事"

AI:
  → 读 templates/weekly_report/default.json
  → 提议改动方案："我会在 'risks' 之前插入 'highlights' 段，从
                  week_plan_items.status=done 选 3 条最显著的。
                  这样改 OK 吗？"
  → 用户："OK"
  → 用 Edit 工具改 JSON（精确 diff，保留其他部分）
  → 渲染一份带 [DRY RUN] 标记的预览（用上周数据）
  → "预览：<带 highlight 段的 markdown> 看着对吗？"
  → 用户："对"
  → 落库 + git 自动 diff（如果 init 时启用了 git）
```

**版本管理**：

- 每次修改 → 旧版本备份到 `templates/weekly_report/.history/<name>-<timestamp>.json`
- `/capture-me template history default` 查看历史
- `/capture-me template rollback default <version>` 回滚

**切换默认**：

```bash
/capture-me template list
/capture-me template use user_xxx    # 切到自定义
/capture-me template use default     # 切回默认
```

---

## 9. 边界情况 + 失败处理

| 场景 | 行为 |
|------|------|
| 周一没规划 | 10:00 + 14:00 再推 2 次；仍无 plan → 周六 18:00 周报自动从 notes 拉"重要/重点/必须"等关键词，凑成关键事项表，标注 `⚠️ 本周未做 plan` |
| 出差/请假 | `/capture-me weekplan skip` 标记本周为 `status=skipped`，bot 全周静默 |
| 某天没回 check-in | item 保持上次状态，周报里标注 `_(X 天未更新)_` |
| bot 解析失败 | 反问一次；2 次失败 → 跳过该项 + 记 `progress_note="用户回复模糊，跳过"` |
| 飞书/Notion 推送失败 | `weekly_reports.status=failed` + `error_log`，写入 `queue/push-retry.json`，下个 cron 重试（最多 3 次），第 4 次告警 |
| token 过期 | `install.js` 和每个 cron 启动时验证一次，失败则停推送 + 提示 `/capture-me channels` 重配 |
| 模板渲染异常 | 降级到 default 模板 + 日志记录 |
| DB 写入失败 | 走 `queue/failed-*.json`，下次命令重试 |
| 时区 | 硬编码 `Asia/Shanghai`（后续可配置） |

---

## 10. 配置（`config.yaml`）

```yaml
capture-me:
  data_dir: ~/.capture-me
  memory_dir: memory

  # 通道（首次使用 week plan 时初始化）
  channels:
    enabled: [feishu, notion]   # 用户可改
    feishu:
      app_id: ""
      app_secret: ""
      default_folder_id: ""
    notion:
      integration_token: ""
      parent_page_id: ""

  # 模板
  template:
    default_id: tpl_default

  # 现有配置保留
  ai: { enabled: true, ... }
  storage: { ... }
  reminders: { ... }
  personality: { ... }
  categories: [ ... ]

  # 新增 schedules
  schedules:
    wp_create: "0 9 * * 1"        # 周一 9:00
    wp_checkin: "0 18 * * 1-5"     # 工作日 18:00
    wp_carryover: "0 23 * * 0"     # 周日 23:00
    wp_report: "0 18 * * 6"        # 周六 18:00
    weekly_review: "0 9 * * 0"     # 现有，保留
    monthly_review: "0 18 28-31 * *"
    todo_check: "0 21 * * *"
    personality_update: "0 22 * * *"
```

---

## 11. 测试策略

| 层级 | 内容 | 位置 |
|------|------|------|
| 单元 | weekplan.js / report.js / template.js / adapters（mock） | `tests/unit/` |
| 集成 | 模拟一周的 notes + plan + check-ins → 渲染 → 验证 markdown 输出 | `tests/integration/` |
| Adapter | Feishu/Notion mock（不真打 API） | `tests/adapters/` |
| E2E 手动 | dev 环境跑 install.js + 模拟 cron 触发 | `docs/manual-test.md` |

**关键测试用例**：

- 周一 plan 创建 → items 写入正确
- 连续 5 天 check-in → updates 累积 + item status 取最新
- 周六 report 渲染 → 4 段输出符合模板
- Notion adapter 把 markdown 转 Notion blocks 正确
- 飞书推送失败重试逻辑
- 自定义模板编辑后下周报告用新模板

---

## 12. 范围外（YAGNI — 不做）

- ❌ 团队/多人协作（assignee 只是显示文本，不做权限/通知）
- ❌ Slack / Email / 短信通道
- ❌ 移动端 App
- ❌ 双周报/月报（后续单独迭代）
- ❌ 模板市场 / 分享（用户自己管 JSON 文件）
- ❌ 自动重写周报（基于历史语气训练）— 后续可考虑
- ❌ Notion database 模式（只支持 page + 父页面）
- ❌ 计划项关联到现有 commitments 表（两者独立追踪，暂不互通）

---

## 13. 实施分阶段

```
PR 1: 数据模型 + week plan 创建 + check-in
  - 新增 4 张表 + 迁移脚本
  - lib/weekplan.js (CRUD + carryover + check-in bot)
  - 不接外部通道
  - CLI: /capture-me weekplan (create/checkin/skip/list/show)
  - 单测 + 集成测试

PR 2: 模板系统 + 周报渲染
  - templates/weekly_report/default.json
  - lib/template.js (read/write/version/switch)
  - lib/report.js (render from template)
  - 自定义模板对话式编辑
  - CLI: /capture-me template (list/use/history/edit)
  - 单测 + 集成测试

PR 3: 通道推送 + 安装入口
  - lib/adapters/notifier/{feishu.js, notion.js, base.js}
  - lib/adapters/scheduler/{openclaw.js, hermas.js, launchd.js}
  - lib/install.js
  - report.js 接 notifier.push
  - 重试 + 失败处理
  - 集成测试（adapter mock）+ 手动 E2E 文档
```

每个 PR 独立可合并、可回滚；PR 1 不依赖 PR 2/3，可以单独发布使用本地 CLI 完成 plan + check-in。

---

## 14. 开放问题（实施时再决策）

- carryover 是"复制"还是"引用"？当前设计是**复制**（item 独立），简单清晰；如果未来要做"上周未完成直接算下周重点"，再考虑引用
- 模板编辑是否进 git？建议 init 时问用户（"是否启用模板版本控制？"），默认否（用户手动管）
- auto_detected 的去重逻辑：如果某条 notes 同时被多个 plan 引用，如何去重？目前设计是 notes → 单个 item（一对多简化），冲突时取最近的
- 飞书文档命名冲突：同一天 push 多份报告怎么办？目前设计是一周一报，物理上不会撞
- Notion 的 parent page 权限：用户必须先在 Notion UI 把 integration 加到 parent page，否则 API 调用 401
