import {
  classNow,
  sortByStart,
  isSchoolDay,
  manilaTime,
  addDays,
  bySectionGrade,
  classPeriods,
  streakInfo,
  toMinutes,
} from './logic';
import { dayId, byName } from './engine/util';

import { withTemplateDefaults } from './engine/defaults';
import { textsMethods } from './engine/texts';
import { dailyMethods } from './engine/daily';
import { attendanceMethods } from './engine/attendance';
import { parentPortalMethods } from './engine/parentPortal';
import { adminMethods } from './engine/admin';

// =====================================================================
// engine.js — THE HEART OF DOORBELL
// ---------------------------------------------------------------------
// The Engine class holds the school's data and does every action:
// scanning, statuses, confirming days, streak alerts, texts, sections,
// teachers, students and the calendar. Screens never touch the database
// directly; they call the engine (see useRepo() in ui.jsx).
//
// Debugging tip: in the browser console you can look at the data with
//   window.doorbell.s.students   (see ui.jsx, where window.doorbell is set)
// =====================================================================
// The Engine is split over several files (src/engine/): this file has its core (state, sessions,
// records, sign-in, reading the school's data); the rest is added below from:
//   engine/texts.js        parent texts, streaks and totals
//   engine/daily.js        confirming classes, absence texts after the 1st period, catching up
//   engine/attendance.js   rosters, gate scans, statuses, alerts, SMS list, Absence Watch
//   engine/parentPortal.js parent portal data and excuse requests
//   engine/admin.js        settings, calendar, teachers, accounts, sections, students
//   engine/sample.js       the sample school;  engine/defaults.js  default settings and texts
// =====================================================================
// =====================================================================
// THE ENGINE
// Every screen talks only to this class (through useRepo() in ui.jsx).
// It holds the school in memory (this.s), runs every rule, and saves each
// change with this.put(collection, id, data):
//   demo mode  -> nothing is saved
//   cloud mode -> Firestore (firebase.js)
// Main parts: session and visibility, people, SMS and alerts, confirming days,
// sign-in, reading data, teacher actions, admin actions.
// =====================================================================
export class Engine {
  persistence; // where changes are saved: { put, remove } (Firestore in cloud mode)
  auth; // sign-in functions (firebase.js or demoAuth)
  clock; // realClock or DemoClock
  mode; // 'demo' or 'cloud'
  s; // THE DATA: the whole school in memory (see emptyState)
  session = null; // who is signed in: { uid, name, email, role, teacherId, sectionIds, sectionId }
  listeners = new Set(); // screens waiting to hear about changes
  lastScanAt = new Map(); // card code -> time of its last scan (to ignore double beeps)
  lastAssign = null; // placements before the last auto-assign (for Undo)
  emitTimer = null;
  /** Resolves when data for the signed-in user has loaded. */
  ready = Promise.resolve();
  constructor(mode, state, persistence, auth, clock) {
    this.persistence = persistence;
    this.auth = auth;
    this.clock = clock;
    this.mode = mode;
    this.s = state;
    this.normalizeSections();
  }
  // ---------------------------------------------------------------------
  // SCHOOL-WIDE TIMES (Settings): the gate opens at settings.gateOpens (default 6:00 AM) for every
  // class, and the absence texts go out when the first period ends (start + settings.firstPeriodMins).
  // The rules in logic.js read them from each section's schedule, so they are copied there, together
  // with the section's grade level (for calendar entries that apply to some levels only).
  // ---------------------------------------------------------------------
  normalizeSection(sec) {
    if (!sec?.schedule) return sec;
    const st = this.s.meta?.settings ?? {};
    const gate = toMinutes(st.gateOpens || '06:00');
    sec.schedule.gradeLevel = sec.gradeLevel ?? 'K';
    sec.schedule.autoFinalizeMins = Number(st.firstPeriodMins) > 0 ? Number(st.firstPeriodMins) : 60;
    // A class with a class program: the absence texts go out when ITS first period ends.
    const first = classPeriods(sec.program)[0] ?? null;
    if (first && first.end > sec.schedule.startTime) sec.schedule.autoFinalizeMins = toMinutes(first.end) - toMinutes(sec.schedule.startTime);
    sec.schedule.scanWindowMins = Math.max(0, toMinutes(sec.schedule.startTime) - gate);
    return sec;
  }
  normalizeSections() {
    for (const sec of this.s.sections?.values?.() ?? []) this.normalizeSection(sec);
  }
  /* ---------- plumbing ---------- */
  // Tells every open screen that data changed so it reloads (grouped: at most once per moment).
  emit() {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.listeners.forEach((l) => l());
    }, 0);
  }
  // Screens call this to be told about changes. Returns a function that stops listening.
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  // Saves one document (in cloud mode this goes to Firestore).
  put(col, id, data) {
    this.persistence.put(col, id, data);
  }
  /** Cloud mode: apply a document that changed in Firestore. */
  applyRemote(col, id, data) {
    const s = this.s;
    if (col === 'meta') {
      if (id === 'school' && data) {
        s.meta = data;
        this.normalizeSections();
      }
      if (id === 'calendar' && data) {
        s.calendar = new Map((data.days ?? []).map((c) => [c.date, c]));
        s.calendarNotices = data.notices ?? [];
      }
    } else {
      const map = s[col];
      if (data === null) map.delete(id);
      else map.set(id, col === 'sections' ? this.normalizeSection(data) : data);
      // Classes added or removed (e.g. "Remove all school data", then "Load sample school"): the signed-in
      // person's class list must follow, or pages keep asking for classes that no longer exist.
      if (col === 'sections') this.sessionStale = true;
    }
    if (this.sessionStale && this.session) {
      const ids = this.session.role === 'admin' ? [...this.s.sections.values()].filter((x) => !x.archived).map((x) => x.id) : this.myClasses(this.session.teacherId).map((c) => c.id);
      if ([...ids].sort().join(',') !== [...this.session.sectionIds].sort().join(',')) this.refreshSession();
      this.sessionStale = false;
    }
    this.emit();
  }
  /** Classes a teacher handles, earliest start first. */
  classesOf(teacherId) {
    if (!teacherId) return [];
    return sortByStart([...this.s.sections.values()].filter((x) => x.teacherId === teacherId && !x.archived));
  }
  // ---------------------------------------------------------------------
  // TEACHER AWAY (a teacher is absent)
  // Saved inside the section's schedule, one entry per date:
  //   schedule.teacherAway = { '2026-11-05': { kind: 'substitute', teacherId: 't-ana', note, by, at } }
  //   kind 'substitute' = another teacher takes and confirms attendance that day
  //   kind 'noclass'    = no class for this section only: nobody is marked absent (see isSchoolDay in logic.js)
  // ---------------------------------------------------------------------
  awayOn(section, date) {
    return section?.schedule?.teacherAway?.[date] ?? null;
  }
  /** Classes another teacher handles today that this teacher covers as a substitute. */
  coveringToday(teacherId) {
    if (!teacherId) return [];
    const today = this.clock.today();
    return [...this.s.sections.values()].filter((x) => !x.archived && x.teacherId !== teacherId && this.awayOn(x, today)?.teacherId === teacherId);
  }
  // SUBJECT TEACHERS (Grades 4-6 may have a different teacher per subject): the admin lists them on the
  // section (section.subjectTeacherIds). They see the class list, so they know who was absent at first
  // period, and they can confirm a child who arrives during their period (the parent is texted).
  subjectClassesOf(teacherId) {
    if (!teacherId) return [];
    return [...this.s.sections.values()].filter((x) => !x.archived && x.teacherId !== teacherId && (x.subjectTeacherIds ?? []).includes(teacherId));
  }
  /** Own classes, classes taught as a subject teacher, and classes covered today. */
  myClasses(teacherId) {
    const all = [...this.classesOf(teacherId), ...this.subjectClassesOf(teacherId), ...this.coveringToday(teacherId)];
    return sortByStart([...new Map(all.map((c) => [c.id, c])).values()]);
  }
  // Remembers who is signed in. For a teacher it also works out their classes
  // (sectionIds) and which one is happening now (sectionId).
  setSession(account) {
    if (!account) {
      this.session = null;
      this.emit();
      return;
    }
    // The admin can open every class (Admin -> Attendance); a teacher sees their own classes
    // plus any class they cover as a substitute today.
    const classes =
      account.role === 'admin' ? [...this.s.sections.values()].filter((x) => !x.archived).sort(bySectionGrade) : this.myClasses(account.teacherId);
    const now = classNow(classes, this.clock.peek(), this.clock.today());
    this.session = {
      uid: account.uid,
      name: account.name,
      email: account.email,
      role: account.role,
      teacherId: account.teacherId,
      sectionIds: classes.map((c) => c.id),
      sectionId: now?.id ?? classes[0]?.id ?? null,
      coveringIds: account.role === 'admin' ? [] : this.coveringToday(account.teacherId).map((c) => c.id),
    };
    this.emit();
  }
  /** Re-derive the teacher's section after section data changes. */
  refreshSession() {
    if (!this.session) return;
    const acc = this.s.users.get(this.session.uid) ?? { ...this.session };
    this.setSession({
      ...acc,
      uid: this.session.uid,
      name: this.session.name,
      email: this.session.email,
      role: this.session.role,
      teacherId: this.session.teacherId,
    });
  }
  // '2026-10-29T07:45:00+08:00' — the current moment, used as the time stamp on texts and alerts.
  nowIso(date = this.clock.today()) {
    return `${date}T${this.clock.peek()}:00+08:00`;
  }
  // The name written in the audit log for changes ("System" if nobody is signed in).
  actor() {
    return this.session?.name ?? 'System';
  }
  // School settings. Saved settings from before the parent texts moved to "after the teacher confirms"
  // get the new template kinds (absent, laterPeriod, ...), and an untouched old default text is replaced
  // by the new default; anything the admin wrote is kept.
  get settings() {
    const saved = this.s.meta.settings;
    if (!saved || saved === this._settingsIn) return this._settingsOut ?? saved;
    this._settingsIn = saved;
    this._settingsOut = withTemplateDefaults(saved);
    return this._settingsOut;
  }
  get year() {
    return this.s.meta.schoolYear;
  }
  // Sections this person may change: all for the admin, only their own for a teacher.
  writableSections() {
    const all = [...this.s.sections.values()].filter((x) => !x.archived);
    if (!this.session) return [];
    return this.session.role === 'admin' ? all : all.filter((x) => this.session.sectionIds.includes(x.id));
  }
  // Section ids a teacher may see alerts and texts for ('all' = messages for everyone). null = admin sees all.
  visibleSectionIds() {
    if (!this.session || this.session.role === 'admin') return null; // null = all
    return new Set([...this.session.sectionIds, 'all']);
  }
  /* ---------- people ---------- */
  // The children in a section on a given date (A-Z). Uses enrollment dates, so a child who
  // moved or left still appears on the days they were in this class.
  rosterOn(sectionId, date) {
    const ids = new Set();
    for (const e of this.s.enrollments.values()) {
      if (e.sectionId !== sectionId || e.startDate > date) continue;
      if (e.endDate && e.endDate <= date) continue;
      ids.add(e.studentId);
    }
    return [...ids]
      .map((id) => this.s.students.get(id))
      .filter((x) => !!x && !x.id.includes('-old-'))
      .sort(byName);
  }
  // The child's current section placement (status 'active'), if any.
  activeEnrollment(studentId) {
    return [...this.s.enrollments.values()].find((e) => e.studentId === studentId && e.status === 'active');
  }
  // The parent or guardian linked to a child (siblings share one guardian).
  guardianOf(studentId) {
    for (const g of this.s.guardians.values()) if (g.studentIds.includes(studentId)) return g;
    return undefined;
  }
  // One child's status per day in a section: { '2026-10-29': 'present', ... } (for streaks).
  // It looks at EVERY class the child was in this year, so totals and streaks follow a child who
  // moved to another section. (A teacher only has their own classes loaded; the admin has all.)
  statusMap(sectionId, studentId) {
    const out = {};
    for (const [date, r] of this.recordsOf(studentId)) out[date] = r.status === 'late' && r.lateExcused ? 'present' : r.status;
    return out;
  }
  // One child's record per date across all sections: Map(date -> record). If two classes have a record
  // on the same date (the day the child moved), the one where the child came to school wins.
  recordsOf(studentId) {
    const out = new Map();
    const rank = (r) => (r.scannedAt ? 3 : 0) + (r.status === 'absent' ? 0 : 1);
    for (const day of this.s.attendance.values()) {
      const r = day.records[studentId];
      if (!r) continue;
      const have = out.get(day.date);
      if (!have || rank(r) > rank(have)) out.set(day.date, r);
    }
    return out;
  }
  // The child's current absence streak (see streakInfo in logic.js).
  streakFor(section, studentId, date) {
    return streakInfo(date, this.statusMap(section.id, studentId), section.schedule, this.s.calendar);
  }
  // One child's attendance record for one day, if there is one.
  record(sectionId, date, studentId) {
    return this.s.attendance.get(dayId(sectionId, date))?.records[studentId];
  }
  // The "absent" / "not in class" text this child's parent got today before being found in class
  // ({ earlierText: 'absent' | 'missing', earlierTextAt: '08:20' }), or {} if none.
  earlierText(studentId, date, prev) {
    if (prev?.earlierText) return { earlierText: prev.earlierText, earlierTextAt: prev.earlierTextAt };
    for (const [kind, id] of [['missing', `mis_${studentId}_${date}`], ['absent', `abs_${studentId}_${date}`], ['absent', `stk_${studentId}_${date}`]]) {
      const m = this.s.sms.get(id);
      if (m && m.status !== 'failed') return { earlierText: kind, earlierTextAt: manilaTime(new Date(m.createdAt)) };
    }
    return {};
  }
  // Saves one child's record inside that day's attendance document.
  writeRecord(rec) {
    const id = dayId(rec.sectionId, rec.date);
    const day = this.s.attendance.get(id) ?? { id, sectionId: rec.sectionId, date: rec.date, records: {} };
    day.records[rec.studentId] = rec;
    this.s.attendance.set(id, day);
    this.put('attendance', id, day);
  }
  /* ---------- SMS and alerts ---------- */
  // =====================================================================
  // SIGN-IN (the actual work is in firebase.js or demoAuth below)
  // =====================================================================
  async getSession() {
    await this.ready;
    return this.session;
  }
  async signIn(email, password) {
    const account = await this.auth.signIn(email.trim(), password);
    this.setSession(account);
    return this.session;
  }
  async signOut() {
    await this.auth.signOut();
    this.setSession(null);
  }
  async sendPasswordReset(email) {
    await this.auth.sendPasswordReset(email.trim());
  }
  // The signed-in teacher or admin changes their own password (Settings). At least 8 characters.
  async changePassword(current, next) {
    if (!this.session) throw new Error('Sign in again first.');
    if (next.length < 8) throw new Error('Use at least 8 characters.');
    if (next === current) throw new Error('The new password is the same as the current one.');
    await this.auth.changePassword(current, next);
    await this.logAudit('account.password', this.session.email, 'Changed own password');
  }
  demoAccounts() {
    return this.auth.demoAccounts();
  }
  /* ---------- shared reads ---------- */
  // =====================================================================
  // READING DATA (every screen uses these)
  // getToday: today's date and time. If today has no class it shows the most recent class day.
  // =====================================================================
  async getToday() {
    await this.ready;
    const actual = this.clock.today();
    const sec = this.session?.sectionId ? this.s.sections.get(this.session.sectionId) : [...this.s.sections.values()][0];
    const schedule = sec?.schedule ?? {
      classDays: [1, 2, 3, 4, 5],
      startTime: '08:00',
      endTime: '11:30',
      scanWindowMins: 30,
      lateCutoffMins: 15,
      autoFinalizeMins: 45,
    };
    const clamp = actual > this.year.end ? this.year.end : actual;
    // A teacher: their own class's days. The admin (no class of their own): the whole school, so today
    // counts if ANY class has class today (one grade suspended, or a section on a different schedule,
    // does not move the admin's "today" to yesterday).
    const active = [...this.s.sections.values()].filter((x) => !x.archived);
    const anyClass = (d) =>
      this.session?.sectionId || !active.length
        ? isSchoolDay(d, schedule, this.s.calendar)
        : active.some((x) => isSchoolDay(d, { ...x.schedule, gradeLevel: x.gradeLevel ?? 'K' }, this.s.calendar));
    let shown = clamp;
    for (let i = 0; i < 120 && !anyClass(shown); i++) shown = addDays(shown, -1);
    if (!anyClass(shown)) shown = clamp;
    return {
      date: shown,
      actualDate: actual,
      time: this.clock.peek(),
      simulated: this.clock.simulated(),
      isSchoolDay: anyClass(actual) && actual >= this.year.start && actual <= this.year.end,
    };
  }
  async getSettings() {
    await this.ready;
    return this.settings;
  }
  async getSchoolYear() {
    await this.ready;
    return this.year;
  }
  async listSections() {
    await this.ready;
    return [...this.s.sections.values()].sort(bySectionGrade);
  }
  async getSection(id) {
    await this.ready;
    const s = this.s.sections.get(id);
    if (!s) throw new Error('Section not found');
    return s;
  }
  async getCalendar() {
    await this.ready;
    return [...this.s.calendar.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  /* ---------- teacher ---------- */
}

// Adds the methods from the engine/ files to the Engine class (getters such as `limits` included).
for (const methods of [textsMethods, dailyMethods, attendanceMethods, parentPortalMethods, adminMethods]) {
  Object.defineProperties(Engine.prototype, Object.getOwnPropertyDescriptors(methods));
}

// Everything other files import from './engine' stays available here.
export { uid } from './engine/util';
export { realClock, DemoClock, noopPersistence, emptyState } from './engine/clocks';
export { DEMO_PASSWORD, schoolYear, settings, TEMPLATE_KINDS, withTemplateDefaults } from './engine/defaults';
export { rng, teachers, users, sections, demoAuth, buildDemoState } from './engine/sample';
