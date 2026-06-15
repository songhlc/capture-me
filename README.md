# 知己 / Capture-Me

**知己，更懂你的 AI 助手。是你数字永生的第一块砖。**

---

知己不是一款软件。

它是你最诚实的朋友、最勤奋的助理、最耐心的倾听者，也是你私密信息的保险箱。

你说的每一句话、做的每一件事、想过的每一个念头，都在变成你自己的数字记忆。

随着时间推移，这些记录会比你自己更懂你自己——而你已经开始在打造第二个自己。

---

## 适合谁用

知己不是给所有人的。

它是给：
- **对自我认知有追求的人** — 不只是想记录，想了解"我是谁"
- **愿意为未来投入的人** — 相信现在的每一笔记录，都在为"未来的自己"积累
- **想让 AI 真正懂自己的人** — 不是用工具，是找一个懂你的伴

进来的人不是因为"功能多"，是因为认同这件事。

---

## 产品逻辑

**先用效率工具让你每天都来**——写日记、看待办、写周报，每天打开的理由。

**久而久之画像就建立起来了**——你发现它记得你说过什么、你的习惯是什么、你为什么事情焦虑。

**然后你就离不开了**——"它真的懂我"。

---

## 🤖 你私人的 AI 助理

它认识你。知道你的目标、习惯、偏好、价值观。你说的每一句话，它都在更新对你的理解。下次找你的时候，它已经知道你关心什么、讨厌什么、在为什么挣扎。

## 📝 你随手可丢的情绪垃圾桶

不用组织语言，不用在意格式。"今天被老板骂了，很烦躁"——这就够了。它不会评价你，只会记住你，然后在你需要的时候帮你看清情绪的规律。

## 💡 你灵感的保险箱 + 头脑风暴伙伴

说一声"这个先记下来"，知己帮你存好。等你想用的时候调出来，它陪你一起想：这个想法为什么重要？可以怎么落地？第一步做什么？讨论出雏形，直接转待办推进。

## 🧠 自我认知的苏格拉底式对话伙伴

很多人在说"我想做 xxx"的时候，其实还没想清楚自己为什么要做。

知己会像苏格拉底一样追问你：
- 你为什么想做这个？
- 是什么让你觉得这件事重要？
- 如果做到了，你会怎样？
- 这个目标和其他目标的优先级是什么？

不是质疑你，是帮你想清楚。反复追问，直到你看见自己真正的动机。

## 📋 你的效率工具

- **写日记** — 每天随手记，AI 帮你整理成结构化日志
- **记工作事项** — 站会内容、项目进展、临时需求，说完即存
- **待办追踪** — 待办自动识别，同步 Apple Reminders
- **周计划工作流** — 周一定计划、每日 check-in、周五自动周报（见下一节）
- **🛡️ 家庭保险管家** — 保单结构化录入、家庭体检报告、缺口分析、续保提醒（见后文）

## 📅 周计划工作流（Week Plan）

把"周一定计划 → 每日推进 → 周五出周报"做成一条自动流水线：

- **周一早上 09:00** — 自动提醒你建本周计划
- **每天下班前 18:00** — 自动来问一句"今天每个专项进展如何"
- **周五下班前 17:30** — 自动生成本周周报，含完成度 / 阻塞项 / 各项摘要
- **未完成项自动 carryover** — 周一一开新计划就把上周没干完的接过来

> 设计哲学：周计划是"梳理表"，不是任务管理器 —— 只记**专项 / 优先级 / 负责人**，细节沉在各专项自己的数据里。

## 🛡️ 家庭保险管家（Insurance Manager）

保单散落在 5 个 APP、3 张纸、1 封邮件里？想看"我们家到底买了哪些险"得翻半天？保险管家把这些串成闭环。

### 解决什么问题

- 快速看"我们家到底买了哪些险"（按险种 / 到期 / 被保人 / 销售渠道 4 维度查询）
- 判断"保额够不够、险种缺不缺"（**双十法则 + 家庭风险矩阵**两套并行规则 + LLM 个性化）
- 续保 / 到期前**工作日 09:00 自动提醒**（7/30/60 天三档窗口，**7 天内强制带"建议提前 3 天确认绑定银行卡余额"提示**）
- 哪些保单是"孤儿单"（代理人已离职，没人服务）—— `sales_contact` 缺失时体检报告标红
- 保单现金价值 / 退保损失（终身寿险 / 年金 / 增额终身 / 万能 / 分红险都有现价表）
- 家庭保险**体检报告**（随时 / 可定时）：资产概览 + 险种覆盖 + 保额建议 + 缺口清单 + 理赔记录 + **免责声明**

### 数据模型

4 张表 + 9 个索引：

- `family_members`（家庭成员，**投保人/被保人/受益人共用一张表，三方角色独立 FK**）
- `insurance_policies`（保单，含 `sales_contact` 防止孤儿单）
- `cash_assets`（现金/应急资产，含 `personal_pension` 个人养老金账户）
- `insurance_claims`（理赔记录，状态机 `submitted → under_review → approved → paid / rejected`）

完整 schema 见 `references/data-model.md`。

### 怎么用

录入只需说人话，Agent 会主动问清投保人 / 被保人 / 受益人三个角色（**经常不是同一个人**：丈夫给妻子买、母亲给孩子买）：

```
/capture-me insurance add-policy
平安福 2023，30 年缴，年缴 8000，
重疾 50 万 + 寿险 51 万，
我是投保人，老婆是被保人，
受益人是儿子，
去年 6 月生效，销售是张经理（13800000000）
```

录入后**健康告知必问**（理赔拒赔主因 = 健康告知问题，国内 60% 拒赔由此导致）：

> "这份保单投保时有没有健康告知项？"

### 体检报告（核心交付物）

6 段输出 + 必含合规章节：

- A 资产概览 — 年总保费 / 现金应急金 / 保费占可支配收入比 / 应急金覆盖月数
- B 险种覆盖 — life / health / accident / critical_illness / annuity / pension 六类
- C 保额建议 — 双十法则 + 家庭风险矩阵并行，列每类建议保额 vs 现有保额
- D 缺口清单 — "缺意外险 / 寿险差额 50 万 / 短期医疗险未续保"
- E 理赔回顾 — 最近 1 年理赔：成功 N 笔 / 拒赔 M 笔；若有拒赔标红
- F LLM 个性化层 — 在规则之上加柔性建议

报告落盘：`memory/insurance-reports/YYYY-MM-DD-体检.md`，**底部必加免责声明**：

> 📌 本报告由 capture-me 保险管家自动生成，仅供家庭资产规划参考，**不构成任何投保 / 退保 / 理赔建议**。实际决策建议咨询持牌保险经纪人或代理人。

### 续保 / 到期提醒

- 工作日 09:00 跑 `insurance check-reminders`
- 7/30/60 天三档窗口
- 7 天内保单**强制**带"建议提前 3 天确认绑定银行卡余额"提示
- 通知走主技能 `lib/notify.js`，复用你 Agent 已对接的飞书 / 钉钉 / 通知中心，**不重复填 token**

首次使用 `insurance` 任意子命令时 Agent 会问"是否注册定时任务"，同意即可。

> 设计哲学：保险是"长期承诺 + 信息不对称"——保险管家不替你决策，只把信息摊开 + 风险标红。**实际决策咨询持牌经纪人**。

### 怎么用

首次使用 weekplan 时 Agent 会问你一句"是否注册 3 个定时任务"，同意即可。之后完全自动跑：

| 时机 | Agent 自动执行 | 提醒方式 |
|---|---|---|
| 周一 09:00 | `weekplan checkin-bot --remind-create` | 推到你 Agent 已配置的通道 |
| 工作日 18:00 | `weekplan checkin-bot --remind-update` | 同上 |
| 周五 17:30 | `weekplan auto-report` | 同上 |

**通知通道零配置** —— 自动复用你 Agent（OpenClaw / Hermes / ...）已对接的飞书 / 钉钉 / 通知中心，不需要重复填 token / webhook。

## 🔄 定期复盘

"吾日三省吾身"——知己帮你做到。

每周、每月自动生成复盘报告：
- 这段时间情绪趋势如何
- 承诺兑现了多少
- 目标推进到了哪一步
- 有哪些模式在重复出现

知己会主动推送给你，不需要你想起来。

## 🔍 人际洞察

知己记得你身边的关系网络：
- 你提过谁、关系怎么样、情绪变化
- 某个重要的人很久没提起了，主动提醒你一声
- 谁对你影响最大、什么类型的人际关系让你消耗或充电

不是通讯录，是你对人际关系的自我洞察。

## 📋 你的承诺执行助手

"我明天一定要跑步"——知己记住了。下周你忘了，它会问你：上次说的跑步，跑了吗？反复说却没做？它会提醒你正视这件事。

## 🌍 你的旅程地图

"知己，我去了日本东京"

去过的地方，都记得。不只是地点，还有时间、心情、当时的笔记。

知己帮你点亮全世界——每记录一次，就多亮一个地方。

慢慢地，你的世界地图就出来了。

## 🧬 你数字永生的第一块砖

你现在的每一个念头、每一次情绪波动、每一个决定，都是你数字生命的一部分。有一天，这些记录会比你自己更懂你自己。

---

## 安装

本项目包含两个技能和一个 Hook：

| 组件 | 说明 |
|------|------|
| `capture-me` | 主技能：随手记录 + 复盘 + 画像 |
| `capture-me-observer` | 被动观察：静默收集对话中的画像信号 |
| `hooks/capture-me-observer` | OpenClaw Hook：拦截消息并调用 observer |

### Claude Code 用户

```bash
# 1. 复制主技能
cp -r src/skills/capture-me ~/.claude/skills/

# 2. （可选）复制被动观察技能
cp -r src/skills/capture-me-observer ~/.claude/skills/

# 3. 复制自动观察 Prompt（启用被动收集）
cp src/skills/capture-me-observer/CLAUDE.md ~/.claude/CLAUDE.md

# 4. 重启 Claude Code
# 5. 输入 /capture-me 开始使用
```

> **自动观察说明**：将 `CLAUDE.md` 内容追加到你的 `~/.claude/CLAUDE.md` 中，AI 会自动在对话中提取画像信号并静默写入数据库。每次对话都会自动收集，无需手动触发。

### Codex 用户

```bash
# 1. 复制主技能
cp -r src/skills/capture-me ~/.codex/skills/

# 2. 安装主技能依赖
cd ~/.codex/skills/capture-me && npm install

# 3. （可选）复制被动观察技能
cp -r src/skills/capture-me-observer ~/.codex/skills/

# 4. 将自动观察规则追加到项目根 AGENTS.md
cat src/skills/capture-me-observer/CODEX-AGENTS.md >> AGENTS.md
```

> **Codex 使用说明**：Codex 通过对话调用技能，不使用 `/capture-me` 这种 slash command。安装后可直接在对话中说“用 capture-me 记录今天做了什么”“用 capture-me 执行 init”“用 capture-me 查询最近一周的待办”。

### OpenClaw 用户

```bash
# 方式一：让 OpenClaw 自动安装
请帮我安装这个 skills：https://github.com/songhlc/capture-me

# 方式二：手动安装所有组件
# 安装主技能
cp -r src/skills/capture-me ~/.openclaw/skills/
# 安装被动观察技能
cp -r src/skills/capture-me-observer ~/.openclaw/skills/
# 安装 Hook（自动拦截消息并收集画像信号）
cp -r src/hooks/capture-me-observer ~/.openclaw/hooks/
```

### Hermes 用户

```bash
# 复制主技能
cp -r src/skills/capture-me ~/.hermes/skills/
# 复制被动观察技能
cp -r src/skills/capture-me-observer ~/.hermes/skills/
# 复制自动观察 Prompt（启用被动收集）
cat src/skills/capture-me-observer/HERMES.md >> ~/.hermes/config/prompt.md
```

> **自动观察说明**：将 Hermes 的 Prompt 内容追加到你的 Hermes 系统配置中，AI 会自动在对话中提取画像信号并静默写入数据库。

### 初始化

安装后运行初始化，完成用户画像设置：

```
Claude Code / OpenClaw / Hermes:
/capture-me init

Codex:
用 capture-me 执行 init
```

---

## 组件说明

### capture-me（主技能）

主动记录模式。你主动输入 `/capture-me <内容>` 进行记录。

**功能：**
- 随手记录：日记、工作、想法、待办
- AI 解析：意图识别、实体提取、标签生成
- 周报/月报生成
- 性格画像分析
- 承诺追踪

### capture-me-observer（被动观察技能）

静默收集模式。在你与 AI 对话时，自动分析并提取画像信号（工作/生活/偏好/情绪），写入同一数据库。

**在 OpenClaw 环境中：** 自动通过 Hook 拦截消息，无需额外操作。

**在 Claude Code 环境中：** 需将 `CLAUDE.md` 中的 Prompt 追加到 `~/.claude/CLAUDE.md`，AI 会自动在对话中提取信号。

**在 Codex 环境中：** 需将 `CODEX-AGENTS.md` 追加到项目根 `AGENTS.md`，Codex 会在用户消息后后台调用 observer。

**在 Hermes 环境中：** 需将 `HERMES.md` 中的 Prompt 追加到 Hermes 系统配置，AI 会自动在对话中提取信号。

**信号维度：**
- work、life、habit、emotion、preference、goal、relation、health

### hooks/capture-me-observer（OpenClaw Hook）

消息拦截器。部署在 OpenClaw 环境时，自动拦截每条用户消息，调用 observer 提取信号并静默写入数据库。

---

## 使用方法

### 核心命令

| 命令 | 功能 |
|------|------|
| `/capture-me <内容>` | 随手记录任意内容 |
| `/capture-me init` | 初始化用户画像 |
| `/capture-me profile` | 查看性格画像 |
| `/capture-me stat` | 查看统计信息 |
| `/capture-me review week` | 生成周报 |
| `/capture-me review month` | 生成月报 |
| `/capture-me query <关键词>` | 搜索历史记录 |
| `/capture-me query todos` | 查看所有待办 |
| `/capture-me projects` | 查看项目列表 |
| `/capture-me projects export` | 导出项目到 Markdown |
| `/capture-me why <问题>` | 5 Why 追问 |
| `/capture-me brainstorm` | 头脑风暴 |
| `/capture-me personality` | 大五人格 + MBTI 分析 |
| `/capture-me blindspot` | 盲区探测 |
| `/capture-me trigger` | 主动触发检查 |
| `/capture-me dashboard` | 打开 Web 仪表盘 |
| `/capture-me config [get\|set\|list]` | 配置管理 |
| `/capture-me mirror` | 镜子状态/承诺追踪 |
| `/capture-me weekplan [create\|show\|list\|add-item\|checkin\|carryover]` | 周计划工作流（创建 / 看 / 加专项 / 进展 check-in / 上周结转） |
| `/capture-me weekplan setup` | 一次性注册周一/每日/周五 3 个定时提醒（首次使用 Agent 会自动询问） |
| `/capture-me insurance add-policy` | 录入保单（对话 + 结构化，**三方角色独立识别**：投保人 / 被保人 / 受益人分别是谁） |
| `/capture-me insurance add-cash` | 录入现金 / 应急资产（含 `personal_pension` 个人养老金账户） |
| `/capture-me insurance add-claim` | 录入理赔记录（与保单关联；拒赔记录标红） |
| `/capture-me insurance query` / `renewals` | 查保单库 / 查 60/30/7 天内续保 / 到期 |
| `/capture-me insurance gap` / `report` | 单独跑缺口分析（双十 + 家庭风险矩阵）/ 体检报告（含免责） |
| `/capture-me insurance setup` | 注册 1 个 launchd 定时任务（工作日 09:00 检查续保 / 到期） |

### 自动观察（OpenClaw + Claude Code + Codex + Hermes）

**OpenClaw：** Hook 部署后自动生效，无需手动操作。

**Claude Code：** 追加 `CLAUDE.md` Prompt 到 `~/.claude/CLAUDE.md` 后自动生效。

**Codex：** 追加 `CODEX-AGENTS.md` 到项目根 `AGENTS.md` 后自动生效。

**Hermes：** 追加 `HERMES.md` Prompt 到 Hermes 系统配置后自动生效。

查看状态：

```bash
# OpenClaw 查看观察者状态
node ~/.openclaw/hooks/capture-me-observer/observe.js

# OpenClaw 查看信号统计
node ~/.openclaw/hooks/capture-me-observer/observe.js --stat

# Claude Code 查看信号（通过主技能）
/capture-me stat
```



知己的每一个功能，都建基于成熟的心理学和行为学理论：

| 功能 | 理论基础 |
|------|---------|
| 情绪分析 | **情绪颗粒度理论**（Lisa Feldman Barrett）+ **认知行为理论**（CBT）|
| 多面镜子 | **自我反馈理论**（Carver & Scheier）+ **元认知**（Flavell）|
| 灵感收集 | **发散-收敛思维模型**（Alex Osborn）+ **工作记忆理论**（Baddeley）|
| 画像感知 | **大五人格模型**（OCEAN, McCrae & Costa）+ **MBTI/荣格认知功能**|
| 习惯追踪 | **习惯回路理论**（James Clear / Charles Duhigg）|
| 自我认知追问 | **苏格拉底式追问**（Socratic Questioning）+ **反思性思维**（Dewey）|
| 人际洞察 | **社会支持理论**（Cohen & Wills）+ **人际关系评估**（Leary）|
| 定期复盘 | **反思性复盘理论**（Kolb 经验学习 cycle）+ **元认知**（Flavell）|
| 旅程记录 | **地点记忆激活**（Place Cell）+ **自传体记忆** |
| 数字永生 | **个人知识管理**（PKM）+ **传记记忆理论** |
| 保险管家 | **双十法则** + **家庭风险矩阵** + **生命周期-家庭收支曲线** + **合规免责原则** |

---

### 情绪分析 → 情绪颗粒度 + CBT
### 情绪分析 → 情绪颗粒度 + CBT

知己帮你细化情绪到：焦虑、失落、兴奋、平静、挫败感…… 高情绪颗粒度的人更懂自己，也更会处理情绪。记录久了能帮你看到：什么让你持续焦虑？什么让你真正满足？

**理论来源：** Lisa Feldman Barrett 情绪构建理论 + 认知行为疗法（CBT）

### 承诺追踪 → 认知失调理论

你反复说"要跑步"却没跑，知己标记出来——不是批评，是让你正视这个模式。看得到的不一致，才会想办法解决。

**理论来源：** Leon Festinger, *A Theory of Cognitive Dissonance* (1957)

### 多面镜子 → 自我反馈 + 元认知

知己通过 6 个镜子视角持续追踪你的行为模式：承诺兑现、情绪变化、习惯重复、关系动态、成长轨迹、目标进度。不是单一指标，是多维度的自我反馈。帮助你看见"镜子里的自己"。

**理论来源：** Carver & Scheier 自我调节理论（*Self-Regulation*）+ Flavell 元认知理论（*Metacognition*, 1979）

### 灵感收集 → 发散-收敛 + 工作记忆

外挂存储 = 清空工作记忆，让大脑专注在想本身，而不是记本身。把灵感从脑子里倒出来，它才有机会被碰撞、被放大。

**理论来源：** Alex Osborn 发散-收敛思维模型 + Baddeley 工作记忆理论

### 画像感知 → 大五人格 + MBTI/荣格

知己能识别你在不同场景下倾向于使用哪种认知方式（思考/情感/感觉/直觉），帮你了解自己是怎么消化信息、做决定的。

**理论来源：** 大五人格模型（OCEAN, McCrae & Costa, 1985）+ 荣格认知功能 → MBTI

### 习惯追踪 → 习惯回路

习惯 = 触发 → 行为 → 奖励。知己帮你记录频率、追踪中断、观察什么破坏了你的习惯。不是靠意志力硬撑，是靠看见模式来优化。

**理论来源：** Charles Duhigg *The Power of Habit* + James Clear *Atomic Habits*

### 自我认知追问 → 苏格拉底式追问 + 反思性思维

"我想做 xxx"——知己追问：你为什么想做？是什么让你觉得重要？如果做到了会怎样？通过一系列追问，帮你看见自己真正的动机和优先级。

**理论来源：** 苏格拉底式追问（Socratic Questioning，教育学经典方法）+ John Dewey *How We Think* (1910) 反思性思维理论

### 定期复盘 → Kolb 经验学习 + 元认知

知己帮你把零散的日记、工作、情绪串联起来，生成结构化复盘报告：情绪趋势、承诺兑现率、目标进度、重复出现的模式。主动推送，不需要你想起来。

**理论来源：** David Kolb 经验学习 cycle（*Experiential Learning*, 1984）+ Flavell 元认知理论（*Metacognition*, 1979）

### 人际洞察 → 社会支持理论 + 人际关系评估

知己记得你身边的关系网络，帮助你看见：什么类型的人际关系让你消耗，什么让你充电？谁是你重要的支持者？

**理论来源：** Cohen & Wills 社会支持理论（*Social Support and the Moderating of Psychosocial Stress*, 1985）+ Timothy Leary 人际关系评估模型（*The Interpersonal Circumplex*）

### 旅程记录 → Place Cell + 自传体记忆

去过的地方激活海马体的 Place Cell（位置细胞）。每一次"我去过这里"都在强化空间自传体记忆——你记得一个地方，往往记得的是当时的心情和故事。知己帮你把这些和地点一起记下来。

**理论来源：** O'Keefe & Nadel 地点场理论（Place Cell, 1971）+ 自传体记忆（Conway & Pleydell-Pearce, 2000）

### 数字永生 → PKM + 传记记忆

你记录的不是日志，是你的思考轨迹。当这些记录比你的记忆更完整，你就已经在数字世界留下了第二个自己。

**理论来源：** Tiago Forte *Building a Second Brain* + Conway & Pleydell-Pearce 自传体记忆理论 (2000)

---

所有数据存在本地，不上云，不被任何第三方访问。这是只属于你的私密空间。

*知己，懂你的那个。*



---

© windknow
