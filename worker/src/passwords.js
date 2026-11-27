// =====================================================================
// passwords.js — NEW PASSWORDS SENT BY TEXT AND EMAIL (parents and staff)
// ---------------------------------------------------------------------
// Only a trusted server may give someone else's account a new password. The Worker does it with the
// Firebase SERVICE ACCOUNT key (Cloudflare secret FIREBASE_SERVICE_ACCOUNT, the whole JSON file):
//   1. adminToken(): signs a short note with the key and trades it for a Google access token.
//   2. Firebase Authentication's admin addresses: find an account, create one, set its password.
// The website asks for a password by saving passwordRequests/{p_<number> | s_<email>}:
//   reason 'new'    = the admin added a parent (or a teacher/admin with a mobile number): welcome text
//   reason 'admin'  = the admin pressed "Send new password"
//   reason 'forgot' = "Forgot password?" from an older copy of the website (the website now asks the Worker
//                     directly, account.js forgotPassword): handled the same way
// The password is made here and goes straight to Semaphore: it is never saved in Firestore. The SMS
// log keeps the text with the password hidden.
// EMAIL (Brevo, BREVO_API_KEY and EMAIL_FROM): when the account has a real email address (a parent's Gmail,
// or a teacher's or admin's sign-in email), a new account ('new') and "Send new password" ('admin') also
// email the password. A new staff account's email also has a link to confirm the address (Firebase).
// "Forgot password?" (account.js): an account with a Gmail or real email gets a link to choose a new
// password itself; without one, a new password by text (forParent / forStaff with reason 'forgot').
// =====================================================================
import { Firestore } from './firestore.js';
import { parentEmail, parentKeyOf, isRealEmail } from '../../src/logic.js';
import { forgotPassword } from './account.js';

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const utf8 = (s) => new TextEncoder().encode(s);

// The access token lasts an hour; Cloudflare may keep this copy between runs.
let cached = { token: null, until: 0 };

/** A Google access token for the service account (Firebase Authentication + Firestore, no security rules). */
export async function adminToken(env, fetchFn) {
  if (cached.token && Date.now() < cached.until) return cached.token;
  let sa;
  try {
    sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT is not the service account JSON file');
  }
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri ?? 'https://oauth2.googleapis.com/token';
  const head = b64url(utf8(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const body = b64url(
    utf8(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud, iat: now, exp: now + 3600 })),
  );
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, utf8(`${head}.${body}`)));
  const res = await fetchFn(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${body}.${b64url(sig)}` }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) throw new Error(`Service account sign-in failed: ${json.error_description ?? json.error ?? res.status}`);
  cached = { token: json.access_token, until: Date.now() + (Number(json.expires_in ?? 3600) - 300) * 1000 };
  return cached.token;
}

/** Firestore with the service account (used for passwordRequests, parents/{uid} and the SMS log). */
export const adminFirestore = (env, fetchFn) => new Firestore(env, fetchFn, () => adminToken(env, fetchFn));

export async function authAdmin(env, fetchFn, path, payload) {
  const res = await fetchFn(`https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await adminToken(env, fetchFn)}` },
    body: JSON.stringify(payload),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Firebase Authentication: ${json.error?.message ?? res.status}`);
  return json;
}
export const findAccount = async (env, f, email) => (await authAdmin(env, f, 'accounts:lookup', { email: [email] })).users?.[0] ?? null;
// A new password also signs the account out on every other device (validSince = now).
export const setPassword = (env, f, localId, password) =>
  authAdmin(env, f, 'accounts:update', { localId, password, validSince: String(Math.floor(Date.now() / 1000)) });
export const createAccount = async (env, f, email, password) => (await authAdmin(env, f, 'accounts', { email, password })).localId;

/** 8 characters, small letters and digits, without look-alikes (0/o, 1/l/i). */
export function newPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const n = crypto.getRandomValues(new Uint32Array(8));
  return [...n].map((x) => abc[x % abc.length]).join('');
}

export const HIDDEN = '••••••••';
const TEXTS = {
  parentNew: {
    en: (s, pw) => `Doorbell: Your parent portal account for ${s} is ready. Sign in with this mobile number and the password: ${pw}`,
    fil: (s, pw) => `Doorbell: Handa na ang inyong account sa parent portal ng ${s}. Mag-sign in gamit ang numerong ito at ang password: ${pw}`,
  },
  parentReset: {
    en: (s, pw) => `Doorbell: Your parent portal password was reset. Your new password is: ${pw}. Did not ask for this? Contact ${s}.`,
    fil: (s, pw) => `Doorbell: Na-reset ang inyong password sa parent portal. Ang bagong password ay: ${pw}. Hindi kayo ang humiling? Makipag-ugnayan sa ${s}.`,
  },
  staffNew: (s, email, pw) => `Doorbell: Your ${s} staff account is ready. Sign in with ${email} and the password: ${pw}`,
  staffReset: (s, email, pw) => `Doorbell: The password for ${email} was reset. Your new password is: ${pw}. Did not ask for this? Tell the school office.`,
};

/**
 * Handles waiting password requests (at most `max` per run: each one needs about 8 web requests).
 * settings = the school's settings (meta/school).
 */
export async function sendPasswords(env, fetchFn, settings, max = 2) {
  if (!env.FIREBASE_SERVICE_ACCOUNT) return 'skipped (FIREBASE_SERVICE_ACCOUNT is not set)';
  const db = adminFirestore(env, fetchFn);
  const report = { done: 0, skipped: 0, failed: 0 };
  // Texts with a password waiting for the gate phone: hide the password once they are sent.
  if (settings.smsProvider === 'phone') {
    const fix = (await db.query('sms', [['secret', 'EQUAL', true]], 10)).filter((m) => ['sent', 'failed'].includes(m.data.status));
    if (fix.length) await db.commit(fix.map((m) => ({ path: `sms/${m.id}`, patch: { body: m.data.hiddenBody ?? HIDDEN, hiddenBody: null, secret: false } })));
  }
  const waiting = await db.query('passwordRequests', [['state', 'EQUAL', 'new']], max);
  const school = settings.schoolName || 'the school';
  for (const r of waiting) {
    try {
      await db.commit([{ path: `passwordRequests/${r.id}`, patch: { state: 'working' }, ifUpdateTime: r.updateTime }]);
    } catch {
      continue; // another run took it
    }
    let result;
    try {
      result =
        r.data.reason === 'forgot'
          ? await forgotPassword(env, fetchFn, db, settings, { who: r.data.who, id: r.data.login })
          : r.data.who === 'parent'
            ? await forParent(env, fetchFn, db, settings, school, r.data)
            : await forStaff(env, fetchFn, db, settings, school, r.data);
    } catch (e) {
      console.error('Password request failed:', r.id, e.message);
      result = `failed: ${e.message}`.slice(0, 200);
    }
    if (result === 'sent') report.done += 1;
    else if (String(result).startsWith('failed')) report.failed += 1;
    else report.skipped += 1;
    await db.commit([{ path: `passwordRequests/${r.id}`, patch: { state: 'done', result, doneAt: new Date().toISOString() } }]);
  }
  return report;
}

export async function forParent(env, f, db, settings, school, req) {
  const key = parentKeyOf(req.login);
  const pk = key ? await db.get(`parentKeys/${key}`) : null;
  if (!pk) return 'not a registered parent number'; // nothing is said on the sign-in page either way
  const g = pk.data.guardianId ? await db.get(`guardians/${pk.data.guardianId}`) : null;
  const lang = g?.data.preferredLanguage === 'fil' ? 'fil' : 'en';
  const email = parentEmail(key);
  const password = newPassword();
  const found = await findAccount(env, f, email);
  const uid = found ? found.localId : await createAccount(env, f, email, password);
  if (found) await setPassword(env, f, uid, password);
  const writes = [];
  // The account's parent profile (what firestore.rules looks at); made here for a new account.
  if (!found || !(await db.get(`parents/${uid}`))) {
    writes.push({ path: `parents/${uid}`, data: { mobile: key, defaultPassword: false, createdAt: new Date().toISOString() } });
  }
  const make = (req.reason === 'new' ? TEXTS.parentNew : TEXTS.parentReset)[lang];
  const texted = await deliver(env, f, db, settings, writes, {
    to: key,
    body: make(school, password),
    hidden: make(school, HIDDEN),
    extra: { guardianId: g?.id ?? null, studentId: g?.data.studentIds?.[0] ?? null },
  });
  // The parent's Gmail (optional, Admin -> Students): the same password by email, for a new account or "Send new password".
  const gmail = g?.data.email;
  if (req.reason === 'forgot' || !isRealEmail(gmail)) return texted;
  const mobile = `${key.slice(0, 4)} ${key.slice(4, 7)} ${key.slice(7)}`;
  const mailed = await sendEmail(env, f, settings, {
    to: gmail,
    name: g.data.name ?? '',
    subject: req.reason === 'new' ? `Your Doorbell parent portal account (${school})` : `Your new Doorbell parent portal password (${school})`,
    lines: [
      req.reason === 'new'
        ? `This email confirms that your parent portal account for ${school} has been created.`
        : `Your parent portal password for ${school} was reset by the school.`,
      `Sign in with your mobile number ${mobile} and this temporary password: ${password}`,
      'You can also sign in with Google using this Gmail address.',
      'Please change the password after you sign in. The same password was also sent by text to your mobile number.',
    ],
    path: '/parent',
  });
  return combine(texted, mailed);
}

// "sent", or "sent (text failed...)" when one of the two went through.
const combine = (texted, mailed) => {
  if (mailed === 'sent' && texted === 'sent') return 'sent';
  if (mailed === 'sent') return `sent by email (text: ${texted})`.slice(0, 200);
  if (texted === 'sent') return mailed === 'skipped' ? 'sent' : `sent by text (email: ${mailed})`.slice(0, 200);
  return `failed: text ${texted}; email ${mailed}`.slice(0, 200);
};

/**
 * One email through Brevo with the temporary password (and, for a new staff account, the "confirm your
 * email" link). Returns 'sent', 'skipped' (Brevo not set up) or 'failed: ...'.
 */
export async function sendEmail(env, f, settings, { to, name, subject, lines, link, linkLabel = 'Confirm this email address', path }) {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM) return 'skipped';
  const site = (env.SITE_URL ?? '').replace(/\/$/, '');
  const school = settings.schoolName ?? '';
  const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const signIn = site ? `${site}${path ?? '/login'}` : '';
  const text = [
    ...lines,
    ...(link ? ['', `${linkLabel}: ${link}`] : []),
    ...(signIn ? ['', `Open Doorbell: ${signIn}`] : []),
    '',
    `Did not expect this email? Contact ${school || 'the school office'}.`,
  ].join('\n');
  const html = `${lines.map((l) => `<p>${esc(l)}</p>`).join('')}${
    link ? `<p><a href="${esc(link)}" style="display:inline-block;padding:10px 16px;background:#1f2d3d;color:#fff;border-radius:8px;text-decoration:none">${esc(linkLabel)}</a></p>` : ''
  }${signIn ? `<p><a href="${esc(signIn)}">Open Doorbell</a></p>` : ''}<p style="color:#666;font-size:12px">Did not expect this email? Contact ${esc(school || 'the school office')}.</p>`;
  const res = await f('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': env.BREVO_API_KEY },
    body: JSON.stringify({
      sender: { name: `Doorbell${school ? ` · ${school}` : ''}`.slice(0, 70), email: env.EMAIL_FROM },
      to: [{ email: to, name }],
      subject,
      textContent: text,
      htmlContent: html,
    }),
  }).catch(() => null);
  if (res?.ok) return 'sent';
  return `failed: Brevo answered ${res?.status ?? 'nothing'}`;
}

// Firebase's "confirm your email address" link for a staff account (marks the email as verified when opened).
async function verifyLink(env, f, email) {
  const site = (env.SITE_URL ?? '').replace(/\/$/, '');
  const ask = (extra) => authAdmin(env, f, 'accounts:sendOobCode', { requestType: 'VERIFY_EMAIL', email, returnOobLink: true, ...extra });
  try {
    return (await ask(site ? { continueUrl: `${site}/login` } : {})).oobLink ?? null;
  } catch {
    // e.g. the website's address is not in Firebase's authorized domains: the link still works without it.
    return (await ask({}).catch(() => null))?.oobLink ?? null;
  }
}

export async function forStaff(env, f, db, settings, school, req) {
  const email = String(req.login).trim().toLowerCase();
  const found = await findAccount(env, f, email);
  if (!found) return 'no account with this email';
  const profile = await db.get(`users/${found.localId}`);
  if (!profile || !['admin', 'teacher'].includes(profile.data.role)) return 'not a teacher or admin account';
  let mobile = profile.data.mobile;
  if (!mobile && profile.data.teacherId) mobile = (await db.get(`teachers/${profile.data.teacherId}`))?.data.mobile;
  const to = parentKeyOf(mobile);
  // By email too: a real address, Brevo set up, and not "Forgot password?" (an account with a real email gets a
  // reset link instead, account.js; this text-only path is for staff without one).
  const byEmail = req.reason !== 'forgot' && isRealEmail(email) && !!(env.BREVO_API_KEY && env.EMAIL_FROM);
  if (!to && !byEmail) return 'no mobile number or email to send it to'; // the password is NOT changed
  const password = newPassword();
  await setPassword(env, f, found.localId, password);
  const make = req.reason === 'new' ? TEXTS.staffNew : TEXTS.staffReset;
  const texted = to ? await deliver(env, f, db, settings, [], { to, body: make(school, email, password), hidden: make(school, email, HIDDEN), extra: {} }) : 'skipped';
  if (!byEmail) return texted;
  const link = req.reason === 'new' && !found.emailVerified ? await verifyLink(env, f, email) : null;
  const mailed = await sendEmail(env, f, settings, {
    to: email,
    name: profile.data.name ?? '',
    subject: req.reason === 'new' ? `Your Doorbell staff account (${school})` : `Your new Doorbell password (${school})`,
    lines: [
      req.reason === 'new'
        ? `This email confirms that your ${school} staff account in Doorbell has been created.`
        : `Your Doorbell password for ${school} was reset by the school.`,
      `Sign in with ${email} and this temporary password: ${password}`,
      ...(/@gmail\.com$/i.test(email) ? ['You can also sign in with Google using this Gmail address.'] : []),
      `Please change the password after you sign in (Settings, Your password).${to ? ' The same password was also sent by text.' : ''}`,
    ],
    link,
    path: '/login',
  });
  return to ? combine(texted, mailed) : mailed === 'sent' ? 'sent' : mailed;
}

// Sends the text and keeps a copy in the SMS log with the password hidden.
export async function deliver(env, f, db, settings, writes, { to, body, hidden, extra }) {
  const id = `pw_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();
  const log = { id, to, kind: 'password', createdAt: now, queuedAt: now, attempts: 1, ...extra };
  if (settings.smsProvider === 'semaphore') {
    if (!env.SEMAPHORE_API_KEY) throw new Error('SEMAPHORE_API_KEY secret is missing');
    const form = new URLSearchParams({ apikey: env.SEMAPHORE_API_KEY, number: `63${to.slice(1)}`, message: body });
    if (settings.senderName) form.set('sendername', settings.senderName);
    const res = await f('https://api.semaphore.co/api/v4/messages', { method: 'POST', body: form });
    const json = await res.json().catch(() => null);
    const first = Array.isArray(json) ? json[0] : null;
    const ok = res.ok && first?.message_id;
    writes.push({
      path: `sms/${id}`,
      data: ok
        ? { ...log, body: hidden, status: 'sent', provider: 'semaphore', providerId: String(first.message_id), sentAt: now }
        : { ...log, body: hidden, status: 'failed', error: `Semaphore answered ${res.status}`, failedAt: now },
    });
    await db.commit(writes);
    return ok ? 'sent' : `failed: Semaphore answered ${res.status}`;
  }
  if (settings.smsProvider === 'phone') {
    // The gate phone sends it; the password is hidden in the log after it goes out (sendPasswords).
    writes.push({ path: `sms/${id}`, data: { ...log, body, hiddenBody: hidden, secret: true, status: 'queued' } });
    await db.commit(writes);
    return 'sent';
  }
  // Simulated texts (testing): nothing goes out, so the log shows the password for the tester.
  writes.push({ path: `sms/${id}`, data: { ...log, body, status: 'sent', provider: 'simulated', sentAt: now } });
  await db.commit(writes);
  return 'sent';
}
