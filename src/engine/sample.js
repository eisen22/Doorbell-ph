// =====================================================================
// engine/sample.js — THE SAMPLE SCHOOL (demo mode and the admin's "Load sample school").
// =====================================================================
import {
  addDays,
  decideScan,
  isSchoolDay,
  recentSchoolDays,
  hasSubjectTeachers,
  sampleProgramFor,
  toMinutes,
  fromMinutes,
  DEPED_SY_2026_2027,
} from '../logic';

import { DEMO_PASSWORD, schedule, schoolYear, settings } from './defaults';
import { emptyState, noopPersistence } from './clocks';
import { Engine } from '../engine';
// Demo data: fake but realistic Filipino names. Never put real children's data here.
// Used by demo mode in the browser AND by the cloud seed script (cloud/seed.ts).
// =====================================================================
// SAMPLE SCHOOL (used by demo mode and by "Load sample school")
// Fake but realistic Filipino names. Never put real children's data here.
// rng() makes "random" numbers that are the same every time, so the sample is predictable.
// =====================================================================
export function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// ---------------------------------------------------------------------
// THE SAMPLE SCHOOL: Kindergarten to Grade 6, 3 sections per grade, 20 pupils per section.
//   Kindergarten: two morning classes and one afternoon class (Maria Santos has Sampaguita in the
//   morning and Gumamela in the afternoon). Grades 1 to 6: whole-day classes with one adviser each.
//   Grades 4 to 6 also have subject teachers (departmentalized), so their classes list them.
// ---------------------------------------------------------------------
const SAMPLE_CLASSES = [
  ['K', ['Sampaguita', 'Rosal', 'Gumamela']],
  ['1', ['Masipag', 'Matapat', 'Magalang']],
  ['2', ['Narra', 'Molave', 'Acacia']],
  ['3', ['Ruby', 'Emerald', 'Diamond']],
  ['4', ['Rizal', 'Mabini', 'Bonifacio']],
  ['5', ['Luna', 'Silang', 'Aguinaldo']],
  ['6', ['Mercury', 'Venus', 'Jupiter']],
];
// Advisers in class order (Kindergarten has 2: Maria handles 2 classes). [name, subject taught in Grades 4 to 6]
const ADVISERS = [
  ['Maria Santos'], ['Liza Aquino'],
  ['Carmela Reyes'], ['Rodel Bautista'], ['Grace Mendoza'],
  ['Jose Ramirez'], ['Teresa Flores'], ['Arnel Castillo'],
  ['Nora Villareal'], ['Joy Navarro'], ['Edwin Salazar'],
  ['Ana Villanueva', 'Mathematics'], ['Ramon Cruz', 'English'], ['Celia Domingo', 'Science'],
  ['Mark Ocampo', 'Filipino'], ['Rhea Lim', 'Araling Panlipunan'], ['Paolo Tan', 'Mathematics'],
  ['Divina Morales', 'English'], ['Allan Garcia', 'Science'], ['Lorna Rivera', 'Filipino'],
];
// Subject teachers with no class of their own (they teach all Grade 4 to 6 classes).
const SPECIALISTS = [['Benjie Torres', 'MAPEH'], ['Sheila Ramos', 'EPP'], ['Victor Gomez', 'GMRC']];
const slug = (name) => name.toLowerCase().replace(/[^a-z]+/g, '.');
const SAMPLE_TEACHERS = [...ADVISERS, ...SPECIALISTS].map(([name, subject]) => {
  const first = name.split(' ')[0].toLowerCase();
  const id = ['maria', 'jose', 'ana', 'liza'].includes(first) ? `t-${first}` : `t-${slug(name).replace(/\./g, '-')}`;
  return { id, name, email: `${slug(name)}@sunnyside.edu.ph`, active: true, uid: `u-${id.slice(2)}`, subjects: subject ? [subject] : [] };
});
export const teachers = SAMPLE_TEACHERS;
export const users = [
  { uid: 'u-admin', email: 'admin@sunnyside.edu.ph', name: 'Rosario Dizon', role: 'admin' },
  ...teachers.map((t) => ({ uid: t.uid, email: t.email, name: t.name, role: 'teacher', teacherId: t.id })),
];
const COLORS = ['#FFD9A8', '#D8F5A2', '#CFE8FF', '#E4D6FA', '#FBD3E0', '#FFF1A8', '#C8F0E0'];
export const sections = (() => {
  const out = [];
  let a = 0;
  for (const [grade, names] of SAMPLE_CLASSES) {
    names.forEach((nm, k) => {
      const kinder = grade === 'K';
      // Kindergarten: Sampaguita and Rosal 7:30-10:30 AM, Gumamela 12:30-3:30 PM (Maria's second class).
      const sched = kinder
        ? { ...schedule, startTime: k === 2 ? '12:30' : '07:30', endTime: k === 2 ? '15:30' : '10:30' }
        : { ...schedule, startTime: '07:30', endTime: '16:00' };
      const teacherId = kinder && k === 2 ? 't-maria' : SAMPLE_TEACHERS[a++].id;
      out.push({
        id: `sec-${grade.toLowerCase()}-${nm.toLowerCase()}`,
        schoolYearId: 'sy-2026',
        name: `${kinder ? 'Kindergarten' : `Grade ${grade}`} - ${nm}`,
        gradeLevel: grade,
        color: COLORS[(k + (Number(grade) || 0) * 3) % COLORS.length],
        schedule: sched,
        capacity: 30,
        teacherId,
        subjectTeacherIds: [],
        archived: false,
      });
    });
  }
  // Every class gets a class program (Kindergarten to Grade 3: no teachers in it). Grades 4 to 6: who teaches each subject in each grade (the advisers teach their own
  // subject; MAPEH, EPP and GMRC have specialists). The order of subjects is shifted for each section.
  const byName = (n) => SAMPLE_TEACHERS.find((t) => t.name === n)?.id ?? null;
  const SUBJECT_TEACHERS = {
    4: { Mathematics: 'Ana Villanueva', English: 'Ramon Cruz', Science: 'Celia Domingo', Filipino: 'Mark Ocampo', 'Araling Panlipunan': 'Rhea Lim' },
    5: { Mathematics: 'Paolo Tan', English: 'Divina Morales', Science: 'Allan Garcia', Filipino: 'Mark Ocampo', 'Araling Panlipunan': 'Rhea Lim' },
    6: { Mathematics: 'Paolo Tan', English: 'Divina Morales', Science: 'Allan Garcia', Filipino: 'Lorna Rivera', 'Araling Panlipunan': 'Rhea Lim' },
  };
  const SPECIAL = { MAPEH: 'Benjie Torres', EPP: 'Sheila Ramos', GMRC: 'Victor Gomez' };
  for (const sec of out) {
    // Grades 4 to 6: each section starts the subjects at a different slot, so a subject teacher is
    // rarely in two classes at the same time.
    const k = out.filter((x) => hasSubjectTeachers(x.gradeLevel)).indexOf(sec);
    const teacherFor = (sub) => byName(SUBJECT_TEACHERS[sec.gradeLevel]?.[sub] ?? SPECIAL[sub]);
    sec.program = sampleProgramFor(sec.gradeLevel, sec.schedule.startTime, teacherFor, Math.max(0, k));
    sec.subjectTeacherIds = [...new Set(sec.program.map((p) => p.teacherId).filter((t) => t && t !== sec.teacherId))];
    sec.schedule = { ...sec.schedule, endTime: sec.program.at(-1).end }; // classes end with the last period
  }
  return out;
})();
const FIRST_M = [
  'Juan',
  'Miguel',
  'Gabriel',
  'Rafael',
  'Joshua',
  'Paolo',
  'Andres',
  'Carlo',
  'Enzo',
  'Lucas',
  'Nathan',
  'Ethan',
  'Marco',
  'Adrian',
  'Daniel',
  'Kenji',
  'Elijah',
  'Tristan',
  'Jericho',
  'Liam',
  'Noah',
  'Caleb',
  'Ivan',
  'Renz',
  'Joaquin',
];
const FIRST_F = [
  'Maria',
  'Andrea',
  'Sofia',
  'Bea',
  'Althea',
  'Princess',
  'Angel',
  'Jasmine',
  'Faith',
  'Danica',
  'Kyla',
  'Bianca',
  'Erika',
  'Trisha',
  'Ysabel',
  'Chloe',
  'Hannah',
  'Mikaela',
  'Samantha',
  'Leah',
  'Janelle',
  'Nicole',
  'Patricia',
  'Rhian',
  'Zoe',
];
const LAST = [
  'Dela Cruz',
  'Santos',
  'Reyes',
  'Garcia',
  'Mendoza',
  'Bautista',
  'Torres',
  'Flores',
  'Villanueva',
  'Ramos',
  'Aquino',
  'Castillo',
  'Navarro',
  'Domingo',
  'Lim',
  'Tan',
  'Cruz',
  'Manalo',
  'Pascual',
  'Soriano',
];
const MIDDLE = ['Lopez', 'Rivera', 'Gomez', 'Morales', 'Ocampo', 'Salazar'];
// Makes 20 children per section plus 9 not yet in a section. Every 7th child is a sibling of the one before.
function people() {
  const r = rng(2026);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const students = [];
  const guardians = [];
  const enrollments = [];
  const usedNames = new Set();
  let n = 0;
  // year = birth year (Kindergarten 2021, Grade 2 2019, Grade 4 2017, Grade 6 2015 in SY 2026-2027).
  const newStudent = (prefix, year = 2021) => {
    n++;
    let first = '';
    let last = '';
    let sex = 'M';
    do {
      sex = r() < 0.5 ? 'M' : 'F';
      first = sex === 'M' ? pick(FIRST_M) : pick(FIRST_F);
      last = pick(LAST);
    } while (usedNames.has(`${first} ${last}`));
    usedNames.add(`${first} ${last}`);
    const token = Array.from({ length: 10 }, () => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(r() * 32)]).join('');
    return {
      id: `stu-${String(n).padStart(3, '0')}`,
      firstName: first,
      middleName: pick(MIDDLE),
      lastName: last,
      birthdate: `${year}-0${1 + Math.floor(r() * 9)}-${String(10 + Math.floor(r() * 18))}`,
      sex,
      qrToken: `${prefix}${token}`,
      qrStatus: 'active',
    };
  };
  for (const sec of sections) {
    for (let i = 0; i < 20; i++) {
      const s = newStudent('DB-', sec.gradeLevel === 'K' ? 2021 : 2021 - Number(sec.gradeLevel));
      students.push(s);
      enrollments.push({
        id: `enr-${s.id}`,
        studentId: s.id,
        sectionId: sec.id,
        schoolYearId: 'sy-2026',
        status: 'active',
        startDate: schoolYear.start,
      });
      if (n % 7 === 0 && guardians.length) {
        // A sibling: same family name as the other child of that guardian.
        const g = guardians[guardians.length - 1];
        s.lastName = students.find((x) => x.id === g.studentIds[0])?.lastName ?? s.lastName;
        g.studentIds.push(s.id);
        continue;
      }
      const rel = r() < 0.6 ? 'Mother' : r() < 0.8 ? 'Father' : 'Grandmother';
      guardians.push({
        id: `g-${s.id}`,
        name: `${rel === 'Father' ? pick(FIRST_M) : pick(FIRST_F)} ${s.lastName}`,
        mobile: `+639${String(170000000 + Math.floor(r() * 9999999)).slice(0, 9)}`,
        relationship: rel,
        smsConsent: r() > 0.08,
        preferredLanguage: r() < 0.35 ? 'fil' : 'en',
        numberStatus: n === 9 ? 'failed' : r() < 0.85 ? 'verified' : 'unverified',
        studentIds: [s.id],
      });
    }
  }
  // Newly enrolled children not yet placed in a section (for the auto-assign demo).
  for (let i = 0; i < 9; i++) {
    const s = newStudent('DB-N');
    students.push(s);
    guardians.push({
      id: `g-${s.id}`,
      name: `${pick(FIRST_F)} ${s.lastName}`,
      mobile: `+639${String(180000000 + Math.floor(r() * 9999999)).slice(0, 9)}`,
      relationship: 'Mother',
      smsConsent: true,
      preferredLanguage: 'en',
      numberStatus: 'unverified',
      studentIds: [s.id],
    });
  }
  return { students, guardians, enrollments };
}
/** Demo sign-in: the accounts above, all with DEMO_PASSWORD. */
// Demo-mode sign-in: checks the email and DEMO_PASSWORD in memory (no internet).
export function demoAuth(engine) {
  const passwords = new Map(users.map((u) => [u.email.toLowerCase(), DEMO_PASSWORD]));
  return {
    async signIn(email, password) {
      const account = [...engine().s.users.values()].find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (!account || passwords.get(email.toLowerCase()) !== password) throw new Error('Wrong email or password.');
      const t = account.teacherId ? engine().s.teachers.get(account.teacherId) : undefined;
      if (t && t.active === false) throw new Error('This account is deactivated. Ask the school admin.');
      return account;
    },
    async signOut() {},
    async sendPasswordReset() {
      throw new Error('Password reset emails work once the cloud is connected.');
    },
    async changePassword(current, next) {
      const email = engine().session?.email?.toLowerCase();
      if (!email || passwords.get(email) !== current) throw new Error('Your current password is wrong.');
      passwords.set(email, next);
    },
    async createTeacherAccount(email) {
      const temp = `Temp-${Math.random().toString(36).slice(2, 8)}`;
      passwords.set(email.toLowerCase(), temp);
      return { uid: `u-${Math.random().toString(36).slice(2, 10)}`, tempPassword: temp };
    },
    demoAccounts: () => [
      { email: 'admin@sunnyside.edu.ph', password: DEMO_PASSWORD, label: 'School admin (Rosario Dizon)' },
      { email: 'maria.santos@sunnyside.edu.ph', password: DEMO_PASSWORD, label: 'Teacher, Kindergarten Sampaguita (AM) and Gumamela (PM)' },
      { email: 'jose.ramirez@sunnyside.edu.ph', password: DEMO_PASSWORD, label: 'Teacher, Grade 2 - Narra' },
      { email: 'ana.villanueva@sunnyside.edu.ph', password: DEMO_PASSWORD, label: 'Teacher, Grade 4 - Rizal (Mathematics)' },
    ],
  };
}
/**
 * Builds a whole school year of history from the first day of classes (June 8, 2026) up to today:
 * attendance, confirmations, streak alerts and SMS, using the real engine rules.
 */
// Builds the sample school: attendance from June 8, 2026 up to yesterday (using the
// real engine rules, so streaks, alerts and texts are realistic) and part of today's arrivals.
// A few Apple children are set up with streaks so the alerts can be shown in a demo.
export function buildDemoState(today, clock) {
  const state = emptyState({ settings: structuredClone(settings), schoolYear: { ...schoolYear } }, DEPED_SY_2026_2027);
  state.calendar.set('2026-07-23', { date: '2026-07-23', type: 'suspension', label: 'Class suspension: heavy rain (example)' });
  // An example of a suspension for Kindergarten only (DepEd: Signal No. 1), 6 school days ago.
  {
    let d = today;
    for (let k = 0; k < 6; ) {
      d = addDays(d, -1);
      const e = state.calendar.get(d);
      if (![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay()) && !(e && ['holiday', 'break', 'suspension'].includes(e.type))) k++;
    }
    if (d >= schoolYear.start)
      state.calendar.set(d, { date: d, type: 'suspension', label: 'Tropical Cyclone Wind Signal No. 1 (example)', levels: ['K'] });
  }
  users.forEach((u) => state.users.set(u.uid, { ...u }));
  teachers.forEach((t) => state.teachers.set(t.id, { ...t }));
  sections.forEach((s) => state.sections.set(s.id, structuredClone(s)));
  const p = people();
  p.students.forEach((s) => state.students.set(s.id, s));
  p.guardians.forEach((g) => state.guardians.set(g.id, g));
  p.enrollments.forEach((e) => state.enrollments.set(e.id, e));
  const auth = {
    signIn: async () => {
      throw new Error();
    },
    signOut: async () => {},
    sendPasswordReset: async () => {},
    createTeacherAccount: async () => ({ uid: '', tempPassword: '' }),
    demoAccounts: () => [],
  };
  const engine = new Engine('demo', state, noopPersistence, auth, clock);
  const r = rng(77);
  const yesterday = addDays(today, -1);
  // History: the last 15 school days only (about 3 weeks), so the sample fits the Firebase free plan
  // (about 3,500 documents). Parent texts are kept for the last 2 school days only.
  const HISTORY = 15;
  const TEXT_DAYS = 2;
  for (const sec of state.sections.values()) {
    const days = recentSchoolDays(yesterday, HISTORY, sec.schedule, state.calendar, 60)
      .filter((d) => d >= schoolYear.start && d <= schoolYear.end)
      .reverse();
    const roster = engine.rosterOn(sec.id, schoolYear.start);
    const last = days.length - 1;
    days.forEach((date, idx) => {
      const id = `${sec.id}_${date}`;
      const day = { id, sectionId: sec.id, date, records: {} };
      roster.forEach((stu, i) => {
        const x = r();
        let status = x < 0.86 ? 'present' : x < 0.93 ? 'late' : x < 0.97 ? 'absent' : 'excused';
        // Stories for the demo (Apple section), ending yesterday:
        if (sec.id === 'sec-k-sampaguita') {
          const fromEnd = last - idx; // 0 = yesterday
          if (fromEnd <= 3) {
            if (i === 2) status = fromEnd === 3 ? 'present' : 'absent'; // absent 3 days in a row
            if (i === 5) status = fromEnd === 3 ? 'present' : 'late'; // late 3 days in a row
            if (i === 8) status = fromEnd === 3 ? 'present' : fromEnd === 1 ? 'late' : 'absent'; // absent 2 + late 1
            if (i === 11) status = fromEnd >= 2 ? 'present' : 'absent'; // absent 2 days (watch list)
          }
        }
        const start = toMinutes(sec.schedule.startTime);
        const time =
          status === 'present'
            ? fromMinutes(start - 28 + Math.floor(r() * 40))
            : status === 'late'
              ? fromMinutes(start + sec.schedule.lateCutoffMins + 1 + Math.floor(r() * 30))
              : undefined;
        if (status === 'absent') return; // finalize marks the absence
        day.records[stu.id] = {
          date,
          studentId: stu.id,
          sectionId: sec.id,
          status,
          scannedAt: time,
          source: time ? 'scanner' : 'manual',
          excusedNote: status === 'excused' ? 'Parent called: check-up' : undefined,
          // Most children scan out at the gate when they go home (0 to 20 minutes after class).
          scannedOut: time && r() < 0.9 ? fromMinutes(toMinutes(sec.schedule.endTime) + Math.floor(r() * 20)) : undefined,
        };
      });
      state.attendance.set(id, day);
      const conf = `${date}T${fromMinutes(toMinutes(sec.schedule.startTime) + 20 + Math.floor(r() * 25))}:00+08:00`;
      engine.backfill = idx >= days.length - TEXT_DAYS; // these days get their parent texts, as if confirmed on the day
      engine.finalize(sec.id, date, r() < 0.8 ? (state.teachers.get(sec.teacherId ?? '')?.name ?? 'Rosario Dizon') : 'Rosario Dizon', false, conf);
    });
    // Today: about 60% of each morning class has arrived (only if today is a class day).
    if (today <= schoolYear.end && isSchoolDay(today, sec.schedule, state.calendar) && toMinutes(sec.schedule.startTime) < toMinutes('12:00')) {
      let mins = toMinutes(sec.schedule.startTime) - 29;
      const id = `${sec.id}_${today}`;
      const day = { id, sectionId: sec.id, date: today, records: {} };
      roster.forEach((stu, i) => {
        if (i === 2 || i === 8 || i % 5 === 4 || i >= 16) return;
        mins += 1 + Math.floor(r() * 3);
        const time = fromMinutes(mins + (i === 5 ? 45 : 0));
        const decision = decideScan({ time, schedule: sec.schedule });
        if (decision.kind !== 'record') return;
        day.records[stu.id] = {
          date: today,
          studentId: stu.id,
          sectionId: sec.id,
          status: decision.status,
          scannedAt: time,
          source: 'scanner',
        };
      });
      state.attendance.set(id, day);
    }
  }
  engine.backfill = false;
  // Older alerts are already read.
  for (const n of state.notifications.values()) if (n.createdAt < addDays(today, -1)) n.read = true;
  return state;
}

