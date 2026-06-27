/**
 * lib/progress-confirm/index.js — 公共 API 入口
 *
 * 用法：
 *   const { scanActiveProjects, buildPrompt, validateAndApply, applyChanges } =
 *     require('./progress-confirm');
 */

const schema = require('./schema');
const scanner = require('./scanner');
const parser = require('./parser');
const applier = require('./applier');
const migrate = require('./migrate-progress');

module.exports = {
  // schema
  VALID_STATUS: schema.VALID_STATUS,
  upgradeProgressDetail: schema.upgradeProgressDetail,
  resolveProgressDetail: schema.resolveProgressDetail,
  backfillFromWeekPlan: schema.backfillFromWeekPlan,

  // scanner
  scanActiveProjects: scanner.scanActiveProjects,
  renderScanMarkdown: scanner.renderScanMarkdown,

  // parser
  buildPrompt: parser.buildPrompt,
  validateAndApply: parser.validateAndApply,
  STATUS_HINT: parser.STATUS_HINT,

  // applier
  applyChanges: applier.applyChanges,

  // migrate
  migrateProgress: migrate.migrate,
};