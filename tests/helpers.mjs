import { Engine, buildDemoState, users } from '../src/engine.js';
export function world(start = '2026-11-16', time = '07:00') {
  const clock = { d: start, t: time, today() { return this.d; }, peek() { return this.t; }, scanTime() { return this.t; }, simulated() { return false; } };
  const state = buildDemoState(start, clock);
  // wipe "today" so each scenario starts clean
  for (const [k, v] of [...state.attendance]) if (v.date >= start) state.attendance.delete(k);
  for (const [k, v] of [...state.confirmations]) if (v.date >= start) state.confirmations.delete(k);
  const log = [];
  const auth = { createTeacherAccount: async () => ({ uid: 'u-' + Math.random().toString(36).slice(2, 8), tempPassword: 'x' }), signIn: async () => {}, signOut: async () => {}, demoAccounts: () => [] };
  const eng = new Engine('cloud', state, { put: (c, i, d) => log.push(['put', c, i, structuredClone(d)]), remove: (c, i) => log.push(['rm', c, i]) }, auth, clock);
  const as = (uid) => eng.setSession(users.find((u) => u.uid === uid));
  as('u-admin');
  const roster = (sec) => eng.rosterOn(sec, clock.d).filter((k) => { const g = eng.guardianOf(k.id); return g && g.smsConsent && g.numberStatus !== 'failed' && g.studentIds.length === 1; });
  const sms = (pred = () => true) => [...state.sms.values()].filter(pred);
  const smsFor = (sid, date = clock.d) => sms((m) => m.studentId === sid && (m.createdAt.startsWith(date) || m.id.endsWith(date)));
  const notes = (sid, date = clock.d) => [...state.notifications.values()].filter((n) => n.studentId === sid && n.createdAt.startsWith(date));
  const scan = async (stu, t) => { if (t) clock.t = t; eng.lastScanAt.clear(); return eng.recordScan({ qrToken: stu.qrToken }); };
  const nextDay = (t = '07:00') => { let d = clock.d; do { d = new Date(new Date(d + 'T00:00:00Z').getTime() + 864e5).toISOString().slice(0, 10); } while ([6, 0].includes(new Date(d + 'T00:00:00Z').getUTCDay())); clock.d = d; clock.t = t; return d; };
  return { eng, state, clock, log, as, roster, sms, smsFor, notes, scan, nextDay };
}
let n = 0;
export const R = [];
export function check(name, ok, detail = '') { R.push([ok ? 'ok   ' : 'FAULT', name, detail]); console.log(`${ok ? 'ok   ' : 'FAULT'} ${name}${detail ? '  -> ' + detail : ''}`); }
