// =====================================================================
// teacher.js — runs on teacher.html
// ---------------------------------------------------------------------
// What a teacher can do here:
//   1. Pick one of their classes (the class happening now is picked first)
//   2. Scan ID cards -> child marked present or late -> parent gets a text
//   3. Change a child's status by hand (Present / Late / Absent / Excused)
//   4. Confirm attendance -> unscanned children become absent ->
//      anyone absent or late 3 school days in a row -> parent gets a warning text
//   5. See who needs attention, alerts and today's texts
//
// HOW THE DATA IS STORED (Firestore):
//   attendance/{sectionId}_{date}  one document per class per day:
//       { sectionId, date, confirmed: true/false,
//         records: { studentId: { status: 'present'|'late'|'absent'|'excused', time: '07:45' } } }
// =====================================================================

import {
  db, auth, collection, doc, query, where, setDoc, addDoc, onSnapshot, serverTimestamp, signOut,
  readAll, requireUser, toast, esc,
} from './firebase.js';
import {
  todayManila, nowTimeManila, to12h, prettyDate, isSchoolDay, recentSchoolDays, statusForScan, pickClassForNow,
  countStreak, describeStreak, smsText, STREAK_DAYS,
} from './logic.js';

const $ = (id) => document.getElementById(id);

// ----- 1. Who is signed in? (sends them away if not a teacher) -----
const me = await requireUser('teacher');
$('who').textContent = me.name;
$('sign-out').onclick = async () => { await signOut(auth); location.href = 'index.html'; };

const today = todayManila();

// ----- 2. Load things that do not change while the page is open -----
// My classes: every section whose teacherUid is my account id.
const sections = await readAll(query(collection(db, 'sections'), where('teacherUid', '==', me.uid)));
// Holidays and suspensions, as a Set of dates for quick lookup.
const noClassDates = new Set((await readAll(collection(db, 'noClassDays'))).map((d) => d.date));

// ----- Page state (changes as the teacher works) -----
let current = null;       // the class being shown
let students = [];        // children in that class, sorted by last name
let attendance = {};      // that class's attendance documents by date: { '2026-10-29': {...}, ... }
let stopListening = null; // function that stops the live connection to today's document

if (!sections.length) {
  // A teacher with no class: show the message and stop here.
  $('no-class').hidden = false;
  $('content').hidden = true;
} else {
  // Fill the class picker. The class happening now is selected first.
  sections.sort((a, b) => a.startTime.localeCompare(b.startTime));
  $('class-select').innerHTML = sections.map((s) => `<option value="${s.id}">${esc(s.name)} (${to12h(s.startTime)})</option>`).join('');
  const now = pickClassForNow(sections, nowTimeManila());
  $('class-select').value = now.id;
  $('class-select').onchange = () => openClass($('class-select').value);
  await openClass(now.id);
  await loadAlertsAndTexts();
}

// =====================================================================
// Loading a class
// =====================================================================
async function openClass(sectionId) {
  current = sections.find((s) => s.id === sectionId);
  $('title').textContent = current.name;
  $('subtitle').textContent = `${prettyDate(today)} · class ${to12h(current.startTime)} to ${to12h(current.endTime)} · late after ${to12h(current.startTime)} + 15 min`;

  // Children in this class who are still enrolled (active !== false), A to Z by last name.
  students = (await readAll(query(collection(db, 'students'), where('sectionId', '==', sectionId))))
    .filter((s) => s.active !== false)
    .sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));

  // Every attendance day of this class (a school year is about 200 small documents).
  const days = await readAll(query(collection(db, 'attendance'), where('sectionId', '==', sectionId)));
  attendance = Object.fromEntries(days.map((d) => [d.date, d]));

  // Listen LIVE to today's document: if another phone or the admin scans a card,
  // this page updates by itself. onSnapshot calls the function on every change.
  if (stopListening) stopListening();
  stopListening = onSnapshot(doc(db, 'attendance', `${sectionId}_${today}`), (snap) => {
    attendance[today] = snap.exists() ? snap.data() : undefined;
    render();
  });
}

// =====================================================================
// Drawing the page from the current state
// =====================================================================
function render() {
  const day = attendance[today];                    // today's document (may not exist yet)
  const records = day?.records || {};
  const schoolDay = isSchoolDay(today, noClassDates);

  // --- counts ---
  const count = { present: 0, late: 0, absent: 0, excused: 0, waiting: 0 };
  students.forEach((s) => { count[records[s.id]?.status || 'waiting']++; });
  $('counts').innerHTML = schoolDay
    ? `<span class="chip present">Present ${count.present}</span><span class="chip late">Late ${count.late}</span>
       <span class="chip absent">Absent ${count.absent}</span><span class="chip excused">Excused ${count.excused}</span>
       ${day?.confirmed ? '<span class="chip">✔ Confirmed</span>' : `<span class="chip waiting">Not yet ${count.waiting}</span>`}`
    : '<span class="chip">No class today (weekend, holiday or suspension)</span>';

  // The confirm button only makes sense on a school day that is not yet confirmed.
  $('confirm').disabled = !schoolDay || !!day?.confirmed;
  $('scan-input').disabled = !schoolDay;

  // --- class list ---
  $('roster').innerHTML = students.map((s) => {
    const r = records[s.id];
    const status = r?.status || 'waiting';
    return `<tr>
      <td><strong>${esc(s.lastName)}, ${esc(s.firstName)}</strong></td>
      <td>${r?.time ? to12h(r.time) : '—'}</td>
      <td><span class="chip ${status}">${status === 'waiting' ? 'Not yet' : status}</span></td>
      <td class="buttons">
        ${['present', 'late', 'absent', 'excused'].map((st) =>
          `<button class="mini ${st} ${status === st ? 'on' : ''}" data-student="${s.id}" data-status="${st}" ${schoolDay ? '' : 'disabled'}>${st[0].toUpperCase()}</button>`).join('')}
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="muted">No students in this class yet.</td></tr>';

  // --- attention needed: 2 or more school days in a row absent or late ---
  const lookBack = recentSchoolDays(today, 10, noClassDates); // the last 10 school days, newest first
  const attention = students
    .map((s) => ({ s, streak: countStreak(s.id, lookBack, attendance) }))
    .filter((x) => x.streak.count >= 2)
    .sort((a, b) => b.streak.count - a.streak.count);
  $('attention').innerHTML = attention.map(({ s, streak }) =>
    `<li class="${streak.count >= STREAK_DAYS ? 'hot' : ''}">
      <strong>${esc(s.firstName)} ${esc(s.lastName)}</strong> — ${describeStreak(streak)}
      <span class="muted">· ${esc(s.guardianName || 'No guardian')} ${esc(s.guardianPhone || '')}</span>
      ${streak.count >= STREAK_DAYS ? '<span class="chip absent">Parent texted</span>' : `<span class="chip">Text at ${STREAK_DAYS}</span>`}
    </li>`).join('') || '<li class="muted">Everyone is on track.</li>';

  // --- past school days that were never confirmed (last 7 school days, not today) ---
  // Only days on or after the class's first day (startDate), so a new class does not show old dates.
  const missed = recentSchoolDays(today, 8, noClassDates)
    .filter((d) => d !== today && d >= (current.startDate || today) && !attendance[d]?.confirmed);
  $('unconfirmed').hidden = !missed.length;
  $('unconfirmed').innerHTML = missed.length
    ? `<strong>Attendance was not confirmed for:</strong> ${missed.map((d) =>
        `<button class="btn small" data-confirm="${d}">${prettyDate(d)}</button>`).join(' ')}
       <p class="muted">Confirming marks children with no record as absent for that day.</p>`
    : '';
}

// One click handler for the whole page: the buttons say what they are for in data-... attributes.
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.status) await setStatus(btn.dataset.student, btn.dataset.status);
  if (btn.dataset.confirm) await confirmDay(btn.dataset.confirm);
});
$('confirm').onclick = () => confirmDay(today);

// =====================================================================
// Scanning a card
// =====================================================================
$('scan-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('scan-input').value.trim().toUpperCase(); // codes are saved in capital letters
  $('scan-input').value = '';                              // clear the box for the next child
  if (code) await recordScan(code);
  $('scan-input').focus();
});

async function recordScan(code) {
  const show = (text, kind) => { $('scan-result').textContent = text; $('scan-result').className = `scan-result ${kind}`; };

  // Find the child with this card code.
  const found = await readAll(query(collection(db, 'students'), where('code', '==', code)));
  const child = found[0];
  if (!child) return show(`Unknown card: ${code}`, 'bad');
  if (child.active === false) return show(`${child.firstName} is no longer enrolled.`, 'bad');
  if (child.sectionId !== current.id) return show(`${child.firstName} ${child.lastName} is not in ${current.name}.`, 'bad');

  // Scanned already today? Then do nothing (stops double texts to parents).
  const day = attendance[today];
  const existing = day?.records?.[child.id];
  if (existing?.time) return show(`${child.firstName} was already scanned at ${to12h(existing.time)}.`, 'warn');

  // On time or late? After confirmation, any arrival counts as late.
  const time = nowTimeManila();
  const status = day?.confirmed ? 'late' : statusForScan(time, current.startTime);

  // Save it. { merge: true } adds this child's record without erasing the others.
  await setDoc(doc(db, 'attendance', `${current.id}_${today}`), {
    sectionId: current.id, date: today,
    records: { [child.id]: { status, time } },
  }, { merge: true });

  await sendText(child, status === 'late' ? 'late' : 'arrival', time);
  show(`${child.firstName} ${child.lastName}: ${status === 'late' ? 'LATE' : 'on time'} at ${to12h(time)}. Parent texted.`, status === 'late' ? 'warn' : 'ok');
  loadAlertsAndTexts();
}

// =====================================================================
// Changing a status by hand
// =====================================================================
async function setStatus(studentId, status) {
  const day = attendance[today];
  // After confirming, changes are still allowed but we ask first.
  if (day?.confirmed && !confirm('Attendance for today is already confirmed. Change it anyway?')) return;
  const old = day?.records?.[studentId];
  await setDoc(doc(db, 'attendance', `${current.id}_${today}`), {
    sectionId: current.id, date: today,
    records: { [studentId]: { status, time: old?.time || '' } }, // keep the scan time if there was one
  }, { merge: true });
}

// =====================================================================
// Confirming a day
// =====================================================================
// 1. Every child with no record that day becomes 'absent'.
// 2. The day is marked confirmed (locked).
// 3. Each absent or late child is checked for a 3-day streak -> warning text + alert.
// Note: for simplicity, the class list used is TODAY's list of children.
async function confirmDay(date) {
  const label = date === today ? 'today' : prettyDate(date);
  if (!confirm(`Confirm attendance for ${label}? Children not scanned will be marked absent.`)) return;

  const day = attendance[date] || { records: {} };
  const missing = {};
  students.forEach((s) => { if (!day.records?.[s.id]) missing[s.id] = { status: 'absent', time: '' }; });

  await setDoc(doc(db, 'attendance', `${current.id}_${date}`), {
    sectionId: current.id, date, confirmed: true, confirmedBy: me.name, records: missing,
  }, { merge: true });

  // Update our own copy right away so the streak check sees the new absences.
  attendance[date] = { ...day, sectionId: current.id, date, confirmed: true, records: { ...day.records, ...missing } };

  // Check streaks. "=== STREAK_DAYS" means the text is sent ONCE, on the 3rd day.
  // Change to ">= STREAK_DAYS" to text the parent every day the streak continues.
  const lookBack = recentSchoolDays(date, 10, noClassDates);
  for (const s of students) {
    const streak = countStreak(s.id, lookBack, attendance);
    if (streak.count === STREAK_DAYS) {
      await sendText(s, 'streak', '', streak);
      await addDoc(collection(db, 'alerts'), {
        sectionId: current.id, kind: 'streak', createdAt: serverTimestamp(), date,
        title: `${s.firstName} ${s.lastName} was ${describeStreak(streak)}`,
        body: s.guardianPhone ? `${s.guardianName || 'The guardian'} was sent a text.` : 'No mobile number on file. Please call the family.',
      });
    }
  }
  toast(`Attendance for ${label} confirmed.`);
  render();
  loadAlertsAndTexts();
}

// =====================================================================
// Text messages (SIMULATED)
// =====================================================================
// The message is saved in the 'sms' collection instead of really being sent.
// To send real texts later, a small server (or Cloud Function) can read new
// documents in 'sms' and pass them to an SMS provider such as Semaphore.
async function sendText(child, kind, time, streak) {
  if (!child.guardianPhone) return; // no number on file: nothing to send
  await addDoc(collection(db, 'sms'), {
    to: child.guardianPhone, kind, body: smsText(kind, child.firstName, time, streak),
    studentId: child.id, studentName: `${child.firstName} ${child.lastName}`, sectionId: child.sectionId,
    date: today, createdAt: serverTimestamp(), status: 'simulated',
  });
}

// =====================================================================
// Alerts and today's texts (right-hand cards)
// =====================================================================
async function loadAlertsAndTexts() {
  const myIds = sections.map((s) => s.id);
  // Alerts for my classes, plus 'all' = calendar notices from the admin. (Firestore "in" allows up to 30 values.)
  const alerts = await readAll(query(collection(db, 'alerts'), where('sectionId', 'in', [...myIds, 'all'])));
  alerts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)); // newest first
  $('alerts').innerHTML = alerts.slice(0, 12).map((a) =>
    `<li class="${a.kind === 'calendar' ? 'calendar' : 'hot'}"><strong>${a.kind === 'calendar' ? '📅 ' : ''}${esc(a.title)}</strong><br><span class="muted">${esc(a.body)}</span></li>`).join('')
    || '<li class="muted">No alerts.</li>';

  const texts = (await readAll(query(collection(db, 'sms'), where('date', '==', today)))).filter((m) => myIds.includes(m.sectionId));
  texts.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  $('sms').innerHTML = texts.map((m) =>
    `<li><span class="chip ${m.kind === 'late' ? 'late' : m.kind === 'streak' ? 'absent' : 'present'}">${m.kind}</span> ${esc(m.studentName)} → ${esc(m.to)}<br><span class="muted">${esc(m.body)}</span></li>`).join('')
    || '<li class="muted">No texts yet today.</li>';
}
