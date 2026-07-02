import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayOfWeek,
  firstDayOfNextMonth,
  lastDayOfMonth,
  todayLima,
} from './lima-date.util';

describe('lima-date.util', () => {
  describe('todayLima', () => {
    it('returns the Lima calendar day for a mid-day UTC instant', () => {
      expect(todayLima(new Date('2026-07-01T18:00:00Z'))).toBe('2026-07-01');
    });

    it('returns the PREVIOUS Lima day for an instant just after UTC midnight', () => {
      // 2026-07-01 02:00 UTC = 2026-06-30 21:00 Lima.
      expect(todayLima(new Date('2026-07-01T02:00:00Z'))).toBe('2026-06-30');
    });
  });

  describe('dayOfWeek', () => {
    it('2026-07-02 is a Thursday (4)', () => {
      expect(dayOfWeek('2026-07-02')).toBe(4);
    });

    it('2026-07-04 is a Saturday (6)', () => {
      expect(dayOfWeek('2026-07-04')).toBe(6);
    });
  });

  describe('addDays', () => {
    it('adds positive days across a month boundary', () => {
      expect(addDays('2026-07-31', 1)).toBe('2026-08-01');
    });

    it('supports negative offsets', () => {
      expect(addDays('2026-07-01', -1)).toBe('2026-06-30');
    });
  });

  describe('lastDayOfMonth', () => {
    it('resolves July (31 days)', () => {
      expect(lastDayOfMonth('2026-07-02')).toBe('2026-07-31');
    });

    it('resolves February in a non-leap year (28 days)', () => {
      expect(lastDayOfMonth('2026-02-10')).toBe('2026-02-28');
    });
  });

  describe('firstDayOfNextMonth', () => {
    it('rolls within the same year', () => {
      expect(firstDayOfNextMonth('2026-07-15')).toBe('2026-08-01');
    });

    it('rolls the year over in December', () => {
      expect(firstDayOfNextMonth('2026-12-15')).toBe('2027-01-01');
    });
  });
});
