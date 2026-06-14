# Capture-Me 保险管家 (Insurance Manager) — 设计

- **日期**：2026-06-14（v2，吸收 GitHub 调研的国内保险实务）
- **状态**：设计已批准，待 writing-plans
- **作者**：brainstorming session
- **影响范围**：`~/.claude/skills/capture-me/`（lib/insurance/ 新增、bin/insurance 新增、**4 张新表**、SKILL.md 增量、weekplan setup-cron 增量、memory/insurance-reports/ + memory/insurance-cashvalue-tables/ 落盘）

---

## 1. 背景与目标

capture-me 现有能力覆盖"随手记 / 性格画像 / 复盘 / Week Plan"，但**没有任何保险与应急资产相关能力**。用户的保险数据散落在保险公司 APP、邮件、纸质保单、微信文件里，无法：

1. 快速看"我们家到底买了哪些险"
2. 判断"保额够不够、险种缺不缺"
3. 在续保/到期前被提醒
4. 知道哪些保单是"孤儿单"（代理人已离职，没人服务）
5. 复盘保单现金价值/退保损失

本次新增的 **保险管家** 把这些串成闭环：

- **保单结构化录入**（随时）—— 自然语言 / PDF → 数据库（含投保人/被保人/受益人三方角色 + 现金价值 + 健康告知）
- **保单库查询**（随时）—— 按险种、到期、续保、被保人、销售渠道
- **家庭保险体检报告**（随时/可定时）—— 资产概览 + 险种覆盖 + 保额建议 + 缺口清单 + **理赔记录引用** + 免责声明
- **缺口分析** —— 规则（**双十 + 家庭风险矩阵两套并行**）出可解释硬建议；LLM 在此之上加个性化建议
- **续保/到期提醒** —— 工作日 09:00 跑 `check-reminders`，30/7/60 天前推消息（**含"提前 3 天确认银行卡余额"建议**），复用 weekplan 的 `notify.js` 通道
- **理赔记录追踪** —— 保单关联的理赔记录（v2 从 YAGNI 拿回；国内理赔拒赔 60% 是健康告知问题，必须跟保单关联）

**用户决策记录**（brainstorming session 敲定 + 调研修订）：

| 决策点 | 选型 | 备注 |
|--------|------|------|
| 资产范围 | **B**：保险 + 现金/应急资产 | 不含房产/股票/基金/加密 |
| 输入形式 | **E**：对话粘贴优先，PDF 后续 | 大模型从对话上下文解析；与 capture-me 现有 entities 提取一脉相承 |
| 家庭成员范围 | **D**：可扩展，5 档 relation（self/spouse/child/parent/other） | 同一成员可同时是投保人/被保人/受益人；保单三方角色独立 FK |
| 核心能力 | **1+2+3+4+5+理赔追踪** | 原 YAGNI 的"理赔追踪"调研后拿回；其余 4 个 YAGNI（现金流规划/产品对比/被动观察增强/历史归档）保留 |
| 现金资产录入 | **D**：一次性起步，按需加月度 | 第一次体检报告时对话采集；type 含 `personal_pension`（个人养老金账户） |
| 架构方案 | **A**：capture-me 本地子模块（与 weekplan 同级别） | 不另起 skill 体系，共享 SQLite / 通知通道 / 解析模式 |
| 混合险 category | 用 `+` 连接，如 `critical_illness+life` | 避免拆条 |
| "我" 角色识别 | 每次录入保单时**逐角色问**（投保人/被保人/受益人分别是谁） | 不做一次性本地映射；不假设"我=被保人" |
| 缺口分析 | **规则 + LLM 个性化 + 定期回顾规则** | 规则可解释；LLM 软建议；偶发复盘评估规则是否过时 |
| 缺口公式 | **双十 + 家庭风险矩阵并行** | 国内中产家庭更常用"5 倍年收入 + 房贷覆盖"思路 |
| 缴费方式 | **payment_method 独立字段**（年缴/月缴/季缴/趸交） | `payment_period` 单独表达"20年缴"这种年期 |
| 现金价值 | **每个有现价的险种都要记 cash_value 字段 + 落盘现价表** | 终身寿险/年金/增额终身/万能/分红险**都有现价表**，"该不该退"是 C 端最高频问题 |
| 健康告知 | **family_members 加 health_disclosure JSON** | 投保时主动问；理赔拒赔主因 |
| 销售渠道 | **insurance_policies 加 sales_channel**（agent/broker/online/bank/etc.） | 解决"孤儿单"风险 |
| 免责声明 | **体检报告必加 footer** | "本报告不构成投保建议，建议咨询持牌经纪人"（合规） |

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
│   │   ├── analyzer.js      ← 体检报告 + 缺口分析（双公式 + LLM）
│   │   ├── reminder.js      ← 续保/到期提醒调度
│   │   ├── cash.js          ← 现金资产记录与汇总
│   │   └── claims.js        ← 理赔记录追踪（v2 拿回）
│   └── (其他 lib 不变)
├── bin/insurance            ← 新增 CLI 入口（与 bin/weekplan 同级）
├── tests/insurance/         ← 新增单元测试
├── memory/
│   ├── insurance-reports/           ← 体检报告 markdown 落盘
│   └── insurance-cashvalue-tables/  ← 现金价值表（终身寿险/年金/万能/分红险等）落盘
```

### 2.2 四张新表（SQLite）

| 表 | 作用 | 关键字段 |
|---|---|---|
| `family_members` | 家庭成员 | member_id, name, relation (self/spouse/child/parent/other), birth_year, **health_disclosure (JSON)**, risk_profile (JSON), created_at, updated_at |
| `insurance_policies` | 保单 | policy_id, family_member_id (被保人, FK), **policy_holder_id (投保人, FK)**, **beneficiary_ids (JSON 数组, FK)**, category, insurer, product_name, sum_insured, annual_premium, **payment_method (年缴/月缴/季缴/趸交)**, payment_period, coverage_period, start_date, end_date, next_renewal_date, **sales_channel (agent/broker/online/bank)**, **cash_value_path (落盘路径)**, **status 全集 (active/expired/cancelled/pending/lapse/surrendered/matured/claim)**, raw_text, ai_summary, tags (JSON), source, created_at, updated_at |
| `cash_assets` | 现金/应急资产 | asset_id, **type (活期/货基/短期理财/personal_pension/其他)**, account_alias, balance, currency (默认 CNY), as_of_date, notes, created_at, updated_at |
| `insurance_claims` | 理赔记录（v2 拿回） | claim_id, policy_id (FK), claim_date, claim_reason, claim_amount, status (submitted/under_review/approved/rejected/paid), paid_amount, paid_date, notes, raw_text, created_at, updated_at |

索引：
- `idx_policies_member` on (family_member_id)
- `idx_policies_holder` on (policy_holder_id)
- `idx_policies_category` on (category)
- `idx_policies_renewal` on (next_renewal_date)
- `idx_policies_status` on (status)
- `idx_policies_channel` on (sales_channel)
- `idx_claims_policy` on (policy_id)
- `idx_claims_date` on (claim_date)

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
/capture-me insurance claim add         # 录入理赔记录
/capture-me insurance claim list <policy_id>  # 查保单的理赔历史
/capture-me insurance check-reminders   # 内部：跑提醒（setup-cron 调用）
/capture-me insurance rules-review      # 用户偶发：评估规则是否过时
```

---

## 3. 数据模型（详细 schema）

```sql
CREATE TABLE family_members (
  member_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                  -- "我" / "老婆" / "爸" / "儿子"
  relation TEXT NOT NULL,              -- self/spouse/child/parent/other
  birth_year INTEGER,
  health_disclosure TEXT,              -- JSON: { conditions: [{name, severity, disclosed, disclosed_at}] }
  risk_profile TEXT,                   -- JSON: { occupation, smoker, dangerous_hobby, ... }
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE insurance_policies (
  policy_id TEXT PRIMARY KEY,
  family_member_id TEXT NOT NULL,      -- 被保人 → family_members
  policy_holder_id TEXT,                -- 投保人 → family_members（可空：保单上未明或自己买给自己时填 = family_member_id）
  beneficiary_ids TEXT,                 -- JSON 数组: [member_id, ...] → family_members
  category TEXT NOT NULL,              -- 混合险用 + 连接: critical_illness+life / health+critical_illness / etc.
  insurer TEXT,
  product_name TEXT,
  policy_number TEXT,
  sum_insured REAL,                    -- 元
  annual_premium REAL,                 -- 元
  payment_method TEXT,                 -- 年缴/月缴/季缴/趸交
  payment_period TEXT,                 -- "20年缴" / "终身" / "5年期"
  coverage_period TEXT,                -- "终身" / "30年" / "至70岁"
  start_date TEXT,                     -- YYYY-MM-DD
  end_date TEXT,                       -- 长期险可空
  next_renewal_date TEXT,
  sales_channel TEXT,                  -- agent / broker / online / bank / other
  sales_contact TEXT,                  -- JSON: { name, phone, company }（孤儿单时这个最关键）
  cash_value_path TEXT,                -- 落盘路径: memory/insurance-cashvalue-tables/<policy_id>.json
  health_disclosure_summary TEXT,      -- 简述本次投保的健康告知要点（"无既往症"/"高血压二级已告知"）
  waiting_period_end TEXT,              -- 等待期结束日（医疗险/重疾险特有）
  guaranteed_renewable INTEGER,        -- 0/1：是否保证续保（短期医疗险核心）
  status TEXT DEFAULT 'active',        -- 详见 2.2 表
  raw_text TEXT,
  ai_summary TEXT,
  tags TEXT,                           -- JSON
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (family_member_id) REFERENCES family_members(member_id),
  FOREIGN KEY (policy_holder_id) REFERENCES family_members(member_id)
);

CREATE INDEX idx_policies_member ON insurance_policies(family_member_id);
CREATE INDEX idx_policies_holder ON insurance_policies(policy_holder_id);
CREATE INDEX idx_policies_category ON insurance_policies(category);
CREATE INDEX idx_policies_renewal ON insurance_policies(next_renewal_date);
CREATE INDEX idx_policies_status ON insurance_policies(status);
CREATE INDEX idx_policies_channel ON insurance_policies(sales_channel);

CREATE TABLE cash_assets (
  asset_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                  -- 活期/货基/短期理财/personal_pension/其他
  account_alias TEXT,                  -- "招行活期" / "招行货基" / "个人养老金账户"
  balance REAL,
  currency TEXT DEFAULT 'CNY',
  as_of_date TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE insurance_claims (
  claim_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  claim_date TEXT,                     -- 出险日期
  claim_reason TEXT,                   -- 出险原因
  claim_amount REAL,                   -- 申请理赔金额
  status TEXT NOT NULL,                -- submitted / under_review / approved / rejected / paid
  paid_amount REAL,
  paid_date TEXT,
  rejection_reason TEXT,               -- 拒赔原因（如"未如实告知"—— 健康告知问题显式标注）
  notes TEXT,
  raw_text TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (policy_id) REFERENCES insurance_policies(policy_id)
);

CREATE INDEX idx_claims_policy ON insurance_claims(policy_id);
CREATE INDEX idx_claims_date ON insurance_claims(claim_date);
CREATE INDEX idx_claims_status ON insurance_claims(status);
```

**关键设计选择**：

- **三方角色独立 FK**：`family_member_id`（被保人）/`policy_holder_id`（投保人）/`beneficiary_ids`（受益人 JSON 数组），**经常不是同一个人**（丈夫给妻子买、母亲给孩子买）
- **`health_disclosure` 在 `family_members`**：健康告知是**个人维度**的（同一个人的所有保单共用一份披露历史）
- **`raw_text` 永远保留**（兜底 + 后续重解析）
- **`next_renewal_date` 与 `end_date` 分离**：长期寿险无 end_date 但有续保/缴费日；短期医疗险两个都有
- **`status` 全集**：`active / expired / cancelled / pending / lapse（断缴失效）/ reinstated（复效）/ surrendered（退保）/ matured（满期）/ claim（理赔中）/ claimed（已理赔）`
- **`guaranteed_renewable` / `waiting_period_end`**：医疗险 / 重疾险特有字段，影响"续保"实际意义
- **`sales_contact` JSON**：孤儿单风险——代理人离职后这个联系人是唯一续保/理赔窗口
- **`status='pending'`** 表示解析未完成，下次再解析
- **解析失败不阻塞录入**：缺啥问啥，逐项对话补齐

---

## 4. 端到端流程

### 4.1 录入一张保单（含三方角色识别）

```
[用户对话]
  "/capture-me insurance add
   平安福 2023，30 年缴，年缴 8000，
   重疾 50 万 + 寿险 51 万，
   我是投保人，老婆是被保人，
   受益人是儿子，
   去年 6 月生效，销售是张经理（13800000000）"
            ↓
[CLI: insurance add]
   ↓ 调 parser.js
[parser.js: parsePolicyText(text)]
  → 调大模型解析 → 输出 JSON:
     {
       policy_holder: { name: "我", relation: "self" },
       insured:       { name: "老婆", relation: "spouse" },
       beneficiaries: [{ name: "儿子", relation: "child" }],
       category: "critical_illness+life",
       insurer: "平安",
       product_name: "平安福 2023",
       sum_insured: { critical_illness: 500000, life: 510000 },
       annual_premium: 8000,
       payment_method: "年缴",
       payment_period: "30年缴",
       start_date: "2023-06-XX",
       sales_channel: "agent",
       sales_contact: { name: "张经理", phone: "13800000000" }
     }
            ↓
[agent 主动问]  ⚠️ 健康告知是理赔拒赔主因，必须问：
  "这份保单投保时有没有健康告知项？（如既往症、家族史等）
   若不清楚，可说'无'或'我不确定'"
            ↓
[用户答] "我老婆有轻度高血压二级，已如实告知"
            ↓
[index.js: insertPolicy(parsed)]
  → family_member 去重 → 插入/复用 3 个 member（我/老婆/儿子）
  → 写 health_disclosure 到老婆的 member 记录
  → 写 health_disclosure_summary 到保单
  → 插入 insurance_policies（含 cash_value_path 默认空，3 张保单）
  → 计算 next_renewal_date（年缴 + 1 年）
  → 返回 policy_id + ai_summary
            ↓
[返回给用户]
  ✓ 保单已录入: ins_abc123
  · 投保人: 我 / 被保人: 老婆 / 受益人: 儿子
  · 平安福 2023 | 重疾 50 万 + 寿险 51 万
  · 年缴 8,000（年缴）/ 30 年缴 / 下次续保: 2025-06-XX
  · 销售: 张经理 (13800000000) — 注意保存此联系方式
  · 健康告知: 已告知（老婆 轻度高血压二级）
  
  体检报告已包含 1 张保单。要看完整报告吗？
```

### 4.2 体检报告（含免责声明 + 理赔引用 + 个人养老金）

```
[用户] /capture-me insurance report
            ↓
[insurance report]
  → 查 status IN (active, lapse) 的保单
  → 查 family_members
  → 查 cash_assets
  → 查 claims（最近 1 年理赔记录，按保单聚合）
  → 调 analyzer.computeHealthCheck(policies, family, cash, claims)
            ↓
[analyzer.js] 输出 6 部分:
  A. 资产概览     → 年总保费 / 现金/应急资产（按 type 分类，含 personal_pension）
                  / 保费占可支配收入比 / 应急金覆盖月数
  B. 险种覆盖     → life/health/accident/critical_illness/annuity/pension 六类
                    按"已覆盖/部分/缺失"标记
  C. 保额建议     → 双十法则 + 家庭风险矩阵两套并行
                    列出每类建议保额 vs 现有保额（取两者较高者）
  D. 缺口清单     → "缺意外险 / 寿险差额 50 万 / 短期医疗险未续保"
  E. 理赔回顾     → 最近 1 年理赔：成功 N 笔 / 拒赔 M 笔
                    若有拒赔：标红"⚠️ M 笔拒赔，建议检查健康告知/合同条款"
  F. LLM 个性化层 → 在规则之上加柔性建议
            ↓
[输出]
  ① 终端彩色输出（与 capture-me 仪表盘风格一致）
  ② 落盘 memory/insurance-reports/2026-06-14-体检.md
  ③ metadata 写回（rules_used, data_completeness, llm_personalization_notes）
  ④ **必加 footer（合规章节）**：
     ---
     📌 免责声明：本报告由 capture-me 保险管家自动生成，
     仅供家庭资产规划参考，**不构成任何投保/退保/理赔建议**。
     实际决策建议咨询持牌保险经纪人或代理人。
     ---
```

### 4.3 续保/到期提醒（含银行卡余额检查）

```
[cron: 工作日 09:00]  →  node bin/insurance check-reminders
            ↓
[check-reminders]
  → 查 next_renewal_date 在 [今天+1, 今天+30] 的保单
  → 查 end_date 在 [今天+1, 今天+60] 的保单
  → 按距今天数（7/30/60）选对应模板
  → 汇总成单条消息（避免一天多条）
  → 调 notify.js 推送
            ↓
[消息样例 — 距续保 7 天]
  📅 续保提醒（7 天内）
  • 平安福 2023 — 老婆
    下次缴费: 2026-06-21 (7 天后)
    年缴 8,000 元
    ⚠️ **建议提前 3 天确认绑定银行卡余额**（断缴 → 失效）
    销售联系: 张经理 13800000000
  
  • 短期医疗险 — 我
    到期: 2026-06-25 (11 天后)
    ⚠️ 等待期 30 天，提前续保避免空窗
    
  本周无保单到期。
  
  体检报告: /capture-me insurance report
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

### 5.1 规则层 — 双公式并行（双十 + 家庭风险矩阵）

| 维度 | 双十法则 | 家庭风险矩阵 | 取值 |
|---|---|---|---|
| 寿险缺口 | 寿险总额 < 年收入 × 10 | 寿险总额 < 年收入 × 10 + 房贷余额 | 两者较大值 |
| 重疾缺口 | 重疾总额 < 年支出 × 5 | 重疾总额 < 年支出 × 5（含康复期 3-5 年） | 两者较大值 |
| 意外险 | 年收入 × 10 | 年收入 × 10-15（高风险职业 1.5x） | 两者较大值 |
| 医疗险 | 百万医疗险 active | 百万医疗 active + 保证续保 | 矩阵更严 |
| 寿险/保费比 | < 10% | < 10%（含所有保费） | 相同 |
| 应急金 | 6 个月支出 | 6-12 个月（含家庭稳定度） | 矩阵更严 |

**为什么两套并行**：
- 双十法则是入门级"理财第一课"，C 端用户最熟悉
- 家庭风险矩阵（房贷/子女/父母/职业）更精细，国内中产更合适
- **输出时展示两套结果**，让用户和经纪人讨论时有个共同语言

| 维度 | 公式/规则 | 数据来源 |
|---|---|---|
| 寿险缺口 | max(收入×10, 收入×10+房贷余额) - 已有寿险 | 保单 + family.birth_year/occupation + 用户在体检报告对话中告知"房贷余额" |
| 重疾缺口 | max(年支出×5, 年支出×5×1.2[含康复期]) - 已有重疾 | 保单 + cash_assets |
| 意外险 | 收入×10-15 × 职业系数 - 已有意外 | 保单 + family.risk_profile |
| 医疗险 | 是否有 active 且 guaranteed_renewable=1 的百万医疗 | 保单 + 短期险 end_date |
| 保费占比 | 年总保费 / 年可支配收入 | 保单 + 体检报告对话中采集的"年可支配收入"（v1 不持久化到独立表） |
| 应急金 | 现金/应急资产 / 月支出（推荐 6-12 个月） | cash_assets |

**为什么用规则而不是纯 LLM**：
- 缺口公式是公认方法论（双十/标普/家庭风险矩阵），可复现
- 规则输出**可解释**：用户能看懂为什么建议补 50 万寿险
- LLM 留给"按家庭成员特征 + 未来计划"做柔性建议

### 5.2 LLM 个性化层

规则输出后，调用大模型加一层个性化分析：
- **有房贷** → 寿险建议加 30%（覆盖房贷余额）
- **孩子 < 3 岁** → 关注教育金险（年金类）
- **父母 > 60 岁** → 关注医疗险（百万医疗）+ 意外险
- **工作高风险（出差/体力）** → 意外险加 1.5 倍
- **有移民/留学计划** → 提示香港/美元保单的可行性（但 spec 不深做）
- **个人养老金账户 active** → 提示税延上限（年 12,000 元）和税优比例

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
| **孤儿单（sales_contact 缺失）** | 体检报告中提示"⚠️ 以下保单无销售联系方式，**断缴或理赔时风险大**：…" |
| **健康告知异常（拒赔记录）** | 体检报告标红"⚠️ 最近 1 年有 M 笔拒赔，建议核对合同健康告知条款" |
| **保单断缴** | status 自动判 `lapse`；体检报告中"已失效保单"分类下显示 |
| **个人养老金账户类型** | 体检报告在现金资产概览里单独标 |

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
| parser 单元 | Jest | 5 类典型输入：寿险/重疾/医疗/意外/混合 + 边界（信息缺失 / 不规范） + **三方角色识别**（投保人≠被保人/受益人的常见组合） |
| analyzer 单元 | Jest | 5 种缺口场景：完全覆盖 / 部分覆盖 / 完全无覆盖 / 数据不足 / 现金为 0 + **双公式并行结果一致** |
| reminder 集成 | Jest + DRY_RUN notify | 命中 7/30/60 天 / 未命中 4 个分支 + **银行卡余额检查提示出现** |
| claims 模块 | Jest | 录入 / 列表 / 状态机迁移（submitted→paid/rejected） |
| rules-review 单元 | Jest | 跑规则反馈，LLM mock 输出建议 |
| 端到端 | 手测 | 用户对话 → 录入 → 体检 → 提醒 → 规则回顾 一次走通 |
| 缺口方法论 | 文档 + Jest fixture | 固定输入 → 固定输出快照（双公式并行） |

---

## 9. YAGNI 红线（暂不做）

- ❌ 银行/股票/基金 API 对接
- ❌ 假设性问题（"如果加 100 万寿险"）
- ❌ 历史保单归档（只管当前在生效的）
- ❌ 自动化规则评估（用偶发回顾代替）
- ❌ 视觉伴侣（保险管家主要是 CLI + 数据报告，不需要 UI mockup）
- ⏸️ **产品对比**（v2 评估）—— 用户原话"查缺补漏"暗示了"现状 vs 应该如何"，但**涉及保险经纪牌照合规风险**，暂缓
- ⏸️ **多币种 / 香港 / 美元保单**（v2 评估）—— 高净值家庭常见；`currency` 字段已留好，未来无缝加

---

## 10. 落地清单（write 阶段会展开成 plan）

1. 新增 **4 张表**（`db.js` 扩展 `initDb()`） + 9 个索引
2. `lib/insurance/parser.js`：自然语言 → 保单结构化（含**三方角色识别** + 健康告知询问）
3. `lib/insurance/index.js`：CRUD + 公共 API
4. `lib/insurance/analyzer.js`：体检 + 缺口分析（**双十 + 家庭风险矩阵** + LLM + 理赔回顾 + **免责声明**）
5. `lib/insurance/cash.js`：现金资产 CRUD + 汇总（含 `personal_pension` 类型）
6. `lib/insurance/reminder.js`：续保/到期检测（**含银行卡余额检查提示**）
7. `lib/insurance/claims.js`：理赔记录 CRUD + 状态机
8. `bin/insurance`：CLI 入口（含 `add` / `add-cash` / `query` / `renewals` / `gap` / `report` / `claim add` / `claim list` / `check-reminders` / `rules-review`）
9. `lib/setup-cron.js` 追加 insurance-reminder 任务
10. SKILL.md 增量：新增 `## 保险管家（Insurance Manager）` 章节
11. README.md 增量：在效率工具列表下加一行
12. 单元测试：`tests/insurance/` 下 5+5+1+1+2 = 14+ 用例
13. 端到端手测：录入（带三方角色）→ 体检（含免责/理赔）→ 提醒（含银行卡）→ 规则回顾

---

## 11. 调研记录（v2 修订依据）

调研对象（GitHub）：

- **FDU-INS/Insurance-Skills**（复旦许闲教授团队，2026-04）—— 国内最相关开源项目；旗下 `insurance-agent-customer-crm` 验证了"保单结构化/续保提醒/缺口分析/家庭成员图谱/理赔查询"是 C 端 + B 端都需要的标准能力。
- **KRASA-AI/insurance-ai-skills**（美国/英国/欧盟运营自动化）—— 监管（NAIC/ICOBS vs 中国银保监）完全不同，参考价值低。
- **zhuang-HE/non-motor-insurance-product**（财险 7 步法）—— 不重合。
- **kalta-ai/actuarial-skills**（精算）—— 不重合。
- **claude-for-financial-services-cn**（A 股金融 63 skills）—— 财富管理里有 `china-financial-plan` 间接相关；架构参考：多 references 按需加载。

修订决策已逐条并入第 1-10 节。YAGNI 项目"理赔追踪"调研后**从红线拿回**（理赔拒赔主因 = 健康告知问题，必须跟保单关联）。

---

**待写 plan 阶段展开为可执行步骤。**
