// =====================================================================
// admin.js — runs on admin.html
// ---------------------------------------------------------------------
// The admin manages the school:
//   Absence watch · Sections · Teachers · Students · ID cards · No-class days · Texts
//
// HOW IT WORKS: loadAll() reads everything from Firestore into the `data`
// object, then each draw...() function turns `data` into HTML. After any
// change we call refresh() = loadAll() + draw everything again.
// Simple to follow; fine for one school (a few hundred students).
// =====================================================================

import {
  db, auth, collection, doc, query, where, orderBy, limit, setDoc, addDoc, updateDoc, deleteDoc, writeBatch,
  serverTimestamp, signOut, readAll, requireUser, createTeacherAccount, toast, esc,
} from './firebase.js';
import {
  todayManila, to12h, prettyDate, addDays, addMinutes, recentSchoolDays, countStreak, normalizePhone, newCardCode,
  STREAK_DAYS,
} from './logic.js';

const $ = (id) => document.getElementById(id);

// ----- Who is signed in? (sends them away if not the admin) -----
const me = await requireUser('admin');
$('who').textContent = me.name;
$('sign-out').onclick = async () => { await signOut(auth); location.href = 'index.html'; };

const today = todayManila();

// Everything the admin screens show. Filled by loadAll().
const data = { sections: [], teachers: [], students: [], attendance: [], noClassDays: [] };

// =====================================================================
// Tabs: clicking a tab button shows its <section> and hides the others
// =====================================================================
document.querySelectorAll('.tabs button').forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b === btn));
    document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${btn.dataset.tab}`; });
    if (btn.dataset.tab === 'sms') drawTexts(); // the text log is loaded only when opened
  };
});

// =====================================================================
// Loading and drawing
// =====================================================================
async function loadAll() {
  data.sections = (await readAll(collection(db, 'sections'))).sort((a, b) => a.name.localeCompare(b.name));
  data.teachers = (await readAll(query(collection(db, 'users'), where('role', '==', 'teacher')))).sort((a, b) => a.name.localeCompare(b.name));
  data.students = (await readAll(collection(db, 'students'))).sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
  data.attendance = await readAll(collection(db, 'attendance'));
  data.noClassDays = (await readAll(collection(db, 'noClassDays'))).sort((a, b) => a.date.localeCompare(b.date));
}

async function refresh() {
  await loadAll();
  drawWatch(); drawSections(); drawTeachers(); drawStudents(); drawCards(); drawDays();
}

// Small lookups used in several places
const sectionName = (id) => data.sections.find((s) => s.id === id)?.name || 'Not in a section';
const teacherName = (uid) => data.teachers.find((t) => t.id === uid)?.name || 'No teacher yet';

// =====================================================================
// Absence watch
// =====================================================================
function drawWatch() {
  const noClass = new Set(data.noClassDays.map((d) => d.date));
  const lookBack = recentSchoolDays(today, 10, noClass);
  // Group attendance by section: { sectionId: { date: doc } }
  const bySection = {};
  data.attendance.forEach((a) => { (bySection[a.sectionId] ??= {})[a.date] = a; });

  const rows = data.students
    .filter((s) => s.active !== false && s.sectionId)
    .map((s) => ({ s, streak: countStreak(s.id, lookBack, bySection[s.sectionId] || {}) }))
    .filter((x) => x.streak.count >= 2)
    .sort((a, b) => b.streak.count - a.streak.count);

  $('watch').innerHTML = rows.map(({ s, streak }) => `<tr class="${streak.count >= STREAK_DAYS ? 'hot' : ''}">
      <td><strong>${esc(s.lastName)}, ${esc(s.firstName)}</strong></td>
      <td>${esc(sectionName(s.sectionId))}</td>
      <td><span class="num absent">${streak.absent}</span></td>
      <td><span class="num late">${streak.late}</span></td>
      <td><span class="num">${streak.count}</span></td>
      <td>${esc(s.guardianName || '—')} ${s.guardianPhone ? `<a href="tel:${s.guardianPhone}">${esc(s.guardianPhone)}</a>` : ''}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No child is absent or late 2 school days in a row.</td></tr>';
}

// =====================================================================
// The pop-up form (<dialog>) shared by sections, teachers and students
// =====================================================================
// openForm('Edit section', '<label>...</label>', async (form) => { ...save... })
// `form` gives the field values by name, e.g. form.get('name').
// If onSave throws an error, the message is shown and the dialog stays open.
let saveHandler = null;
function openForm(title, fieldsHtml, onSave) {
  $('dialog-title').textContent = title;
  $('dialog-fields').innerHTML = fieldsHtml;
  $('dialog-error').textContent = '';
  saveHandler = onSave;
  $('dialog').showModal();
}
$('dialog-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (e.submitter?.value === 'cancel') { $('dialog').close(); return; }
  try {
    await saveHandler(new FormData($('dialog-form')));
    $('dialog').close();
    await refresh();
  } catch (err) {
    $('dialog-error').textContent = err.message;
  }
});

// =====================================================================
// Sections
// =====================================================================
function drawSections() {
  $('section-list').innerHTML = data.sections.map((s) => {
    const count = data.students.filter((x) => x.sectionId === s.id && x.active !== false).length;
    return `<article class="card section-card" data-edit-section="${s.id}">
      <h3>${esc(s.name)}</h3>
      <p>${esc(teacherName(s.teacherUid))}</p>
      <p class="muted">${to12h(s.startTime)} to ${to12h(s.endTime)} · ${count} learners</p>
      <p class="muted">Click to edit</p>
    </article>`;
  }).join('') || '<p class="muted">No sections yet.</p>';
}

function sectionForm(s = {}) {
  const teacherOptions = data.teachers.map((t) => `<option value="${t.id}" ${t.id === s.teacherUid ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
  openForm(s.id ? `Edit ${s.name}` : 'Add section', `
    <label>Section name <input name="name" required value="${esc(s.name || 'Kindergarten - ')}" /></label>
    <label>Teacher <select name="teacherUid"><option value="">No teacher yet</option>${teacherOptions}</select></label>
    <div class="row"><label>Class starts <input type="time" name="startTime" required value="${s.startTime || '08:00'}" /></label>
    <label>Class ends <input type="time" name="endTime" required value="${s.endTime || '11:30'}" /></label></div>
    <label>First day of classes <input type="date" name="startDate" required value="${s.startDate || today}" /></label>
    ${s.id ? '<label class="check"><input type="checkbox" name="delete" /> Delete this section (only if it has no students)</label>' : ''}`,
  async (form) => {
    if (form.get('delete')) {
      if (data.students.some((x) => x.sectionId === s.id && x.active !== false)) throw new Error('Move the students to another section first.');
      await deleteDoc(doc(db, 'sections', s.id));
      return;
    }
    const value = {
      name: form.get('name').trim(), teacherUid: form.get('teacherUid') || null,
      startTime: form.get('startTime'), endTime: form.get('endTime'), startDate: form.get('startDate'),
    };
    if (value.endTime <= value.startTime) throw new Error('Class must end after it starts.');
    // A teacher may have several classes, but not two at the same time.
    const clash = data.sections.find((x) => x.id !== s.id && x.teacherUid && x.teacherUid === value.teacherUid
      && value.startTime < x.endTime && x.startTime < value.endTime);
    if (clash) throw new Error(`That teacher already has ${clash.name} at the same time.`);
    if (s.id) await updateDoc(doc(db, 'sections', s.id), value);
    else await addDoc(collection(db, 'sections'), value);
  });
}
$('add-section').onclick = () => sectionForm();

// =====================================================================
// Teachers
// =====================================================================
function drawTeachers() {
  $('teacher-list').innerHTML = data.teachers.map((t) => {
    const classes = data.sections.filter((s) => s.teacherUid === t.id).map((s) => esc(s.name)).join(', ');
    return `<tr><td><button class="name" data-edit-teacher="${t.id}">${esc(t.name)}</button></td><td>${esc(t.email)}</td><td>${classes || '<span class="muted">None</span>'}</td></tr>`;
  }).join('') || '<tr><td colspan="3" class="muted">No teachers yet.</td></tr>';
}

function teacherForm(t = {}) {
  // A random starting password the admin gives to the teacher. They can change it with "Forgot password?".
  const temp = `Db-${Math.random().toString(36).slice(2, 8)}!`;
  openForm(t.id ? `Edit ${t.name}` : 'Add teacher', `
    <label>Full name <input name="name" required value="${esc(t.name || '')}" /></label>
    ${t.id ? `<p class="muted">Email: ${esc(t.email)} (cannot be changed here)</p>
              <p class="muted">Assign classes on the Sections tab.</p>`
           : `<label>Email (used to sign in) <input type="email" name="email" required /></label>
              <label>Temporary password (write it down for the teacher) <input name="password" required minlength="6" value="${temp}" /></label>`}`,
  async (form) => {
    const name = form.get('name').trim();
    if (t.id) { await updateDoc(doc(db, 'users', t.id), { name }); return; }
    const email = form.get('email').trim();
    const uid = await createTeacherAccount(email, form.get('password')); // makes the sign-in account
    await setDoc(doc(db, 'users', uid), { name, email, role: 'teacher' }); // saves their profile and role
    alert(`Teacher account created.\nEmail: ${email}\nPassword: ${form.get('password')}`);
  });
}
$('add-teacher').onclick = () => teacherForm();

// =====================================================================
// Students
// =====================================================================
function drawStudents() {
  // Section filter dropdown (keeps the current choice when redrawing)
  const chosen = $('student-filter').value || 'all';
  $('student-filter').innerHTML = `<option value="all">All students</option><option value="none">Not in a section</option>`
    + data.sections.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('student-filter').value = chosen;

  const list = data.students.filter((s) => chosen === 'all' || (chosen === 'none' ? !s.sectionId : s.sectionId === chosen));
  $('student-list').innerHTML = list.map((s) => `<tr class="${s.active === false ? 'dim' : ''}">
      <td><button class="name" data-edit-student="${s.id}">${esc(s.lastName)}, ${esc(s.firstName)}</button></td>
      <td>${s.active === false ? `<span class="chip absent">${esc(s.leftReason || 'Left')}</span>` : esc(sectionName(s.sectionId))}</td>
      <td>${esc(s.guardianName || '—')}</td>
      <td>${esc(s.guardianPhone || '—')}</td>
      <td><code>${esc(s.code)}</code></td>
      <td>${s.active === false ? `<button class="btn small" data-restore="${s.id}">Restore</button>` : `<button class="btn small" data-leave="${s.id}">Transfer / drop</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="muted">No students here.</td></tr>';
}
$('student-filter').onchange = drawStudents;

function studentForm(s = {}) {
  const sectionOptions = data.sections.map((x) => `<option value="${x.id}" ${x.id === s.sectionId ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
  openForm(s.id ? `Edit ${s.firstName} ${s.lastName}` : 'Add student', `
    <div class="row"><label>First name <input name="firstName" required value="${esc(s.firstName || '')}" /></label>
    <label>Last name <input name="lastName" required value="${esc(s.lastName || '')}" /></label></div>
    <label>Section <select name="sectionId"><option value="">Not in a section yet</option>${sectionOptions}</select></label>
    <label>Parent or guardian name <input name="guardianName" required value="${esc(s.guardianName || '')}" /></label>
    <label>Guardian mobile (receives the texts) <input name="guardianPhone" required placeholder="0917 123 4567" value="${esc(s.guardianPhone || '')}" /></label>
    ${s.id ? `<label class="check"><input type="checkbox" name="newCard" /> Lost card: make a new card code (the old card stops working)</label>` : ''}`,
  async (form) => {
    const phone = normalizePhone(form.get('guardianPhone'));
    if (!phone) throw new Error('Mobile must look like 0917 123 4567.');
    const value = {
      firstName: form.get('firstName').trim(), lastName: form.get('lastName').trim(), sectionId: form.get('sectionId') || null,
      guardianName: form.get('guardianName').trim(), guardianPhone: phone,
    };
    if (s.id) {
      if (form.get('newCard')) value.code = newCardCode();
      await updateDoc(doc(db, 'students', s.id), value);
    } else {
      await addDoc(collection(db, 'students'), { ...value, code: newCardCode(), active: true });
    }
  });
}
$('add-student').onclick = () => studentForm();

// Transfer or drop: the child is NOT deleted (attendance history stays); they are marked inactive.
function leaveForm(s) {
  const options = data.sections.filter((x) => x.id !== s.sectionId).map((x) => `<option value="move:${x.id}">Move to ${esc(x.name)}</option>`).join('');
  openForm(`Transfer or drop ${s.firstName}`, `
    <label>What is happening? <select name="action">${options}
      <option value="Transferred">Transferred to another school</option>
      <option value="Dropped">Dropped out</option></select></label>
    <p class="muted">Records are never deleted. A transferred or dropped child leaves the class list and gets no more texts.</p>`,
  async (form) => {
    const action = form.get('action');
    if (action.startsWith('move:')) await updateDoc(doc(db, 'students', s.id), { sectionId: action.slice(5) });
    else await updateDoc(doc(db, 'students', s.id), { active: false, leftReason: action, leftDate: today });
  });
}

// =====================================================================
// ID cards (barcodes drawn by JsBarcode in CODE128 format)
// =====================================================================
function drawCards() {
  const chosen = $('card-section').value || data.sections[0]?.id || '';
  $('card-section').innerHTML = data.sections.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  $('card-section').value = chosen;
  const kids = data.students.filter((s) => s.sectionId === chosen && s.active !== false);
  $('card-grid').innerHTML = kids.map((s) => `<div class="id-card" id="card-${s.id}">
      <strong>${esc(s.firstName)} ${esc(s.lastName)}</strong>
      <span>${esc(sectionName(s.sectionId))}</span>
      <svg class="barcode" data-code="${esc(s.code)}"></svg>
      <button class="btn small no-print" data-print="${s.id}">Print</button>
    </div>`).join('') || '<p class="muted">No students in this section.</p>';
  // Draw each barcode. The scanner reads the same text that is in data-code.
  document.querySelectorAll('.barcode').forEach((svg) => {
    if (window.JsBarcode) JsBarcode(svg, svg.dataset.code, { format: 'CODE128', height: 50, fontSize: 14, margin: 4 });
  });
}
$('card-section').onchange = drawCards;
$('print-all').onclick = () => window.print();

// Printing ONE card: mark it, hide the rest while printing (see .printing-one in style.css).
function printOne(id) {
  document.body.classList.add('printing-one');
  $(`card-${id}`).classList.add('print-me');
  window.print(); // waits until the print window closes
  document.body.classList.remove('printing-one');
  $(`card-${id}`).classList.remove('print-me');
}

// =====================================================================
// No-class days (holidays and suspensions) + alerts to teachers
// =====================================================================
function drawDays() {
  $('day-list').innerHTML = data.noClassDays.map((d) =>
    `<li><strong>${prettyDate(d.date)}</strong> · ${d.type === 'suspension' ? 'Class suspension' : 'Holiday'}: ${esc(d.reason)}
      <button class="btn small" data-remove-day="${d.date}">Remove</button></li>`).join('') || '<li class="muted">No holidays or suspensions added.</li>';
}

$('day-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const date = $('day-date').value;
  const type = $('day-type').value;
  const reason = $('day-reason').value.trim();
  // The date is the document id, so the same day cannot be added twice.
  await setDoc(doc(db, 'noClassDays', date), { date, type, reason });
  // sectionId 'all' = every teacher sees this alert.
  await addDoc(collection(db, 'alerts'), {
    sectionId: 'all', kind: 'calendar', date, createdAt: serverTimestamp(),
    title: `${type === 'suspension' ? 'Classes suspended' : 'No classes'}: ${prettyDate(date)}`,
    body: `${reason}. No attendance is taken and this day does not count in absence streaks.`,
  });
  $('day-form').reset();
  toast('Saved. Teachers were alerted.');
  await refresh();
});

async function removeDay(date) {
  if (!confirm(`Make ${prettyDate(date)} a regular class day again?`)) return;
  await deleteDoc(doc(db, 'noClassDays', date));
  await addDoc(collection(db, 'alerts'), {
    sectionId: 'all', kind: 'calendar', date, createdAt: serverTimestamp(),
    title: `Classes are back on: ${prettyDate(date)}`, body: 'This day follows the regular class schedule again.',
  });
  await refresh();
}

// =====================================================================
// Text log
// =====================================================================
async function drawTexts() {
  const texts = await readAll(query(collection(db, 'sms'), orderBy('createdAt', 'desc'), limit(100)));
  $('sms-list').innerHTML = texts.map((m) => `<tr>
      <td>${m.date ? prettyDate(m.date) : ''}</td><td>${esc(m.studentName)}</td><td>${esc(m.to)}</td>
      <td><span class="chip ${m.kind === 'late' ? 'late' : m.kind === 'streak' ? 'absent' : 'present'}">${m.kind}</span></td>
      <td>${esc(m.body)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No texts yet.</td></tr>';
}

// =====================================================================
// One click handler for buttons that carry data-... attributes
// =====================================================================
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-edit-section],[data-edit-teacher],[data-edit-student],[data-leave],[data-restore],[data-print],[data-remove-day]');
  if (!el) return;
  const d = el.dataset;
  if (d.editSection) sectionForm(data.sections.find((s) => s.id === d.editSection));
  if (d.editTeacher) teacherForm(data.teachers.find((t) => t.id === d.editTeacher));
  if (d.editStudent) studentForm(data.students.find((s) => s.id === d.editStudent));
  if (d.leave) leaveForm(data.students.find((s) => s.id === d.leave));
  if (d.restore) updateDoc(doc(db, 'students', d.restore), { active: true, leftReason: null, leftDate: null }).then(refresh);
  if (d.print) printOne(d.print);
  if (d.removeDay) removeDay(d.removeDay);
});

// =====================================================================
// Sample data (for testing and the demo)
// =====================================================================
// Adds 2 sections and 16 children with 2 weeks of confirmed attendance,
// including children who are absent or late several days in a row.
// Assign a teacher to each section afterwards (Sections tab).
$('sample-data').onclick = async () => {
  if (!confirm('Add 2 sample sections with 16 children and 2 weeks of attendance?')) return;
  const noClass = new Set(data.noClassDays.map((d) => d.date));
  const days = recentSchoolDays(addDays(today, -1), 10, noClass); // the last 10 school days before today
  const batch = writeBatch(db); // all writes are sent together
  const first = ['Juan', 'Maria', 'Miguel', 'Andrea', 'Paolo', 'Sofia', 'Carlo', 'Bea'];
  const last = ['Dela Cruz', 'Santos', 'Reyes', 'Garcia', 'Mendoza', 'Bautista', 'Torres', 'Flores'];
  const plan = [
    { name: 'Kindergarten - Apple', startTime: '08:00', endTime: '11:30' },
    { name: 'Kindergarten - Mango', startTime: '12:30', endTime: '16:00' },
  ];
  plan.forEach((p, si) => {
    const sectionRef = doc(collection(db, 'sections'));               // a new id, made on this device
    batch.set(sectionRef, { ...p, teacherUid: null, startDate: days[days.length - 1] });
    const kids = first.map((f, i) => {
      const ref = doc(collection(db, 'students'));
      batch.set(ref, {
        firstName: f, lastName: last[(i + si * 3) % last.length], sectionId: sectionRef.id, code: newCardCode(), active: true,
        guardianName: `Parent of ${f}`, guardianPhone: `+63917${String(1000000 + si * 100 + i).slice(0, 7)}`,
      });
      return ref.id;
    });
    days.forEach((date, dayIndex) => {                                // dayIndex 0 = yesterday
      const records = {};
      kids.forEach((id, i) => {
        let status = (i + dayIndex) % 9 === 0 ? 'late' : 'present';     // a little lateness
        if (i === 1 && dayIndex < 3) status = 'absent';                  // absent 3 days in a row
        if (i === 2 && dayIndex < 3) status = 'late';                    // late 3 days in a row
        if (i === 3 && dayIndex < 2) status = 'absent';                  // absent 2 days (watch list)
        records[id] = { status, time: status === 'absent' ? '' : addMinutes(p.startTime, status === 'late' ? 25 : -10) }; // late 25 min after start, on time 10 min before
      });
      batch.set(doc(db, 'attendance', `${sectionRef.id}_${date}`), { sectionId: sectionRef.id, date, confirmed: true, confirmedBy: 'Sample data', records });
    });
  });
  await batch.commit();
  toast('Sample data added. Assign teachers on the Sections tab.');
  await refresh();
};

// ----- Start: load everything and draw the first screen -----
await refresh();
