/**
 * lib/insurance/cash.js — 现金/应急资产封装
 */
const insDb = require('./db');

function addCash(input) { return insDb.insertCashAsset(input); }
function listCash() { return insDb.listCashAssets(); }
function getCash(id) { return insDb.getCashAsset(id); }
function deleteCash(id) { return insDb.deleteCashAsset(id); }

function summarizeByType() {
  const all = listCash();
  const sum = {};
  for (const a of all) {
    sum[a.type] = (sum[a.type] || 0) + (a.balance || 0);
  }
  return sum;
}

function totalCash() {
  return listCash().reduce((s, a) => s + (a.balance || 0), 0);
}

module.exports = { addCash, listCash, getCash, deleteCash, summarizeByType, totalCash };
