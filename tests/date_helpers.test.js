import assert from 'node:assert/strict';
import test from 'node:test';
import { getDurationDays, calculateBookingDeadline, formatDate } from '../helpers/date.js';

test('getDurationDays parses week and day ranges', () => {
    assert.equal(getDurationDays('3-5-days'), 4);
    assert.equal(getDurationDays('1-2-weeks'), 11);
    assert.equal(getDurationDays('14d'), 14);
    assert.equal(getDurationDays(null), 7);
});

test('calculateBookingDeadline maps timeframes correctly', () => {
    assert.equal(calculateBookingDeadline('1-month'), '1 week before departure');
    assert.equal(calculateBookingDeadline('1-3-months'), '2-3 weeks before departure');
    assert.equal(calculateBookingDeadline('unknown'), '2 weeks before departure');
});

test('formatDate outputs YYYY-MM-DD', () => {
    const d = new Date('2026-05-15T12:00:00Z');
    assert.equal(formatDate(d), '2026-05-15');
});
