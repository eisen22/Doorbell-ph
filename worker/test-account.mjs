// =====================================================================
// test-account.mjs — tries worker/src/account.js (sign-in help, "Forgot password?", changing a
// parent's number or Gmail) WITHOUT Cloudflare, Firebase, Brevo or Semaphore: fakes answer them.
// Run:  node --import ./resolve-hook.mjs test-account.mjs   (inside the worker folder)
// =====================================================================
import { handleAccount, processAccountChanges, forgotPassword } from './src/account.js';
import { fromFields, toFields } from './src/firestore.js';
import { parentEmail } from '../src/logic.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

// ---- a service account key, so the Worker can "sign" its token request ----
const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
const env = {
  FIREBASE_PROJECT_ID: 'demo',
  FIREBASE_API_KEY: 'k',
  FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ client_email: 'w@demo.iam', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----\n` }),
  BREVO_API_KEY: 'b',
  EMAIL_FROM: 'doorbell@example.com',
  SITE_URL: 'https://eisen22.github.io/Doorbell-ph',
};

// ---- the fake database ----
const db = new Map();
let tick = 0;
const put = (path, data) => db.set(path, { data: JSON.parse(JSON.stringify(data)), updateTime: `t${++tick}` });
const get = (path) => db.get(path)?.data;
const L = '09764842100';
const N = '09175550000';
put('meta/school', { settings: { schoolName: 'Sunnyside', smsProvider: 'simulated' } });
put('guardians/g1', { name: 'Linda', mobile: '+639764842100', email: 'linda@gmail.com', preferredLanguage: 'en', studentIds: ['s1'] });
put(`parentKeys/${L}`, { id: L, guardianId: 'g1', studentIds: ['s1'], codeHash: 'h', email: 'linda@gmail.com' });
put('parentEmails/linda@gmail.com', { mobile: L, guardianId: 'g1' });
put('parents/uP', { mobile: L, defaultPassword: false });
put('parents/uG', { mobile: L, via: 'google', email: 'linda@gmail.com', defaultPassword: false });
put('guardians/g2', { name: 'Ben', mobile: '+639170000002', preferredLanguage: 'fil', studentIds: ['s2'] });
put('parentKeys/09170000002', { id: '09170000002', guardianId: 'g2', studentIds: ['s2'], codeHash: 'h2' });
put('threads/t1', { members: [`p:${L}`, 't:t1'], parent: L, names: { [`p:${L}`]: 'Linda', 't:t1': 'Ms. Cruz' }, readAt: { [`p:${L}`]: 'x' }, lastFrom: `p:${L}` });
put('messages/m1', { threadId: 't1', members: [`p:${L}`, 't:t1'], from: `p:${L}`, text: 'Hello' });
put('messages/m2', { threadId: 't1', members: [`p:${L}`, 't:t1'], from: 't:t1', text: 'Hi' });
put('users/uT', { role: 'teacher', email: 'cruz@gmail.com', teacherId: 't1', name: 'Ms. Cruz' });
put('teachers/t1', { name: 'Ms. Cruz', mobile: '+639181111111' });
put('users/uS', { role: 'teacher', email: 'sam@sunnyside.edu.ph', teacherId: 't2', name: 'Mr. Sam' });
put('teachers/t2', { name: 'Mr. Sam', mobile: '+639182222222' });

// ---- the fake sign-in accounts (Firebase Authentication) ----
const accounts = new Map(); // email -> { localId, email, password }
const addAcc = (localId, email, password) => accounts.set(email, { localId, email, password });
addAcc('uP', parentEmail(L), 'linda-pass');
addAcc('uT', 'cruz@gmail.com', 'teach-pass');
addAcc('uS', 'sam@sunnyside.edu.ph', 'sam-pass');
const byId = (id) => [...accounts.values()].find((a) => a.localId === id);
const tokens = new Set();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (uid, authTime) => {
  const t = `${b64({ alg: 'RS256' })}.${b64({ sub: uid, aud: 'demo', auth_time: authTime })}.sig`;
  tokens.add(t);
  return t;
};

const root = 'projects/demo/databases/(default)/documents';
const doc = (path) => ({ name: `${root}/${path}`, fields: toFields(db.get(path).data), updateTime: db.get(path).updateTime });
const cmp = { EQUAL: (a, b) => a === b, IN: (a, b) => b.includes(a), ARRAY_CONTAINS: (a, b) => Array.isArray(a) && a.includes(b) };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const brevo = [];
const semaphore = [];
let oob = 0;
async function fakeFetch(url, init = {}) {
  url = String(url);
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'admin', expires_in: 3600 });
  if (url.startsWith('https://api.brevo.com')) {
    brevo.push(body);
    return json({ messageId: 'm' });
  }
  if (url.startsWith('https://api.semaphore.co')) {
    semaphore.push(Object.fromEntries(new URLSearchParams(init.body.toString())));
    return json([{ message_id: 1 }]);
  }
  if (url.includes('/v1/accounts:signInWithPassword')) {
    const a = accounts.get(body.email);
    return a && a.password === body.password ? json({ localId: a.localId }) : json({ error: { message: 'INVALID_LOGIN_CREDENTIALS' } }, 400);
  }
  if (url.includes('/v1/accounts:lookup?key=')) {
    if (!tokens.has(body.idToken)) return json({ error: { message: 'INVALID_ID_TOKEN' } }, 400);
    const sub = JSON.parse(Buffer.from(body.idToken.split('.')[1], 'base64url').toString()).sub;
    return json({ users: [{ localId: sub }] });
  }
  if (url.includes('/projects/demo/accounts:lookup')) return json({ users: body.email.map((e) => accounts.get(e)).filter(Boolean).map((a) => ({ localId: a.localId, email: a.email })) });
  if (url.includes('/projects/demo/accounts:update')) {
    const a = byId(body.localId);
    if (body.password) a.password = body.password;
    if (body.email) {
      accounts.delete(a.email);
      a.email = body.email;
      accounts.set(a.email, a);
    }
    return json({ localId: a.localId });
  }
  if (url.includes('/projects/demo/accounts:delete')) {
    accounts.delete(byId(body.localId).email);
    return json({});
  }
  if (url.includes('/projects/demo/accounts:sendOobCode')) return json({ oobLink: `https://demo.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=CODE${++oob}&apiKey=k` });
  if (url.endsWith('/projects/demo/accounts')) {
    const id = `new${accounts.size}`;
    addAcc(id, body.email, body.password);
    return json({ localId: id });
  }
  const path = url.split('/documents')[1];
  if (path === ':runQuery') {
    const q = body.structuredQuery;
    const col = q.from[0].collectionId;
    const filters = q.where ? (q.where.compositeFilter ? q.where.compositeFilter.filters : [q.where]) : [];
    let rows = [...db.keys()].filter((k) => k.split('/')[0] === col && k.split('/').length === 2);
    rows = rows.filter((k) => filters.every(({ fieldFilter: fl }) => cmp[fl.op](db.get(k).data[fl.field.fieldPath], fromFields({ v: fl.value }).v)));
    if (q.limit) rows = rows.slice(0, q.limit);
    return json(rows.map((k) => ({ document: doc(k) })));
  }
  if (path === ':commit') {
    for (const w of body.writes) {
      if (w.delete) {
        db.delete(w.delete.split('/documents/')[1]);
        continue;
      }
      const p = w.update.name.split('/documents/')[1];
      if (w.currentDocument?.updateTime && db.get(p)?.updateTime !== w.currentDocument.updateTime) return json({ error: { message: 'changed' } }, 400);
      const fields = fromFields(w.update.fields);
      put(p, w.updateMask ? { ...(get(p) ?? {}), ...Object.fromEntries(w.updateMask.fieldPaths.map((k) => [k, fields[k]])) } : fields);
    }
    return json({});
  }
  const p = path.slice(1);
  return db.has(p) ? json(doc(p)) : json({ error: { status: 'NOT_FOUND' } }, 404);
}

const SITE = 'https://eisen22.github.io';
let clock = new Date('2026-11-27T02:00:00Z');
const call = async (path, body, origin = SITE) => {
  const res = await handleAccount(new Request(`https://w.example${path}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, fakeFetch, clock);
  return { res, data: await res.json() };
};
const later = (min) => (clock = new Date(clock.getTime() + min * 60000));
const smsTo = (key) => [...db.keys()].filter((k) => k.startsWith('sms/') && get(k).to === key).map(get);

// ---- 1. Signing in with a parent's Gmail, or a teacher's number ----
let r = await call('/auth/signin', { who: 'parent', id: 'Linda@Gmail.com ', password: 'linda-pass' });
ok(r.data.ok && r.data.login === L, 'parent Gmail + right password -> the parent number to sign in with');
ok(r.res.headers.get('access-control-allow-origin') === SITE, 'the website is allowed to call the Worker (CORS)');
r = await call('/auth/signin', { who: 'parent', id: 'linda@gmail.com', password: 'nope' });
ok(!r.data.ok && !r.data.login && /Wrong/.test(r.data.error), 'wrong password: only "wrong", no number');
r = await call('/auth/signin', { who: 'parent', id: 'stranger@gmail.com', password: 'linda-pass' });
ok(!r.data.ok && /Wrong/.test(r.data.error), 'unknown Gmail: the same "wrong" answer');
r = await call('/auth/signin', { who: 'staff', id: '0918 111 1111', password: 'teach-pass' });
ok(r.data.ok && r.data.login === 'cruz@gmail.com', 'teacher mobile number + password -> their email');
for (let i = 0; i < 10; i++) await call('/auth/signin', { who: 'staff', id: '09181111111', password: 'bad' });
r = await call('/auth/signin', { who: 'staff', id: '09181111111', password: 'teach-pass' });
ok(!r.data.ok && /Too many/.test(r.data.error), '10 wrong tries: even the right password waits 15 minutes');
later(16);
r = await call('/auth/signin', { who: 'staff', id: '09181111111', password: 'teach-pass' });
ok(r.data.ok, 'after 15 minutes it works again');
const evil = await call('/auth/signin', { who: 'parent', id: L, password: 'x' }, 'https://evil.example');
ok(!evil.res.headers.get('access-control-allow-origin'), 'another website is not allowed (no CORS header)');

// ---- 2. Forgot password ----
r = await call('/auth/forgot', { who: 'parent', id: '0976 484 2100' });
ok(r.data.ok && brevo.length === 1 && brevo[0].to[0].email === 'linda@gmail.com', 'parent with a Gmail: the reset email goes to the saved Gmail');
ok(brevo[0].htmlContent.includes('https://eisen22.github.io/Doorbell-ph/reset?oobCode=CODE1') && brevo[0].htmlContent.includes('Set a new password'), 'it links to the Doorbell /reset page with the one-time code');
ok(accounts.get(parentEmail(L)).password === 'linda-pass', 'the old password still works until a new one is chosen');
r = await call('/auth/forgot', { who: 'parent', id: 'linda@gmail.com' });
ok(r.data.ok && brevo.length === 1, 'asked again within 5 minutes (by Gmail this time): nothing new is sent');
later(6);
r = await call('/auth/forgot', { who: 'parent', id: 'LINDA@gmail.com' });
ok(brevo.length === 2 && brevo[1].to[0].email === 'linda@gmail.com', 'typing the Gmail works too (after 5 minutes)');
r = await call('/auth/forgot', { who: 'parent', id: '09170000002' });
const benText = smsTo('09170000002').find((m) => m.kind === 'password');
ok(r.data.ok && brevo.length === 2 && benText && /new password is/.test(benText.body) === false && /password/.test(benText.body), 'parent without a Gmail: a new password by text');
ok(!!accounts.get(parentEmail('09170000002')), 'their sign-in account was made for it');
r = await call('/auth/forgot', { who: 'parent', id: 'nobody@gmail.com' });
ok(r.data.ok && brevo.length === 2, 'unknown Gmail: the same "ok" answer, nothing sent');
r = await call('/auth/forgot', { who: 'staff', id: 'cruz@gmail.com' });
ok(brevo.length === 3 && brevo[2].to[0].email === 'cruz@gmail.com' && brevo[2].htmlContent.includes('/reset?oobCode='), 'teacher with a Gmail: reset link to their Gmail');
r = await call('/auth/forgot', { who: 'staff', id: '0918 222 2222' });
ok(brevo.length === 3 && smsTo('09182222222').length === 1 && accounts.get('sam@sunnyside.edu.ph').password !== 'sam-pass', 'teacher without a real email, by number: a new password by text');

// ---- 3. A parent changes their number ----
const old = idToken('uP', clock.getTime() / 1000 - 3600);
r = await call('/account/change-number', { idToken: old, mobile: N });
ok(!r.data.ok && r.data.reauth, 'signed in an hour ago: must type the password again first');
r = await call('/account/change-number', { idToken: 'fake.token.x', mobile: N });
ok(!r.data.ok && /sign in again/i.test(r.data.error), 'a made-up token is refused');
const fresh = idToken('uP', clock.getTime() / 1000 - 30);
r = await call('/account/change-number', { idToken: fresh, mobile: '0917 000 0002' });
ok(!r.data.ok && /already used/.test(r.data.error), "another parent's number is refused");
const brevoBefore = brevo.length;
r = await call('/account/change-number', { idToken: fresh, mobile: '0917 555 0000' });
ok(r.data.ok && r.data.mobile === N, 'the number is changed');
ok(get('guardians/g1').mobile === '+639175550000' && get(`parentKeys/${N}`)?.guardianId === 'g1' && !get(`parentKeys/${L}`), 'guardian and parent portal key moved to the new number');
ok(accounts.get(parentEmail(N))?.localId === 'uP' && !accounts.get(parentEmail(L)), 'the same sign-in account (same password) now uses the new number');
ok(accounts.get(parentEmail(N)).password === 'linda-pass', 'the password did not change');
ok(get('parents/uP').mobile === N && get('parents/uG').mobile === N && get('parentEmails/linda@gmail.com').mobile === N, 'both profiles (password and Google) and the Gmail link follow');
ok(get('threads/t1').members[0] === `p:${N}` && get('threads/t1').names[`p:${N}`] === 'Linda' && get('threads/t1').parent === N && get('threads/t1').lastFrom === `p:${N}`, 'conversations keep working with the new number');
ok(get('messages/m1').from === `p:${N}` && get('messages/m2').members.includes(`p:${N}`) && get('messages/m2').from === 't:t1', 'old messages too');
ok(smsTo(L).some((m) => /changed to 0917/.test(m.body)) && smsTo(N).some((m) => /now the number/.test(m.body)), 'notice texts to the old and the new number');
ok(brevo.length === brevoBefore + 1 && brevo.at(-1).to[0].email === 'linda@gmail.com' && /mobile number was changed/.test(brevo.at(-1).subject), 'notice email to the Gmail');
ok([...db.keys()].some((k) => k.startsWith('audit/') && get(k).action === 'guardian.mobile'), 'written in the audit log');
r = await call('/account/change-number', { idToken: fresh, mobile: '09175551111' });
ok(!r.data.ok && /Wait 5 minutes/.test(r.data.error), 'one change every 5 minutes');

// ---- 4. A parent changes their Gmail (confirmed by a link sent to the new Gmail) ----
later(6);
r = await call('/account/change-gmail', { idToken: fresh, email: 'cruz@gmail.com' });
ok(!r.data.ok && /teacher or admin/.test(r.data.error), "a teacher's Gmail is refused");
const tok = idToken('uP', clock.getTime() / 1000 - 10);
r = await call('/account/change-gmail', { idToken: tok, email: 'Linda.New@gmail.com' });
const mail = brevo.at(-1);
const link = mail.htmlContent.match(/confirm-email\?token=([a-f0-9]{64})/);
ok(r.data.ok && mail.to[0].email === 'linda.new@gmail.com' && link, 'a confirm link goes to the NEW Gmail');
ok(get('guardians/g1').email === 'linda@gmail.com', 'nothing changes before the link is opened');
r = await call('/account/confirm-gmail', { token: link[1] });
ok(r.data.ok && get('guardians/g1').email === 'linda.new@gmail.com' && get(`parentKeys/${N}`).email === 'linda.new@gmail.com', 'opening the link saves the new Gmail');
ok(get('parentEmails/linda.new@gmail.com')?.mobile === N && !get('parentEmails/linda@gmail.com'), 'Google sign-in moves to the new Gmail (the old one stops)');
ok(brevo.at(-1).to[0].email === 'linda@gmail.com' && /Gmail of your Doorbell account was changed/.test(brevo.at(-1).subject), 'notice email to the OLD Gmail');
r = await call('/account/confirm-gmail', { token: link[1] });
ok(!r.data.ok && /already used/.test(r.data.error), 'the link works once');

// ---- 5. The admin changes a number (Admin -> Students -> Change number) ----
put('accountChanges/m_g2', { kind: 'mobile', guardianId: 'g2', mobile: '09179990000', by: 'Admin Ana', at: clock.toISOString(), state: 'new' });
const rep = await processAccountChanges(env, fakeFetch, { schoolName: 'Sunnyside', smsProvider: 'simulated' }, 2, clock);
ok(rep.done === 1 && get('accountChanges/m_g2').result === 'done' && get('guardians/g2').mobile === '+639179990000' && get('parentKeys/09179990000'), 'the admin change is done by the Worker');
ok(smsTo('09170000002').some((m) => /Pinalitan/.test(m.body)), 'the notice is in the parent\'s language (Filipino)');

// ---- 6. A teacher who lost their Gmail gets a new sign-in email ----
put('accountChanges/s_uT', { kind: 'staffEmail', uid: 'uT', teacherId: 't1', email: 'Cruz.New@gmail.com', by: 'Admin Ana', at: clock.toISOString(), state: 'new' });
const before = brevo.length;
await processAccountChanges(env, fakeFetch, { schoolName: 'Sunnyside', smsProvider: 'simulated' }, 2, clock);
ok(get('accountChanges/s_uT').result === 'done' && get('users/uT').email === 'cruz.new@gmail.com' && get('teachers/t1').email === 'cruz.new@gmail.com', "the teacher's email is changed");
ok(accounts.get('cruz.new@gmail.com')?.localId === 'uT' && accounts.get('cruz.new@gmail.com').password === 'teach-pass' && !accounts.get('cruz@gmail.com'), 'same account and password, new sign-in email');
ok(brevo.length === before + 2 && brevo.slice(-2).map((m) => m.to[0].email).sort().join() === 'cruz.new@gmail.com,cruz@gmail.com', 'notices to the old and the new email');

console.log(failures ? `\n${failures} FAILED` : '\nAll account tests passed.');
process.exit(failures ? 1 : 0);
