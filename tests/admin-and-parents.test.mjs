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
// ---- excused for some class periods only ----
{
  const w = world(); const D = w.clock.d; const [a, b] = w.roster(SEC);
  await w.eng.setStatus({ studentId: a.id, sectionId: SEC, date: D, status: 'excused', note: 'Dentist', excusedPeriods: [2, 1] });
  check('X1 excused for periods 1 and 2', JSON.stringify(w.eng.record(SEC, D, a.id).excusedPeriods) === '[1,2]');
  await w.eng.setStatus({ studentId: a.id, sectionId: SEC, date: D, status: 'present' });
  const r = w.eng.record(SEC, D, a.id);
  check('X1 marked present later: keeps the excused periods and note', JSON.stringify(r.excusedPeriods) === '[1,2]' && r.excusedNote === 'Dentist', JSON.stringify(r));
  await w.eng.setStatus({ studentId: b.id, sectionId: SEC, date: D, status: 'excused', excusedPeriods: [] });
  check('X1 whole-day excuse has no periods', !(w.eng.record(SEC, D, b.id).excusedPeriods ?? []).length);
  await w.eng.setStatus({ studentId: a.id, sectionId: SEC, date: D, status: 'absent' });
  check('X1 absent clears the excused periods', !w.eng.record(SEC, D, a.id).excusedPeriods);
}
// ---- parent excuse for certain periods ----
{
  const w = world(); const D = w.clock.d; const [a, b] = w.roster(SEC);
  const mk = (id, stu, periods) => { const ex = { id, studentId: stu.id, sectionId: SEC, parentUid: 'p1', studentName: stu.firstName, dates: [D], reason: 'Doctor or dental appointment', note: '', periods, status: 'pending', createdAt: new Date().toISOString() }; w.state.excuses.set(id, ex); return ex; };
  mk('ex-p1', a, [1, 2]); mk('ex-p2', b, undefined);
  w.as('u-admin');
  await w.eng.decideExcuse('ex-p1', 'approved'); await w.eng.decideExcuse('ex-p2', 'approved');
  w.clock.t = '08:20'; await w.eng.confirmDay(SEC, D);
  const ra = w.eng.record(SEC, D, a.id), rb = w.eng.record(SEC, D, b.id);
  check('E1 period excuse: excused for the 1st and 2nd period, not absent', ra.status === 'excused' && JSON.stringify(ra.excusedPeriods) === '[1,2]', JSON.stringify(ra));
  check('E1 whole-day excuse: excused, no periods', rb.status === 'excused' && !rb.excusedPeriods?.length, JSON.stringify(rb));
  check('E1 no absence text for either', !w.smsFor(a.id).some((m) => m.kind === 'absent') && !w.smsFor(b.id).some((m) => m.kind === 'absent'));
  await w.eng.setStatus({ studentId: a.id, sectionId: SEC, date: D, status: 'late' });
  check('E1 arrives later: Late, excuse kept', JSON.stringify(w.eng.record(SEC, D, a.id).excusedPeriods) === '[1,2]');
}
// ---- scenario: the parent excuses the morning (periods 1-5), the child comes after lunch ----
{
  const R = 'sec-4-rizal';
  const w = world(); const D = w.clock.d; const [kid, other] = w.roster(R);
  const ex = { id: 'ex-am', studentId: kid.id, sectionId: R, parentUid: 'p1', studentName: kid.firstName, dates: [D], reason: 'Doctor or dental appointment', note: 'Check-up in the morning', periods: [1, 2, 3, 4, 5], status: 'pending', createdAt: new Date().toISOString() };
  w.state.excuses.set(ex.id, ex);
  w.as('u-ramon-cruz'); // a subject teacher of the class
  let refused = false; try { await w.eng.decideExcuse('ex-am', 'approved'); } catch { refused = true; }
  check('S1 a subject teacher cannot answer the request', refused && w.state.excuses.get('ex-am').status === 'pending');
  w.as('u-ana'); // the adviser
  await w.eng.decideExcuse('ex-am', 'approved');
  w.as('u-ramon-cruz');
  const before = (await w.eng.getRoster(R, D)).find((r) => r.student.id === kid.id);
  check('S1 before confirming, every teacher sees the approved portal excuse and who approved it', before.excuse?.periods?.join() === '1,2,3,4,5' && before.excuse.by === 'Ana Villanueva' && !before.excuse.pending, JSON.stringify(before.excuse));
  w.as('u-ana'); await w.scan(other, '07:20'); w.clock.t = '07:50'; await w.eng.confirmDay(R, D);
  let r = w.eng.record(R, D, kid.id);
  check('S1 at confirmation: excused for the morning, approved by the adviser', r.status === 'excused' && r.excusedPeriods.join() === '1,2,3,4,5' && r.excuse?.by === 'Ana Villanueva', JSON.stringify(r));
  w.clock.t = '08:20'; w.eng.catchUp();
  check('S1 no absence text', !w.smsFor(kid.id).some((m) => m.kind === 'absent'));
  await w.scan(kid, '12:20');
  r = w.eng.record(R, D, kid.id);
  check('S1 arrives after lunch: waiting for a teacher, excuse kept', r.needsCheck && r.excusedPeriods.join() === '1,2,3,4,5' && r.excuse?.by === 'Ana Villanueva', JSON.stringify(r));
  check('S1 the alert says the child was excused by the parent', w.notes(kid.id).some((n) => /excused for the 1st, 2nd, 3rd, 4th and 5th period/.test(n.title)));
  w.as('u-benjie-torres'); w.clock.t = '12:35';
  await w.eng.setStatus({ studentId: kid.id, sectionId: R, date: D, status: 'present', period: 6 });
  r = w.eng.record(R, D, kid.id);
  check('S1 6th-period teacher confirms: Present, excuse and approver kept, marked by Benjie', r.status === 'present' && r.excusedPeriods.join() === '1,2,3,4,5' && r.excuse?.by === 'Ana Villanueva' && r.markedBy === 'Benjie Torres', JSON.stringify(r));
  const t = w.smsFor(kid.id).find((m) => /6th period/.test(m.body));
  check('S1 parent is texted the arrival (6th period, MAPEH)', /MAPEH/.test(t?.body ?? ''), t?.body);
}
// ---- notices to parents: suspension, lifted suspension, teacher absent, upcoming days ----
{
  const w = world(); const D = w.clock.d; const { addDays } = await import('../src/logic.js');
  const tomorrow = addDays(D, 1);
  const kSec = w.state.sections.get(SEC); const g2 = w.state.sections.get(SEC2);
  const [k1] = w.roster(SEC); const [n1] = w.roster(SEC2);
  const notices = () => [...w.state.sms.values()].filter((m) => m.kind === 'notice');
  const portal = (stu) => w.log.filter((l) => l[1] === 'parentDays' && l[3].studentId === stu.id && l[3].month === D.slice(0, 7)).pop()?.[3];
  const n = await w.eng.declareSuspension(tomorrow, 'Tropical Cyclone Wind Signal No. 1', ['K'], { textParents: true });
  const kText = notices().find((m) => m.studentId === k1.id || w.eng.guardianOf(m.studentId) === w.eng.guardianOf(k1.id));
  check('N1 K-only suspension texts K families only', n > 0 && notices().every((m) => w.state.sections.get(m.sectionId).gradeLevel === 'K'), `${n} texts`);
  check('N1 the text says tomorrow and the reason', /suspended tomorrow, .*Reason: Tropical Cyclone Wind Signal No\. 1\./.test(kText?.body ?? '') || /bukas/.test(kText?.body ?? ''), kText?.body);
  const fams = new Set(notices().map((m) => m.guardianId)); check('N1 one text per family', fams.size === notices().length);
  const pk = portal(k1); const pn = portal(n1);
  check('N1 K portal: notice and upcoming no-class day', pk?.notices?.[0]?.type === 'suspension' && pk.upcoming.some((u) => u.date === tomorrow && u.type === 'suspension'), JSON.stringify(pk?.upcoming));
  check('N1 Grade 2 portal: no notice, no missing day', !(pn?.notices ?? []).length && !(pn?.upcoming ?? []).some((u) => u.date === tomorrow && u.type === 'suspension'));
  const before = notices().length;
  await w.eng.removeCalendarDays([tomorrow], { textParents: true });
  const resume = notices().slice(before);
  check('N2 lifted suspension: K families told classes push through', resume.length === fams.size && resume.every((m) => /push through|Tuloy/.test(m.body)), resume[0]?.body);
  check('N2 portal shows "Classes as usual"', portal(k1)?.notices?.[0]?.type === 'resume');
  const b2 = notices().length;
  await w.eng.setTeacherAway(SEC2, { from: tomorrow, kind: 'noclass', textParents: true });
  const away = notices().slice(b2);
  check('N3 teacher absent: only that class is texted', away.length > 0 && away.every((m) => m.sectionId === SEC2) && /teacher is absent|liban ang guro/.test(away[0].body), away[0]?.body);
  check('N3 that class\'s portal shows the no-class day', portal(n1)?.upcoming?.some((u) => u.date === tomorrow && /teacher is absent/.test(u.label)));
  const b3 = notices().length;
  await w.eng.saveCalendarDays([{ date: addDays(D, 2), type: 'holiday', label: 'Test holiday' }]);
  check('N4 holiday without "text parents": portal only, no texts', notices().length === b3 && portal(k1)?.upcoming?.some((u) => u.label === 'Test holiday'));
  void kSec; void g2;
}
// ---- leaving school, suspension during class hours, announcements ----
{
  const w = world(); const D = w.clock.d; const [a, b, c] = w.roster(SEC);
  for (const k of [a, b, c]) w.eng.guardianOf(k.id).smsConsent = true;
  await w.scan(a, '07:30'); await w.scan(b, '07:35'); await w.scan(c, '07:40');
  w.clock.t = '11:40'; const out = await w.scan(a, '11:40');
  const dep = w.smsFor(a.id).find((m) => m.kind === 'departure');
  check('L1 scanning out texts the parent', out.kind === 'out' && /left school at 11:40 AM|Umalis na/.test(dep?.body ?? ''), dep?.body);
  w.clock.t = '11:50'; await w.scan(a, '11:50');
  check('L1 only one "left school" text a day', w.smsFor(a.id).filter((m) => m.kind === 'departure').length === 1);
  // Suspension declared at 10:00 with b and c still at school.
  w.clock.t = '10:00';
  await w.eng.declareSuspension(D, 'Heavy rain', [], { textParents: true });
  const alert = w.state.notifications.get(`oncampus_${SEC}_${D}`);
  check('L2 staff get the list of children still at school', alert && alert.body.includes(b.firstName) && alert.body.includes(c.firstName) && !alert.body.includes(a.firstName), alert?.title);
  const sus = w.smsFor(b.id).find((m) => m.kind === 'notice');
  check('L2 the parent of a child at school is told to fetch them', /is at school now|Nasa paaralan na/.test(sus?.body ?? ''), sus?.body);
  const still = await w.eng.listStillAtSchool(SEC);
  check('L2 "Still at school" lists b and c', still.map((x) => x.student.id).sort().join() === [b.id, c.id].sort().join());
  w.clock.t = '10:20'; const o2 = await w.scan(b, '10:20');
  check('L3 on the suspended day, scanning out still works and texts', o2.kind === 'out' && w.smsFor(b.id).some((m) => m.kind === 'departure'));
  w.as('u-maria'); await w.eng.markPickedUp(SEC, c.id); w.as('u-admin');
  const pu = w.smsFor(c.id).find((m) => m.kind === 'departure');
  check('L3 "Picked up" texts the parent and names the school', /picked up|Sinundo/.test(pu?.body ?? '') && w.eng.record(SEC, D, c.id).pickedUpBy, pu?.body);
  check('L3 nobody left on the list', !(await w.eng.listStillAtSchool(SEC)).length);
  const n = await w.eng.sendAnnouncement({ message: 'Please fetch your children by 11:00 AM.', sectionId: SEC2, days: 3 });
  const ann = [...w.state.sms.values()].filter((m) => m.kind === 'notice' && m.body.includes('11:00 AM'));
  check('L4 class announcement texts that class only, one per family', n > 0 && ann.length === n && ann.every((m) => m.sectionId === SEC2));
  const pdoc = w.log.filter((l) => l[1] === 'parentDays' && l[3].sectionId === SEC2).pop()?.[3];
  check("L4 it shows in that class's parent portal", pdoc?.notices?.[0]?.type === 'announcement');
  let err = ''; try { await w.eng.sendAnnouncement({ message: ' ' }); } catch (e) { err = e.message; }
  check('L4 empty message refused', /Write the message/.test(err));
}
// ---- suspension from a time (classes before it go on) ----
{
  const w = world(); const D = w.clock.d; const [a, b] = w.roster(SEC);
  for (const k of [a, b]) w.eng.guardianOf(k.id).smsConsent = true;
  await w.scan(a, '07:30');
  w.clock.t = '10:00';
  await w.eng.declareSuspension(D, 'Heavy rain', [], { textParents: true, from: '09:00' });
  const { isSchoolDay, suspendedFrom, addDays: addDays2 } = await import('../src/logic.js');
  const sec = w.state.sections.get(SEC);
  check('PS the day is still a class day', isSchoolDay(D, sec.schedule, w.state.calendar) && suspendedFrom(D, sec.schedule, w.state.calendar) === '09:00');
  const t = w.smsFor(a.id).find((m) => m.kind === 'notice');
  check('PS text: suspended from 9:00 AM, fetch at 9:00 AM', /suspended from 9:00 AM today.*Please fetch .* at 9:00 AM|mula 9:00 AM/.test(t?.body ?? ''), t?.body);
  const al = w.state.notifications.get(`oncampus_${SEC}_${D}`);
  check('PS staff told who is at school and when they leave', /suspended from 9:00 AM today/.test(al?.title ?? '') && al.body.includes(a.firstName), al?.title);
  const k1 = w.roster(SEC)[0];
  const pd = w.log.filter((l) => l[1] === 'parentDays' && l[3].studentId === k1.id).pop()?.[3];
  check('PS parent portal notice is the part-day suspension', pd?.notices?.[0]?.type === 'partial');
  const before = [...w.state.sms.values()].length;
  await w.eng.declareSuspension(addDays2(D, 1), 'Heavy rain', [], { textParents: true, from: '13:00' });
  const kTexts = [...w.state.sms.values()].slice(before).filter((m) => w.state.sections.get(m.sectionId).schedule.endTime <= '13:00');
  check('PS a class that ends before the time is not texted', !kTexts.length);
}
// ---- suspension for several days, half day with an end time, the preview before sending ----
{
  const w = world(); const D = w.clock.d; const { addDays: ad } = await import('../src/logic.js');
  const fri = (() => { let d = D; while (new Date(d + 'T00:00:00Z').getUTCDay() !== 5) d = ad(d, 1); return d; })();
  const tue = ad(fri, 4); // Friday to the next Tuesday: Saturday and Sunday are skipped
  await w.eng.declareSuspension(fri, 'Typhoon', [], { to: tue });
  const set = [...w.state.calendar.values()].filter((e) => e.type === 'suspension' && e.label === 'Typhoon').map((e) => e.date);
  check('R1 suspension from ... to: weekdays only', set.length === 3 && set[0] === fri && set.at(-1) === tue, set.join());
  const pv = await w.eng.previewNotice({ type: 'suspension', dates: [fri, tue], body: 'Typhoon' });
  check('R1 preview: families and the same text the engine sends', pv.families > 0 && new RegExp(`suspended from .* to .*Reason: Typhoon`).test(pv.text), pv.text);
  const hd = ad(D, 2);
  for (const k of w.roster(SEC)) w.eng.guardianOf(k.id).smsConsent = true;
  await w.eng.saveCalendarDays([{ date: hd, type: 'halfday', label: 'Teachers in-service', until: '11:30' }], { textParents: true });
  const t = [...w.state.sms.values()].find((m) => m.kind === 'notice' && /half day/.test(m.body));
  check('R2 half day text says when classes end', /classes end at 11:30 AM|matatapos ang klase ng 11:30 AM/.test(t?.body ?? ''), t?.body);
  const pd = w.log.filter((l) => l[1] === 'parentDays' && l[3].studentId === w.roster(SEC)[0].id).pop()?.[3];
  check('R2 parent portal "Coming up" shows the end time', pd?.upcoming?.some((u) => u.type === 'halfday' && /11:30 AM/.test(u.label)), JSON.stringify(pd?.upcoming));
}
// ---- seating chart ----
{
  const w = world(); const kids = w.roster(SEC);
  const seats = { '1-1': kids[0].id, '1-2': kids[1].id, '9-9': kids[2].id, '2-1': kids[0].id, '2-2': 'not-a-child' };
  const doc = await w.eng.saveSeating(SEC, { rows: 5, cols: 6, aisleEvery: 2, spacing: 'wide', seats });
  check('SC1 seats kept only inside the room, one seat per child, children of the class', Object.keys(doc.seats).join() === '1-1,1-2' && doc.rows === 5 && doc.spacing === 'wide', JSON.stringify(doc.seats));
  check('SC1 saved to Firestore', w.log.some((l) => l[1] === 'seating' && l[2] === SEC));
  check('SC1 read back', (await w.eng.getSeating(SEC)).seats['1-2'] === kids[1].id);
  const odd = await w.eng.saveSeating(SEC, { rows: 99, cols: 0, aisleEvery: 7, spacing: 'huge', seats: {} });
  check('SC2 sizes kept within 1-12, unknown spacing -> normal', odd.rows === 12 && odd.cols === 1 && odd.aisleEvery === 1 && odd.spacing === 'normal');
}
// ---- undo a mark by pressing the selected status again ----
{
  const w = world(); const D = w.clock.d; const [a, b] = w.roster(SEC);
  await w.eng.setStatus({ sectionId: SEC, date: D, studentId: a.id, status: 'present' });
  const r1 = await w.eng.clearStatus({ sectionId: SEC, date: D, studentId: a.id });
  check('U1 Present by mistake (no scan): undone, back to not yet scanned', r1.kind === 'cleared' && !w.eng.record(SEC, D, a.id));
  await w.scan(b, '07:20');
  await w.eng.setStatus({ sectionId: SEC, date: D, studentId: b.id, status: 'absent' });
  const r2 = await w.eng.clearStatus({ sectionId: SEC, date: D, studentId: b.id });
  check('U2 scanned child: back to the gate scan', r2.kind === 'scan' && w.eng.record(SEC, D, b.id).status === 'present' && w.eng.record(SEC, D, b.id).scannedAt === '07:20');
  await w.eng.confirmDay(SEC, D);
  let err = ''; try { await w.eng.clearStatus({ sectionId: SEC, date: D, studentId: b.id }); } catch (e) { err = e.message; }
  check('U3 after confirming, undo is refused (texts already sent)', /already confirmed/.test(err));
}
{
  const w = world(); const D = w.clock.d; const [, b] = w.roster(SEC);
  await w.scan(b, '07:20');
  await w.eng.setStatus({ sectionId: SEC, date: D, studentId: b.id, status: 'absent' });
  const open = () => [...w.state.notifications.values()].filter((n) => n.studentId === b.id && n.kind === 'missing' && !n.resolved && !n.read);
  const before = open().length;
  await w.eng.clearStatus({ sectionId: SEC, date: D, studentId: b.id });
  check('U4 undoing Absent closes the "not in class" alert', before > 0 ? open().length < before : true, `${before} -> ${open().length}`);
}
