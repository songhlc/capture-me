const { getIsoWeek, getWeekBounds, getNextWeekBounds } = require('../lib/iso-week');

describe('iso-week', () => {
  describe('getIsoWeek', () => {
    test('returns correct week for known Monday', () => {
      // 2026-06-08 is Monday, ISO week 24
      const w = getIsoWeek(new Date('2026-06-08T00:00:00'));
      expect(w).toEqual({ year: 2026, weekNum: 24, weekIso: '2026-W24' });
    });

    test('handles year boundary (early January)', () => {
      // 2026-01-01 is Thursday, ISO week 1 of 2026
      const w = getIsoWeek(new Date('2026-01-01T00:00:00'));
      expect(w.weekIso).toBe('2026-W01');
    });

    test('handles late December belonging to next ISO year', () => {
      // 2025-12-29 is Monday, ISO week 1 of 2026
      const w = getIsoWeek(new Date('2025-12-29T00:00:00'));
      expect(w.weekIso).toBe('2026-W01');
    });
  });

  describe('getWeekBounds', () => {
    test('Monday-Friday for 2026-W24', () => {
      const b = getWeekBounds(2026, 24);
      expect(b.startDate).toBe('2026-06-08'); // Monday
      expect(b.endDate).toBe('2026-06-12');   // Friday
    });

    test('year-boundary week: 2025-12-29 (Mon) to 2026-01-02 (Fri)', () => {
      const b = getWeekBounds(2026, 1);
      expect(b.startDate).toBe('2025-12-29');
      expect(b.endDate).toBe('2026-01-02');
    });
  });

  describe('getNextWeekBounds', () => {
    test('2026-W24 → 2026-W25', () => {
      const next = getNextWeekBounds(2026, 24);
      expect(next.weekIso).toBe('2026-W25');
      expect(next.startDate).toBe('2026-06-15');
    });

    test('2026-W52 (Dec 28) → 2026-W53? → 2027-W01', () => {
      // 2026 has 53 ISO weeks
      const next = getNextWeekBounds(2026, 52);
      expect(next.weekIso).toBe('2026-W53');
    });
  });
});
