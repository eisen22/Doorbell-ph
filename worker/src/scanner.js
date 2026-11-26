// =====================================================================
// scanner.js — THE GATE SCANNER (ESP32 + GM65) TALKS TO THE WORKER, NOT TO FIREBASE
// ---------------------------------------------------------------------
// The scanner at the gate never holds Firebase access. Each scanner has its own scanner key, made by the
// admin in Settings -> Gate scanners (only a SHA-256 hash of the key is saved, in scanners/{id}).
// The scanner sends the key in the "Authorization: Bearer <key>" header:
//
//   GET  /scanner/cards  -> { hashes: [...] } the SHA-256 of every valid card code. The scanner keeps this
//                           list in its own memory, so it can check a card and beep at once, even when the
//                           Wi-Fi is slow or down. (Hashes, not the codes: a copied list cannot make cards.)
//   POST /scanner/scan   -> body { code, at? }: records one scan, with the same rules as the website
//                           (src/engine/attendance.js recordScan) and the Doorbell Gate phone app.
//                           at = when the card was scanned (ISO time), for scans kept on the scanner while
//                           it was offline and uploaded later. Scans from an earlier day are not recorded.
//
// A copied key can only submit scans and download card hashes. The admin cancels it in Settings and
// issues a new one. Scans are saved field by field (only this child's record), so two scans of the same
// class at the same moment never overwrite each other.
// =====================================================================
import { Firestore, fp } from './firestore.js';
import { Engine, emptyState } from '../../src/engine.js';
import { addDays, decideScan, isSchoolDay, manilaTime, manilaToday, to12h, toMinutes } from '../../src/logic.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Kept in the Worker's memory for a few minutes (fewer database reads; each read counts toward the free 50,000 a day).
const cache = { meta: null, metaAt: 0, cards: null, cardsAt: 0 };
const META_MS = 5 * 60_000;
const CARDS_MS = 15 * 60_000;

async function loadMeta(db) {
  if (cache.meta && Date.now() - cache.metaAt < META_MS) return cache.meta;
  const [school, cal] = await Promise.all([db.get('meta/school'), db.get('meta/calendar')]);
  cache.meta = { meta: school?.data ?? null, days: cal?.data?.days ?? [] };
  cache.metaAt = Date.now();
  return cache.meta;
}

// Which scanner is this? null if the key is missing, wrong or cancelled.
async function scannerOf(db, request, now) {
  const key = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (key.length < 20) return null;
  const rows = await db.query('scanners', [['keyHash', 'EQUAL', await sha256Hex(key)]], 1);
  const s = rows[0];
  if (!s || s.data.active === false) return null;
  // "Last seen" in Settings, saved at most every 10 minutes (fewer writes).
  if (!s.data.lastSeenAt || now - new Date(s.data.lastSeenAt) > 10 * 60_000) {
    await db.commit([{ path: `scanners/${s.id}`, patch: { lastSeenAt: now.toISOString() } }]).catch(() => {});
  }
  return { id: s.id, name: s.data.name ?? 'Gate scanner' };
}

export async function handleScanner(request, env, fetchFn = (...a) => fetch(...a), now = new Date()) {
  const url = new URL(request.url);
  const db = new Firestore(env, fetchFn);
  let scanner;
  try {
    scanner = await scannerOf(db, request, now);
  } catch (e) {
    console.error('Scanner check failed:', e.message);
    return json({ ok: false, result: 'server_error' }, 503);
  }
  if (!scanner) return json({ ok: false, result: 'bad_key' }, 401);
  try {
    if (request.method === 'GET' && url.pathname === '/scanner/cards') return json(await cardList(db));
    if (request.method === 'POST' && url.pathname === '/scanner/scan') {
      const body = await request.json().catch(() => ({}));
      return json(await recordGateScan(db, scanner, String(body.code ?? ''), body.at, now));
    }
    return json({ ok: false, result: 'not_found' }, 404);
  } catch (e) {
    console.error('Scan failed:', e.message);
    // 503: the scanner keeps the scan and tries again later.
    return json({ ok: false, result: 'server_error' }, 503);
  }
}

// The SHA-256 of every card that may enter (revoked cards and old copies of lost cards are left out).
async function cardList(db) {
  if (cache.cards && Date.now() - cache.cardsAt < CARDS_MS) return cache.cards;
  const students = await db.query('students');
  const tokens = students.filter((s) => !s.id.includes('-old-') && s.data.qrStatus !== 'revoked' && s.data.qrToken).map((s) => s.data.qrToken);
  cache.cards = { ok: true, updatedAt: new Date().toISOString(), hashes: await Promise.all(tokens.map(sha256Hex)) };
  cache.cardsAt = Date.now();
  return cache.cards;
}

/**
 * One scan. Same rules as the website and the gate phone app:
 *   1. unknown or revoked card, or the child is in no class -> nothing saved
 *   2. no class today: a child who came in earlier (suspension during class hours) is scanned out;
 *      a child whose class was cancelled (teacher absent) -> urgent alert for the staff
 *   3. first scan of the day -> present or late by the clock (no text yet: the parent is texted when the
 *      teacher confirms the class); after the class was confirmed -> "waiting for the teacher"
 *   4. scanned again 30 minutes or more later (or near dismissal, for a child the teacher marked present
 *      without a scan) -> going home: time out saved, departure text queued (once a day)
 */
export async function recordGateScan(db, scanner, code, at, now = new Date()) {
  code = code.trim();
  if (!code || code.length > 200) return { ok: false, result: 'unknown' };
  // When the card was really scanned (offline scans are uploaded later).
  let when = now;
  if (at) {
    const t = new Date(at);
    if (!Number.isNaN(t.getTime()) && t <= new Date(now.getTime() + 2 * 60_000)) when = t;
  }
  const today = manilaToday(now);
  if (manilaToday(when) !== today) return { ok: false, result: 'old_scan' }; // an earlier day: not recorded
  const time = manilaTime(when);

  // 1. Whose card is it?
  const found = (await db.query('students', [['qrToken', 'EQUAL', code]], 2)).filter((s) => !s.id.includes('-old-'))[0];
  if (!found) return { ok: false, result: 'unknown' };
  const student = { ...found.data, id: found.id };
  if (student.qrStatus === 'revoked') return { ok: false, result: 'revoked', name: student.firstName };
  const enr = (await db.query('enrollments', [['studentId', 'EQUAL', student.id], ['status', 'EQUAL', 'active']], 1))[0];
  const secDoc = enr ? await db.get(`sections/${enr.data.sectionId}`) : null;
  if (!secDoc || secDoc.data.archived) return { ok: false, result: 'no_class_found', name: student.firstName };
  const { meta, days } = await loadMeta(db);
  if (!meta?.schoolYear) return { ok: false, result: 'no_school_year' };

  // The engine is used for the same school-day rules and text wording as the website.
  const writes = [];
  const persistence = { put: (col, id, data) => writes.push({ path: `${col}/${id}`, data: JSON.parse(JSON.stringify(data)), ifMissing: col === 'sms' }), remove() {} };
  const clock = { today: () => today, peek: () => time, scanTime: () => time, simulated: () => false };
  const engine = new Engine('cloud', emptyState(meta, days), persistence, {}, clock);
  const sec = engine.normalizeSection({ ...secDoc.data, id: secDoc.id });
  engine.s.sections.set(sec.id, sec);
  engine.s.students.set(student.id, student);
  const dayId = `${sec.id}_${today}`;
  const [dayDoc, confDoc] = await Promise.all([db.get(`attendance/${dayId}`), db.get(`confirmations/${dayId}`)]);
  const rec = dayDoc?.data?.records?.[student.id] ?? null;
  const year = meta.schoolYear;
  const name = `${student.firstName} ${student.lastName}`;
  const audit = (action, detail) => {
    const id = `aud-scan-${crypto.randomUUID().slice(0, 8)}`;
    writes.push({ path: `audit/${id}`, data: { id, at: now.toISOString(), actor: scanner.name, action, target: name, detail } });
  };
  const notify = (n) => writes.push({ path: `notifications/${n.id}`, data: { studentId: student.id, sectionId: sec.id, createdAt: `${today}T${time}:00+08:00`, read: false, ...n } });
  const recordFields = (fields) => ({
    merge: { id: dayId, sectionId: sec.id, date: today, records: { [student.id]: fields } },
    mask: ['id', 'sectionId', 'date', ...Object.keys(fields).map((k) => fp('records', student.id, k))],
  });

  // Going home: time out on the class list and in the parent portal, and the departure text (once a day).
  const goOut = async () => {
    writes.push({ path: `attendance/${dayId}`, ...recordFields({ scannedOut: time }) });
    const month = today.slice(0, 7);
    writes.push({ path: `parentDays/${student.id}_${month}`, merge: { studentId: student.id, month, days: { [today]: { o: time } } }, mask: ['studentId', 'month', fp('days', today, 'o')] });
    const outId = `out_${student.id}_${today}`;
    if (!(await db.get(`sms/${outId}`))) {
      const g = (await db.query('guardians', [['studentIds', 'ARRAY_CONTAINS', student.id]], 1))[0];
      if (g) engine.s.guardians.set(g.id, { ...g.data, id: g.id });
      engine.queueSms(student, 'departure', { id: outId, date: today, time, sectionId: sec.id, template: 'departure', createdAt: now.toISOString() });
    }
    await save(db, writes);
    return { ok: true, result: 'out', name: student.firstName, time: to12h(time) };
  };

  // 2. Is there class today?
  if (!isSchoolDay(today, sec.schedule, engine.s.calendar) || today < year.start || today > year.end) {
    if (rec?.scannedAt && !rec.scannedOut) return goOut();
    if (engine.awayOn(sec, today)?.kind === 'noclass' && today >= year.start && today <= year.end) {
      notify({
        id: `oncampus_${student.id}_${today}`,
        kind: 'missing',
        title: `${name} came to school at ${to12h(time)} but ${sec.name} has no class today`,
        body: 'The class was cancelled because the teacher is absent. Keep the child with a staff member and call the guardian.',
      });
      await save(db, writes);
    }
    return { ok: true, result: 'no_class_today', name: student.firstName };
  }

  // 4. Scanned again: going home, or a double scan.
  const manualIn = rec && !rec.scannedAt && (rec.status === 'present' || rec.status === 'late');
  if ((rec?.scannedAt && toMinutes(time) - toMinutes(rec.scannedAt) >= 30) || (manualIn && toMinutes(time) >= toMinutes(sec.schedule.endTime) - 60)) return goOut();
  if (rec?.scannedAt) return { ok: true, result: 'already_in', name: student.firstName, time: to12h(rec.scannedAt) };

  // 3a. The teacher already marked this child Present or Late without a scan: keep it, add the scan time.
  if (manualIn) {
    writes.push({ path: `attendance/${dayId}`, ...recordFields({ scannedAt: time }) });
    await save(db, writes);
    return { ok: true, result: rec.status, name: student.firstName, time: to12h(time) };
  }
  // 3b. First scan of the day: present or late by the clock.
  const status = decideScan({ time, schedule: sec.schedule }).status;
  const locked = !!confDoc;
  const partExcused = rec?.status === 'excused';
  writes.push({
    path: `attendance/${dayId}`,
    ...recordFields({
      date: today,
      studentId: student.id,
      sectionId: sec.id,
      status,
      scannedAt: time,
      source: 'scanner',
      ...(locked ? { needsCheck: true, editedReason: partExcused ? 'Arrived after an excused part of the day' : 'Arrived after attendance was confirmed' } : {}),
    }),
  });
  if (locked) {
    audit('attendance.scan_after_lock', `scanned at ${time}, waiting for the teacher`);
    notify({
      id: `late_${student.id}_${today}`,
      kind: 'missing',
      title: partExcused
        ? `${name} arrived at ${to12h(time)} (excused earlier today by the parent's request)`
        : `${name} scanned at the gate at ${to12h(time)}, after attendance was confirmed`,
      body: `Check that ${student.firstName} is in ${sec.name}, then mark Present or Late on the Attendance page. The parent is texted when you do.`,
    });
  }
  await save(db, writes);
  return { ok: true, result: status, name: student.firstName, time: to12h(time), waitingForTeacher: locked };
}

// All writes in one go. A text that already exists (another scan made it first) is simply left out.
async function save(db, writes) {
  try {
    await db.commit(writes);
  } catch (e) {
    if (e.status !== 'FAILED_PRECONDITION' && e.status !== 'ALREADY_EXISTS') throw e;
    await db.commit(writes.filter((w) => !w.ifMissing));
  }
}

export const _test = { cache, addDays };
