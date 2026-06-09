/**
 * iso-week.js — ISO week math (no DB)
 *
 * Conventions:
 * - Week starts on Monday, ends on Friday (work week).
 * - ISO 8601 week numbering: week 1 = the week containing the first Thursday.
 * - week_iso format: "YYYY-Www" (e.g., "2026-W24").
 */

/**
 * Get ISO week info for a given date.
 * @param {Date} date
 * @returns {{year: number, weekNum: number, weekIso: string}}
 */
function getIsoWeek(date) {
  // Copy date so we don't mutate the input
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Day of week: Mon=0, Tue=1, ..., Sun=6 (we shift Sunday from 0 to 6)
  const dayNum = (d.getUTCDay() + 6) % 7;
  // Set to nearest Thursday: current date + 3 - dayNum (Mon=0 → +3, Tue=1 → +2, …, Sun=6 → -3)
  d.setUTCDate(d.getUTCDate() + 3 - dayNum);
  // First day of ISO year = first Thursday of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Week number = ceil((days since yearStart) / 7) + 1
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return {
    year: d.getUTCFullYear(),
    weekNum,
    weekIso: `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`,
  };
}

/**
 * Get the Monday-Friday date range for a given ISO year + week.
 * @param {number} year
 * @param {number} weekNum
 * @returns {{startDate: string, endDate: string}}
 */
function getWeekBounds(year, weekNum) {
  // Find Thursday of the given ISO week (Thursday is day 4 if Mon=0)
  // ISO week 1 always contains Jan 4. Thursday of week 1 = Jan 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayNum = (jan4.getUTCDay() + 6) % 7; // 0=Mon, ..., 6=Sun
  // Monday of week 1
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - jan4DayNum);
  // Monday of given week
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (weekNum - 1) * 7);
  // Friday = Monday + 4
  const friday = new Date(monday);
  friday.setUTCDate(monday.getUTCDate() + 4);

  return {
    startDate: formatYmd(monday),
    endDate: formatYmd(friday),
  };
}

/**
 * Get the next ISO week (handles year boundary).
 * @param {number} year
 * @param {number} weekNum
 * @returns {{year: number, weekNum: number, weekIso: string, startDate: string, endDate: string}}
 */
function getNextWeekBounds(year, weekNum) {
  // Compute next week as Monday + 7 days from current week's Monday
  const current = getWeekBounds(year, weekNum);
  const nextMonday = new Date(current.startDate + 'T00:00:00Z');
  nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
  const next = getIsoWeek(nextMonday);
  const bounds = getWeekBounds(next.year, next.weekNum);
  return { year: next.year, weekNum: next.weekNum, weekIso: next.weekIso, ...bounds };
}

function formatYmd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

module.exports = { getIsoWeek, getWeekBounds, getNextWeekBounds };
