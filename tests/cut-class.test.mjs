// Missed class periods ("cutting class"): a child at school is not in one period's class, then comes back.
import { world, check, R } from './helpers.mjs';

const w = world('2026-11-18', '07:00');
const { eng, state, clock, roster, smsFor, notes, scan } = w;
// A Grades 4-6 class with a full program (subject teachers).
const sec = [...state.sections.values()].find((s) => !s.archived && ['4', '5', '6'].includes(String(s.gradeLevel)) && s.program?.length);
const kid = roster(sec.id)[0];
await scan(kid, sec.schedule.startTime);
clock.t = '09:00';
await eng.confirmDay(sec.id, clock.d);
const st0 = eng.record(sec.id, clock.d, kid.id)?.status;
check('C1 child in class after confirming', st0 === 'present' || st0 === 'late', st0);

clock.t = '13:20';
await eng.markCut({ sectionId: sec.id, date: clock.d, studentId: kid.id, period: 6 });
const rec = eng.record(sec.id, clock.d, kid.id);
check('C2 the day stays present/late', rec.status === st0, rec.status);
const cuts = eng.cutsOn(sec.id, clock.d, kid.id);
check('C3 the missed period is saved', cuts.length === 1 && cuts[0].period === 6 && !!cuts[0].subject, JSON.stringify(cuts[0]));
const t1 = smsFor(kid.id).find((m) => m.kind === 'cut');
check('C4 the parent is texted right away', !!t1 && t1.body.includes('6th period'), t1?.body);
const a1 = notes(kid.id).find((n) => n.id.startsWith('cut_'));
check('C5 staff get an urgent alert', a1?.kind === 'missing' && !a1.resolved, a1?.title);
let threw = false;
try { await eng.markCut({ sectionId: sec.id, date: clock.d, studentId: kid.id, period: 7 }); } catch { threw = true; }
check('C6 a second cut needs "back in class" first', threw);

clock.t = '14:01';
await eng.markBack({ sectionId: sec.id, date: clock.d, studentId: kid.id, period: 7 });
const c2 = eng.cutsOn(sec.id, clock.d, kid.id)[0];
check('C7 back in class is saved', c2.backAt === '14:01' && c2.backPeriod === 7, JSON.stringify(c2));
const t2 = smsFor(kid.id).find((m) => m.kind === 'back');
check('C8 the parent is texted "back in class"', !!t2 && t2.body.includes('7th period'), t2?.body);
check('C9 the alert is resolved', notes(kid.id).find((n) => n.id.startsWith('cut_'))?.resolved === true);

// An absent child cannot be marked as cutting.
const other = roster(sec.id).find((k) => k.id !== kid.id && eng.record(sec.id, clock.d, k.id)?.status === 'absent');
threw = false;
try { if (other) await eng.markCut({ sectionId: sec.id, date: clock.d, studentId: other.id, period: 6 }); else threw = true; } catch { threw = true; }
check('C10 an absent child cannot be marked as cutting', threw);

// Totals: 3 cuts in a month reach the alert limit and text the parent once.
await eng.markCut({ sectionId: sec.id, date: clock.d, studentId: kid.id, period: 8 });
await eng.markBack({ sectionId: sec.id, date: clock.d, studentId: kid.id, period: 8 });
const t = eng.totalsFor(sec, kid.id, clock.d);
check('C11 two cuts this month = watch', t.month.cut === 2 && t.levels.cutMonth === 'watch', `${t.month.cut} ${t.levels.cutMonth}`);
await eng.markCut({ sectionId: sec.id, date: clock.d, studentId: kid.id, period: 3 }).catch(() => {});
const t3 = eng.totalsFor(sec, kid.id, clock.d);
const tot = smsFor(kid.id).filter((m) => m.kind === 'total');
check('C12 three cuts = parent texted about the total', t3.levels.cutMonth === 'alert' && tot.length === 1, `${t3.month.cut} ${tot[0]?.body}`);

check('C13 history includes the cuts', (await eng.getStudentAttendance(kid.id, sec.id)).days[clock.d].cuts.length === 3);

const bad = R.filter((r) => r[0] !== 'ok   ');
console.log(bad.length ? `\n${bad.length} FAILED` : '\nall passed');
process.exit(bad.length ? 1 : 0);
