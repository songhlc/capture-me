---
name: tag-taxonomy
description: 记忆标签分类体系 - 工作/投资/生活/项目/承诺
type: reference
---

# 标签分类体系

## 一级分类（必须顶格标签）

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

## 二级标签（跟在主标签后）

### @work 二级
- `@work/email` — 邮件相关
- `@work/meeting` — 会议
- `@work/report` — 汇报/报告
- `@work/followup` — 需要跟进的

### @project 二级（按项目名）
- `@project/intent-workflow` — 意图工作流项目
- `@project/xxx` — 其他项目

### @people 二级
- `@people/老板` — 上级
- `@people/colleague` — 同事
- `@people/partner` — 合作伙伴

## 时间相关标签
- `@deadline/今天`
- `@deadline/明天`
- `@deadline/本周`
- `@deadline/下周`
- `@deadline/月底`
- `@deadline/周五`

## 状态标签
- `@pending` — 待处理
- `@done` — 已完成
- `@delegated` — 已委托/已转提醒
- `@someday` — 将来某时

## 使用规则
1. 每条记录至少一个一级分类标签
2. `@deadline` 标签用于有明确时间要求的
3. `@pending` 默认状态，可省略
4. 承诺类（"答应某人做某事"）同时打 `@work/followup` + `@promise`
