// =====================================================================
// test.mjs — tries the Worker WITHOUT Cloudflare, Firebase or Semaphore.
// A fake Firestore (in memory, filled with the sample school) and a fake Semaphore answer
// the Worker's web requests. Run:  npm test   (inside the worker folder)
// =====================================================================
import { run, toSemaphoreNumber } from './src/index.js';
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
const cmp = { EQUAL: (a, b) => a === b, IN: (a, b) => b.includes(a), GREATER_THAN_OR_EQUAL: (a, b) => a >= b };
let semaphoreCalls = [];
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

async function fakeFetch(url, init = {}) {
  url = String(url);
  if (url.includes('accounts:signInWithPassword')) return json({ idToken: 'tok', expiresIn: '3600' });
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
      const p = w.update.name.split('/documents/')[1];
      if (w.currentDocument && db.get(p)?.updateTime !== w.currentDocument.updateTime) return json({ error: { status: 'FAILED_PRECONDITION', message: 'changed' } }, 400);
    }
    for (const w of writes) {
      const p = w.update.name.split('/documents/')[1];
      const fields = fromFields(w.update.fields);
      put(p, w.updateMask ? { ...(db.get(p)?.data ?? {}), ...fields } : fields);
    }
    return json({});
  }
  const p = path.slice(1);
  if (db.has(p)) return json(doc(p));
  return json({ error: { status: 'NOT_FOUND', message: 'no' } }, 404);
}

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

// ---- 9:00 AM: the absence step for the class the teacher confirmed ----
report = await run(env, new Date(`${today}T01:00:00Z`), fakeFetch);
console.log('09:00 report:', JSON.stringify(report));
ok(textable.length > 0 && textable.every((k) => smsOf(k).some((m) => m.kind === 'absent' || m.kind === 'streak')), `absence texts queued for the confirmed class (${textable.length})`);
ok(db.has(`notifications/absrun_sec-k-sampaguita_${today}`), 'absence step remembered');
const count = [...db.keys()].filter((k) => k.startsWith('sms/')).length;
await run(env, new Date(`${today}T01:05:00Z`), fakeFetch);
ok([...db.keys()].filter((k) => k.startsWith('sms/')).length === count, 'absence texts are not made twice');
ok(!db.has(`confirmations/sec-2-narra_${today}`), 'unconfirmed class still open during class');

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
const size = db.size;
await run(env, new Date(`${today}T03:40:00Z`), fakeFetch);
ok(db.size === size, 'another run changes nothing');
process.exit(failures ? 1 : 0);
