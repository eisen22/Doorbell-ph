// =====================================================================
// test.mjs — tries the Worker WITHOUT Cloudflare, Firebase or Semaphore.
// A fake Firestore (in memory, filled with the sample school) and a fake Semaphore answer
// the Worker's web requests. Run:  npm test   (inside the worker folder)
// =====================================================================
import { run, toSemaphoreNumber, sendMessageEmails } from './src/index.js';
import { handleScanner, sha256Hex } from './src/scanner.js';
import { fromFields, toFields } from './src/firestore.js';
import { Engine, buildDemoState, users } from '../src/engine.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

// ---- the fake database: path -> { data, updateTime } ----
const db = new Map();
let tick = 0;
const put = (path, data) => db.set(path, { data: JSON.parse(JSON.stringify(data)), updateTime: `t${++tick}` });
// A fixed school day (a Monday), so the test gives the same result on any day it is run.
const today = '2026-11-16';
const clock = { t: '08:30', today: () => today, peek() { return this.t; }, scanTime() { return this.t; }, simulated: () => false };
const state = buildDemoState(today, clock);
// Give the two classes used here 8:00 to 11:30 hours (the times below assume them).
for (const id of ['sec-k-sampaguita', 'sec-2-narra']) Object.assign(state.sections.get(id).schedule, { startTime: '08:00', endTime: '11:30' });
// Apple: the teacher confirms at 8:30 AM (children scanned so far are in class, the rest absent).
// Mango: nobody confirms all day.
const teacherEngine = new Engine('cloud', state, { put() {}, remove() {} }, {}, clock);
teacherEngine.setSession(users.find((u) => u.uid === 'u-maria'));
for (const [k, v] of [...state.sms]) if (v.createdAt.startsWith(today)) state.sms.delete(k);
await teacherEngine.confirmDay('sec-k-sampaguita', today);
const appleAbsent = teacherEngine.rosterOn('sec-k-sampaguita', today).filter((k) => state.attendance.get(`sec-k-sampaguita_${today}`).records[k.id].status === 'absent');
const textable = appleAbsent.filter((k) => teacherEngine.guardianOf(k.id)?.smsConsent);
put('meta/school', { ...state.meta, settings: { ...state.meta.settings, smsProvider: 'semaphore', senderName: 'SUNNYSIDE' } });
put('meta/calendar', { days: [...state.calendar.values()] });
for (const col of ['sections', 'students', 'guardians', 'enrollments', 'attendance', 'confirmations', 'sms', 'notifications', 'teachers'])
  for (const [id, v] of state[col]) put(`${col}/${id}`, { ...v, ...(col === 'sms' && v.createdAt.startsWith(today) ? { status: 'sent' } : {}) });
put('sms/test1', { id: 'test1', to: '+639171234567', body: 'Doorbell test message', kind: 'test', status: 'queued', createdAt: new Date().toISOString(), attempts: 1 });
const someKid = appleAbsent[0] ?? [...state.students.values()][0];
const itsGuardian = teacherEngine.guardianOf(someKid.id);
// A text for a child, but to a number that is NOT the guardian's (someone misusing a staff sign-in).
put('sms/bad1', { id: 'bad1', studentId: someKid.id, guardianId: itsGuardian.id, to: '+639998887777', body: 'Click this link', kind: 'arrival', status: 'queued', createdAt: '2026-11-16T07:00:00+08:00', attempts: 1 });

const root = 'projects/demo/databases/(default)/documents';
const doc = (path) => ({ name: `${root}/${path}`, fields: toFields(db.get(path).data), updateTime: db.get(path).updateTime });
const cmp = { EQUAL: (a, b) => a === b, IN: (a, b) => b.includes(a), ARRAY_CONTAINS: (a, b) => Array.isArray(a) && a.includes(b), GREATER_THAN_OR_EQUAL: (a, b) => a >= b, LESS_THAN_OR_EQUAL: (a, b) => a <= b };
// A Firestore field path ('records.`stu-1`.scannedAt') -> ['records', 'stu-1', 'scannedAt'].
const splitPath = (fp) => (fp.match(/`(?:[^`\\]|\\.)*`|[^.]+/g) ?? []).map((x) => (x.startsWith('`') ? x.slice(1, -1).replace(/\\(.)/g, '$1') : x));
let semaphoreCalls = [];
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

const brevoCalls = [];
async function fakeFetch(url, init = {}) {
  url = String(url);
  if (url.includes('accounts:signInWithPassword')) return json({ idToken: 'tok', expiresIn: '3600' });
  if (url.startsWith('https://api.brevo.com')) {
    brevoCalls.push(JSON.parse(init.body));
    return json({ messageId: 'm1' });
  }
  if (url.startsWith('https://api.semaphore.co')) {
    const form = new URLSearchParams(init.body.toString());
    semaphoreCalls.push(Object.fromEntries(form));
    return json([{ message_id: 777, status: 'Pending', network: 'Globe' }]);
  }
  const path = url.split('/documents')[1];
  if (path === ':runQuery') {
    const q = JSON.parse(init.body).structuredQuery;
    const col = q.from[0].collectionId;
    const filters = q.where ? (q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where]) : [];
    let rows = [...db.keys()].filter((k) => k.split('/')[0] === col && k.split('/').length === 2);
    rows = rows.filter((k) =>
      filters.every(({ fieldFilter: f }) => cmp[f.op](db.get(k).data[f.field.fieldPath], fromFields({ v: f.value }).v)),
    );
    if (q.limit) rows = rows.slice(0, q.limit);
    return json(rows.map((k) => ({ document: doc(k) })));
  }
  if (path === ':batchGet') {
    const names = JSON.parse(init.body).documents;
    return json(names.map((n) => { const p = n.split('/documents/')[1]; return db.has(p) ? { found: doc(p) } : { missing: n }; }));
  }
  if (path === ':commit') {
    const { writes } = JSON.parse(init.body);
    for (const w of writes) {
      if (w.delete) continue;
      const p = w.update.name.split('/documents/')[1];
      if (w.currentDocument?.exists === false && db.has(p)) return json({ error: { status: 'ALREADY_EXISTS', message: 'exists' } }, 409);
      if (w.currentDocument?.updateTime && db.get(p)?.updateTime !== w.currentDocument.updateTime) return json({ error: { status: 'FAILED_PRECONDITION', message: 'changed' } }, 400);
    }
    for (const w of writes) {
      if (w.delete) {
        db.delete(w.delete.split('/documents/')[1]);
        continue;
      }
      const p = w.update.name.split('/documents/')[1];
      const fields = fromFields(w.update.fields);
      if (!w.updateMask) {
        put(p, fields);
        continue;
      }
      // Only the fields in the mask change (nested paths too), like Firestore.
      const out = JSON.parse(JSON.stringify(db.get(p)?.data ?? {}));
      for (const fp of w.updateMask.fieldPaths) {
        const parts = splitPath(fp);
        let src = fields;
        let dst = out;
        for (let i = 0; i < parts.length - 1; i++) {
          src = src?.[parts[i]];
          dst = dst[parts[i]] = typeof dst[parts[i]] === 'object' && dst[parts[i]] ? dst[parts[i]] : {};
        }
        dst[parts[parts.length - 1]] = src?.[parts[parts.length - 1]];
      }
      put(p, out);
    }
    return json({});
  }
  const p = path.slice(1);
  if (db.has(p)) return json(doc(p));
  return json({ error: { status: 'NOT_FOUND', message: 'no' } }, 404);
}

const addDay = (d, n) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const env = { FIREBASE_PROJECT_ID: 'demo', FIREBASE_API_KEY: 'k', GATE_EMAIL: 'w@x', GATE_PASSWORD: 'p', SEMAPHORE_API_KEY: 'secret' };
const smsOf = (kid) => [...db.keys()].filter((k) => k.startsWith('sms/') && k !== 'sms/bad1' && db.get(k).data.studentId === kid.id && db.get(k).data.createdAt.startsWith(today)).map((k) => db.get(k).data);
const mangoDay = `attendance/sec-2-narra_${today}`;
// Parent portal: a parent's excuse for today (Mango), approved by the teacher.
const exEnr = [...state.enrollments.values()].find((e) => e.status === 'active' && e.sectionId === 'sec-2-narra');
{
  const d = db.get(mangoDay).data;
  delete d.records[exEnr.studentId];
  put(mangoDay, d);
}
put('excuses/ex1', { id: 'ex1', studentId: exEnr.studentId, sectionId: exEnr.sectionId, dates: [today], reason: 'Sick', status: 'approved', createdAt: '2026-11-16T06:00:00+08:00' });

// ---- 8:35 AM: before the absence text time (9:00) ----
let report = await run(env, new Date(`${today}T00:35:00Z`), fakeFetch);
console.log('08:35 report:', JSON.stringify(report));
ok(toSemaphoreNumber('+639171234567') === '639171234567' && toSemaphoreNumber('0917 123 4567') === '639171234567' && toSemaphoreNumber('12345') === null, 'phone numbers converted');
ok(db.get('sms/test1').data.status === 'sent' && db.get('sms/test1').data.providerId === '777', 'queued text sent through Semaphore');
ok(semaphoreCalls[0]?.sendername === 'SUNNYSIDE' && semaphoreCalls[0]?.number === '639171234567' && semaphoreCalls[0]?.apikey === 'secret', 'Semaphore got the number, sender name and key');
ok(db.get('sms/bad1').data.status === 'failed' && !semaphoreCalls.some((c) => c.number === '639998887777'), 'a text to a number that is not the guardian\'s is refused');
ok(!db.has(`confirmations/sec-2-narra_${today}`), 'no auto-confirm in the morning (Mango stays unconfirmed)');
ok(textable.every((k) => smsOf(k).length === 0), 'no absence text before the absence text time');
const unc = () => [...db.keys()].filter((k) => k.startsWith('notifications/uncnow_'));
ok(unc().length === 4 && !db.has(`notifications/uncnow_sec-k-sampaguita_${today}`), 'classes not confirmed 15 minutes after they started: alert on the website (4 per run, never a confirmed class)');
const officeTexts = () => semaphoreCalls.filter((c) => c.number === '639175550123' && c.message.includes('not confirmed attendance yet'));
ok(officeTexts().length === 1 && officeTexts()[0].message.includes(' and '), 'the school office gets ONE text listing the classes');

// ---- 9:00 AM: the absence step for the class the teacher confirmed ----
report = await run(env, new Date(`${today}T01:00:00Z`), fakeFetch);
console.log('09:00 report:', JSON.stringify(report));
ok(textable.length > 0 && textable.every((k) => smsOf(k).some((m) => m.kind === 'absent' || m.kind === 'streak')), `absence texts queued for the confirmed class (${textable.length})`);
ok(db.has(`notifications/absrun_sec-k-sampaguita_${today}`), 'absence step remembered');
const count = [...db.keys()].filter((k) => k.startsWith('sms/')).length;
await run(env, new Date(`${today}T01:05:00Z`), fakeFetch);
ok([...db.keys()].filter((k) => k.startsWith('sms/')).length === count, 'absence texts are not made twice');
ok(!db.has(`confirmations/sec-2-narra_${today}`), 'unconfirmed class still open during class');
ok(db.has(`notifications/uncnow_sec-2-narra_${today}`) && new Set(unc()).size === unc().length, 'each class is alerted once (Narra by 9:05)');

// ---- 11:35 AM: the class nobody confirmed is closed quietly ----
const before = [...db.keys()].filter((k) => k.startsWith('sms/')).length;
report = await run(env, new Date(`${today}T03:35:00Z`), fakeFetch);
console.log('11:35 report:', JSON.stringify(report));
const conf = db.get(`confirmations/sec-2-narra_${today}`)?.data;
ok(conf?.auto === true && conf.confirmedBy === 'Not confirmed', 'class nobody confirmed is closed after it ends');
ok([...db.keys()].filter((k) => k.startsWith('sms/')).length === before, 'closing it sends no parent texts');
ok(db.has(`notifications/unc_sec-2-narra_${today}`), 'staff are told the class was not confirmed');
const recs = Object.values(db.get(mangoDay).data.records);
ok(recs.some((r) => r.status === 'absent') && recs.some((r) => r.status === 'present'), 'records completed: scanned present, the rest absent');
const exRec = db.get(mangoDay).data.records[exEnr.studentId];
ok(exRec?.status === 'excused' && exRec.source === 'excuse', 'approved parent excuse -> excused, not absent');
const pd = db.get(`parentDays/${exEnr.studentId}_${today.slice(0, 7)}`)?.data;
ok(pd?.days?.[today]?.s === 'excused' && pd.totals && pd.sectionName, 'parent portal month written (today, totals, class name)');
const size = db.size - unc().length;
await run(env, new Date(`${today}T03:40:00Z`), fakeFetch);
ok(db.size - unc().length === size, 'another run changes nothing (apart from alerts for classes still not confirmed)');

// ---- email alerts for new messages (Brevo) ----
{
  const now = new Date(`${today}T02:02:00Z`); // 10:02 AM in Manila
  const old = new Date(now.getTime() - 10 * 60_000).toISOString();
  const fresh = new Date(now.getTime() - 60_000).toISOString();
  const school = db.get('meta/school').data;
  put('meta/school', { ...school, settings: { ...school.settings, officeEmail: 'office@school.test' } });
  put('teachers/t-maria', { ...state.teachers.get('t-maria'), email: 'maria@gmail.com' });
  put('teachers/t-jose', { ...state.teachers.get('t-jose'), emailAlerts: false });
  put('mailQueue/th1_t:t-maria', { id: 'th1_t:t-maria', threadId: 'th1', to: 't:t-maria', at: old, fromName: 'Althea <Dela Cruz>', studentName: 'Daniel' });
  put('mailQueue/th1_office', { id: 'th1_office', threadId: 'th1', to: 'office', at: old, fromName: 'Althea', studentName: '' });
  put('mailQueue/th2_t:t-jose', { id: 'th2_t:t-jose', threadId: 'th2', to: 't:t-jose', at: old, fromName: 'X', studentName: '' });
  put('mailQueue/th3_t:t-maria', { id: 'th3_t:t-maria', threadId: 'th3', to: 't:t-maria', at: fresh, fromName: 'Y', studentName: '' });
  const r1 = await sendMessageEmails(new (await import('./src/firestore.js')).Firestore(env, fakeFetch), { ...env }, fakeFetch, now);
  ok(r1 === 'skipped (BREVO_API_KEY or EMAIL_FROM is not set)' || typeof r1 === 'string', 'no Brevo key: nothing is emailed');
  const envMail = { ...env, BREVO_API_KEY: 'bk', EMAIL_FROM: 'doorbell@school.test', SITE_URL: 'https://x.test/Doorbell-ph/' };
  const r = await sendMessageEmails(new (await import('./src/firestore.js')).Firestore(envMail, fakeFetch), envMail, fakeFetch, now);
  console.log('email report:', JSON.stringify(r));
  const to = brevoCalls.map((c) => c.to[0].email).sort();
  ok(to.join() === 'maria@gmail.com,office@school.test', `emails go to the teacher and the office (${to.join()})`);
  const m = brevoCalls.find((c) => c.to[0].email === 'maria@gmail.com');
  ok(m && m.htmlContent.includes('Althea &lt;Dela Cruz&gt;') && !m.htmlContent.includes('<Dela'), 'names are escaped in the email');
  ok(m && m.textContent.includes('https://x.test/Doorbell-ph/messages?t=th1'), 'the email links to the conversation');
  ok(!db.has('mailQueue/th1_t:t-maria') && !db.has('mailQueue/th2_t:t-jose'), 'sent (or turned off) alerts are removed');
  ok(db.has('mailQueue/th3_t:t-maria'), 'a message from 1 minute ago waits (the teacher may still open it)');
}
// ---- the gate scanner (ESP32) through the Worker ----
{
  const key = 'dbs_TESTKEY_abcdefghijklmnopqrstuvwxyz';
  put('scanners/scn1', { id: 'scn1', name: 'Main gate', keyHash: await sha256Hex(key), keyEnd: 'wxyz', active: true });
  put('scanners/scn2', { id: 'scn2', name: 'Old gate', keyHash: await sha256Hex('dbs_OLD_abcdefghijklmnopqrstuvwxyz'), active: false });
  const call = (method, path, body, at, k = key) =>
    handleScanner(new Request(`https://w.test${path}`, { method, headers: { authorization: `Bearer ${k}` }, ...(body ? { body: JSON.stringify(body) } : {}) }), env, fakeFetch, new Date(at)).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  // A class nobody has confirmed yet, still in session (until 4 PM).
  const secId = [...state.sections.keys()].find((id) => !db.has(`confirmations/${id}_${today}`) && id !== 'sec-2-narra' && [...state.enrollments.values()].some((e) => e.status === 'active' && e.sectionId === id));
  const sec = db.get(`sections/${secId}`).data;
  put(`sections/${secId}`, { ...sec, schedule: { ...sec.schedule, startTime: '08:00', endTime: '16:00', classDays: [1, 2, 3, 4, 5] } });
  const dayPath = `attendance/${secId}_${today}`;
  const recsBefore = Object.keys(db.get(dayPath)?.data.records ?? {});
  const kid = [...state.enrollments.values()].filter((e) => e.status === 'active' && e.sectionId === secId).map((e) => state.students.get(e.studentId)).find((k) => !recsBefore.includes(k.id));
  ok((await call('GET', '/scanner/cards', null, `${today}T02:00:00Z`, 'wrong-key-wrong-key-wrong')).status === 401, 'scanner: a wrong key is refused');
  ok((await call('GET', '/scanner/cards', null, `${today}T02:00:00Z`, 'dbs_OLD_abcdefghijklmnopqrstuvwxyz')).status === 401, 'scanner: a cancelled key is refused');
  const cards = await call('GET', '/scanner/cards', null, `${today}T02:00:00Z`);
  ok(cards.ok && cards.hashes.includes(await sha256Hex(kid.qrToken)) && !cards.hashes.includes(kid.qrToken), 'scanner: card list has the hashes of the cards, not the codes');
  ok(!!db.get('scanners/scn1').data.lastSeenAt, 'scanner: last seen saved');
  const s1 = await call('POST', '/scanner/scan', { code: kid.qrToken }, `${today}T02:10:00Z`); // 10:10 AM
  ok(s1.ok && s1.result === 'late' && s1.name === kid.firstName, `scanner: first scan recorded as late (${s1.result})`);
  const day = db.get(dayPath).data;
  ok(day.records[kid.id]?.scannedAt === '10:10' && day.records[kid.id].source === 'scanner' && !day.records[kid.id].needsCheck, 'scanner: the record has the scan time');
  ok(recsBefore.every((id) => day.records[id]), "scanner: the other children's records are kept");
  ok(!smsOf(kid).length, 'scanner: no text at the gate (the parent is texted when the teacher confirms)');
  const s2 = await call('POST', '/scanner/scan', { code: kid.qrToken }, `${today}T02:11:00Z`);
  ok(s2.result === 'already_in', 'scanner: scanned again a minute later -> already in, nothing changes');
  const off = await call('POST', '/scanner/scan', { code: kid.qrToken, at: `${addDay(today, -1)}T01:00:00Z` }, `${today}T02:12:00Z`);
  ok(off.result === 'old_scan', "scanner: a scan kept from yesterday is not recorded");
  const s3 = await call('POST', '/scanner/scan', { code: kid.qrToken, at: `${today}T06:50:00Z` }, `${today}T06:55:00Z`); // scanned 2:50 PM, uploaded 2:55
  ok(s3.result === 'out' && db.get(dayPath).data.records[kid.id].scannedOut === '14:50', 'scanner: scanned again later -> going home, with the time it was scanned (offline upload)');
  const g = [...state.guardians.values()].find((x) => x.studentIds.includes(kid.id));
  ok(!g?.smsConsent || smsOf(kid).some((m) => m.kind === 'departure' && m.status === 'queued'), 'scanner: departure text queued');
  ok(db.get(`parentDays/${kid.id}_${today.slice(0, 7)}`)?.data.days?.[today]?.o === '14:50', 'scanner: time out in the parent portal');
  const n = smsOf(kid).length;
  await call('POST', '/scanner/scan', { code: kid.qrToken }, `${today}T07:30:00Z`);
  ok(smsOf(kid).length === n, 'scanner: only one departure text a day');
  // A class already confirmed: the late child waits for the teacher.
  const apple = `attendance/sec-k-sampaguita_${today}`;
  const late = appleAbsent.find((k) => !db.get(apple).data.records[k.id]?.scannedAt);
  const s4 = await call('POST', '/scanner/scan', { code: late.qrToken }, `${today}T01:20:00Z`);
  ok(s4.waitingForTeacher && db.get(apple).data.records[late.id].needsCheck && db.has(`notifications/late_${late.id}_${today}`), 'scanner: after the class was confirmed -> waiting for the teacher, staff alerted');
  ok((await call('POST', '/scanner/scan', { code: 'not-a-card' }, `${today}T01:20:00Z`)).result === 'unknown', 'scanner: unknown card');
}
process.exit(failures ? 1 : 0);
