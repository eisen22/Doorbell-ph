// =====================================================================
// index.js — DOORBELL'S FREE SERVER (a Cloudflare Worker)
// ---------------------------------------------------------------------
// Runs every minute on Cloudflare's free plan (no Firebase Blaze plan needed):
//   1. sendQueuedSms():  when Settings -> How texts are sent = Semaphore, sends every text saved
//                        as 'queued' through Semaphore and marks it 'sent' or 'failed'.
//   3. sendMessageEmails(): every 5 minutes, 6 AM to 9 PM (Philippine time): emails a teacher or the school
//                        office "X sent you a message in Doorbell" when a message is still unread a few minutes
//                        later (Brevo, free plan; no message text in the email). Parents are not emailed.
//   2. dailyWork():      every 5 minutes, 6 AM to 6 PM, Monday to Saturday (Philippine time), even
//                        if nobody has Doorbell open, with the SAME rules as the website (src/engine.js):
//                          - a class a TEACHER confirmed: at the absence text time (end of first
//                            period) queues the "has not arrived" texts and the 3-day / limit texts
//                          - a class NOBODY confirmed: closed quietly after the class ends (no texts)
//                        The Worker never confirms a class in the morning: only a teacher does.
// It signs in to Firebase with a Doorbell gate account (see README.md), so firestore.rules
// decides what it may do, like for any user. Secrets (passwords, API key) are kept in Cloudflare.
// =====================================================================
import { Firestore } from './firestore.js';
import { sendPasswords } from './passwords.js';
import { Engine, emptyState } from '../../src/engine.js';
import { addDays, isSchoolDay, manilaTime, manilaToday, shouldAutoFinalize, classEnded, semesterOf, parentKeyOf } from '../../src/logic.js';

export default {
  // The schedule (wrangler.toml: every minute).
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(run(env, new Date(controller.scheduledTime)));
  },
  // Opening the Worker's address in a browser shows that it is alive (nothing secret is shown).
  async fetch() {
    return new Response('Doorbell worker is running. It sends Semaphore texts and auto-confirms classes on a schedule.\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};

export async function run(env, now = new Date(), fetchFn = (...args) => fetch(...args)) {
  const db = new Firestore(env, fetchFn);
  const report = { sms: null, confirm: null };
  // The class work runs every 5 minutes during school hours (fewer database reads).
  const hour = Number(manilaTime(now).slice(0, 2));
  const weekday = new Date(`${manilaToday(now)}T12:00:00+08:00`).getUTCDay(); // 0 = Sunday
  const classMinute = now.getUTCMinutes() % 5 === 0 && hour >= 6 && hour <= 18 && weekday !== 0;
  // New passwords by text (worker/src/passwords.js): every minute except the class-work minutes.
  // Each one uses about 8 of the 50 web requests a run may make, so fewer texts are sent that minute.
  let passwordWork = false;
  // The settings are read once per run and shared (each read counts toward the free 50,000 a day).
  let settings = null;
  try {
    settings = (await db.get('meta/school'))?.data.settings ?? {};
  } catch (e) {
    console.error('Settings not read:', e.message);
  }
  if (!classMinute && settings) {
    try {
      report.passwords = await sendPasswords(env, fetchFn, settings);
      passwordWork = typeof report.passwords === 'object' && report.passwords.done + report.passwords.failed + report.passwords.skipped > 0;
    } catch (e) {
      console.error('Password step failed:', e.message);
    }
  }
  try {
    // Cloudflare's free plan allows 50 web requests per run, and each text needs 3 of them:
    // 14 texts on a normal minute, 6 on the minutes that also do the class work or send passwords.
    report.sms = await sendQueuedSms(db, env, fetchFn, classMinute || passwordWork ? 6 : 14, settings);
  } catch (e) {
    console.error('SMS step failed:', e.message);
  }
  if (classMinute) {
    try {
      report.confirm = await dailyWork(db, now);
    } catch (e) {
      console.error('Class step failed:', e.message);
    }
  }
  // Email alerts: 2 minutes after the class work's minutes (so they don't share a run), 6 AM to 9 PM.
  if (now.getUTCMinutes() % 5 === 2 && hour >= 6 && hour <= 21) {
    try {
      report.email = await sendMessageEmails(db, env, fetchFn, now);
    } catch (e) {
      console.error('Email step failed:', e.message);
    }
  }
  return report;
}

/* =====================================================================
   3. EMAIL ALERTS FOR NEW MESSAGES (teachers and the school office only)
   The website saves mailQueue/{threadId}_{key} when someone writes in a conversation (src/messaging.js) and
   deletes it when that person opens the conversation. One still there after WAIT_MINUTES -> one email
   through Brevo (BREVO_API_KEY and EMAIL_FROM are Cloudflare secrets), then it is deleted. The email says who
   wrote and about which child, never the message itself (the people in the conversation read it in Doorbell).
   ===================================================================== */
const WAIT_MINUTES = 5;
const MAX_EMAILS_PER_RUN = 10; // Cloudflare allows 50 web requests per run (Brevo's free plan: 300 emails a day)
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export async function sendMessageEmails(db, env, fetchFn, now = new Date()) {
  if (!env.BREVO_API_KEY || !env.EMAIL_FROM) return 'skipped (BREVO_API_KEY or EMAIL_FROM is not set)';
  const cutoff = new Date(now.getTime() - WAIT_MINUTES * 60_000).toISOString();
  const due = await db.query('mailQueue', [['at', 'LESS_THAN_OR_EQUAL', cutoff]], MAX_EMAILS_PER_RUN);
  if (!due.length) return { sent: 0 };
  const school = (await db.get('meta/school'))?.data?.settings ?? {};
  const teacherIds = [...new Set(due.map((q) => q.data.to).filter((k) => k?.startsWith('t:')).map((k) => k.slice(2)))];
  const teachers = await db.getMany(teacherIds.map((id) => `teachers/${id}`));
  const site = (env.SITE_URL ?? '').replace(/\/$/, '');
  let sent = 0;
  let skipped = 0;
  const done = [];
  for (const { id, data: q } of due) {
    done.push({ path: `mailQueue/${id}`, remove: true });
    let email = '';
    let name = '';
    if (q.to === 'office') {
      email = school.officeEmail ?? '';
      name = 'School office';
    } else {
      const t = teachers.get(`teachers/${q.to.slice(2)}`);
      if (t && t.active !== false && t.emailAlerts !== false) {
        email = t.email ?? '';
        name = t.name ?? '';
      }
    }
    // No email on file, alerts turned off, the teacher left, or a made-up sample address (they would bounce).
    if (!/^\S+@\S+\.\S+$/.test(email) || /@sunnyside\.edu\.ph$/i.test(email)) {
      skipped += 1;
      continue;
    }
    const who = q.fromName || 'Someone';
    const about = q.studentName ? ` about ${q.studentName}` : '';
    const link = site ? `${site}/${q.to === 'office' ? 'admin/messages' : 'messages'}?t=${encodeURIComponent(q.threadId)}` : '';
    const subject = `New message from ${who} in Doorbell`;
    const text = `${who} sent you a message in Doorbell${about}.\n\nOpen Doorbell to read and reply${link ? `: ${link}` : '.'}\n\n${school.schoolName ?? ''}\nThis is an automatic alert. ${q.to === 'office' ? 'The admin can turn it off in Settings.' : 'You can turn these emails off in Doorbell -> Settings.'}`;
    const html = `<p><b>${escapeHtml(who)}</b> sent you a message in Doorbell${escapeHtml(about)}.</p>
<p>${link ? `<a href="${escapeHtml(link)}">Open Doorbell to read and reply</a>` : 'Open Doorbell to read and reply.'}</p>
<p style="color:#666;font-size:12px">${escapeHtml(school.schoolName ?? '')}<br>This is an automatic alert. The message itself is only in Doorbell. ${
      q.to === 'office' ? 'The admin can turn it off in Settings.' : 'You can turn these emails off in Doorbell &rarr; Settings.'
    }</p>`;
    const res = await fetchFn('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', 'api-key': env.BREVO_API_KEY },
      body: JSON.stringify({
        sender: { name: `Doorbell${school.schoolName ? ` · ${school.schoolName}` : ''}`.slice(0, 70), email: env.EMAIL_FROM },
        to: [{ email, name }],
        subject,
        textContent: text,
        htmlContent: html,
      }),
    });
    if (res.ok) sent += 1;
    else {
      // Not sent (e.g. the daily limit): keep it for the next run, unless Brevo refused the address itself.
      const why = await res.text().catch(() => '');
      console.error('Brevo refused an email:', res.status, why.slice(0, 200));
      if (res.status === 429 || res.status >= 500) done.pop();
      else skipped += 1;
    }
  }
  if (done.length) await db.commit(done);
  return { due: due.length, sent, skipped };
}

/* =====================================================================
   1. SEND QUEUED TEXTS THROUGH SEMAPHORE
   ===================================================================== */
// '+639171234567' or '0917 123 4567' -> '639171234567'. null if not a PH mobile number.
export function toSemaphoreNumber(to) {
  const digits = String(to ?? '').replace(/[^\d]/g, '');
  const m = digits.match(/^(?:63|0)?(9\d{9})$/);
  return m ? `63${m[1]}` : null;
}

async function sendQueuedSms(db, env, fetchFn, batch = 14, preloaded = null) {
  const settings = preloaded ?? (await db.get('meta/school'))?.data.settings ?? {};
  if (settings.smsProvider !== 'semaphore') return 'skipped (Semaphore is not chosen in Settings)';
  if (!env.SEMAPHORE_API_KEY) throw new Error('SEMAPHORE_API_KEY secret is missing');
  const queued = await db.query('sms', [['status', 'EQUAL', 'queued']], batch);
  let sent = 0;
  let failed = 0;
  // A text left as 'sending' for over 5 minutes was interrupted (the Worker stopped mid-way). It may or
  // may not have gone out, so it is not sent again by itself: it is marked failed and staff can Resend.
  for (const m of await db.query('sms', [['status', 'EQUAL', 'sending']], 5)) {
    if (Date.now() - new Date(m.updateTime).getTime() < 5 * 60_000) continue;
    await db.commit([{ path: `sms/${m.id}`, patch: { status: 'failed', error: 'Sending was interrupted. Press Resend if the parent did not get it.', failedAt: new Date().toISOString() } }]).catch(() => {});
    failed += 1;
  }
  // SAFETY: a text for a child may only go to THAT child's guardian's number on file. This stops anyone
  // with a staff or gate sign-in from using the school's sender name to text other numbers.
  const guardianIds = [...new Set(queued.filter((m) => m.data.studentId).map((m) => m.data.guardianId).filter(Boolean))];
  const guardians = await db.getMany(guardianIds.map((id) => `guardians/${id}`));
  const onFile = (m) => {
    if (!m.data.studentId) return m.data.kind === 'test'; // the admin's test text (firestore.rules: admin only)
    const g = guardians.get(`guardians/${m.data.guardianId}`);
    return !!g && (g.studentIds ?? []).includes(m.data.studentId) && parentKeyOf(g.mobile) === parentKeyOf(m.data.to);
  };
  for (const m of queued) {
    // Claim it: only works if nobody changed it since we read it, so a text is never sent twice.
    try {
      await db.commit([{ path: `sms/${m.id}`, patch: { status: 'sending' }, ifUpdateTime: m.updateTime }]);
    } catch {
      continue;
    }
    const fail = async (reason) => {
      failed += 1;
      const writes = [{ path: `sms/${m.id}`, patch: { status: 'failed', error: reason, failedAt: new Date().toISOString() } }];
      if (m.data.studentId) {
        const nid = `smsf_${m.id}`;
        writes.push({
          path: `notifications/${nid}`,
          data: {
            id: nid, kind: 'sms_failed', studentId: m.data.studentId, sectionId: m.data.sectionId ?? null,
            createdAt: m.data.createdAt ?? new Date().toISOString(), read: false,
            title: 'A text to a guardian did not go through',
            body: `Semaphore said: ${reason}. Check the number on the Students page, then press Resend.`,
          },
        });
      }
      await db.commit(writes);
    };
    if (!onFile(m)) {
      await fail(`"${m.data.to}" is not this child's guardian number on file`);
      continue;
    }
    const number = toSemaphoreNumber(m.data.to);
    if (!number) {
      await fail(`"${m.data.to}" is not a Philippine mobile number`);
      continue;
    }
    const form = new URLSearchParams({ apikey: env.SEMAPHORE_API_KEY, number, message: m.data.body ?? '' });
    if (settings.senderName) form.set('sendername', settings.senderName);
    let res, text, json;
    try {
      res = await fetchFn('https://api.semaphore.co/api/v4/messages', { method: 'POST', body: form });
      text = await res.text();
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    } catch (e) {
      // Could not reach Semaphore: put it back in the queue for the next minute.
      await db.commit([{ path: `sms/${m.id}`, patch: { status: 'queued' } }]);
      continue;
    }
    const first = Array.isArray(json) ? json[0] : null;
    if (!res.ok || !first?.message_id) {
      const parts = json && typeof json === 'object' ? Object.values(json).flat().map(String) : [];
      await fail(parts.length ? parts.join(' ').slice(0, 300) : `Semaphore answered ${res.status}: ${String(text).slice(0, 200)}`);
      continue;
    }
    await db.commit([
      {
        path: `sms/${m.id}`,
        patch: { status: 'sent', provider: 'semaphore', providerId: String(first.message_id), providerStatus: first.status ?? '', sentAt: new Date().toISOString(), error: null },
      },
    ]);
    sent += 1;
  }
  return { queued: queued.length, sent, failed };
}

/* =====================================================================
   2. THE CLASS WORK (no morning auto-confirm: only a teacher confirms a class)
   For today: classes a teacher confirmed get their absence step once the absence text time passes.
   For today and the last 7 days: classes nobody confirmed are closed quietly after they end.
   ===================================================================== */
async function dailyWork(db, now) {
  const today = manilaToday(now);
  const time = manilaTime(now);
  const [school, cal, secs] = await Promise.all([db.get('meta/school'), db.get('meta/calendar'), db.query('sections')]);
  const meta = school?.data;
  if (!meta?.schoolYear) return 'no school year yet';
  const days = cal?.data.days ?? [];
  const calendar = new Map(days.map((c) => [c.date, c]));
  const sections = secs.map((s) => ({ ...s.data, id: s.id })).filter((s) => !s.archived && s.schedule);
  // The school-wide times (Settings: gate opens, first period length) and each class's grade level are
  // copied into every schedule, exactly like the website does (engine.normalizeSection).
  const norm = new Engine('cloud', emptyState(meta, days), { put() {}, remove() {} }, {}, { today: () => today, peek: () => time });
  sections.forEach((s) => norm.normalizeSection(s));

  // 1. Which class days need work?
  // Today on every run; the last 7 days (classes nobody confirmed) only once an hour, at :00. Each
  // class day checked is one read, so looking back every 5 minutes used most of the free daily reads.
  const back = now.getUTCMinutes() < 5 ? 7 : 0;
  const due = [];
  for (const sec of sections) {
    for (let i = back; i >= 0; i--) {
      const d = addDays(today, -i);
      if (d < meta.schoolYear.start || d > meta.schoolYear.end || !isSchoolDay(d, sec.schedule, calendar)) continue;
      due.push({ sec, d });
    }
  }
  if (!due.length) return { closed: 0, absence: 0 };
  const have = await db.getMany([
    ...due.map(({ sec, d }) => `confirmations/${sec.id}_${d}`),
    ...due.filter(({ d }) => d === today).map(({ sec }) => `notifications/absrun_${sec.id}_${today}`), // "absence step done" markers
  ]);
  const confOf = ({ sec, d }) => have.get(`confirmations/${sec.id}_${d}`);
  const toClose = due.filter((x) => !confOf(x) && (x.d < today || classEnded(time, x.sec.schedule)));
  const toText = due.filter(
    (x) => x.d === today && confOf(x) && !confOf(x).auto && shouldAutoFinalize(time, x.sec.schedule) && !have.has(`notifications/absrun_${x.sec.id}_${today}`),
  );
  if (!toClose.length && !toText.length) return { closed: 0, absence: 0 };

  // 2. Load what the engine needs, only for those classes (keeps the Worker fast): children, guardians,
  //    placements, attendance since the semester started (at least the last 60 days) for the 3-day and
  //    limit rules, and the texts and alerts already made (so nothing is sent twice).
  const semStart = semesterOf(today, meta.schoolYear, meta.settings?.semester2Start).from;
  const since = semStart < addDays(today, -60) ? semStart : addDays(today, -60);
  const span = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${since}T00:00:00Z`)) / 86400000);
  const ids = [...new Set([...toClose, ...toText].map(({ sec }) => sec.id))];
  const bySection = async (col) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 30) out.push(...(await db.query(col, [['sectionId', 'IN', ids.slice(i, i + 30)]])));
    return out;
  };
  const dayStart = `${today}T00:00:00+08:00`;
  const [students, guardians, enrollments, attendance, teachers, excuses, smsToday, smsTotals, notesToday, notesTotals] = await Promise.all([
    db.query('students'),
    db.query('guardians'),
    bySection('enrollments'),
    // Attendance documents are named <section>_<date> (like the website), so they are fetched by
    // name: no Firestore index needed, and missing days are simply skipped.
    db.getMany(ids.flatMap((id) => Array.from({ length: span + 1 }, (_, i) => `attendance/${id}_${addDays(since, i)}`))),
    // For the parent portal months (teacher's name) and the excuses the teacher already approved.
    db.query('teachers'),
    db.query('excuses', [['status', 'EQUAL', 'approved']]).catch(() => []), // none if the rules are older than the portal
    db.query('sms', [['createdAt', 'GREATER_THAN_OR_EQUAL', dayStart]]),
    db.query('sms', [['kind', 'EQUAL', 'total']]),
    db.query('notifications', [['createdAt', 'GREATER_THAN_OR_EQUAL', dayStart]]),
    db.query('notifications', [['kind', 'EQUAL', 'total']]),
  ]);
  const writes = new Map();
  const persistence = {
    put: (col, id, data) => writes.set(`${col}/${id}`, JSON.parse(JSON.stringify(data))),
    remove: () => {},
  };
  const clock = { today: () => today, peek: () => time, scanTime: () => time, simulated: () => false };
  const engine = new Engine('cloud', emptyState(meta, days), persistence, {}, clock);
  sections.forEach((s) => engine.s.sections.set(s.id, s));
  for (const [map, rows] of [
    [engine.s.students, students],
    [engine.s.guardians, guardians],
    [engine.s.enrollments, enrollments],
    [engine.s.teachers, teachers],
    [engine.s.excuses, excuses],
    [engine.s.sms, [...smsToday, ...smsTotals]],
    [engine.s.notifications, [...notesToday, ...notesTotals]],
  ])
    rows.forEach((r) => map.set(r.id, { ...r.data, id: r.data.id ?? r.id }));
  for (const [path, data] of attendance) engine.s.attendance.set(path.split('/')[1], { ...data, id: path.split('/')[1] });
  for (const [path, data] of have) if (path.startsWith('confirmations/')) engine.s.confirmations.set(path.split('/')[1], data);

  // 3. Do the work.
  for (const { sec, d } of toClose) engine.finalize(sec.id, d, 'Not confirmed', true, `${d}T${sec.schedule.endTime}:00+08:00`);
  for (const { sec, d } of toText) engine.runAbsence(sec, d);

  // 4. Save everything.
  await db.commit([...writes].map(([path, data]) => ({ path, data })));
  console.log(
    `Closed (nobody confirmed): ${toClose.map(({ sec, d }) => `${sec.name} ${d}`).join(', ') || 'none'}. Absence texts: ${toText.map(({ sec }) => sec.name).join(', ') || 'none'}. (${writes.size} writes)`,
  );
  return { closed: toClose.length, absence: toText.length, writes: writes.size };
}
