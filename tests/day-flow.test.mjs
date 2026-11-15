import { world, check } from './helpers.mjs';
const SEC = 'sec-k-sampaguita';
const kinds = (w, id) => w.smsFor(id).map((m) => m.kind).join('+') || '-';
// ===== The new flow, one full day =====
{
  const w = world(); const D = w.clock.d; const [a, b, c, d, e, f, g] = w.roster(SEC); w.as('u-maria');
  await w.scan(a, '07:40'); await w.scan(b, '08:20'); await w.scan(c, '07:50');
  w.clock.t = '08:00'; w.eng.catchUp();
  check('N1 no auto-confirm in the morning', !w.state.confirmations.has(`${SEC}_${D}`));
  w.clock.t = '08:50'; w.eng.catchUp(); check('N1 still not confirmed at 08:50 (old auto time)', !w.state.confirmations.has(`${SEC}_${D}`));
  // c scanned but not in the room: teacher marks absent before confirming
  w.clock.t = '08:25'; await w.eng.setStatus({ studentId: c.id, sectionId: SEC, date: D, status: 'absent', reason: 'not in room' });
  check('N1 scanned+absent: staff alert at once', w.notes(c.id).some((n) => n.kind === 'missing'));
  check('N1 scanned+absent: parent not texted before confirmation', kinds(w, c.id) === '-');
  await w.eng.setStatus({ studentId: d.id, sectionId: SEC, date: D, status: 'present', reason: 'forgot ID' });
  w.clock.t = '08:30'; await w.eng.confirmDay(SEC, D);
  check('N1 confirm: present -> in class text', kinds(w, a.id) === 'arrival');
  check('N1 confirm: late -> late text', kinds(w, b.id) === 'late');
  check('N1 confirm: scanned but absent -> "not in class" text', kinds(w, c.id) === 'missing', w.smsFor(c.id)[0]?.body);
  check('N1 confirm: unscanned absent -> no text yet', kinds(w, e.id) === '-' && w.eng.record(SEC, D, e.id).status === 'absent');
  // f arrives 08:45 (after confirmation, before absence time)
  const rf = await w.scan(f, '08:45');
  check('N1 late arrival after confirm waits for teacher', rf.needsCheck === true && kinds(w, f.id) === '-', `${rf.status}`);
  check('N1 late arrival: staff alert', w.notes(f.id).some((n) => n.id.startsWith('late_')));
  check('N1 late arrival not shown to parent yet', w.eng.parentMonthDoc(f.id, D.slice(0, 7)).days[D] === undefined);
  // 09:00 absence step
  w.clock.t = '09:00'; w.eng.catchUp();
  check('N1 09:00: absent child gets absence text', kinds(w, e.id) === 'absent', w.smsFor(e.id)[0]?.body);
  check('N1 09:00: child waiting at gate gets NO absence text', kinds(w, f.id) === '-');
  check('N1 09:00: missing child not also sent absence text', kinds(w, c.id) === 'missing');
  const n0 = w.state.sms.size; w.clock.t = '09:05'; w.eng.catchUp(); w.clock.t = '09:10'; w.eng.catchUp();
  check('N1 absence step runs once', w.state.sms.size === n0);
  // teacher confirms f late
  w.clock.t = '09:12'; await w.eng.setStatus({ studentId: f.id, sectionId: SEC, date: D, status: 'late' });
  check('N1 teacher confirms late arrival -> text with gate time', kinds(w, f.id) === 'late' && /8:45/.test(w.smsFor(f.id)[0].body), w.smsFor(f.id)[0]?.body);
  check('N1 late-arrival alert resolved', w.notes(f.id).find((n) => n.id.startsWith('late_')).resolved === true);
  // e (texted absent at 9:00) arrives at 10:15
  const re = await w.scan(e, '10:15'); w.clock.t = '10:20'; await w.eng.setStatus({ studentId: e.id, sectionId: SEC, date: D, status: 'late' });
  check('N1 absent-texted child arrives later -> new text with time', kinds(w, e.id) === 'absent+late' && /10:15/.test(w.smsFor(e.id).find((m) => m.kind === 'late').body), w.smsFor(e.id).map((m) => m.body).join(' | '));
  // c found
  w.clock.t = '10:30'; await w.eng.setStatus({ studentId: c.id, sectionId: SEC, date: D, status: 'present', reason: 'found' });
  check('N1 missing child found: alert resolved + parent told in class', w.notes(c.id).find((n) => n.id.startsWith('miss_')).resolved && kinds(w, c.id) === 'missing+arrival');
  // a: told "in class", later not in room
  w.clock.t = '10:40'; await w.eng.setStatus({ studentId: a.id, sectionId: SEC, date: D, status: 'absent', reason: 'gone' });
  check('N1 withdrawn "in class": parent gets "not in class" text', kinds(w, a.id).replace(/\+(total|streak)/g, '') === 'arrival+missing');
  await w.eng.setStatus({ studentId: a.id, sectionId: SEC, date: D, status: 'present', reason: 'found' });
  check('N1 ...and a new "in class" text when found again', kinds(w, a.id).replace(/\+(total|streak)/g, '') === 'arrival+missing+arrival');
  // d manual present scans card later
  await w.scan(d, '11:00'); check('N1 manual-present child scanning later stays present, no text', w.eng.record(SEC, D, d.id).status === 'present' && kinds(w, d.id) === 'arrival');
  // g: marked absent AFTER absence step (teacher mis-tap present at confirm) -> immediate absent text
}
// ===== Teacher confirms late (after 9:00): absence texts go at once =====
{
  const w = world(); const D = w.clock.d; const [a, b] = w.roster(SEC); w.as('u-maria'); await w.scan(a, '07:40');
  w.clock.t = '09:20'; await w.eng.confirmDay(SEC, D);
  check('N2 confirm after absence time: absent text right away', kinds(w, b.id) === 'absent' && /9:20/.test(w.smsFor(b.id)[0].body), w.smsFor(b.id)[0]?.body);
}
// ===== Nobody confirms =====
{
  const w = world(); const D = w.clock.d; const [a, b] = w.roster(SEC); w.as('u-admin'); await w.scan(a, '07:40');
  w.clock.t = '11:00'; w.eng.catchUp(); check('N3 unconfirmed class stays open during class', !w.state.confirmations.has(`${SEC}_${D}`));
  w.clock.t = '11:35'; w.eng.catchUp(); const conf = w.state.confirmations.get(`${SEC}_${D}`);
  check('N3 closed quietly after class ends', conf?.auto === true);
  check('N3 quiet close: no parent texts at all', w.sms((m) => m.createdAt.startsWith(D) && m.sectionId === SEC).length === 0);
  check('N3 quiet close: staff alerted', [...w.state.notifications.values()].some((n) => n.id === `unc_${SEC}_${D}`));
  check('N3 quiet close: records complete', w.eng.record(SEC, D, a.id).status === 'present' && w.eng.record(SEC, D, b.id).status === 'absent');
  // gate offline + nobody confirmed = no data, nobody absent
  const w2 = world(); w2.clock.t = '11:35'; w2.eng.catchUp(); const c2 = w2.state.confirmations.get(`${SEC}_${w2.clock.d}`);
  check('N3b no scans and no marks: nobody marked absent', c2?.noData === true && !w2.state.attendance.get(`${SEC}_${w2.clock.d}`));
}
// ===== streak text timing =====
{
  const w = world(); const D = w.clock.d; const kids = w.roster(SEC); w.as('u-maria'); const k = kids[3];
  const prev = [...w.state.attendance.values()].filter((d) => d.sectionId === SEC && d.date < D).sort((p, q) => q.date.localeCompare(p.date)).slice(0, 2);
  for (const d of prev) d.records[k.id] = { date: d.date, studentId: k.id, sectionId: SEC, status: 'absent', source: 'auto' };
  w.clock.t = '08:30'; await w.eng.confirmDay(SEC, D);
  check('N4 no streak text at confirmation', !w.smsFor(k.id).some((m) => m.kind === 'streak'));
  await w.scan(k, '08:55'); w.clock.t = '08:57'; await w.eng.setStatus({ studentId: k.id, sectionId: SEC, date: D, status: 'late' });
  w.clock.t = '09:00'; w.eng.catchUp();
  check('N4 child arrived before 9:00: no false streak text or alert', !w.smsFor(k.id).some((m) => m.kind === 'streak') && !w.notes(k.id).some((n) => n.kind === 'streak'));
  const k2 = kids[4]; for (const d of prev) d.records[k2.id] = { date: d.date, studentId: k2.id, sectionId: SEC, status: 'absent', source: 'auto' };
  const w3 = world(); // fresh: real 3rd absence
  const kk = w3.roster(SEC)[3]; const pv = [...w3.state.attendance.values()].filter((d) => d.sectionId === SEC && d.date < D).sort((p, q) => q.date.localeCompare(p.date)).slice(0, 2);
  for (const d of pv) d.records[kk.id] = { date: d.date, studentId: kk.id, sectionId: SEC, status: 'absent', source: 'auto' };
  w3.as('u-maria'); w3.clock.t = '08:30'; await w3.eng.confirmDay(SEC, D); w3.clock.t = '09:00'; w3.eng.catchUp();
  check('N4 real 3rd absence: one text (the 3-day one) at 9:00', kinds(w3, kk.id) === 'streak', kinds(w3, kk.id));
}
// ===== old-day edits and past confirmation never text =====
{
  const w = world(); w.as('u-maria'); const D = w.clock.d;
  const past = [...w.state.attendance.values()].filter((d) => d.sectionId === SEC && d.date < D).sort((p, q) => q.date.localeCompare(p.date))[3];
  const kid = w.roster(SEC)[0]; past.records[kid.id] = { date: past.date, studentId: kid.id, sectionId: SEC, status: 'absent', source: 'auto' };
  w.state.sms.delete(`arr_${kid.id}_${past.date}`); const n0 = w.state.sms.size; w.clock.t = '21:05';
  await w.eng.setStatus({ studentId: kid.id, sectionId: SEC, date: past.date, status: 'present', reason: 'fix' });
  await w.eng.setStatus({ studentId: kid.id, sectionId: SEC, date: past.date, status: 'absent', reason: 'fix back' });
  check('N5 editing an old day never texts parents', w.state.sms.size === n0);
  // removed past holiday
  const w2 = world(); const hol = ['2026-11-02']; const s0 = w2.state.sms.size;
  await w2.eng.removeCalendarDays(hol); w2.eng.catchUp();
  const day = w2.state.attendance.get(`${SEC}_2026-11-02`);
  check('N5 removed past holiday: nobody marked absent, no texts', !day && w2.state.sms.size === s0);
}
// ===== School-wide times and level-limited suspensions =====
{
  const w = world(); const D = w.clock.d; w.as('u-admin');
  await w.eng.updateSettings({ gateOpens: '06:30', firstPeriodMins: 45 });
  const sec = w.state.sections.get(SEC);
  check('L1 absence time = start + school first period length', sec.schedule.autoFinalizeMins === 45);
  check('L1 gate opening applies to every class', sec.schedule.scanWindowMins === 90);
  await w.eng.declareSuspension(D, 'Signal No. 1', ['K']);
  const kSec = w.state.sections.get('sec-k-rosal'), g2 = w.state.sections.get('sec-2-narra');
  const t = await w.eng.getToday();
  const { isSchoolDay } = await import('../src/logic.js');
  check('L2 Kindergarten-only suspension: no class for Kindergarten', !isSchoolDay(D, kSec.schedule, w.state.calendar));
  check('L2 ...but Grade 2 has class', isSchoolDay(D, g2.schedule, w.state.calendar));
  const kid = w.eng.rosterOn('sec-2-narra', D)[0]; const r = await w.scan(kid, '07:40');
  check('L2 Grade 2 pupil scans normally', r.kind === 'recorded');
  const kk = w.eng.rosterOn('sec-k-rosal', D)[0]; const r2 = await w.scan(kk, '07:41');
  check('L2 Kindergarten pupil: no class today', r2.kind === 'not_school_day');
  check('L2 the alert says Kindergarten only', [...w.state.notifications.values()].some((n) => /Kindergarten only/.test(n.title)));
}
// ===== Gate scan-out and the times the parent sees =====
{
  const w = world(); const D = w.clock.d; const [a, b, c] = w.roster(SEC); w.as('u-maria');
  await w.scan(a, '07:42'); await w.scan(c, '07:50');
  w.clock.t = '08:10'; await w.eng.confirmDay(SEC, D);
  const r1 = await w.scan(a, '07:55'); // a second beep 13 minutes later: still "already in"
  check('O1 second scan soon after = already in', r1.kind === 'duplicate');
  const r2 = await w.scan(a, '11:40');
  check('O1 scan after class = scanned out', r2.kind === 'out' && w.eng.record(SEC, D, a.id).scannedOut === '11:40');
  check('O1 scan-out sends no text and no alert', kinds(w, a.id) === 'arrival' && !w.notes(a.id).length);
  const day = w.eng.parentMonthDoc(a.id, D.slice(0, 7)).days[D];
  check('O1 parent portal: in, confirmed, out times', day.t === '07:42' && day.c === '08:10' && day.o === '11:40', JSON.stringify(day));
  const dc = w.eng.parentMonthDoc(c.id, D.slice(0, 7)).days[D];
  check('O1 child who did not scan out: no out time (portal says "did not scan out")', dc.o === null && dc.c === '08:10');
  // manual present (forgot ID) scanning at dismissal = out, not in
  await w.eng.setStatus({ studentId: b.id, sectionId: SEC, date: D, status: 'present', reason: 'forgot ID' });
  const r3 = await w.scan(b, '11:20');
  check('O1 teacher-marked child scanning near dismissal = out', r3.kind === 'out' && w.eng.record(SEC, D, b.id).status === 'present');
}
