// engine/util.js — small helpers shared by the engine files.
import { toMinutes } from '../logic';
export const dayId = (sectionId, date) => `${sectionId}_${date}`;
// '2026-10-30' -> 'Fri, Oct 30' (used in alert titles).
export const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
// True when two class schedules share a weekday AND their times overlap (a teacher cannot be in two places).
export const schedulesOverlap = (a, b) =>
  a.classDays.some((d) => b.classDays.includes(d)) && toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
let counter = 0;
// Makes a new unique id with a prefix, e.g. uid('stu') -> 'stu-lq2x9k0a1b'.
export const uid = (p) => `${p}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Sorts children by last name, then first name.
export const byName = (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
