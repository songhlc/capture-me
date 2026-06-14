# Capture-Me 保险管家 (Insurance Manager) — 设计

- **日期**：2026-06-14
- **状态**：设计已批准，待 writing-plans
- **作者**：brainstorming session
- **影响范围**：`~/.claude/skills/capture-me/`（lib/insurance/ 新增、bin/insurance 新增、3 张新表、SKILL.md 增量、weekplan setup-cron 增量）

---

## 1. 背景与目标

capture-me 现有能力覆盖"随手记 / 性格画像 / 复盘 / Week Plan"，但**没有任何保险与应急资产相关能力**。用户的保险数据散落在保险公司 APP、邮件、纸质保单、微信文件里，无法：

1. 快速看"我们家到底买了哪些险"
2. 判断"保额够不够、险种缺不缺"
3. 在续保/到期前被提醒

本次新增的 **保险管家** 把这些串成闭环：

- **保单结构化录入**（随时）—— 自然语言 / PDF → 数据库
- **保单库查询**（随时）—— 按险种、到期、续保、被保人
- **家庭保险体检报告**（随时/可定时）—— 资产概览 + 险种覆盖 + 保额建议 + 缺口清单
- **缺口分析** —— 规则（双十/标普/家庭风险矩阵）出可解释硬建议；LLM 在此之上加个性化建议
- **续保/到期提醒** —— 工作日 09:00 跑 `check-reminders`，30/7/60 天前推消息，复用 weekplan 的 `notify.js` 通道

**用户决策记录**（brainstorming session 敲定）：

| 决策点 | 选型 | 备注 |
|--------|------|------|
| 资产范围 | **B**：保险 + 现金/应急资产 | 不含房产/股票/基金/加密 |
| 输入形式 | **E**：对话粘贴优先，PDF 后续 | 大模型从对话上下文解析；与 capture-me 现有 entities 提取一脉相承 |
| 被保人范围 | **D**：可扩展，按"被保人"字段存 | `family_members` 表，5 档 relation（self/spouse/child/parent/other） |
| 核心能力 | **1+2+3+4+5**（录入/查询/体检/缺口/续保提醒） | 暂不做 6（现金流规划）/7（产品对比）/8（被动观察增强）/9（理赔追踪） |
| 现金资产录入 | **D**：一次性起步，按需加月度 | 第一次体检报告时对话采集；下月可补每月更新 |
| 架构方案 | **A**：capture-me 本地子模块（与 weekplan 同级别） | 不另起 skill 体系，共享 SQLite / 通知通道 / 解析模式 |
| 混合险 category | 用 `+` 连接，如 `critical_illness+life` | 避免拆条 |
| "我" 识别 | 每次录入保单时与用户对话确认被保人 | 不做一次性本地映射 |
| 缺口分析 | **规则 + LLM 个性化 + 定期回顾规则** | 规则可解释；LLM 软建议；偶发复盘评估规则是否过时 |

---

## 2. 架构

### 2.1 模块结构

```
capture-me/
├── lib/
│   ├── weekplan.js          ← 既有
│   ├── insurance/           ← 新增（与 weekplan 同级）
│   │   ├── index.js         ← 入口；导出主要 API
│   │   ├── parser.js        ← 自然语言 / PDF → 保单结构化字段
│   │   ├── analyzer.js      ← 体检报告 + 缺口分析（规则 + LLM）
│   │   ├── reminder.js      ← 续保/到期提醒调度
│   │   └── cash.js          ← 现金资产记录与汇总
│   └── (其他 lib 不变)
├── bin/insurance            ← 新增 CLI 入口（与 bin/weekplan 同级）
├── tests/insurance/         ← 新增单元测试
└── memory/insurance-reports/  ← 新增体检报告 markdown 落盘目录
```

### 2.2 三张新表（SQLite）

| 表 | 作用 | 关键字段 |
|---|---|---|
| `family_members` | 被保人维度 | member_id, name, relation (self/spouse/child/parent/other), birth_year, risk_profile (JSON), created_at, updated_at |
| `insurance_policies` | 保单 | policy_id, family_member_id (FK), category (life/health/accident/critical_illness/annuity/财产/车/other，混合用 + ), insurer, product_name, sum_insured, annual_premium, payment_period, coverage_period, start_date, end_date, next_renewal_date, beneficiaries (JSON), policy_number, status (active/expired/cancelled/pending), raw_text, ai_summary, tags (JSON), source, created_at, updated_at |
| `cash_assets` | 现金/应急资产 | asset_id, type (活期/货基/短期理财/其他), account_alias, balance, currency (默认 CNY), as_of_date, notes, created_at, updated_at |

索引：
- `idx_policies_member` on (family_member_id)
- `idx_policies_category` on (category)
- `idx_policies_renewal` on (next_renewal_date)
- `idx_policies_status` on (status)

### 2.3 与 capture-me 既有体系的关系

- **复用 `lib/notify.js`**：续保/到期提醒走 `notify()`，自动探测 Agent 平台通道（飞书/Reminders/...）
- **复用 `lib/setup-cron.js`**：在 `TASKS` 数组追加 1 条 `insurance-reminder` 任务（工作日 09:00 跑 `insurance check-reminders`），不破坏现有 3 条
- **不侵入 `lib/capture.js`**：保险数据从保险子模块的命令单独进入；随手记主流程不动
- **tag 打通**：`insurance_policies.tags` 接受 capture-me 的 `@investment` 等标签

### 2.4 命令

```
/capture-me insurance add [policy]      # 录入保单（对话+结构化）
/capture-me insurance add-cash          # 录入现金资产（对话+结构化）
/capture-me insurance query <关键词>    # 查保单库
/capture-me insurance renewals          # 查 60/30/7 天内续保/到期的保单
/capture-me insurance gap               # 单独跑缺口分析
/capture-me insurance report            # 输出家庭保险体检报告（终端 + 落盘）
/capture-me insurance check-reminders   # 内部：跑提醒（setup-cron 调用）
/capture-me insurance rules-review      # 用户偶发：评估规则是否过时
```

---

## 3. 数据模型（详细 schema）

```sql
CREATE TABLE family_members (
  member_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  relation TEXT NOT NULL,            -- self/spouse/child/parent/other
  birth_year INTEGER,
  risk_profile TEXT,                 -- JSON: { health, occupation, smoker, ... }
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE insurance_policies (
  policy_id TEXT PRIMARY KEY,
  family_member_id TEXT NOT NULL,
  category TEXT NOT NULL,            -- 混合险用 + 连接
  insurer TEXT,
  product_name TEXT,
  sum_insured REAL,                  -- 元
  annual_premium REAL,               -- 元
  payment_period TEXT,               -- "20年缴" / "终身" / "趸交"
  coverage_period TEXT,              -- "终身" / "30年" / "至70岁"
  start_date TEXT,                   -- YYYY-MM-DD
  end_date TEXT,                     -- 长期险可空
  next_renewal_date TEXT,
  beneficiaries TEXT,                -- JSON 数组
  policy_number TEXT,
  status TEXT DEFAULT 'active',      -- active/expired/cancelled/pending
  raw_text TEXT,                     -- 原始输入，永久保留
  ai_summary TEXT,
  tags TEXT,                         -- JSON
  source TEXT,                       -- dialogue/pdf/manual
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (family_member_id) REFERENCES family_members(member_id)
);

CREATE INDEX idx_policies_member ON insurance_policies(family_member_id);
CREATE INDEX idx_policies_category ON insurance_policies(category);
CREATE INDEX idx_policies_renewal ON insurance_policies(next_renewal_date);
CREATE INDEX idx_policies_status ON insurance_policies(status);

CREATE TABLE cash_assets (
  asset_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                -- 活期/货基/短期理财/其他
  account_alias TEXT,
  balance REAL,
  currency TEXT DEFAULT 'CNY',
  as_of_date TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);
```

**关键设计选择**：
- `raw_text` 永远保留（兜底 + 后续重解析）
- `next_renewal_date` 与 `end_date` 分离：长期寿险无 end_date 但有续保/缴费日；短期医疗险两个都有
- `family_member_id` 必填；若用户未指定被保人，agent 问"这是给谁买的？"
- `status='pending'` 表示解析未完成，下次再解析
- 解析失败不阻塞录入：缺啥问啥，逐项对话补齐

---

## 4. 端到端流程

### 4.1 录入一张保单

```
[用户对话]
  "/capture-me insurance add
   平安福 2023，30 年缴，年缴 8000，
   重疾 50 万 + 寿险 51 万，
   我是投保人和被保人，受益人是老婆，
   去年 6 月生效"
            ↓
[CLI: insurance add]
   ↓ 调 parser.js
[parser.js: parsePolicyText(text)]
  → 调大模型解析（与 capture-me 现有实体提取同模式）
  → 输出 JSON:
     {
       family_member: { name: "我", relation: "self" },
       category: "critical_illness+life",
       insurer: "平安",
       product_name: "平安福 2023",
       sum_insured: { critical_illness: 500000, life: 510000 },
       annual_premium: 8000,
       payment_period: "30年缴",
       start_date: "2023-06-XX",
       beneficiaries: ["老婆"]
     }
            ↓
[index.js: insertPolicy(parsed)]
  → 检查 family_member 是否已存在（按 name+relation 去重）
     → 存在：复用 member_id
     → 不存在：插入 family_members
  → 插入 insurance_policies（raw_text 也存）
  → 计算 next_renewal_date（年缴 + 1 年）
  → 返回 policy_id + ai_summary
            ↓
[返回给用户]
  ✓ 保单已录入: ins_abc123
  · 我 | 平安福 2023 | 重疾 50 万 + 寿险 51 万
  · 年缴 8,000 / 30 年缴 / 下次续保: 2025-06-XX
  · 受益人: 老婆
  
  体检报告已包含 1 张保单。要看完整报告吗？
```

### 4.2 体检报告

```
[用户] /capture-me insurance report
            ↓
[insurance report]
  → 查所有 status=active 的保单
  → 查 family_members
  → 查 cash_assets（可能为空）
  → 调 analyzer.computeHealthCheck(policies, family, cash)
            ↓
[analyzer.js] 输出 4 部分:
  A. 资产概览     → 年总保费 / 现金/应急资产 / 保费占可支配收入比
  B. 险种覆盖     → life/health/accident/critical_illness/annuity 五类
                     按"已覆盖/部分/缺失"标记
  C. 保额建议     → 寿险: 收入×10-15 倍 / 重疾: 年支出×5 倍
                     列出每类建议保额 vs 现有保额
  D. 缺口清单     → "缺意外险 / 寿险差额 50 万 / 短期医疗险未续保"
  E. LLM 个性化层 → 在规则之上加柔性建议
            ↓
[输出]
  ① 终端彩色输出（与 capture-me 仪表盘风格一致）
  ② 落盘 memory/insurance-reports/2026-06-14-体检.md
  ③ metadata 写回（rules_used, data_completeness, llm_personalization_notes）
```

### 4.3 续保/到期提醒

```
[cron: 工作日 09:00]  →  node bin/insurance check-reminders
            ↓
[check-reminders]
  → 查 next_renewal_date 在 [今天+1, 今天+30] 的保单
  → 查 end_date 在 [今天+1, 今天+60] 的保单
  → 按距今天数（7/30/60）选对应模板
  → 汇总成单条消息（避免一天多条）
  → 调 notify.js 推送
```

### 4.4 规则反馈循环

```
[每份体检报告]
  → 记录 metadata: 
     policy_check_v1_<date>: 
       rules_used=[...], data_completeness=0.7,
       llm_personalization_notes="..."
  → 用户反馈"这条建议不适用" → 写 policy_check_feedback 表

[季度/半年 / 用户主动问]
  /capture-me insurance rules-review
  → 拉所有 feedback
  → 跑 LLM 评估规则覆盖度
  → 输出"是否调整"的建议清单，用户决定
```

---

## 5. 缺口分析方法论

### 5.1 规则层（硬性、可解释）

| 维度 | 公式/规则 | 数据来源 |
|---|---|---|
| 寿险缺口 | 收入 × 10 - 已有寿险 | 保单 + family.birth_year/occupation |
| 重疾缺口 | 年支出 × 5 - 已有重疾 | 保单 + cash_assets |
| 意外险 | 是否有 active 的意外险 | 保单 |
| 医疗险 | 是否有 active 的百万医疗 | 保单 + 短期险 end_date |
| 保费占比 | 年总保费 / 年可支配收入 | 保单 + 体检报告对话中采集的"年可支配收入"（v1 不持久化到独立表） |
| 应急金 | 现金/应急资产 / 月支出 | cash_assets |

**为什么用规则而不是纯 LLM**：
- 缺口公式是公认方法论（双十/标普/家庭风险矩阵），可复现
- 规则输出**可解释**：用户能看懂为什么建议补 50 万寿险
- LLM 留给"按家庭成员特征 + 未来计划"做柔性建议

### 5.2 LLM 个性化层

规则输出后，调用大模型加一层个性化分析：
- 用户提到"有房贷" → 寿险建议加 30%
- 孩子 < 3 岁 → 关注教育金险
- 父母 > 60 岁 → 关注医疗险 + 意外险
- 工作高风险（出差/体力）→ 意外险加 1.5 倍

个性化结论也写到报告里，标记为"AI 建议（需人工确认）"。

### 5.3 规则反馈循环（v1 简化版）

- 体检报告记录 metadata；用户反馈 → `policy_check_feedback` 表（设计要点见 4.4 流程图）
- 偶发回顾：用户主动 `rules-review` → LLM 评估规则覆盖度
- 不做自动化评估（成本不匹配）

---

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| 解析失败：大模型返回字段不完整 | 缺啥问啥，逐项对话补齐；不阻塞录入 |
| 解析失败：完全不识别 | 原文存 raw_text + status=`pending`，下次再解析 |
| 保单过期 | status 自动判 `expired`（查询时 end_date < now） |
| 重复保单（product_name + family_member_id） | agent 提示"已有相似保单，是否更新/新增？" |
| 用户录入时取消 | 全部 commit/rollback；不写半条 |
| `cash_assets` 没录 | 体检报告中标注"无应急金数据，X 维度暂不计算" |
| 缺口计算数据不足 | 标注"⚠️ 数据不足：年支出未知、收入未知"，列出需补的字段 |
| 报告 markdown 落盘失败 | 终端输出不受影响，只 warn |

**关键原则**：**永远不丢原始输入**。`raw_text` 一定写库，结构化字段是"增强"，不是"替代"。

---

## 7. 与 weekplan 通知通道的复用

在 `lib/setup-cron.js` 的 `TASKS` 数组追加 1 条：

```js
{
  label: `${LABEL_PREFIX}.insurance-reminder`,
  desc: '工作日 09:00 检查续保/到期保单',
  args: ['insurance', 'check-reminders'],
  schedule: [1,2,3,4,5].map(d => ({ Weekday: d, Hour: 9, Minute: 0 })),
}
```

- 现有 3 条 weekplan 任务不动
- 用户跑 `node lib/weekplan.js setup` 一次注册 4 条
- `--check` / `--remove` 行为自然扩展到 4 条
- 通知出口走 `lib/notify.js`，通道探测层不变

---

## 8. 测试策略

| 层 | 工具 | 覆盖 |
|---|---|---|
| parser 单元 | Jest | 5 类典型输入：寿险/重疾/医疗/意外/混合 + 边界（信息缺失 / 不规范） |
| analyzer 单元 | Jest | 5 种缺口场景：完全覆盖 / 部分覆盖 / 完全无覆盖 / 数据不足 / 现金为 0 |
| reminder 集成 | Jest + DRY_RUN notify | 命中 7/30/60 天 / 未命中 4 个分支 |
| rules-review 单元 | Jest | 跑规则反馈，LLM mock 输出建议 |
| 端到端 | 手测 | 用户对话 → 录入 → 体检 → 提醒 一次走通 |
| 缺口方法论 | 文档 + Jest fixture | 固定输入 → 固定输出快照 |

---

## 9. YAGNI 红线（暂不做）

- ❌ 银行/股票/基金 API 对接
- ❌ 假设性问题（"如果加 100 万寿险"）
- ❌ 历史保单归档（只管当前在生效的）
- ❌ 理赔记录追踪
- ❌ 自动化规则评估（用偶发回顾代替）
- ❌ 视觉伴侣（保险管家主要是 CLI + 数据报告，不需要 UI mockup）

---

## 10. 落地清单（write 阶段会展开成 plan）

1. 新增 3 张表（`db.js` 扩展 `initDb()`） + 索引
2. `lib/insurance/parser.js`：自然语言 → 保单结构化
3. `lib/insurance/index.js`：CRUD + 公共 API
4. `lib/insurance/analyzer.js`：体检 + 缺口分析（规则 + LLM）
5. `lib/insurance/cash.js`：现金资产 CRUD + 汇总
6. `lib/insurance/reminder.js`：续保/到期检测
7. `bin/insurance`：CLI 入口（含 `add` / `add-cash` / `query` / `renewals` / `gap` / `report` / `check-reminders` / `rules-review`）
8. `lib/setup-cron.js` 追加 insurance-reminder 任务
9. SKILL.md 增量：新增 `## 保险管家（Insurance Manager）` 章节
10. README.md 增量：在效率工具列表下加一行
11. 单元测试：`tests/insurance/` 下 5+5+1+1 = 12+ 用例
12. 端到端手测：录入 → 体检 → 提醒 → 规则回顾

---

**待写 plan 阶段展开为可执行步骤。**
