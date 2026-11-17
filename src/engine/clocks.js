// engine/clocks.js — clocks, the empty starting state, and the no-op persistence.
import { manilaToday, manilaTime, toMinutes, fromMinutes } from '../logic';
// =====================================================================
// CLOCKS: where the engine gets "today" and "now" from.
// realClock = the real Philippine date and time (cloud mode).
// =====================================================================
export const realClock = {
  today: () => manilaToday(),
  scanTime: () => manilaTime(),
  peek: () => manilaTime(),
  simulated: () => false,
};
/** Outside 6:30-9:30 AM the demo simulates a school morning, so scans are not all "late". */
// Demo clock: outside 6:30-9:30 AM it pretends it is a school morning (starting 8:06)
// and moves forward 1-3 minutes per scan, so demo scans are not all "late".
export class DemoClock {
  sim = toMinutes('08:06');
  inHours() {
    const m = toMinutes(manilaTime());
    return m >= toMinutes('06:30') && m <= toMinutes('09:30');
  }
  today() {
    return manilaToday();
  }
  scanTime() {
    if (this.inHours()) return manilaTime();
    this.sim += 1 + Math.floor(Math.random() * 3);
    return fromMinutes(this.sim);
  }
  peek() {
    return this.inHours() ? manilaTime() : fromMinutes(this.sim);
  }
  simulated() {
    return !this.inHours();
  }
}
// Demo mode saves nothing: put() and remove() do nothing, so data resets when the tab closes.
export const noopPersistence = { put() {}, remove() {} };
// The whole school in memory. Each collection is a Map (id -> document), the same
// names as the Firestore collections. `meta` holds { settings, schoolYear }.
export function emptyState(meta, calendar = []) {
  return {
    meta,
    calendar: new Map(calendar.map((c) => [c.date, c])),
    calendarNotices: [], // latest calendar changes, newest first, shown to parents (meta/calendar.notices)
    users: new Map(),
    sections: new Map(),
    teachers: new Map(),
    students: new Map(),
    guardians: new Map(),
    enrollments: new Map(),
    attendance: new Map(),
    confirmations: new Map(),
    sms: new Map(),
    notifications: new Map(),
    audit: new Map(),
    excuses: new Map(), // excuse requests from the parent portal
    announcements: new Map(), // announcements to parents (admin: school / levels / a class; teacher: their classes)
    seating: new Map(), // seating charts: section id -> { rows, cols, aisleEvery, spacing, seats: { 'row-col': studentId } }
  };
}
