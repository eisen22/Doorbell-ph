// =====================================================================
// test.mjs — tries the Worker WITHOUT Cloudflare, Firebase or Semaphore.
// A fake Firestore (in memory, filled with the sample school) and a fake Semaphore answer
// the Worker's web requests. Run:  npm test   (inside the worker folder)
// =====================================================================
import { run, toSemaphoreNumber } from './src/index.js';
import { fromFields, toFields } from './src/firestore.js';
import { buildDemoState, realClock } from '../src/engine.js';
import { manilaToday } from '../src/logic.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

// ---- the fake database: path -> { data, updateTime } ----
const db = new Map();
let tick = 0;
const put = (path, data) => db.set(path, { data: JSON.parse(JSON.stringify(data)), updateTime: `t${++tick}` });
const today = manilaToday();
const state = buildDemoState(today, realClock);
put('meta/school', { ...state.meta, settings: { ...state.meta.settings, smsProvider: 'semaphore', senderName: 'SUNNYSIDE' } });
put('meta/calendar', { days: [...state.calendar.values()] });
for (const col of ['sections', 'students', 'guardians', 'enrollments', 'attendance', 'confirmations'])
  for (const [id, v] of state[col]) put(`${col}/${id}`, v);
// Remove TODAY's confirmations and absences so the Worker has something to confirm.
for (const k of [...db.keys()]) if (k.startsWith('confirmations/') && k.endsWith(today)) db.delete(k);
put('sms/test1', { id: 'test1', to: '+639171234567', body: 'Doorbell test message', kind: 'test', status: 'queued', createdAt: new Date().toISOString(), attempts: 1 });
put('sms/bad1', { id: 'bad1', studentId: [...state.students.keys()][0], to: '12345', body: 'x', kind: 'arrival', status: 'queued', createdAt: new Date().toISOString(), attempts: 1 });

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
// A run at 11:00 AM Manila on a school day (minute 0, so auto-confirm runs too).
const at = new Date(`${today}T03:00:00Z`);
const day = new Date(`${today}T12:00:00+08:00`).getUTCDay();
const report = await run(env, at, fakeFetch);
console.log('report:', JSON.stringify(report));

ok(toSemaphoreNumber('+639171234567') === '639171234567' && toSemaphoreNumber('0917 123 4567') === '639171234567' && toSemaphoreNumber('12345') === null, 'phone numbers converted');
ok(db.get('sms/test1').data.status === 'sent' && db.get('sms/test1').data.providerId === '777', 'queued text sent through Semaphore');
ok(semaphoreCalls[0]?.sendername === 'SUNNYSIDE' && semaphoreCalls[0]?.number === '639171234567' && semaphoreCalls[0]?.apikey === 'secret', 'Semaphore got the number, sender name and key');
ok(db.get('sms/bad1').data.status === 'failed' && db.has('notifications/smsf_bad1'), 'bad number marked failed + teacher alert');
if (day >= 1 && day <= 5) {
  const confs = [...db.keys()].filter((k) => k.startsWith('confirmations/') && k.endsWith(today));
  ok(confs.length > 0, `auto-confirmed today's classes (${confs.length})`);
  ok(confs.every((k) => db.get(k).data.auto === true && db.get(k).data.confirmedAt.startsWith(`${today}T`)), 'stamped with each class auto-confirm time');
  const att = [...db.keys()].filter((k) => k.startsWith('attendance/') && k.endsWith(today));
  ok(att.some((k) => Object.values(db.get(k).data.records).some((r) => r.status === 'absent')), 'unscanned children marked absent');
  // A second run does nothing new.
  const before = db.size;
  await run(env, at, fakeFetch);
  ok(db.size === before, 'second run changes nothing');
} else {
  console.log('(weekend: auto-confirm part not tested today)');
}
process.exit(failures ? 1 : 0);
