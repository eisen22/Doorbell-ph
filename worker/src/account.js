// =====================================================================
// account.js — SIGN-IN HELP, "FORGOT PASSWORD?", AND A PARENT CHANGING THEIR NUMBER OR GMAIL
// ---------------------------------------------------------------------
// The website calls these addresses of the Worker (POST, JSON). They need the service account
// (Cloudflare secret FIREBASE_SERVICE_ACCOUNT), because they look up other people's accounts.
//
//   /auth/signin          a parent typed their Gmail, or a teacher/admin typed their mobile number, with the
//                         password: if the password is right, answers which sign-in to use (the parent's
//                         number, the staff email). A wrong password answers only "wrong", so the page
//                         cannot be used to find out who is registered. 10 wrong tries = wait 15 minutes.
//   /auth/forgot          "Forgot password?" with a mobile number or an email. An account with a Gmail
//                         (or a staff member's real email) gets an email with a link to the website's
//                         /reset page, where they choose a new password themselves. Without one, a new
//                         password is texted (passwords.js). The old password keeps working until then.
//                         Once per account every 5 minutes. The answer is always the same ("if it exists").
//   /account/change-number    a signed-in parent changes their mobile number (they typed their password
//                             again in the last 10 minutes). moveGuardianNumber() moves everything.
//   /account/change-gmail     a signed-in parent asks to use another Gmail: a link is sent TO the new Gmail
//   /account/confirm-gmail    ...and opening that link makes the change (so a typo cannot lock them out).
// The admin can change a parent's number too (Admin -> Students -> Change number), or give a teacher who lost
// their Gmail a new sign-in email (Admin -> Teachers -> Change email): the website saves accountChanges/{id}
// and processAccountChanges() (every minute) makes the change.
// After every change, a notice goes to the old number and to the Gmail on file, so a parent finds out
// at once if someone else changed it.
// =====================================================================
import { adminFirestore, authAdmin, findAccount, createAccount, sendEmail, deliver, newPassword, forParent, forStaff } from './passwords.js';
import { parentEmail, parentKeyOf, isRealEmail } from '../../src/logic.js';
import { sha256Hex } from './scanner.js';

const MINUTE = 60 * 1000;
const RESET_GAP = 5 * MINUTE; // one "Forgot password?" per account every 5 minutes
const CHANGE_GAP = 5 * MINUTE; // one number or Gmail change per parent every 5 minutes
const TRIES = 10; // wrong passwords before /auth/signin waits...
const TRIES_WINDOW = 15 * MINUTE; // ...this long
const RECENT_SECONDS = 10 * 60; // "typed the password again" counts for 10 minutes
const LINK_LIFE = 60 * MINUTE; // the "confirm this Gmail" link

const variants = (key) => [key, `+63${key.slice(1)}`]; // numbers are saved as 09... or +639...
export const maskMobile = (key) => (key ? `${key.slice(0, 4)} ••• ${key.slice(7)}` : '');
export const maskEmail = (e) => {
  const [user, host] = String(e ?? '').split('@');
  if (!host) return '';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 2)))}${user.length > 2 ? user.slice(-1) : ''}@${host}`;
};
const siteOf = (env) => (env.SITE_URL ?? '').replace(/\/$/, '');
const newId = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

// ---------- the web address part ----------
function corsFor(request, env) {
  const origin = request.headers.get('origin') ?? '';
  let site = '';
  try {
    site = new URL(env.SITE_URL).origin;
  } catch {
    /* no SITE_URL */
  }
  const allowed = origin && (origin === site || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
  return allowed
    ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400', vary: 'Origin' }
    : { vary: 'Origin' };
}
const reply = (obj, cors) => new Response(JSON.stringify(obj), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });

/** The Worker's fetch() sends /auth/... and /account/... here. */
export async function handleAccount(request, env, fetchFn = (...a) => fetch(...a), now = new Date()) {
  const cors = corsFor(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ ok: false, error: 'Use POST.' }, cors);
  if (!env.FIREBASE_SERVICE_ACCOUNT) return reply({ ok: false, error: 'The school server is not set up yet. Contact the school office.' }, cors);
  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ ok: false, error: 'Bad request.' }, cors);
  }
  const path = new URL(request.url).pathname;
  const db = adminFirestore(env, fetchFn);
  const settings = async () => (await db.get('meta/school'))?.data.settings ?? {};
  try {
    if (path === '/auth/signin') return reply(await signInHelp(env, fetchFn, db, body ?? {}, now), cors);
    if (path === '/auth/forgot') {
      // Always the same answer: the page never tells whether the account exists.
      const result = await forgotPassword(env, fetchFn, db, await settings(), body ?? {}, now);
      console.log('Forgot password:', result);
      return reply({ ok: true }, cors);
    }
    if (path === '/account/change-number') return reply(await changeNumber(env, fetchFn, db, await settings(), body ?? {}, now), cors);
    if (path === '/account/change-gmail') return reply(await changeGmail(env, fetchFn, db, await settings(), body ?? {}, now), cors);
    if (path === '/account/confirm-gmail') return reply(await confirmGmail(env, fetchFn, db, await settings(), body ?? {}, now), cors);
    return reply({ ok: false, error: 'Not found.' }, cors);
  } catch (e) {
    console.error('Account request failed:', path, e.message);
    return reply({ ok: false, error: 'Something went wrong. Try again in a minute.' }, cors);
  }
}

// ---------- limits (limits/{hash}: only the Worker reads and writes them) ----------
async function limitHit(db, name, gap, now) {
  const d = await db.get(`limits/${await sha256Hex(name)}`);
  return !!d && now - Date.parse(d.data.at) < gap;
}
async function limitSet(db, name, now) {
  await db.commit([{ path: `limits/${await sha256Hex(name)}`, data: { at: now.toISOString(), kind: name.split(':')[0] } }]);
}

// ---------- who is this? ----------
/** A parent by mobile number or by the Gmail the school saved: { key, guardian } or null. */
async function parentByLogin(db, id) {
  const clean = String(id ?? '').trim().toLowerCase();
  let key = parentKeyOf(clean);
  if (!key && clean.includes('@')) key = (await db.get(`parentEmails/${clean}`))?.data.mobile ?? null;
  if (!key) return null;
  const pk = await db.get(`parentKeys/${key}`);
  if (!pk) return null;
  const g = pk.data.guardianId ? await db.get(`guardians/${pk.data.guardianId}`) : null;
  return { key, guardianId: pk.data.guardianId ?? null, guardian: g?.data ?? null };
}

/** A teacher or admin by email or by the mobile number on file: { uid, email, profile } or null. */
async function staffByLogin(env, f, db, id) {
  const clean = String(id ?? '').trim().toLowerCase();
  const isStaff = (p) => p && ['admin', 'teacher'].includes(p.role);
  if (clean.includes('@')) {
    const acc = await findAccount(env, f, clean);
    const p = acc ? await db.get(`users/${acc.localId}`) : null;
    return acc && isStaff(p?.data) ? { uid: acc.localId, email: (acc.email ?? clean).toLowerCase(), profile: p.data } : null;
  }
  const key = parentKeyOf(clean);
  if (!key) return null;
  const rows = await db.query('users', [['mobile', 'IN', variants(key)]], 3);
  for (const t of await db.query('teachers', [['mobile', 'IN', variants(key)]], 3)) rows.push(...(await db.query('users', [['teacherId', 'EQUAL', t.id]], 1)));
  const staff = [...new Map(rows.filter((r) => isStaff(r.data)).map((r) => [r.id, r])).values()];
  // None, or the same number on two staff accounts (then they must type their email).
  if (staff.length !== 1) return null;
  return { uid: staff[0].id, email: String(staff[0].data.email).toLowerCase(), profile: staff[0].data };
}

/** Checks a password with Firebase's normal sign-in: 'ok', 'wrong' or 'busy'. */
async function passwordOk(env, f, email, password) {
  const res = await f(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  if (res.ok) return 'ok';
  const json = await res.json().catch(() => ({}));
  return /TOO_MANY_ATTEMPTS/.test(json.error?.message ?? '') ? 'busy' : 'wrong';
}

/** The signed-in person behind a Firebase ID token: { uid, recent } or null. Firebase checks the token. */
async function signedInUser(env, f, idToken, now) {
  if (typeof idToken !== 'string' || idToken.length > 5000) return null;
  const res = await f(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) return null;
  const user = (await res.json().catch(() => ({}))).users?.[0];
  if (!user?.localId) return null;
  let claims = {};
  try {
    const part = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    claims = JSON.parse(atob(part + '='.repeat((4 - (part.length % 4)) % 4)));
  } catch {
    return null;
  }
  if (claims.sub !== user.localId || claims.aud !== env.FIREBASE_PROJECT_ID) return null;
  return { uid: user.localId, recent: now.getTime() / 1000 - Number(claims.auth_time ?? 0) <= RECENT_SECONDS };
}

/** The guardian of the signed-in parent: { key, guardianId, guardian } or null. */
async function parentOfUser(db, uid) {
  const prof = await db.get(`parents/${uid}`);
  const key = prof?.data.mobile;
  if (!key) return null;
  const pk = await db.get(`parentKeys/${key}`);
  if (!pk?.data.guardianId) return null;
  const g = await db.get(`guardians/${pk.data.guardianId}`);
  return g ? { key, guardianId: pk.data.guardianId, guardian: g.data } : null;
}

// =====================================================================
// SIGN IN WITH A PARENT'S GMAIL OR A STAFF MEMBER'S NUMBER
// (a parent's number and a staff email are handled by the website itself)
// =====================================================================
async function signInHelp(env, f, db, { who, id, password }, now) {
  const clean = String(id ?? '').trim().toLowerCase();
  const pw = String(password ?? '');
  const wrong =
    who === 'parent'
      ? 'Wrong mobile number, Gmail or password. First time? Sign in with your mobile number and the password the school texted you.'
      : 'Wrong email, mobile number or password.';
  if (!clean || !pw || clean.length > 120 || pw.length > 200) return { ok: false, error: wrong };
  const triesId = `limits/${await sha256Hex(`signin:${clean}`)}`;
  const tries = await db.get(triesId);
  const fresh = tries && now - Date.parse(tries.data.since) < TRIES_WINDOW;
  if (fresh && tries.data.fails >= TRIES) return { ok: false, error: 'Too many wrong tries. Wait 15 minutes, or press "Forgot password?".' };
  let login = null;
  let check = null;
  if (who === 'parent' && clean.includes('@')) {
    const p = await parentByLogin(db, clean);
    if (p) {
      login = p.key;
      check = [...new Set([pw.trim(), pw.trim().toLowerCase()])].map((x) => [parentEmail(p.key), x]);
    }
  } else if (who === 'staff' && !clean.includes('@')) {
    const s = await staffByLogin(env, f, db, clean);
    if (s) {
      login = s.email;
      check = [[s.email, pw]];
    }
  }
  for (const [email, x] of check ?? []) {
    const r = await passwordOk(env, f, email, x);
    if (r === 'busy') return { ok: false, error: 'Too many tries. Wait a few minutes and try again.' };
    if (r === 'ok') {
      if (tries) await db.commit([{ path: triesId, remove: true }]);
      return { ok: true, login };
    }
  }
  await db.commit([{ path: triesId, data: { kind: 'signin', since: fresh ? tries.data.since : now.toISOString(), fails: (fresh ? tries.data.fails : 0) + 1 } }]);
  return { ok: false, error: wrong };
}

// =====================================================================
// FORGOT PASSWORD
// =====================================================================
/** A link to the website's /reset page with Firebase's one-time reset code (expires after 1 hour). */
async function resetLink(env, f, email) {
  const r = await authAdmin(env, f, 'accounts:sendOobCode', { requestType: 'PASSWORD_RESET', email, returnOobLink: true });
  const code = r.oobLink ? new URL(r.oobLink).searchParams.get('oobCode') : null;
  if (!code) throw new Error('Firebase did not return a reset link');
  return `${siteOf(env)}/reset?oobCode=${encodeURIComponent(code)}`;
}
const resetLines = (school, who) => [
  `Someone (hopefully you) asked to reset the Doorbell password for ${who} at ${school}.`,
  'Press the button below and choose a new password. The link works once and expires in 1 hour.',
  'Did not ask for this? Ignore this email: your password stays the same.',
];

/**
 * "Forgot password?" (who 'parent' or 'staff', id = mobile number or email). Returns what happened,
 * for the Worker's log only (the person always sees the same message).
 */
export async function forgotPassword(env, f, db, settings, { who, id }, now = new Date()) {
  const school = settings.schoolName || 'the school';
  const canMail = !!(env.BREVO_API_KEY && env.EMAIL_FROM);
  if (who === 'parent') {
    const p = await parentByLogin(db, id);
    if (!p) return 'not registered';
    if (await limitHit(db, `reset:p:${p.key}`, RESET_GAP, now)) return 'skipped: asked less than 5 minutes ago';
    await limitSet(db, `reset:p:${p.key}`, now);
    const gmail = p.guardian?.email;
    if (isRealEmail(gmail) && canMail) {
      const email = parentEmail(p.key);
      if (!(await findAccount(env, f, email))) {
        // Never signed in yet: make the account (with a password nobody knows) so the link can set one.
        const uid = await createAccount(env, f, email, newPassword());
        await db.commit([{ path: `parents/${uid}`, data: { mobile: p.key, defaultPassword: false, createdAt: now.toISOString() } }]);
      }
      const mailed = await sendEmail(env, f, settings, {
        to: gmail,
        name: p.guardian.name ?? '',
        subject: `Reset your Doorbell parent portal password (${school})`,
        lines: resetLines(school, `the parent portal account of ${maskMobile(p.key)}`),
        link: await resetLink(env, f, email),
        linkLabel: 'Set a new password',
        path: '/login',
      });
      return mailed === 'sent' ? 'sent: reset link by email' : `failed: ${mailed}`;
    }
    // No Gmail: a new password by text (the old one stops working).
    return forParent(env, f, db, settings, school, { login: p.key, reason: 'forgot' });
  }
  const s = await staffByLogin(env, f, db, id);
  if (!s) return 'not registered';
  if (await limitHit(db, `reset:s:${s.uid}`, RESET_GAP, now)) return 'skipped: asked less than 5 minutes ago';
  await limitSet(db, `reset:s:${s.uid}`, now);
  if (isRealEmail(s.email) && canMail) {
    const mailed = await sendEmail(env, f, settings, {
      to: s.email,
      name: s.profile.name ?? '',
      subject: `Reset your Doorbell password (${school})`,
      lines: resetLines(school, s.email),
      link: await resetLink(env, f, s.email),
      linkLabel: 'Set a new password',
      path: '/login',
    });
    return mailed === 'sent' ? 'sent: reset link by email' : `failed: ${mailed}`;
  }
  return forStaff(env, f, db, settings, school, { login: s.email, reason: 'forgot' });
}

// =====================================================================
// NOTICES: a short text and/or email after a number or Gmail change
// =====================================================================
async function notice(env, f, db, settings, { to, email, name, text, subject, lines }) {
  const out = [];
  if (to && text) {
    try {
      out.push(`text ${await deliver(env, f, db, settings, [], { to, body: text, hidden: text, extra: { kind: 'account' } })}`);
    } catch (e) {
      out.push(`text failed: ${e.message}`);
    }
  }
  if (email && isRealEmail(email) && lines) out.push(`email ${await sendEmail(env, f, settings, { to: email, name: name ?? '', subject, lines, path: '/login' })}`);
  return out.join(', ');
}
const audit = (actor, action, target, detail, at) => {
  const id = newId('aud');
  return { path: `audit/${id}`, data: { id, at, actor, action, target, detail } };
};

// =====================================================================
// CHANGING A PARENT'S NUMBER (by the parent or by the admin)
// Everything tied to the number moves to the new one: the sign-in account (its sign-in email is made
// from the number), parentKeys, the parent profiles, the Gmail link, and the conversations (members
// 'p:<number>'). The children, the Gmail and the password stay the same.
// =====================================================================
export async function moveGuardianNumber(env, f, db, settings, guardianId, newKey, { by, now = new Date() }) {
  const school = settings.schoolName || 'the school';
  const g = await db.get(`guardians/${guardianId}`);
  if (!g) return { ok: false, error: 'This guardian record was not found.' };
  const oldKey = parentKeyOf(g.data.mobile);
  if (!newKey) return { ok: false, error: 'Enter the new mobile number, e.g. 0917 123 4567.' };
  if (oldKey === newKey) return { ok: false, error: 'That is already the number on file.' };
  const taken = 'This number is already used by another parent at the school. Use another number, or contact the school office.';
  if (await db.get(`parentKeys/${newKey}`)) return { ok: false, error: taken };
  if ((await db.query('guardians', [['mobile', 'IN', variants(newKey)]], 3)).some((x) => x.id !== guardianId)) return { ok: false, error: taken };
  const at = now.toISOString();
  const writes = [];
  // 1. The sign-in account follows the number (same account, same password).
  if (oldKey) {
    const acc = await findAccount(env, f, parentEmail(oldKey));
    const stale = await findAccount(env, f, parentEmail(newKey));
    if (stale && stale.localId !== acc?.localId) {
      // An old account of the new number with no children (e.g. a test): removed so the email is free.
      await authAdmin(env, f, 'accounts:delete', { localId: stale.localId });
      writes.push({ path: `parents/${stale.localId}`, remove: true });
    }
    if (acc) await authAdmin(env, f, 'accounts:update', { localId: acc.localId, email: parentEmail(newKey) });
  }
  // 2. The records.
  writes.push({ path: `guardians/${guardianId}`, patch: { mobile: `+63${newKey.slice(1)}`, numberStatus: 'unverified' } });
  const pk = oldKey ? await db.get(`parentKeys/${oldKey}`) : null;
  if (pk) writes.push({ path: `parentKeys/${newKey}`, data: { ...pk.data, id: newKey, updatedAt: at } }, { path: `parentKeys/${oldKey}`, remove: true });
  if (oldKey) for (const p of await db.query('parents', [['mobile', 'EQUAL', oldKey]])) writes.push({ path: `parents/${p.id}`, patch: { mobile: newKey } });
  if (g.data.email) writes.push({ path: `parentEmails/${g.data.email}`, patch: { mobile: newKey, updatedAt: at } });
  // 3. The conversations and their messages.
  if (oldKey) {
    const from = `p:${oldKey}`;
    const to = `p:${newKey}`;
    const swap = (list) => (list ?? []).map((k) => (k === from ? to : k));
    const rekey = (obj) => Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k === from ? to : k, v]));
    for (const t of await db.query('threads', [['members', 'ARRAY_CONTAINS', from]])) {
      writes.push({
        path: `threads/${t.id}`,
        patch: {
          members: swap(t.data.members),
          names: rekey(t.data.names),
          readAt: rekey(t.data.readAt),
          ...(t.data.parent === oldKey ? { parent: newKey } : {}),
          ...(t.data.lastFrom === from ? { lastFrom: to } : {}),
        },
      });
    }
    for (const m of await db.query('messages', [['members', 'ARRAY_CONTAINS', from]]))
      writes.push({ path: `messages/${m.id}`, patch: { members: swap(m.data.members), ...(m.data.from === from ? { from: to } : {}) } });
    for (const m of await db.query('mailQueue', [['from', 'EQUAL', from]])) writes.push({ path: `mailQueue/${m.id}`, patch: { from: to } });
  }
  writes.push(audit(by, 'guardian.mobile', g.data.name ?? '', `${oldKey ?? 'none'} -> ${newKey}`, at));
  await db.commit(writes);
  // 4. Notices: the old number (in case someone else did this), the new number and the Gmail.
  const lang = g.data.preferredLanguage === 'fil' ? 'fil' : 'en';
  const sent = [
    await notice(env, f, db, settings, {
      to: oldKey,
      text:
        lang === 'fil'
          ? `Doorbell: Pinalitan ang mobile number ng inyong parent portal account sa ${school} ng ${maskMobile(newKey)}. Hindi kayo ang nagpalit? Makipag-ugnayan agad sa paaralan.`
          : `Doorbell: The mobile number of your parent portal account at ${school} was changed to ${maskMobile(newKey)}. Did not ask for this? Contact the school right away.`,
    }),
    await notice(env, f, db, settings, {
      to: newKey,
      email: g.data.email,
      name: g.data.name,
      text:
        lang === 'fil'
          ? `Doorbell: Ito na ang numero ng inyong parent portal account sa ${school}. Mag-sign in gamit ang numerong ito at ang inyong password.`
          : `Doorbell: This is now the number of your parent portal account at ${school}. Sign in with this number and your password.`,
      subject: `Your Doorbell mobile number was changed (${school})`,
      lines: [
        `The mobile number of your parent portal account at ${school} was changed from ${maskMobile(oldKey)} to ${maskMobile(newKey)} (${by}).`,
        'From now on, sign in with the new number and your current password, or with Google.',
        'Did not ask for this? Contact the school right away.',
      ],
    }),
  ];
  console.log('Number changed:', guardianId, sent.join('; '));
  return { ok: true, mobile: newKey };
}

async function changeNumber(env, f, db, settings, { idToken, mobile }, now) {
  const me = await signedInUser(env, f, idToken, now);
  if (!me) return { ok: false, error: 'Please sign in again.' };
  if (!me.recent) return { ok: false, reauth: true, error: 'For your safety, type your password again.' };
  const p = await parentOfUser(db, me.uid);
  if (!p) return { ok: false, error: 'This account is not linked to a child at the school.' };
  const key = parentKeyOf(mobile);
  if (!key) return { ok: false, error: 'Enter the new mobile number, e.g. 0917 123 4567.' };
  if (await limitHit(db, `number:${p.guardianId}`, CHANGE_GAP, now)) return { ok: false, error: 'The number was changed a moment ago. Wait 5 minutes and try again.' };
  const r = await moveGuardianNumber(env, f, db, settings, p.guardianId, key, { by: 'the parent, in the parent portal', now });
  if (r.ok) await limitSet(db, `number:${p.guardianId}`, now);
  return r;
}

// =====================================================================
// CHANGING A PARENT'S GMAIL (by the parent): confirmed through a link sent to the new Gmail
// =====================================================================
async function gmailProblem(env, f, db, guardianId, email) {
  if (!isRealEmail(email) || email.length > 100) return 'Enter a valid email address, e.g. name@gmail.com.';
  const used = await db.get(`parentEmails/${email}`);
  if (used && used.data.guardianId !== guardianId) return 'This Gmail is already used by another parent. Use another Gmail, or contact the school office.';
  const acc = await findAccount(env, f, email);
  if (acc && (await db.get(`users/${acc.localId}`))) return 'This Gmail belongs to a teacher or admin account. Use another Gmail.';
  return null;
}

async function changeGmail(env, f, db, settings, { idToken, email }, now) {
  const school = settings.schoolName || 'the school';
  const me = await signedInUser(env, f, idToken, now);
  if (!me) return { ok: false, error: 'Please sign in again.' };
  if (!me.recent) return { ok: false, reauth: true, error: 'For your safety, type your password again.' };
  const p = await parentOfUser(db, me.uid);
  if (!p) return { ok: false, error: 'This account is not linked to a child at the school.' };
  const clean = String(email ?? '').trim().toLowerCase();
  if (clean === (p.guardian.email ?? '').toLowerCase()) return { ok: false, error: 'That is already the Gmail on file.' };
  const problem = await gmailProblem(env, f, db, p.guardianId, clean);
  if (problem) return { ok: false, error: problem };
  if (await limitHit(db, `gmail:${p.guardianId}`, CHANGE_GAP, now)) return { ok: false, error: 'A link was sent a moment ago. Check that Gmail (and Spam), or wait 5 minutes.' };
  if (!(env.BREVO_API_KEY && env.EMAIL_FROM)) return { ok: false, error: 'The school cannot send emails yet. Contact the school office.' };
  const token = randomHex(32);
  await db.commit([
    { path: `emailChanges/${await sha256Hex(token)}`, data: { guardianId: p.guardianId, email: clean, uid: me.uid, createdAt: now.toISOString(), expires: new Date(now.getTime() + LINK_LIFE).toISOString() } },
  ]);
  const mailed = await sendEmail(env, f, settings, {
    to: clean,
    name: p.guardian.name ?? '',
    subject: `Confirm your Gmail for Doorbell (${school})`,
    lines: [
      `You asked to use this Gmail for your parent portal account at ${school} (${maskMobile(p.key)}).`,
      'Press the button below to confirm it. The link expires in 1 hour.',
      'After that you can sign in with Google using this Gmail, and a forgotten password can be reset through it.',
      'Did not ask for this? Ignore this email: nothing changes.',
    ],
    link: `${siteOf(env)}/confirm-email?token=${token}`,
    linkLabel: 'Confirm this Gmail',
    path: '/login',
  });
  if (mailed !== 'sent') return { ok: false, error: 'The confirmation email could not be sent. Try again later.' };
  await limitSet(db, `gmail:${p.guardianId}`, now);
  return { ok: true, sentTo: clean };
}

/** Saves a guardian's new Gmail everywhere and sends the notices. */
export async function applyGuardianGmail(env, f, db, settings, guardianId, email, { by, now = new Date(), extra = [] }) {
  const school = settings.schoolName || 'the school';
  const g = await db.get(`guardians/${guardianId}`);
  if (!g) return { ok: false, error: 'This guardian record was not found.' };
  const key = parentKeyOf(g.data.mobile);
  const old = g.data.email ?? null;
  const at = now.toISOString();
  const writes = [...extra, { path: `guardians/${guardianId}`, patch: { email } }];
  if (key) writes.push({ path: `parentEmails/${email}`, data: { mobile: key, guardianId, updatedAt: at } }, { path: `parentKeys/${key}`, patch: { email } });
  if (old && old !== email) writes.push({ path: `parentEmails/${old}`, remove: true });
  writes.push(audit(by, 'guardian.email', g.data.name ?? '', `${old ?? 'none'} -> ${email}`, at));
  await db.commit(writes);
  await gmailNotices(env, f, db, settings, g.data, old, email, by);
  return { ok: true, email };
}

async function gmailNotices(env, f, db, settings, guardian, oldEmail, newEmail, by) {
  const school = settings.schoolName || 'the school';
  const key = parentKeyOf(guardian.mobile);
  const fil = guardian.preferredLanguage === 'fil';
  return [
    await notice(env, f, db, settings, {
      to: key,
      email: oldEmail && oldEmail !== newEmail ? oldEmail : null,
      name: guardian.name,
      text: newEmail
        ? fil
          ? `Doorbell: Pinalitan ang Gmail ng inyong parent portal account sa ${school} ng ${maskEmail(newEmail)}. Hindi kayo ang nagpalit? Makipag-ugnayan agad sa paaralan.`
          : `Doorbell: The Gmail of your parent portal account at ${school} was changed to ${maskEmail(newEmail)}. Did not ask for this? Contact the school right away.`
        : null,
      subject: `The Gmail of your Doorbell account was changed (${school})`,
      lines: [
        `The Gmail of your parent portal account at ${school} was changed from this address to ${newEmail ? maskEmail(newEmail) : 'none'} (${by}).`,
        'This Gmail can no longer be used to sign in with Google or to reset the password.',
        'Did not ask for this? Contact the school right away.',
      ],
    }),
  ].join('; ');
}

async function confirmGmail(env, f, db, settings, { token }, now) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return { ok: false, error: 'This link is not valid.' };
  const path = `emailChanges/${await sha256Hex(token)}`;
  const ch = await db.get(path);
  if (!ch) return { ok: false, error: 'This link was already used or is not valid.' };
  if (Date.parse(ch.data.expires) < now.getTime()) {
    await db.commit([{ path, remove: true }]);
    return { ok: false, error: 'This link has expired. Ask for a new one in the parent portal.' };
  }
  const problem = await gmailProblem(env, f, db, ch.data.guardianId, ch.data.email);
  if (problem) {
    await db.commit([{ path, remove: true }]);
    return { ok: false, error: problem };
  }
  return applyGuardianGmail(env, f, db, settings, ch.data.guardianId, ch.data.email, { by: 'the parent, in the parent portal', now, extra: [{ path, remove: true }] });
}

// =====================================================================
// A TEACHER'S NEW SIGN-IN EMAIL (by the admin): same account, classes and password. Google sign-in with
// the OLD Gmail is unlinked; the new Gmail can sign in with Google from now on.
// =====================================================================
export async function changeStaffEmail(env, f, db, settings, { uid, teacherId, email, by }, now = new Date()) {
  const school = settings.schoolName || 'the school';
  const clean = String(email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'Not a valid email address.' };
  const prof = await db.get(`users/${uid}`);
  if (!prof) return { ok: false, error: 'This staff account was not found.' };
  const other = await findAccount(env, f, clean);
  if (other && other.localId !== uid) return { ok: false, error: 'That email already has a sign-in account.' };
  const old = prof.data.email ?? null;
  await authAdmin(env, f, 'accounts:update', { localId: uid, email: clean, deleteProvider: ['google.com'] });
  const tid = teacherId ?? prof.data.teacherId ?? null;
  const at = now.toISOString();
  await db.commit([
    { path: `users/${uid}`, patch: { email: clean } },
    ...(tid ? [{ path: `teachers/${tid}`, patch: { email: clean } }] : []),
    audit(`${by ?? 'the school office'}, school office`, 'staff.email', prof.data.name ?? '', `${old ?? 'none'} -> ${clean}`, at),
  ]);
  let mobile = prof.data.mobile;
  if (!mobile && tid) mobile = (await db.get(`teachers/${tid}`))?.data.mobile;
  const lines = (to) => [
    `The sign-in email of your Doorbell staff account at ${school} was changed from ${old ?? 'none'} to ${clean} by the school office.`,
    to === clean ? 'Sign in with this email and your current password, or with Google if it is a Gmail.' : 'This address can no longer be used to sign in.',
    'Did not ask for this? Tell the school office right away.',
  ];
  const sent = [
    await notice(env, f, db, settings, { email: old, name: prof.data.name, subject: `Your Doorbell sign-in email was changed (${school})`, lines: lines(old) }),
    await notice(env, f, db, settings, {
      to: parentKeyOf(mobile),
      email: clean,
      name: prof.data.name,
      text: `Doorbell: Your staff sign-in email at ${school} was changed to ${maskEmail(clean)}. Did not ask for this? Tell the school office.`,
      subject: `Your Doorbell sign-in email was changed (${school})`,
      lines: lines(clean),
    }),
  ];
  console.log('Staff email changed:', uid, sent.join('; '));
  return { ok: true, email: clean };
}

// =====================================================================
// CHANGES ASKED BY THE ADMIN (accountChanges/{id}, saved by the website; every minute, 2 at a time)
//   kind 'mobile'      = Admin -> Students -> Change number: { guardianId, mobile }
//   kind 'gmailNotice' = the admin changed or removed a parent's Gmail: { guardianId, oldEmail, newEmail }
//   kind 'staffEmail'  = Admin -> Teachers -> Change email: { uid, teacherId, email }
// =====================================================================
export async function processAccountChanges(env, fetchFn, settings, max = 2, now = new Date()) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return 'skipped (FIREBASE_SERVICE_ACCOUNT is not set)';
  const db = adminFirestore(env, fetchFn);
  const waiting = await db.query('accountChanges', [['state', 'EQUAL', 'new']], max);
  let done = 0;
  for (const c of waiting) {
    try {
      await db.commit([{ path: `accountChanges/${c.id}`, patch: { state: 'working' }, ifUpdateTime: c.updateTime }]);
    } catch {
      continue; // another run took it
    }
    let result;
    try {
      if (c.data.kind === 'mobile') {
        const r = await moveGuardianNumber(env, fetchFn, db, settings, c.data.guardianId, parentKeyOf(c.data.mobile), { by: `${c.data.by ?? 'the school office'}, school office`, now });
        result = r.ok ? 'done' : `failed: ${r.error}`;
      } else if (c.data.kind === 'gmailNotice') {
        const g = await db.get(`guardians/${c.data.guardianId}`);
        result = g ? `done: ${await gmailNotices(env, fetchFn, db, settings, { ...g.data, email: c.data.newEmail ?? null }, c.data.oldEmail ?? null, c.data.newEmail ?? null, `${c.data.by ?? 'the school office'}, school office`)}` : 'failed: guardian not found';
      } else if (c.data.kind === 'staffEmail') {
        const r = await changeStaffEmail(env, fetchFn, db, settings, c.data, now);
        result = r.ok ? 'done' : `failed: ${r.error}`;
      } else result = 'failed: unknown kind';
    } catch (e) {
      console.error('Account change failed:', c.id, e.message);
      result = `failed: ${e.message}`.slice(0, 200);
    }
    done += 1;
    await db.commit([{ path: `accountChanges/${c.id}`, patch: { state: 'done', result: String(result).slice(0, 300), doneAt: new Date().toISOString() } }]);
  }
  return { done };
}
