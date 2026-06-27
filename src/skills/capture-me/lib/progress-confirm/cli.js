#!/usr/bin/env node
/**
 * lib/progress-confirm/cli.js — capture-me progress-confirm 子命令入口
 *
 * 用法：
 *   node cli.js scan [--json] [--week=2026-W26]    # 扫描活跃项目
 *   node cli.js parse --reply="..." --projects=<json> --llm-result=<json>
 *                                                      # 校验 LLM 结果
 *   node cli.js apply [--dry-run] [--week=2026-W26]   # 落库（需先 scan → parse 串起来）
 *   node cli.js migrate [--dry-run|--confirm]         # 老数据迁移
 *
 * 完整流程（OpenClaw agent 调用）：
 *   1. scan --json                           → projectsJson
 *   2. 渲染 Markdown → 推送飞书
 *   3. 等用户回复
 *   4. parse --reply=... --projects=... --llm-result=<LLM JSON>
 *   5. apply --week=...
 *   6. 把结果反馈给用户
 */

const path = require('path');
const { scanActiveProjects, renderScanMarkdown } = require('./scanner');
const { buildPrompt, validateAndApply } = require('./parser');
const { applyChanges } = require('./applier');
const { migrate } = require('./migrate-progress');
const { getIsoWeek } = require('../iso-week');

function parseArg(args, prefix) {
  return args.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function cmdScan(args) {
  const wantJson = args.includes('--json');
  const weekIso = parseArg(args, '--week=') || getIsoWeek(new Date());

  const projects = scanActiveProjects({ weekIso });

  if (wantJson) {
    console.log(JSON.stringify({ week_iso: weekIso, projects }, null, 2));
    return;
  }

  console.log(renderScanMarkdown(projects, weekIso));
}

function cmdParse(args) {
  const replyText = parseArg(args, '--reply=');
  const projectsJson = parseArg(args, '--projects=');
  const llmResultJson = parseArg(args, '--llm-result=');

  if (!replyText || !projectsJson || !llmResultJson) {
    console.error(
      '用法: progress-confirm parse --reply="..." --projects=<json> --llm-result=<json>',
    );
    process.exit(2);
  }

  let projects, llmResult;
  try {
    projects = JSON.parse(projectsJson);
    llmResult = typeof llmResultJson === 'string' ? JSON.parse(llmResultJson) : llmResultJson;
  } catch (e) {
    console.error(`JSON 解析失败: ${e.message}`);
    process.exit(2);
  }

  const result = validateAndApply(projects, llmResult);
  console.log(JSON.stringify(result, null, 2));
}

function cmdApply(args) {
  const dryRun = args.includes('--dry-run');
  const weekIso = parseArg(args, '--week=') || getIsoWeek(new Date());
  const projectsJson = parseArg(args, '--projects=');

  if (!projectsJson) {
    console.error('用法: progress-confirm apply [--dry-run] --projects=<json>');
    process.exit(2);
  }

  let projects;
  try {
    projects = JSON.parse(projectsJson);
  } catch (e) {
    console.error(`JSON 解析失败: ${e.message}`);
    process.exit(2);
  }

  const result = applyChanges(projects, { weekIso, dryRun });
  console.log(JSON.stringify(result, null, 2));
}

function cmdMigrate(args) {
  const confirm = args.includes('--confirm');
  const dryRun = !confirm;
  const result = migrate({ dryRun });

  console.log(JSON.stringify(result, null, 2));
}

function cmdPrompt(args) {
  const replyText = parseArg(args, '--reply=');
  const projectsJson = parseArg(args, '--projects=');

  if (!replyText || !projectsJson) {
    console.error('用法: progress-confirm prompt --reply="..." --projects=<json>');
    process.exit(2);
  }

  let projects;
  try {
    projects = JSON.parse(projectsJson);
  } catch (e) {
    console.error(`JSON 解析失败: ${e.message}`);
    process.exit(2);
  }

  console.log(buildPrompt(projects, replyText));
}

function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const rest = args.slice(1);

  switch (cmd) {
    case 'scan':
      cmdScan(rest);
      break;
    case 'parse':
      cmdParse(rest);
      break;
    case 'apply':
      cmdApply(rest);
      break;
    case 'migrate':
      cmdMigrate(rest);
      break;
    case 'prompt':
      cmdPrompt(rest);
      break;
    default:
      console.error(`未知子命令: ${cmd}`);
      console.error('可用: scan | parse | apply | migrate | prompt');
      process.exit(2);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(`\n❌ 错误: ${e.message}`);
    if (process.env.DEBUG) console.error(e.stack);
    process.exit(1);
  }
}

module.exports = {
  scanActiveProjects,
  renderScanMarkdown,
  buildPrompt,
  validateAndApply,
  applyChanges,
  migrate,
  getIsoWeek,
};