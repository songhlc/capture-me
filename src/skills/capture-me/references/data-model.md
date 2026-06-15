# Data Model

随手记 / 项目 / 性格 / weekplan / 保险管家 数据存储与 Markdown 文件格式。

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

## 保险管家（Insurance Manager）

> **保险**（policies / cash / claims）：SQLite 唯一源；Markdown 为 `report` 导出视图，非写入源。详见 `docs/superpowers/specs/2026-06-14-insurance-manager-design.md`。

### 4 张表

```sql
-- 家庭成员（投保人 / 被保人 / 受益人共用一张表，三方角色独立 FK）
CREATE TABLE family_members (
  member_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                 -- "我" / "老婆" / "爸" / "儿子"
  relation TEXT NOT NULL,             -- self/spouse/child/parent/other
  birth_year INTEGER,
  health_disclosure TEXT,             -- JSON: { conditions: [{name, severity, disclosed, disclosed_at}] }
  risk_profile TEXT,                  -- JSON: { occupation, smoker, dangerous_hobby, ... }
  created_at TEXT,
  updated_at TEXT
);

-- 保单（**三方角色独立 FK**：policy_holder_id ≠ family_member_id ≠ beneficiary_ids 常见）
CREATE TABLE insurance_policies (
  policy_id TEXT PRIMARY KEY,
  family_member_id TEXT NOT NULL,     -- 被保人 → family_members
  policy_holder_id TEXT,              -- 投保人 → family_members（可空：自己买给自己时填 = family_member_id）
  beneficiary_ids TEXT,               -- JSON 数组: [member_id, ...]
  category TEXT NOT NULL,             -- 混合险用 + 连接: critical_illness+life / health+critical_illness / etc.
  insurer TEXT,
  product_name TEXT,
  policy_number TEXT,
  sum_insured REAL,                   -- 元
  annual_premium REAL,                -- 元
  payment_method TEXT,                -- 年缴/月缴/季缴/趸交
  payment_period TEXT,                -- "20年缴" / "终身" / "5年期"
  coverage_period TEXT,               -- "终身" / "30年" / "至70岁"
  start_date TEXT,                    -- YYYY-MM-DD
  end_date TEXT,                      -- 长期险可空
  next_renewal_date TEXT,
  sales_channel TEXT,                 -- agent / broker / online / bank / other
  sales_contact TEXT,                 -- JSON: { name, phone, company }（孤儿单时这个最关键）
  cash_value_path TEXT,               -- 落盘路径: memory/insurance-cashvalue-tables/<policy_id>.json
  health_disclosure_summary TEXT,     -- 简述本次投保的健康告知要点
  waiting_period_end TEXT,            -- 等待期结束日（医疗险/重疾险特有）
  guaranteed_renewable INTEGER,       -- 0/1：是否保证续保（短期医疗险核心）
  status TEXT DEFAULT 'active',       -- active/expired/cancelled/pending/lapse/surrendered/matured/claim/reinstated
  raw_text TEXT,                      -- 原始输入，永远保留（兜底 + 重解析）
  ai_summary TEXT,
  tags TEXT,                          -- JSON
  source TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (family_member_id) REFERENCES family_members(member_id),
  FOREIGN KEY (policy_holder_id) REFERENCES family_members(member_id)
);

-- 现金/应急资产
CREATE TABLE cash_assets (
  asset_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,                 -- 活期/货基/短期理财/personal_pension/其他
  account_alias TEXT,                 -- "招行活期" / "招行货基" / "个人养老金账户"
  balance REAL,
  currency TEXT DEFAULT 'CNY',
  as_of_date TEXT,
  notes TEXT,
  created_at TEXT,
  updated_at TEXT
);

-- 理赔记录
CREATE TABLE insurance_claims (
  claim_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  claim_date TEXT,                    -- 出险日期
  claim_reason TEXT,                  -- 出险原因
  claim_amount REAL,                  -- 申请理赔金额
  status TEXT NOT NULL,               -- submitted / under_review / approved / rejected / paid
  paid_amount REAL,
  paid_date TEXT,
  rejection_reason TEXT,              -- 拒赔原因（"未如实告知"——健康告知问题显式标注）
  notes TEXT,
  raw_text TEXT,
  created_at TEXT,
  updated_at TEXT,
  FOREIGN KEY (policy_id) REFERENCES insurance_policies(policy_id)
);
```

### 9 个索引

```sql
-- 保单 6 个
CREATE INDEX idx_policies_member ON insurance_policies(family_member_id);
CREATE INDEX idx_policies_holder ON insurance_policies(policy_holder_id);
CREATE INDEX idx_policies_category ON insurance_policies(category);
CREATE INDEX idx_policies_renewal ON insurance_policies(next_renewal_date);
CREATE INDEX idx_policies_status ON insurance_policies(status);
CREATE INDEX idx_policies_channel ON insurance_policies(sales_channel);

-- 理赔 3 个
CREATE INDEX idx_claims_policy ON insurance_claims(policy_id);
CREATE INDEX idx_claims_date ON insurance_claims(claim_date);
CREATE INDEX idx_claims_status ON insurance_claims(status);
```

### 落盘目录

```
memory/
├── insurance-reports/             # 体检报告 markdown 落盘（YYYY-MM-DD-体检.md）
└── insurance-cashvalue-tables/    # 现金价值表（终身寿险/年金/万能/分红险等，<policy_id>.json）
```

### 关键设计选择

- **三方角色独立 FK**：`family_member_id`（被保人） / `policy_holder_id`（投保人） / `beneficiary_ids`（受益人 JSON 数组），**经常不是同一个人**（丈夫给妻子买、母亲给孩子买）
- **`health_disclosure` 在 `family_members`**：健康告知是**个人维度**的（同一个人的所有保单共用一份披露历史）
- **`raw_text` 永远保留**（兜底 + 后续重解析）
- **`next_renewal_date` 与 `end_date` 分离**：长期寿险无 end_date 但有续保/缴费日；短期医疗险两个都有
- **`guaranteed_renewable` / `waiting_period_end`**：医疗险 / 重疾险特有字段，影响"续保"实际意义
- **`sales_contact` JSON**：孤儿单风险——代理人离职后这个联系人是唯一续保/理赔窗口
- **缺口分析**：双公式并行（**双十法则** + **家庭风险矩阵**）取较大值，LLM 加一层个性化
- **体检报告必含合规章节**："本报告不构成任何投保/退保/理赔建议"

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

