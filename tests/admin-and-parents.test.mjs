import { world, check } from './helpers.mjs';
const SEC = 'sec-k-sampaguita', SEC2 = 'sec-2-narra';
const kinds = (w, id) => w.smsFor(id).map((m) => m.kind).join('+') || '-';
// ---- section move ----
{
  const w = world(); const [a] = w.roster(SEC); const sec = w.state.sections.get(SEC);
  const days = [...w.state.attendance.values()].filter((d) => d.sectionId === SEC).sort((p, q) => q.date.localeCompare(p.date)).slice(0, 4);
  for (const d of days) d.records[a.id] = { date: d.date, studentId: a.id, sectionId: SEC, status: 'absent', source: 'auto' };
  const t1 = w.eng.totalsFor(sec, a.id, w.clock.d);
  await w.scan(a, '07:40'); await w.eng.assignStudents({ [a.id]: SEC2 }, 'move');
  w.clock.t = '08:30'; w.as('u-jose'); await w.eng.confirmDay(SEC2, w.clock.d); w.as('u-admin');
  check('M1 moved mid-day: new class sees the gate scan', w.eng.record(SEC2, w.clock.d, a.id)?.status === 'present' && kinds(w, a.id) === 'arrival');
  check('M1 old class no longer holds today\'s record', !w.eng.record(SEC, w.clock.d, a.id));
  const t2 = w.eng.totalsFor(w.state.sections.get(SEC2), a.id, w.clock.d);
  check('M1 totals follow the child', t2.semester.absent === t1.semester.absent, `${t1.semester.absent} -> ${t2.semester.absent}`);
  const hist = await w.eng.getStudentAttendance(a.id, SEC2); check('M1 history keeps old-class days', Object.keys(hist.days).length >= 15, `${Object.keys(hist.days).length} days`);
  const key = w.log.filter((l) => l[1] === 'parentKeys').pop(); check('M1 parent key points to the new class', key?.[3].children.some((c) => c.id === a.id && c.sectionId === SEC2));
}
// ---- guardian change ----
{
  const w = world(); const [a, b] = w.roster(SEC); const gA = w.eng.guardianOf(a.id), gB = w.eng.guardianOf(b.id);
  await w.eng.saveStudent({ id: a.id, lrn: a.lrn, firstName: a.firstName, middleName: a.middleName, lastName: a.lastName, birthdate: a.birthdate, sex: a.sex, guardianName: gB.name, guardianMobile: gB.mobile, relationship: 'Mother', smsConsent: true, preferredLanguage: 'en' });
  const owners = [...w.state.guardians.values()].filter((g) => g.studentIds.includes(a.id));
  check('G1 one guardian after changing to an existing number', owners.length === 1 && owners[0].id === gB.id);
  const keyOld = w.log.filter((l) => l[1] === 'parentKeys' && l[3].guardianId === gA.id).pop(); check('G1 old number loses the child in the portal', keyOld && !keyOld[3].studentIds.includes(a.id));
}
// ---- housekeeping ----
{
  const w = world(); const [a] = w.roster(SEC); await w.eng.reissueQr(a.id); w.log.length = 0; await w.eng.syncParentPortal();
  check('H1 no junk portal docs for revoked cards', !w.log.some((l) => l[1] === 'parentDays' && l[2].includes('-old-')));
  const w2 = world(); w2.log.length = 0; const ns = await w2.eng.saveSection({ name: 'Grade 1 - Bago', gradeLevel: '1', color: '#eee', schedule: { ...w2.state.sections.get(SEC).schedule }, capacity: 30, teacherId: null }); w2.clock.t = '12:00'; w2.eng.catchUp();
  check('H1 new empty section writes nothing for past days', !w2.log.some((l) => (l[1] === 'confirmations' || l[1] === 'attendance') && l[3].sectionId === ns.id));
  const w3 = world(); w3.log.length = 0; await w3.eng.resetCalendar([...w3.state.calendar.values()]); check('H1 reset calendar updates the portal', w3.log.some((l) => l[1] === 'parentDays'));
  const w4 = world(); await w4.eng.setTeacherActive('t-jose', false); check('H1 class without a teacher raises an alert', [...w4.state.notifications.values()].some((n) => /has no teacher/.test(n.title)));
}
// ---- cancelled class ----
{
  const w = world(); const [x, y] = w.roster(SEC); await w.scan(y, '07:35');
  await w.eng.setTeacherAway(SEC, { from: w.clock.d, kind: 'noclass' });
  check('C1 cancelled after scans: staff get the list of children on campus', [...w.state.notifications.values()].some((n) => n.id === `oncampus_${SEC}_${w.clock.d}` && n.body.includes(y.firstName)));
  const r = await w.scan(x, '07:40');
  check('C1 child arrives on a cancelled-class day: staff alerted', r.kind === 'not_school_day' && w.state.notifications.has(`oncampus_${x.id}_${w.clock.d}`));
}
// ---- excuses ----
{
  const w = world(); const [a] = w.roster(SEC); const D = w.clock.d; w.as('u-maria');
  const mk = (id, stu, dates, sec = SEC) => w.state.excuses.set(id, { id, studentId: stu.id, sectionId: sec, parentUid: 'p', dates, reason: 'Sick', status: 'pending', createdAt: `${D}T06:00:00.000Z` });
  mk('d1', a, [D]); mk('d2', a, [D]); await w.eng.decideExcuse('d1', 'approved');
  check('E1 duplicate request gets the same answer', w.state.excuses.get('d2').status === 'approved');
  const late = [...w.state.attendance.values()].filter((d) => d.sectionId === SEC).flatMap((d) => Object.values(d.records)).find((r) => r.status === 'late');
  const s = w.state.students.get(late.studentId); const sec = w.state.sections.get(SEC); const before = w.eng.totalsFor(sec, s.id, late.date).semester.late;
  mk('d3', s, [late.date]); await w.eng.decideExcuse('d3', 'approved');
  check('E1 excused late no longer counts', w.eng.totalsFor(sec, s.id, late.date).semester.late === before - 1 && w.eng.record(SEC, late.date, s.id).status === 'late');
  mk('d4', a, [D], SEC2); w.as('u-jose'); let err = ''; try { await w.eng.decideExcuse('d4', 'approved'); } catch (e) { err = e.message; }
  check('E1 request sent to the wrong class cannot be approved', /not in that class/.test(err));
}
// ---- subject teachers ----
{
  const w = world(); const D = w.clock.d; const [a, b, c] = w.roster(SEC); const sec = w.state.sections.get(SEC);
  await w.eng.saveSection({ id: SEC, name: sec.name, color: sec.color, capacity: sec.capacity, teacherId: 't-maria', gradeLevel: '5', subjectTeacherIds: ['t-jose', 't-maria'], schedule: sec.schedule });
  check('T1 class teacher is not listed as own subject teacher', JSON.stringify(w.state.sections.get(SEC).subjectTeacherIds) === '["t-jose"]');
  w.as('u-maria'); await w.scan(a, '07:40'); w.clock.t = '08:30'; await w.eng.confirmDay(SEC, D); w.clock.t = '09:00'; w.eng.catchUp();
  w.as('u-jose'); check('T1 subject teacher sees the class', w.eng.session.sectionIds.includes(SEC));
  const roster = await w.eng.getRoster(SEC, D); check('T1 ...and who was absent at first period', roster.some((r) => r.student.id === b.id && r.record.status === 'absent'));
  await w.scan(b, '10:15'); w.clock.t = '10:20'; await w.eng.setStatus({ studentId: b.id, sectionId: SEC, date: D, status: 'late', period: 2 });
  const m = w.smsFor(b.id).find((x) => x.kind === 'late');
  check('T1 subject teacher confirms arrival: text names the period and time', /10:15/.test(m?.body) && /(2nd period|ika-2 na period)/.test(m?.body), m?.body);
  w.as('u-ana'); check('T1 other teachers do not see the class', !w.eng.session.sectionIds.includes(SEC));
}
// ---- class program (Grades 4 to 6) ----
{
  const w = world(); const D = w.clock.d; const [a, b] = w.roster(SEC); const sec = w.state.sections.get(SEC);
  const program = [
    { start: '07:30', end: '08:20', subject: 'Mathematics', teacherId: 't-maria' },
    { start: '08:20', end: '09:10', subject: 'English', teacherId: 't-jose' },
    { start: '09:10', end: '09:30', subject: 'Recess' },
    { start: '09:30', end: '10:20', subject: 'Science', teacherId: 't-ana' },
  ];
  await w.eng.saveSection({ id: SEC, name: sec.name, color: sec.color, capacity: sec.capacity, teacherId: 't-maria', gradeLevel: '5', program, schedule: { ...sec.schedule, startTime: '07:30', endTime: '10:20' } });
  const s1 = w.state.sections.get(SEC);
  check('P1 subject teachers come from the program (not the adviser)', JSON.stringify([...s1.subjectTeacherIds].sort()) === '["t-ana","t-jose"]', JSON.stringify(s1.subjectTeacherIds));
  check('P1 absence time = end of the 1st period', s1.schedule.autoFinalizeMins === 50, s1.schedule.autoFinalizeMins);
  w.as('u-maria'); await w.scan(a, '07:20'); w.clock.t = '07:50'; await w.eng.confirmDay(SEC, D); w.clock.t = '08:25'; w.eng.catchUp();
  check('P1 absence text at the end of the 1st period', w.smsFor(b.id).some((x) => x.kind === 'absent'), kinds(w, b.id));
  w.as('u-jose'); await w.scan(b, '08:40'); w.clock.t = '08:45'; await w.eng.setStatus({ studentId: b.id, sectionId: SEC, date: D, status: 'late', period: 2 });
  const m = w.smsFor(b.id).find((x) => x.kind === 'late');
  const rb = w.eng.record(SEC, D, b.id);
  check('P1 record keeps the joined period and the earlier text', rb.joinedPeriod === 2 && rb.joinedSubject === 'English' && rb.earlierText === 'absent' && /^\d\d:\d\d$/.test(rb.earlierTextAt), JSON.stringify(rb));
  const pd = w.log.filter((l) => l[1] === 'parentDays' && l[3].studentId === b.id).pop()?.[3].days?.[D];
  check('P1 parent portal day shows period, subject and the earlier text', pd?.p === 2 && pd.j === 'English' && pd.e === 'absent' && pd.s === 'late', JSON.stringify(pd));
  await w.eng.setStatus({ studentId: b.id, sectionId: SEC, date: D, status: 'present' });
  check('P1 changing Late to Present keeps the joined period', w.eng.record(SEC, D, b.id).joinedPeriod === 2);
  check('P1 later-period text names the subject', /English/.test(m?.body ?? '') || /English/.test(JSON.stringify(m ?? {})), m?.body);
  w.as('u-admin');
  await w.eng.saveSection({ id: SEC, name: sec.name, color: sec.color, capacity: sec.capacity, teacherId: 't-maria', gradeLevel: '2', program, schedule: s1.schedule });
  const s2 = w.state.sections.get(SEC);
  check('P1 moving the class to Grade 2 keeps the periods but drops the teachers', s2.program.length === 4 && s2.program.every((p) => !p.teacherId) && !s2.subjectTeacherIds.length);
  const k1 = w.state.sections.get('sec-k-rosal');
  check('P1 sample Kindergarten class has a program without teachers', k1.program.length > 3 && k1.program.every((p) => !p.teacherId), JSON.stringify(k1.program[0]));
  const s4 = [...w.state.sections.values()].find((x) => x.id === 'sec-4-rizal');
  check('P1 sample Grade 4 class has a program with recess and lunch', s4?.program?.some((p) => p.subject === 'Recess') && s4.program.some((p) => p.subject === 'Lunch'));
}
