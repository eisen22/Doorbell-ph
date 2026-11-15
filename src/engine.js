import {
  classNow,
  sortByStart,
  addDays,
  decideScan,
  describeStreak,
  isSchoolDay,
  manilaTime,
  manilaToday,
  recentSchoolDays,
  renderTemplate,
  shouldAlertStreak,
  shouldAutoFinalize,
  classEnded,
  gradeRank,
  bySectionGrade,
  levelsLabel,
  classPeriods,
  hasSubjectTeachers,
  sampleProgram,
  sampleProgramFor,
  ordinal,
  autoFinalizeTime,
  streakInfo,
  to12h,
  toMinutes,
  fromMinutes,
  DEPED_SY_2026_2027,
  eachDate,
  isoWeekday,
  displayPhMobile,
  DEFAULT_LIMITS,
  attendanceTotals,
  totalLevels,
  describeTotal,
  parentKeyOf,
  defaultParentPassword,
  eldestChild,
  sha256Hex,
} from './logic';

// =====================================================================
// engine.js — THE HEART OF DOORBELL
// ---------------------------------------------------------------------
// The Engine class holds the school's data and does every action:
// scanning, statuses, confirming days, streak alerts, texts, sections,
// teachers, students and the calendar. Screens never touch the database
// directly; they call the engine (see useRepo() in ui.jsx).
//
// At the bottom of this file is the SAMPLE SCHOOL used by demo mode and
// by the admin's "Load sample school" button.
//
// Debugging tip: in the browser console you can look at the data with
//   window.doorbell.s.students   (see ui.jsx, where window.doorbell is set)
// =====================================================================
// =====================================================================
// CLOCKS: where the engine gets "today" and "now" from.
// realClock = the real Philippine date and time (cloud mode).
// =====================================================================
export const realClock = {
  today: () => manilaToday(),
  scanTime: () => manilaTime(),
  peek: () => manilaTime(),
  simulated: () => false,
};
/** Outside 6:30-9:30 AM the demo simulates a school morning, so scans are not all "late". */
// Demo clock: outside 6:30-9:30 AM it pretends it is a school morning (starting 8:06)
// and moves forward 1-3 minutes per scan, so demo scans are not all "late".
export class DemoClock {
  sim = toMinutes('08:06');
  inHours() {
    const m = toMinutes(manilaTime());
    return m >= toMinutes('06:30') && m <= toMinutes('09:30');
  }
  today() {
    return manilaToday();
  }
  scanTime() {
    if (this.inHours()) return manilaTime();
    this.sim += 1 + Math.floor(Math.random() * 3);
    return fromMinutes(this.sim);
  }
  peek() {
    return this.inHours() ? manilaTime() : fromMinutes(this.sim);
  }
  simulated() {
    return !this.inHours();
  }
}
// Demo mode saves nothing: put() and remove() do nothing, so data resets when the tab closes.
export const noopPersistence = { put() {}, remove() {} };
// The whole school in memory. Each collection is a Map (id -> document), the same
// names as the Firestore collections. `meta` holds { settings, schoolYear }.
export function emptyState(meta, calendar = []) {
  return {
    meta,
    calendar: new Map(calendar.map((c) => [c.date, c])),
    users: new Map(),
    sections: new Map(),
    teachers: new Map(),
    students: new Map(),
    guardians: new Map(),
    enrollments: new Map(),
    attendance: new Map(),
    confirmations: new Map(),
    sms: new Map(),
    notifications: new Map(),
    audit: new Map(),
    excuses: new Map(), // excuse requests from the parent portal
  };
}
// Attendance and confirmation documents are named '<sectionId>_<date>', e.g. 'sec-apple_2026-10-29'.
const dayId = (sectionId, date) => `${sectionId}_${date}`;
// '2026-10-30' -> 'Fri, Oct 30' (used in alert titles).
const fmtDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' });
// True when two class schedules share a weekday AND their times overlap (a teacher cannot be in two places).
const schedulesOverlap = (a, b) =>
  a.classDays.some((d) => b.classDays.includes(d)) && toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime);
let counter = 0;
// Makes a new unique id with a prefix, e.g. uid('stu') -> 'stu-lq2x9k0a1b'.
export const uid = (p) => `${p}-${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// Sorts children by last name, then first name.
const byName = (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
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
      if (id === 'calendar' && data) s.calendar = new Map((data.days ?? []).map((c) => [c.date, c]));
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
  // SMS AND ALERTS
  // queueSms builds a text to the child's guardian and saves it in the 'sms' collection:
  //   Settings -> "How texts are sent" = Simulated: status 'sent' at once (nothing really goes out)
  //   Settings -> "How texts are sent" = Semaphore: status 'queued'; the Cloudflare Worker
  //     (worker/src/index.js) sends it and changes it to 'sent' or 'failed'
  //   Settings -> "How texts are sent" = Gate phone (SIM): status 'queued'; the Doorbell Gate app
  //     (gate-app/.../SmsGateway.kt) sends it from the phone's SIM and changes it to 'sent' or 'failed'
  // A number the office marked as failed is saved as 'failed' straight away.
  // No text is sent when the guardian did not give SMS consent, or when arrival texts are turned off.
  //   kind: 'arrival' | 'late' | 'streak'
  //   opts.auto: the class was auto-confirmed (no teacher checked), so the arrivalAuto / lateAuto wording
  //   is used: "arrived at school", never "is in class".
  // Arrival and late texts are sent when the class is CONFIRMED (finalize), not at the gate scan, so a
  // parent is never told "in class" before the teacher has seen the child in the classroom.
  // =====================================================================
  queueSms(student, kind, opts) {
    const g = this.guardianOf(student.id);
    if (!g || !g.smsConsent) return null;
    if ((kind === 'arrival' || kind === 'late') && !this.settings.arrivalSmsEnabled) return null;
    // One arrival/late text per child per day (confirming, then editing a status, does not text twice).
    if ((kind === 'arrival' || kind === 'late') && this.s.sms.has(opts.id ?? `arr_${student.id}_${opts.date}`)) return null;
    if (kind === 'absent' && this.settings.absentSmsEnabled === false) return null;
    // One total text per limit per month/semester, one "not in class" / "absent" text per day (opts.id says which).
    if ((kind === 'total' || kind === 'missing' || kind === 'absent') && this.s.sms.has(opts.id)) return null;
    if (kind === 'streak' && this.s.sms.has(`stk_${student.id}_${opts.date}`)) return null;
    const tpl = this.settings.templates[g.preferredLanguage] ?? this.settings.templates.en;
    const key = opts.template ?? kind;
    const ord = (n) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'}`;
    const body = renderTemplate(tpl[key] ?? this.settings.templates.en[key], {
      child: student.firstName,
      time: opts.time ? to12h(opts.time) : '',
      school: this.settings.schoolName,
      contact: this.settings.contactNumber,
      streak: opts.streak ? describeStreak(opts.streak, g.preferredLanguage) : '',
      summary: opts.metric ? describeTotal(opts.metric, opts.count, g.preferredLanguage) : '',
      period: opts.period
        ? `${g.preferredLanguage === 'fil' ? `ika-${opts.period} na period` : `${ord(opts.period)} period`}${opts.subject ? `, ${opts.subject}` : ''}`
        : '',
    });
    // Deterministic ids: two devices processing the same event write the same document once.
    const id = kind === 'total' || kind === 'missing' || kind === 'absent' ? opts.id : kind === 'streak' ? `stk_${student.id}_${opts.date}` : (opts.id ?? `arr_${student.id}_${opts.date}`);
    const failed = g.numberStatus === 'failed';
    const msg = {
      id,
      studentId: student.id,
      guardianId: g.id,
      sectionId: opts.sectionId,
      to: g.mobile,
      body,
      kind,
      status: failed ? 'failed' : this.newSmsStatus(),
      createdAt: opts.createdAt ?? this.nowIso(opts.date),
      // When it was really put in the queue. A day confirmed late (e.g. Thursday confirmed on Friday) makes
      // texts with an old createdAt; the gate phone checks this time instead, so they are still sent.
      queuedAt: new Date().toISOString(),
      attempts: 1,
    };
    this.s.sms.set(id, msg);
    this.put('sms', id, msg);
    if (failed) {
      const n = {
        id: `smsf_${id}`,
        kind: 'sms_failed',
        studentId: student.id,
        sectionId: opts.sectionId,
        createdAt: msg.createdAt,
        read: false,
        title: `Text to ${student.firstName} ${student.lastName}'s guardian did not go through`,
        body: `${g.name}'s number could not be reached. Ask the office to update it, or call the family.`,
      };
      this.s.notifications.set(n.id, n);
      this.put('notifications', n.id, n);
    }
    return msg;
  }
  // Checks one child's streak after a day is confirmed. When it reaches the threshold
  // (Admin -> Settings, default 3) the parent is texted and the teacher gets an alert.
  // text = false: only the alert for staff (a day nobody confirmed, or a correction to an old day).
  checkStreak(section, stu, date, at, text = true) {
    const info = this.streakFor(section, stu.id, date);
    if (!shouldAlertStreak(info.count, this.settings.streakDays)) return;
    if (this.s.notifications.has(`stk_${stu.id}_${date}`)) return; // already handled
    const sms = text ? this.queueSms(stu, 'streak', { streak: info, date, sectionId: section.id, createdAt: at }) : null;
    const g = this.guardianOf(stu.id);
    const dates = [...info.dates]
      .reverse()
      .map((d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }))
      .join(', ');
    const n = {
      id: `stk_${stu.id}_${date}`,
      kind: 'streak',
      studentId: stu.id,
      sectionId: section.id,
      streak: info,
      createdAt: at,
      read: false,
      title: `${stu.firstName} ${stu.lastName} was ${describeStreak(info)}`,
      body: `${dates}. ${sms ? `${g?.name ?? 'The guardian'} was sent an SMS.` : text ? 'No SMS sent (no consent on file). Please call the family.' : 'No SMS sent (the class was not confirmed by a teacher). Please call the family.'}`,
    };
    this.s.notifications.set(n.id, n);
    this.put('notifications', n.id, n);
  }
  // The limits for totals (Settings -> Attendance limits), filled in with the defaults.
  get limits() {
    const mine = this.settings.limits ?? {};
    const out = {};
    for (const k of Object.keys(DEFAULT_LIMITS)) out[k] = { ...DEFAULT_LIMITS[k], ...(mine[k] ?? {}) };
    return out;
  }
  // One child's absences and lates this month and this semester (not in a row), with their levels.
  totalsFor(section, studentId, date) {
    const t = attendanceTotals(date, this.statusMap(section.id, studentId), section.schedule, this.s.calendar, this.year, this.settings.semester2Start);
    return { ...t, levels: totalLevels(t, this.limits) };
  }
  // =====================================================================
  // TOTALS (not in a row): after a class is confirmed, each child's month and semester totals are
  // checked. At "alert" the parent gets ONE text per limit per month/semester; at "serious" the
  // teacher and admin are told to hold a parent conference. "watch" only shows in Absence Watch.
  // =====================================================================
  checkTotals(section, stu, date, at, text = true) {
    const t = this.totalsFor(section, stu.id, date);
    const g = this.guardianOf(stu.id);
    for (const [metric, level] of Object.entries(t.levels)) {
      if (level !== 'alert' && level !== 'serious') continue;
      const month = metric.endsWith('Month');
      const period = month ? t.monthKey : `${this.year.id ?? this.year.start}-${t.semesterKey}`;
      const n = metric.startsWith('absent') ? (month ? t.month.absent : t.semester.absent) : month ? t.month.late : t.semester.late;
      const id = `tot_${stu.id}_${metric}_${period}_${level}`;
      if (this.s.notifications.has(id)) continue; // already handled for this period and level
      const sms = level === 'alert' && text ? this.queueSms(stu, 'total', { id, metric, count: n, date, sectionId: section.id, createdAt: at }) : null;
      const what = describeTotal(metric, n);
      const n2 = {
        id,
        kind: 'total',
        level,
        studentId: stu.id,
        sectionId: section.id,
        createdAt: at,
        read: false,
        title: `${stu.firstName} ${stu.lastName} has been ${what}`,
        body:
          level === 'serious'
            ? `This reaches the serious limit. Ask the admin to set a parent conference${g ? ` with ${g.name}` : ''}.`
            : sms
              ? `${g?.name ?? 'The guardian'} was sent an SMS.`
              : 'No SMS sent (no consent on file). Please call the family.',
      };
      this.s.notifications.set(id, n2);
      this.put('notifications', id, n2);
    }
  }
  // Children at the watch level or higher for any total, worst first (Absence Watch -> Totals).
  async listTotals() {
    const today = await this.getToday();
    const vis = this.visibleSectionIds();
    const rank = { serious: 3, alert: 2, watch: 1 };
    const out = [];
    for (const section of this.s.sections.values()) {
      if (section.archived || (vis && !vis.has(section.id))) continue;
      for (const row of await this.getRoster(section.id, today.date)) {
        const t = this.totalsFor(section, row.student.id, today.date);
        const worst = Math.max(0, ...Object.values(t.levels).map((l) => rank[l] ?? 0));
        if (!worst) continue;
        const smsSent = [...this.s.sms.values()].some((m) => m.kind === 'total' && m.studentId === row.student.id && (m.id.includes(`_${t.monthKey}_`) || m.id.includes(`-${t.semesterKey}_`)));
        out.push({ student: row.student, guardian: row.guardian, section, totals: t, worst, smsSent });
      }
    }
    return out.sort((a, b) => bySectionGrade(a.section, b.section) || b.worst - a.worst || b.totals.semester.absent - a.totals.semester.absent || byName(a.student, b.student));
  }
  // =====================================================================
  // CONFIRMING A CLASS (finalize) AND THE PARENT TEXTS
  // Only a TEACHER (or the admin) confirms a class. What the parent gets, and when:
  //   1. At confirmation (today only):
  //        present / late      -> "is in class, confirmed by the teacher"
  //        scanned but absent  -> "entered the school but is not in class" (staff are alerted the
  //                               moment the teacher marks the child Absent)
  //        not scanned, absent -> nothing yet (the child may still arrive)
  //   2. At the absence text time (end of first period: start + autoFinalizeMins), runAbsence():
  //        still absent -> "As of 9:00 AM, {child} has not arrived at school", then the 3-day and
  //        limit texts. If the class is confirmed after that time, this runs right away.
  //   3. A child who arrives after confirmation waits for the teacher (recordScan -> needsCheck);
  //      when the teacher marks them Present or Late the parent gets the text with the arrival time.
  // A class NOBODY confirmed is closed quietly after it ends (auto = true): scanned children are
  // recorded from the gate, the rest absent, NO parent texts, and staff get an alert. If there is
  // no scan and no mark at all, nobody is marked absent (there is simply no data for that day).
  // Confirming or closing a PAST day never texts parents.
  // =====================================================================
  finalize(sectionId, date, by, auto, at = this.nowIso(date)) {
    const existing = this.s.confirmations.get(dayId(sectionId, date));
    if (existing) return existing;
    const section = this.s.sections.get(sectionId);
    const roster = this.rosterOn(sectionId, date);
    const id = dayId(sectionId, date);
    if (auto && !roster.length) return null; // the class had no children yet on that day
    const day = this.s.attendance.get(id) ?? { id, sectionId, date, records: {} };
    const noData = auto && !roster.some((stu) => day.records[stu.id]);
    // The time the teacher confirmed each child in class (shown to the parent in the parent portal).
    if (!auto) {
      const hhmm = at.slice(11, 16);
      for (const stu of roster) {
        const rec = day.records[stu.id];
        if (rec && (rec.status === 'present' || rec.status === 'late') && !rec.confirmedAt) rec.confirmedAt = hhmm;
      }
    }
    if (!noData) {
      for (const stu of roster) {
        if (day.records[stu.id]) continue;
        // The teacher already approved a parent's excuse for this day (Parent portal): excused, not absent.
        const ex = this.approvedExcuse(stu.id, date);
        day.records[stu.id] = ex
          ? { date, studentId: stu.id, sectionId, status: 'excused', source: 'excuse', excusedNote: `Parent: ${ex.reason}` }
          : { date, studentId: stu.id, sectionId, status: 'absent', source: 'auto' };
      }
      this.s.attendance.set(id, day);
      this.put('attendance', id, day);
    }
    const conf = { id, sectionId, date, confirmedBy: by, confirmedAt: at, auto, ...(noData ? { noData: true } : {}) };
    this.s.confirmations.set(id, conf);
    this.put('confirmations', id, conf);
    const today = this.clock.today();
    if (auto) {
      // Nobody confirmed: tell the staff, never the parents.
      const n = {
        id: `unc_${id}`,
        kind: 'cover',
        sectionId,
        createdAt: at,
        read: false,
        title: `${section?.name ?? 'A class'} was not confirmed by a teacher on ${fmtDay(date)}`,
        body: noData
          ? 'No child was scanned or marked that day, so nobody was marked absent. If there was class, open Attendance for that day and fix it.'
          : 'It was closed automatically: children scanned at the gate are recorded from the scan, the others as absent. Parents were not texted. Check the list and correct it if needed.',
      };
      this.s.notifications.set(n.id, n);
      this.put('notifications', n.id, n);
      if (!noData) this.runAbsence(section, date, at, false);
    } else {
      const live = date === today || !!this.backfill;
      const confirmedAt = at.slice(11, 16);
      if (live) {
        for (const stu of roster) {
          const rec = day.records[stu.id];
          if (rec?.status === 'present' || rec?.status === 'late') {
            this.queueSms(stu, rec.status === 'late' ? 'late' : 'arrival', { time: rec.scannedAt ?? confirmedAt, date, sectionId, createdAt: at });
          } else if (rec?.status === 'absent' && rec.scannedAt) {
            // Scanned at the gate, not in the room, and the teacher has finished checking: tell the parent.
            this.queueSms(stu, 'missing', { id: `mis_${stu.id}_${date}`, time: rec.scannedAt, date, sectionId, createdAt: at });
          }
        }
      }
      // Confirmed after the absence text time (or an old day confirmed by hand): do that step now.
      if (date !== today || shouldAutoFinalize(this.clock.peek(), section.schedule)) this.runAbsence(section, date, at, live);
    }
    // The parent portal now shows this day (it only shows days the class has confirmed).
    this.syncParentDays(roster.map((x) => x.id), [date.slice(0, 7)]);
    return conf;
  }
  // The absence step for one confirmed class day (see the box above). Runs once per class per day:
  // a hidden marker (notifications/absrun_<class>_<date>) remembers it, for the website and the Worker.
  // text = false: only staff alerts (a day nobody confirmed, or an old day).
  runAbsence(section, date, at = this.nowIso(date), text = true) {
    const mark = `absrun_${dayId(section.id, date)}`;
    if (this.s.notifications.has(mark) || this._absDone?.has(mark)) return;
    (this._absDone ??= new Set()).add(mark);
    const asOf = at.slice(11, 16);
    let texted = 0;
    for (const stu of this.rosterOn(section.id, date)) {
      const rec = this.record(section.id, date, stu.id);
      // On the day a 3-day streak is reached the parent gets that (stronger) text instead of the plain absence text.
      const streakToday = shouldAlertStreak(this.streakFor(section, stu.id, date).count, this.settings.streakDays) && !this.s.notifications.has(`stk_${stu.id}_${date}`);
      if (text && rec?.status === 'absent' && !rec.scannedAt && !(streakToday && this.guardianOf(stu.id)?.smsConsent)) {
        if (this.queueSms(stu, 'absent', { id: `abs_${stu.id}_${date}`, time: asOf, date, sectionId: section.id, createdAt: at })) texted += 1;
      }
      this.checkStreak(section, stu, date, at, text);
      this.checkTotals(section, stu, date, at, text);
    }
    // The marker is only needed today (the Worker and other screens check it); past days are done at once.
    if (date === this.clock.today()) {
      const n = { id: mark, kind: 'system', sectionId: section.id, createdAt: at, read: true, title: `Absence texts for ${section.name}: ${texted}` };
      this.s.notifications.set(mark, n);
      this.put('notifications', mark, n);
    }
  }
  // Runs every minute while the website is open (and in the Cloudflare Worker every 5 minutes):
  //   - today, a class a teacher confirmed, once the absence text time passes: runAbsence()
  //   - a class nobody confirmed: closed quietly after the class ends (and any past day)
  catchUp() {
    const today = this.clock.today();
    const now = this.clock.peek();
    const end = today < this.year.end ? today : this.year.end;
    for (const sec of this.writableSections()) {
      // A substitute may only confirm the covered class TODAY (firestore.rules allows only that date).
      const own = this.session.role === 'admin' || sec.teacherId === this.session.teacherId;
      // Looks back 14 days at most (a class left unconfirmed longer than that is fixed by hand).
      const from = addDays(today, -14) > this.year.start ? addDays(today, -14) : this.year.start;
      for (let d = own ? from : today; d <= end; d = addDays(d, 1)) {
        if (!isSchoolDay(d, sec.schedule, this.s.calendar)) continue;
        const conf = this.s.confirmations.get(dayId(sec.id, d));
        if (!conf) {
          // Stamped with the class's end time on that day, not the moment the app happened to be opened.
          if (d < today || classEnded(now, sec.schedule)) this.finalize(sec.id, d, 'Not confirmed', true, `${d}T${sec.schedule.endTime}:00+08:00`);
        } else if (d === today && !conf.auto && shouldAutoFinalize(now, sec.schedule)) {
          this.runAbsence(sec, d);
        }
      }
    }
    this.emit();
  }
  /* ---------- auth ---------- */
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
    const shown = recentSchoolDays(clamp, 1, schedule, this.s.calendar, 120)[0] ?? clamp;
    return {
      date: shown,
      actualDate: actual,
      time: this.clock.peek(),
      simulated: this.clock.simulated(),
      isSchoolDay: isSchoolDay(actual, schedule, this.s.calendar) && actual >= this.year.start && actual <= this.year.end,
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
  // =====================================================================
  // TEACHER ACTIONS
  // getRoster: the class list for a day, each child with their guardian, record and streak.
  // =====================================================================
  async getRoster(sectionId, date) {
    const sec = await this.getSection(sectionId);
    const prev = recentSchoolDays(addDays(date, -1), 1, sec.schedule, this.s.calendar)[0];
    return this.rosterOn(sectionId, date).map((student) => {
      const record = this.record(sectionId, date, student.id);
      return {
        student,
        guardian: this.guardianOf(student.id),
        record,
        // Not scanned yet today: show the streak as of the previous school day.
        streak: record || !prev ? this.streakFor(sec, student.id, date) : this.streakFor(sec, student.id, prev),
      };
    });
  }
  // All records of a section between two dates (for the weekly card and Excel reports).
  async getAttendanceRange(sectionId, from, to) {
    await this.ready;
    const out = [];
    for (const day of this.s.attendance.values()) {
      if (day.sectionId === sectionId && day.date >= from && day.date <= to) out.push(...Object.values(day.records));
    }
    return out;
  }
  // The confirmation of a day (who confirmed and when), or null if not yet confirmed.
  async getConfirmation(sectionId, date) {
    await this.ready;
    return this.s.confirmations.get(dayId(sectionId, date)) ?? null;
  }
  // A card was scanned. Steps:
  //  1. find the child by the code on the card (unknown / revoked card -> stop)
  //  2. check the child belongs to this section and today is a school day
  //  3. decideScan(): ignore a double beep, keep the first scan of the day, or record present/late
  //  4. save the record. NO text is sent at the gate.
  // Before the class is confirmed the scan pre-fills Present / Late on the teacher's list.
  // AFTER the class is confirmed:
  //   - the teacher already marked the child Present / Late / Excused (e.g. forgot the ID): only the
  //     scan time is added, the status stays;
  //   - the child was absent: the record becomes present/late with needsCheck = true, staff are alerted,
  //     and the parent is texted only when the teacher confirms the child in class (setStatus).
  // The same steps are in the gate app: gate-app/.../GateRepository.kt scan().
  async recordScan({ qrToken, sectionId }) {
    await this.ready;
    const token = qrToken.trim();
    const student = [...this.s.students.values()].find((s) => s.qrToken === token);
    if (!student) return { kind: 'unknown' };
    if (student.qrStatus === 'revoked') return { kind: 'revoked', student };
    const enr = this.activeEnrollment(student.id);
    const sec = enr ? this.s.sections.get(enr.sectionId) : undefined;
    if (!sec || (sectionId && sec.id !== sectionId)) return { kind: 'wrong_section', student };
    const today = this.clock.today();
    const time = this.clock.scanTime();
    if (!isSchoolDay(today, sec.schedule, this.s.calendar) || today < this.year.start || today > this.year.end) {
      // CHILD SAFETY: the class was cancelled for today (teacher absent) but the child came anyway.
      if (this.awayOn(sec, today)?.kind === 'noclass' && today >= this.year.start && today <= this.year.end) {
        const n = {
          id: `oncampus_${student.id}_${today}`,
          kind: 'missing',
          studentId: student.id,
          sectionId: sec.id,
          createdAt: this.nowIso(today),
          read: false,
          title: `${student.firstName} ${student.lastName} came to school at ${to12h(time)} but ${sec.name} has no class today`,
          body: 'The class was cancelled because the teacher is absent. Keep the child with a staff member and call the guardian.',
        };
        if (!this.s.notifications.has(n.id)) {
          this.s.notifications.set(n.id, n);
          this.put('notifications', n.id, n);
          this.emit();
        }
      }
      return { kind: 'not_school_day', student };
    }
    const last = this.lastScanAt.get(token);
    const nowMs = Date.now();
    this.lastScanAt.set(token, nowMs);
    const existing = this.record(sec.id, today, student.id);
    // LEAVING SCHOOL: the card is scanned again 30 minutes or more after the child came in (or, for a child
    // the teacher marked present without a scan, in the last hour of class): the time out is saved and shown
    // to the parent in the parent portal. No text and no alert.
    if (existing && (last === undefined || (nowMs - last) / 1000 >= 10)) {
      const sinceIn = existing.scannedAt ? toMinutes(time) - toMinutes(existing.scannedAt) : null;
      const manualPresent = !existing.scannedAt && (existing.status === 'present' || existing.status === 'late');
      if ((sinceIn !== null && sinceIn >= 30) || (manualPresent && toMinutes(time) >= toMinutes(sec.schedule.endTime) - 60)) {
        this.writeRecord({ ...existing, scannedOut: time });
        this.syncParentDays([student.id], [today.slice(0, 7)]);
        this.emit();
        return { kind: 'out', student, time };
      }
    }
    const decision = decideScan({
      time,
      schedule: sec.schedule,
      existingScanAt: existing?.scannedAt,
      secondsSinceLastSameCode: last ? (nowMs - last) / 1000 : undefined,
    });
    if (decision.kind === 'ignore') return { kind: 'ignore' };
    if (decision.kind === 'duplicate') return { kind: 'duplicate', student, firstScanAt: decision.firstScanAt };
    const locked = this.s.confirmations.has(dayId(sec.id, today));
    // The teacher already marked this child (present, late or excused) without a scan: keep that, add the scan time.
    if (existing && (existing.status === 'present' || existing.status === 'late')) {
      this.writeRecord({ ...existing, scannedAt: time });
      this.emit();
      return { kind: 'recorded', student, status: existing.status, time };
    }
    const status = decision.status;
    this.writeRecord({
      date: today,
      studentId: student.id,
      sectionId: sec.id,
      status,
      scannedAt: time,
      source: 'scanner',
      ...(locked ? { needsCheck: true, editedReason: 'Arrived after attendance was confirmed' } : {}),
    });
    if (locked) {
      await this.logAudit('attendance.scan_after_lock', `${student.firstName} ${student.lastName}`, `scanned at ${time}, waiting for the teacher`);
      const n = {
        id: `late_${student.id}_${today}`,
        kind: 'missing',
        studentId: student.id,
        sectionId: sec.id,
        createdAt: this.nowIso(today),
        read: false,
        title: `${student.firstName} ${student.lastName} scanned at the gate at ${to12h(time)}, after attendance was confirmed`,
        body: `Check that ${student.firstName} is in ${sec.name}, then mark Present or Late on the Attendance page. The parent is texted when you do.`,
      };
      this.s.notifications.set(n.id, n);
      this.put('notifications', n.id, n);
    }
    this.emit();
    return { kind: 'recorded', student, status, time, needsCheck: locked };
  }
  // A teacher changes a status by hand, before or after confirming (every change is saved in the audit log).
  // Parent texts are only sent for TODAY: correcting an older day never texts anyone.
  async setStatus(input) {
    await this.ready;
    const locked = this.s.confirmations.has(dayId(input.sectionId, input.date));
    const prev = this.record(input.sectionId, input.date, input.studentId);
    const live = input.date === this.clock.today();
    const section = this.s.sections.get(input.sectionId);
    const inClass = input.status === 'present' || input.status === 'late';
    // A subject teacher confirmed the child in a later period (2, 3, ...): saved with the record so the
    // class list and the parent portal show "joined at the 2nd period (English)".
    const joined = inClass && locked && Number(input.period) > 1
      ? { joinedPeriod: Number(input.period), joinedSubject: classPeriods(section?.program)[Number(input.period) - 1]?.subject }
      : inClass && prev?.joinedPeriod
        ? { joinedPeriod: prev.joinedPeriod, joinedSubject: prev.joinedSubject }
        : {};
    // The parent was already texted "absent" (or "entered the school but not in class") before the child
    // was found in class: kept with the record so the portal shows both texts in order.
    const earlier = inClass ? this.earlierText(input.studentId, input.date, prev) : {};
    this.writeRecord({
      date: input.date,
      studentId: input.studentId,
      sectionId: input.sectionId,
      status: input.status,
      scannedAt: prev?.scannedAt,
      scannedOut: prev?.scannedOut,
      // Confirmed in class by a teacher after the class was confirmed: the time is shown to the parent.
      confirmedAt:
        (input.status === 'present' || input.status === 'late') && locked
          ? prev?.confirmedAt && !prev.needsCheck && prev.status !== 'absent'
            ? prev.confirmedAt
            : this.clock.peek()
          : undefined,
      source: 'manual',
      excusedNote: input.status === 'excused' ? input.note : undefined,
      editedReason: input.reason,
      ...joined,
      ...earlier,
    });
    const stu = this.s.students.get(input.studentId);
    await this.logAudit(
      'attendance.edit',
      stu ? `${stu.firstName} ${stu.lastName}` : input.studentId,
      `${input.date}: ${prev?.status ?? 'none'} -> ${input.status}${input.reason ? ` (${input.reason})` : ''}`,
    );
    const absenceDone = input.date < this.clock.today() || this.s.notifications.has(`absrun_${dayId(input.sectionId, input.date)}`);
    if (stu && input.status !== 'absent') {
      // The child is accounted for: close any open "not in class" / "arrived after confirming" alert.
      const wasMissing = this.resolveAlerts(stu, input.date, input.status);
      // After confirming, the teacher marks a child present or late: the parent gets the "in class" text
      // (once a day; if the parent was told "not in class" earlier, a new text says the child is in class now).
      if (locked && live && (input.status === 'present' || input.status === 'late')) {
        const again = wasMissing && this.s.sms.has(`mis_${stu.id}_${input.date}`);
        // input.period (2, 3, ...): a subject teacher confirmed the child in a later period.
        const later = Number(input.period) > 1;
        this.queueSms(stu, input.status === 'late' || later ? 'late' : 'arrival', {
          time: prev?.scannedAt ?? this.clock.peek(),
          date: input.date,
          sectionId: input.sectionId,
          ...(later ? { template: 'laterPeriod', period: Number(input.period), subject: classPeriods(section?.program)[Number(input.period) - 1]?.subject } : {}),
          ...(again ? { id: `arr_${stu.id}_${input.date}_found` } : {}),
        });
      }
    }
    if (stu && input.status === 'absent') {
      if (prev?.scannedAt) {
        // CHILD SAFETY: scanned at the gate but marked absent in class = the child is in school but missing.
        // Staff are alerted now. The parent is texted when the class is confirmed (now, if it already is).
        await this.alertMissing(stu, input.sectionId, input.date, prev.scannedAt, locked && live);
      } else if (locked && live && absenceDone) {
        // Marked absent after the absence texts already went out: this child's text goes now.
        this.queueSms(stu, 'absent', { id: `abs_${stu.id}_${input.date}`, time: this.clock.peek(), date: input.date, sectionId: input.sectionId });
      }
    }
    // Streak and limit alerts follow the change once the day's absence step has run (texts only today).
    if (locked && stu && section && absenceDone && (input.status === 'absent' || input.status === 'late')) {
      this.checkStreak(section, stu, input.date, this.nowIso(), live);
      this.checkTotals(section, stu, input.date, this.nowIso(), live);
    }
    // A change to a confirmed day (or a past day) also changes what the parent portal shows.
    if (locked || input.date < this.clock.today()) this.syncParentDays([input.studentId], [input.date.slice(0, 7)]);
    this.emit();
  }
  // Marks the open "not in class" alerts of a child as resolved. Returns true if there was one.
  resolveAlerts(stu, date, status) {
    let any = false;
    for (const id of [`miss_${stu.id}_${date}`, `late_${stu.id}_${date}`]) {
      const n = this.s.notifications.get(id);
      if (!n || n.resolved) continue;
      any = any || id.startsWith('miss_');
      Object.assign(n, {
        resolved: true,
        read: true,
        title: `Resolved: ${n.title}`,
        body: `Marked ${status} at ${to12h(this.clock.peek())} by ${this.actor()}. ${n.body}`,
      });
      this.put('notifications', id, n);
    }
    return any;
  }
  // Raises an urgent alert (admin Overview + the teacher's Alerts): the gate saw the child, the classroom did not.
  // textParent: the class is already confirmed, so the parent is told now; otherwise at confirmation (finalize).
  async alertMissing(stu, sectionId, date, scannedAt, textParent) {
    const sec = this.s.sections.get(sectionId);
    const g = this.guardianOf(stu.id);
    const n = {
      id: `miss_${stu.id}_${date}`,
      kind: 'missing',
      studentId: stu.id,
      sectionId,
      createdAt: this.nowIso(date),
      read: false,
      title: `${stu.firstName} ${stu.lastName} was scanned at the gate at ${to12h(scannedAt)} but is not in class`,
      body: `Marked absent in ${sec?.name ?? 'class'} by ${this.actor()}. Look for the child now (gate, office, comfort rooms, other rooms)${
        g ? `, then call ${g.name} at ${displayPhMobile(g.mobile)}` : ''
      }. ${textParent ? 'The parent was sent a text that the child is not in class.' : 'If the child is not found, the parent is texted when you confirm attendance.'}`,
    };
    this.s.notifications.set(n.id, n);
    this.put('notifications', n.id, n);
    if (textParent) this.queueSms(stu, 'missing', { id: `mis_${stu.id}_${date}`, time: scannedAt, date, sectionId, createdAt: this.nowIso(date) });
    await this.logAudit('attendance.missing_after_scan', `${stu.firstName} ${stu.lastName}`, `scanned ${scannedAt}, marked absent`);
  }
  // The teacher presses "Confirm attendance" (same as finalize, plus an audit entry).
  async confirmDay(sectionId, date) {
    await this.ready;
    const conf = this.finalize(sectionId, date, this.actor(), false);
    await this.logAudit('attendance.confirm', this.s.sections.get(sectionId)?.name ?? sectionId, date);
    this.emit();
    return conf;
  }
  // Demo helper: scans a random child who has not arrived yet.
  async simulateScan(sectionId) {
    const today = this.clock.today();
    const waiting = this.rosterOn(sectionId, today).filter((s) => !this.record(sectionId, today, s.id)?.scannedAt);
    if (!waiting.length) return { kind: 'ignore' };
    return this.recordScan({ qrToken: waiting[Math.floor(Math.random() * waiting.length)].qrToken, sectionId });
  }
  // Alerts this person may see, newest first.
  async listNotifications() {
    await this.ready;
    const vis = this.visibleSectionIds();
    return [...this.s.notifications.values()]
      .filter((n) => n.kind !== 'system' && (!vis || (n.sectionId && vis.has(n.sectionId))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  // Marks alerts as read (all of them, or only the ids given).
  async markNotificationsRead(ids) {
    for (const n of await this.listNotifications()) {
      if (n.read || (ids && !ids.includes(n.id))) continue;
      n.read = true;
      this.put('notifications', n.id, n);
    }
    this.emit();
  }
  // Texts this person may see, newest first.
  async listSms(limit = 300) {
    await this.ready;
    const vis = this.visibleSectionIds();
    return [...this.s.sms.values()]
      .filter((m) => !vis || !m.sectionId || vis.has(m.sectionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
  // 'queued' when real texts are on (sent by the Cloudflare Worker through Semaphore, or by the
  // Doorbell Gate app from the gate phone's SIM), 'sent' in simulated mode.
  newSmsStatus() {
    return ['semaphore', 'phone'].includes(this.settings.smsProvider) ? 'queued' : 'sent';
  }
  // Tries a failed text again (still fails if the number is marked failed).
  async resendSms(id) {
    const m = this.s.sms.get(id);
    if (!m) return;
    const g = m.guardianId ? this.s.guardians.get(m.guardianId) : undefined;
    m.attempts += 1;
    m.status = g?.numberStatus === 'failed' ? 'failed' : this.newSmsStatus();
    m.queuedAt = this.nowIso(); // the gate phone does not send texts that waited over 12 hours: this restarts the clock
    delete m.error;
    this.put('sms', id, m);
    await this.logAudit('sms.resend', m.to, m.status);
    this.emit();
  }
  // Children absent `minDays` or more school days in a row, longest streak first (dashboard and Absence Watch).
  async listAttention(minDays = 2) {
    const today = await this.getToday();
    const vis = this.visibleSectionIds();
    const out = [];
    for (const section of this.s.sections.values()) {
      if (section.archived || (vis && !vis.has(section.id))) continue;
      for (const row of await this.getRoster(section.id, today.date)) {
        if (row.streak.count < minDays) continue;
        const oldest = row.streak.dates[row.streak.dates.length - 1];
        const smsSent = [...this.s.sms.values()].some(
          (m) => m.kind === 'streak' && m.studentId === row.student.id && m.createdAt.slice(0, 10) >= oldest,
        );
        out.push({ student: row.student, guardian: row.guardian, section, streak: row.streak, smsSent });
      }
    }
    return out.sort((a, b) => bySectionGrade(a.section, b.section) || b.streak.count - a.streak.count || byName(a.student, b.student));
  }
  // One learner's attendance for the school year, for the attendance calendar window
  // (Absence Watch and the teacher's "Attention needed": click a name).
  //   days:   { '2026-10-29': { status: 'absent', scannedAt: null }, ... }
  //   streak: the current absent days in a row (their dates are outlined)
  async getStudentAttendance(studentId, sectionId) {
    await this.ready;
    const section = this.s.sections.get(sectionId);
    const days = {};
    // Every class the child was in this year (a child who moved keeps their history).
    for (const [date, r] of this.recordsOf(studentId)) {
      // A day the admin later made a break, holiday or suspension is not a class day anymore: its old
      // records are not shown or counted, like in Absence Watch.
      const sec = this.s.sections.get(r.sectionId) ?? section;
      if (sec && !isSchoolDay(date, sec.schedule, this.s.calendar)) continue;
      days[date] = { status: r.status, scannedAt: r.scannedAt ?? null };
    }
    const today = this.clock.today();
    return {
      days,
      today,
      year: this.year,
      calendar: [...this.s.calendar.values()],
      schedule: section?.schedule,
      streak: section ? this.streakFor(section, studentId, today) : null,
    };
  }
  /* ---------- parent portal ---------- */
  // =====================================================================
  // PARENT PORTAL (src/parent/): parents sign in with their mobile number and see their children's
  // CONFIRMED attendance, and can ask the teacher to excuse a day. The portal cannot read the class
  // attendance documents (those hold every classmate), so the engine keeps two small copies for it:
  //   parentKeys/{09XXXXXXXXX} = which children belong to that number + the default password's hash
  //   parentDays/{studentId}_{YYYY-MM} = one child's days for one month, the "no class" days and totals
  // They are rewritten when a class is confirmed, a status changes, the calendar changes, or the admin
  // presses Settings -> Parent portal -> "Update parent portal".
  // =====================================================================
  // An approved excuse from the parent portal that covers this child on this day, if any.
  approvedExcuse(studentId, date) {
    for (const ex of this.s.excuses.values()) if (ex.status === 'approved' && ex.studentId === studentId && ex.dates?.includes(date)) return ex;
    return undefined;
  }
  // Saves the portal key for one guardian's mobile number. The default password is stored only as a
  // SHA-256 hash; firestore.rules checks it when a parent signs in for the first time.
  async syncParentKey(g) {
    const key = parentKeyOf(g?.mobile);
    if (!key) return;
    const kids = g.studentIds.map((id) => this.s.students.get(id)).filter(Boolean);
    const eldest = eldestChild(kids);
    const code = defaultParentPassword(eldest);
    const doc = {
      id: key,
      guardianId: g.id,
      guardianName: g.name,
      studentIds: kids.map((k) => k.id),
      children: kids.map((k) => ({ id: k.id, firstName: k.firstName, lastName: k.lastName, sectionId: this.activeEnrollment(k.id)?.sectionId ?? null })),
      codeHash: code ? await sha256Hex(code) : null,
      defaultFrom: eldest ? `${eldest.firstName} ${eldest.lastName}` : null,
      updatedAt: new Date().toISOString(),
    };
    this.put('parentKeys', key, doc);
  }
  // What the parent portal shows for one child in one month ('2026-11').
  parentMonthDoc(studentId, month) {
    const stu = this.s.students.get(studentId);
    if (!stu) return null;
    const today = this.clock.today();
    const enr = this.activeEnrollment(studentId);
    const section = enr ? this.s.sections.get(enr.sectionId) : undefined;
    const days = {};
    for (const [date, r] of this.recordsOf(studentId)) {
      if (!date.startsWith(month)) continue;
      const sec = this.s.sections.get(r.sectionId);
      // Not a class day anymore (made a holiday or break later): not shown, like in Absence Watch.
      if (sec && !isSchoolDay(date, sec.schedule, this.s.calendar)) continue;
      // Today only after the class is confirmed (the parent is never shown a gate scan as "in class"),
      // and not while a late arrival is still waiting for the teacher to confirm the child in class.
      if (date >= today && (!this.s.confirmations.has(dayId(r.sectionId, date)) || r.needsCheck)) continue;
      // s status, t scanned in at the gate, c confirmed in class by the teacher, o scanned out at the gate
      // p/j joined at a later period (number, subject); e/et the earlier "absent" or "not in class" text and its time
      days[date] = {
        s: r.status,
        t: r.scannedAt ?? null,
        c: r.confirmedAt ?? null,
        o: r.scannedOut ?? null,
        ...(r.joinedPeriod ? { p: r.joinedPeriod, j: r.joinedSubject ?? null } : {}),
        ...(r.earlierText ? { e: r.earlierText, et: r.earlierTextAt } : {}),
      };
    }
    // Class days with no class (holidays, breaks, suspensions, teacher absent), with their names.
    const noClass = {};
    if (section) {
      for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) {
        if (d < this.year.start || d > this.year.end) continue;
        const usual = section.schedule.classDays.includes(isoWeekday(d));
        if (usual && !isSchoolDay(d, section.schedule, this.s.calendar)) {
          noClass[d] = this.s.calendar.get(d)?.label ?? 'No class';
        }
      }
    }
    let totals = null;
    if (section) {
      const [y, m] = month.split('-').map(Number);
      const monthEnd = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
      const asOf = today < monthEnd ? today : monthEnd;
      const t = this.totalsFor(section, studentId, asOf);
      totals = { asOf, month: t.month, semester: t.semester, semesterKey: t.semesterKey, levels: t.levels };
    }
    return {
      id: `${studentId}_${month}`,
      studentId,
      month,
      firstName: stu.firstName,
      lastName: stu.lastName,
      sectionId: section?.id ?? null,
      sectionName: section?.name ?? null,
      gradeLevel: section?.gradeLevel ?? null,
      teacherName: (section && this.s.teachers.get(section.teacherId)?.name) ?? null,
      endTime: section?.schedule.endTime ?? null, // after this time, no scan out = "did not scan out"
      schoolName: this.settings.schoolName ?? null,
      days,
      noClass,
      totals,
      updatedAt: new Date().toISOString(),
    };
  }
  // Rewrites the parent portal months. studentIds null = every child.
  syncParentDays(studentIds, months) {
    // (Revoked copies of lost ID cards are kept as students with '-old-' in the id: skipped.)
    const ids = (studentIds ?? [...this.s.students.keys()]).filter((id) => !id.includes('-old-'));
    for (const month of new Set(months)) {
      for (const id of ids) {
        const doc = this.parentMonthDoc(id, month);
        if (doc) this.put('parentDays', doc.id, doc);
      }
    }
  }
  // Admin: Settings -> Parent portal -> "Update parent portal": every key and every month so far.
  async syncParentPortal() {
    await this.ready;
    for (const g of this.s.guardians.values()) await this.syncParentKey(g);
    // Only the months that have attendance (keeps the number of writes low on the free plan).
    const months = [...new Set([...this.s.attendance.values()].map((d) => d.date.slice(0, 7)))].sort();
    this.syncParentDays(null, months);
    await this.logAudit('parent_portal.sync', `${this.s.guardians.size} parents`, `${months.length} months`);
    this.emit();
    return { parents: this.s.guardians.size, months: months.length };
  }
  // Parents who cannot sign in yet because no child of theirs has a birthday (no default password).
  parentsWithoutPassword() {
    return [...this.s.guardians.values()].filter((g) => g.studentIds.length && !defaultParentPassword(eldestChild(g.studentIds.map((id) => this.s.students.get(id)).filter(Boolean))));
  }
  // Excuse requests the signed-in person may see (a teacher: their classes), newest first.
  async listExcuses() {
    await this.ready;
    const vis = this.visibleSectionIds();
    return [...this.s.excuses.values()]
      .filter((x) => !vis || vis.has(x.sectionId))
      .map((x) => ({ ...x, student: this.s.students.get(x.studentId), section: this.s.sections.get(x.sectionId) }))
      // Waiting requests first, then newest first.
      .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.createdAt.localeCompare(a.createdAt));
  }
  // The teacher approves or declines a parent's excuse request. Approved: the days that already
  // happened become Excused (unless the child came to school); later days are excused when the
  // class is confirmed (finalize).
  async decideExcuse(id, decision, note) {
    await this.ready;
    const ex = this.s.excuses.get(id);
    if (!ex || ex.status !== 'pending') return;
    // The request must be for a child who is (or was) in that class.
    if (![...this.s.enrollments.values()].some((e) => e.studentId === ex.studentId && e.sectionId === ex.sectionId))
      throw new Error('This child is not in that class. Decline the request.');
    Object.assign(ex, { status: decision, decidedBy: this.actor(), decidedAt: new Date().toISOString(), teacherNote: note || null });
    this.put('excuses', id, ex);
    const stu = this.s.students.get(ex.studentId);
    const sec = this.s.sections.get(ex.sectionId);
    if (decision === 'approved' && sec) {
      const today = this.clock.today();
      for (const date of ex.dates) {
        if (date > today || !isSchoolDay(date, sec.schedule, this.s.calendar)) continue;
        const rec = this.record(ex.sectionId, date, ex.studentId);
        if (rec?.status === 'late' && !rec.lateExcused) {
          // The child came late with a valid reason: still Late on the list, but not counted in the late totals.
          this.writeRecord({ ...rec, lateExcused: true, excusedNote: `Parent: ${ex.reason}` });
          this.syncParentDays([ex.studentId], [date.slice(0, 7)]);
          continue;
        }
        if (rec && rec.status !== 'absent') continue; // the child came (present or late) or already excused
        await this.setStatus({ studentId: ex.studentId, sectionId: ex.sectionId, date, status: 'excused', note: `Parent: ${ex.reason}`, reason: 'Parent excuse approved' });
      }
    }
    // The same parent asked twice for the same day(s): the second request gets the same answer.
    for (const other of this.s.excuses.values()) {
      if (other.status !== 'pending' || other.studentId !== ex.studentId || !other.dates.every((d) => ex.dates.includes(d))) continue;
      Object.assign(other, { status: decision, decidedBy: ex.decidedBy, decidedAt: ex.decidedAt, teacherNote: ex.teacherNote });
      this.put('excuses', other.id, other);
    }
    await this.logAudit(`excuse.${decision}`, stu ? `${stu.firstName} ${stu.lastName}` : ex.studentId, `${ex.dates.join(', ')}: ${ex.reason}`);
    this.emit();
  }
  /* ---------- admin ---------- */
  // =====================================================================
  // ADMIN ACTIONS
  // =====================================================================
  async listAudit(limit = 300) {
    await this.ready;
    return [...this.s.audit.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  }
  // Adds a line to the audit log: who did what, to whom, and when.
  async logAudit(action, target, detail) {
    const e = { id: uid('aud'), at: new Date().toISOString(), actor: this.actor(), action, target, detail };
    this.s.audit.set(e.id, e);
    this.put('audit', e.id, e);
  }
  // meta/school = { settings, schoolYear }; meta/calendar = { days: [...] }.
  saveMeta() {
    this.put('meta', 'school', this.s.meta);
  }
  saveCalendar() {
    this.put('meta', 'calendar', { days: [...this.s.calendar.values()].sort((a, b) => a.date.localeCompare(b.date)) });
  }
  // Admin -> Settings: SMS templates, streak days, school name, etc.
  async updateSettings(patch) {
    this.s.meta = { ...this.s.meta, settings: { ...this.settings, ...patch } };
    this.normalizeSections();
    this.saveMeta();
    await this.logAudit('settings.update', 'settings', Object.keys(patch).join(', '));
    this.emit();
    return this.settings;
  }
  // First and last day of classes. Teachers are alerted when the dates change.
  async updateSchoolYear(patch) {
    const before = this.year;
    this.s.meta = { ...this.s.meta, schoolYear: { ...this.year, ...patch } };
    this.saveMeta();
    await this.logAudit('schoolyear.update', this.year.name, `${this.year.start} to ${this.year.end}`);
    const changed = [];
    if (patch.start && patch.start !== before.start) changed.push(`first day of classes is now ${fmtDay(patch.start)}`);
    if (patch.end && patch.end !== before.end) changed.push(`last day of classes is now ${fmtDay(patch.end)}`);
    if (changed.length) this.notifyCalendar('School year dates changed', `The ${changed.join(' and the ')}.`, patch.start ?? patch.end);
    this.emit();
  }
  /** Tells every teacher about a change to the school calendar. */
  notifyCalendar(title, body, date) {
    const n = {
      id: uid('cal'),
      kind: 'calendar',
      sectionId: 'all',
      date,
      createdAt: new Date().toISOString(),
      read: false,
      title,
      body: `${body} Updated by ${this.actor()}.`,
    };
    this.s.notifications.set(n.id, n);
    this.put('notifications', n.id, n);
  }
  // Admin marks one or more days (holiday, suspension, exam...). Every teacher gets an alert.
  async saveCalendarDays(days) {
    if (!days.length) return;
    days.forEach((d) => this.s.calendar.set(d.date, d));
    this.saveCalendar();
    const first = days[0];
    const last = days[days.length - 1];
    const when = days.length === 1 ? fmtDay(first.date) : `${fmtDay(first.date)} to ${fmtDay(last.date)}`;
    await this.logAudit('calendar.update', days.length === 1 ? first.date : `${first.date} to ${last.date}`, `${first.type}: ${first.label}`);
    const noClass = first.type === 'holiday' || first.type === 'suspension' || first.type === 'break';
    const only = levelsLabel(first.levels);
    const title =
      first.type === 'suspension'
        ? `Classes suspended${only ? ` (${only})` : ''}: ${when}`
        : noClass
          ? `No classes: ${when}`
          : first.type === 'exam'
            ? `Exam day: ${when}`
            : first.type === 'halfday'
              ? `Half day: ${when}`
              : first.type === 'makeup'
                ? `Make-up class: ${when}`
                : `School event: ${when}`;
    this.notifyCalendar(
      title,
      `${first.label}.${noClass ? ` ${only ? `Only ${only.replace(/ only$/, '')} classes are affected. ` : ''}Attendance is not taken and these days do not count in absence streaks.` : ''}`,
      first.date,
    );
    this.syncParentDays(null, days.map((d) => d.date.slice(0, 7)));
    this.emit();
  }
  // Makes days regular class days again (and alerts teachers).
  async removeCalendarDays(dates) {
    if (!dates.length) return;
    dates.forEach((d) => this.s.calendar.delete(d));
    this.saveCalendar();
    await this.logAudit('calendar.clear', dates.length === 1 ? dates[0] : `${dates.length} days`);
    const sorted = [...dates].sort();
    const when = sorted.length === 1 ? fmtDay(sorted[0]) : `${fmtDay(sorted[0])} to ${fmtDay(sorted[sorted.length - 1])}`;
    this.notifyCalendar(
      `Calendar change: ${when}`,
      `${sorted.length === 1 ? 'This day is' : 'These days are'} back to the regular class schedule.`,
      sorted[0],
    );
    this.syncParentDays(null, sorted.map((d) => d.slice(0, 7)));
    this.emit();
  }
  // Replaces the whole calendar with the DepEd template.
  async resetCalendar(days) {
    this.s.calendar = new Map(days.map((d) => [d.date, d]));
    this.saveCalendar();
    await this.logAudit('calendar.reset', 'DepEd SY 2026-2027 template');
    this.notifyCalendar(
      'School calendar was reset',
      'The calendar now follows the DepEd school year template. Check the Calendar page for holidays and breaks.',
    );
    await this.syncParentPortal();
    this.emit();
  }
  // Shortcut for one suspended day.
  // levels: which grade levels are suspended (empty or all = the whole school). DepEd Order 22, s. 2024:
  // Signal No. 1 suspends Kindergarten only; Signal No. 2 Kindergarten to Grade 10; Signal No. 3 all levels.
  async declareSuspension(date, label, levels = []) {
    const some = levels.length && levels.length < 7;
    await this.saveCalendarDays([{ date, type: 'suspension', label, ...(some ? { levels: [...levels].sort((a, b) => gradeRank(a) - gradeRank(b)) } : {}) }]);
  }
  async listTeachers() {
    await this.ready;
    // By the grade they advise (Kindergarten, Grade 1 ... Grade 6), then by name; teachers with no class last.
    const level = (t) => Math.min(99, ...[...this.s.sections.values()].filter((x) => !x.archived && x.teacherId === t.id).map((x) => gradeRank(x.gradeLevel)));
    return [...this.s.teachers.values()].sort((a, b) => level(a) - level(b) || a.name.localeCompare(b.name));
  }
  // Adds or edits a teacher. A NEW teacher also gets a sign-in account with a temporary password
  // (returned so the admin can hand it over). The email cannot change after creation.
  async saveTeacher(input) {
    const dupe = [...this.s.teachers.values()].find((t) => t.email.toLowerCase() === input.email.toLowerCase() && t.id !== input.id);
    if (dupe) throw new Error('Another teacher already uses this email.');
    const existing = input.id ? this.s.teachers.get(input.id) : undefined;
    if (existing) {
      Object.assign(existing, { name: input.name, mobile: input.mobile, subjects: input.subjects ?? existing.subjects ?? [] });
      this.put('teachers', existing.id, existing);
      await this.logAudit('teacher.update', existing.name);
      this.emit();
      return { teacher: existing };
    }
    const teacher = { id: uid('t'), name: input.name, email: input.email, mobile: input.mobile, subjects: input.subjects ?? [], active: true };
    const { uid: accountUid, tempPassword } = await this.auth.createTeacherAccount(input.email, input.name, teacher.id);
    teacher.uid = accountUid;
    const account = { uid: accountUid, email: input.email, name: input.name, role: 'teacher', teacherId: teacher.id };
    this.s.users.set(accountUid, account);
    this.put('users', accountUid, account);
    this.s.teachers.set(teacher.id, teacher);
    this.put('teachers', teacher.id, teacher);
    await this.logAudit('teacher.create', teacher.name, 'sign-in account created');
    this.emit();
    return { teacher, tempPassword };
  }
  // ---------------------------------------------------------------------
  // GATE SCANNER ACCOUNTS
  // The phone at the school gate runs the Doorbell Gate app (gate-app/ folder). It signs in with
  // its own account whose role is 'gate': it can record scans and queue the parent texts, but it
  // cannot open this website. Removing the account's profile stops the phone from scanning.
  // ---------------------------------------------------------------------
  gateAccounts() {
    return [...this.s.users.values()].filter((u) => u.role === 'gate').sort((a, b) => a.email.localeCompare(b.email));
  }
  async createGateAccount(email, password) {
    const clean = email.trim().toLowerCase();
    if (!clean.includes('@')) throw new Error('Enter an email address for the gate phone, e.g. gate@yourschool.edu.ph');
    if ((password ?? '').length < 8) throw new Error('Use a password with at least 8 characters.');
    if ([...this.s.users.values()].some((u) => u.email.toLowerCase() === clean)) throw new Error('That email already has an account.');
    const { uid: accountUid } = await this.auth.createTeacherAccount(clean, 'School gate', undefined, password);
    const account = { uid: accountUid || uid('u'), email: clean, name: 'School gate', role: 'gate' };
    this.s.users.set(account.uid, account);
    this.put('users', account.uid, account);
    await this.logAudit('gate.create', clean, 'gate scanner account created');
    this.emit();
    return account;
  }
  async removeGateAccount(accountUid) {
    const acc = this.s.users.get(accountUid);
    if (!acc || acc.role !== 'gate') return;
    this.s.users.delete(accountUid);
    this.persistence.remove('users', accountUid);
    await this.logAudit('gate.remove', acc.email, 'gate scanner account removed');
    this.emit();
  }
  // ---------------------------------------------------------------------
  // ADMIN ACCOUNTS (Settings -> Admins). The school can have several admins; each one can do
  // everything. Removing an admin deletes their profile (users/{uid}), so they can no longer
  // open the website. Nobody can remove their own access or the last admin, so the school
  // can never lock itself out.
  // ---------------------------------------------------------------------
  admins() {
    return [...this.s.users.values()].filter((u) => u.role === 'admin').sort((a, b) => a.name.localeCompare(b.name));
  }
  async addAdmin({ name, email }) {
    const cleanName = (name ?? '').trim();
    const clean = (email ?? '').trim().toLowerCase();
    if (!cleanName) throw new Error("Enter the new admin's name.");
    if (!clean.includes('@')) throw new Error('Enter an email address, e.g. principal@yourschool.edu.ph');
    if ([...this.s.users.values()].some((u) => u.email.toLowerCase() === clean)) throw new Error('That email already has an account.');
    let made;
    try {
      made = await this.auth.createTeacherAccount(clean, cleanName);
    } catch (e) {
      if (String(e?.code ?? e?.message).includes('email-already-in-use'))
        throw new Error('That email already has a sign-in account (maybe a removed admin or teacher). Delete it in Firebase console -> Authentication first, or use another email.');
      throw e;
    }
    const account = { uid: made.uid || uid('u'), email: clean, name: cleanName, role: 'admin' };
    this.s.users.set(account.uid, account);
    this.put('users', account.uid, account);
    await this.logAudit('admin.create', cleanName, clean);
    this.emit();
    return { account, tempPassword: made.tempPassword };
  }
  async removeAdmin(accountUid) {
    const acc = this.s.users.get(accountUid);
    if (!acc || acc.role !== 'admin') return;
    if (accountUid === this.session?.uid) throw new Error('You cannot remove your own admin access. Ask another admin to do it.');
    if (this.admins().length <= 1) throw new Error('The school must keep at least one admin.');
    this.s.users.delete(accountUid);
    this.persistence.remove('users', accountUid);
    await this.logAudit('admin.remove', acc.name, acc.email);
    this.emit();
  }
  // Deactivate (cannot sign in, removed from their classes) or reactivate a teacher.
  async setTeacherActive(id, active) {
    const t = this.s.teachers.get(id);
    if (!t) return;
    t.active = active;
    this.put('teachers', id, t);
    if (!active) {
      for (const s of this.s.sections.values())
        if (s.teacherId === id) {
          s.teacherId = null;
          this.put('sections', s.id, s);
          // Only a teacher confirms a class, so a class without one must be noticed.
          const n = {
            id: uid('cov'),
            kind: 'cover',
            sectionId: s.id,
            createdAt: this.nowIso(),
            read: false,
            title: `${s.name} has no teacher`,
            body: `${t.name} was deactivated. Assign a teacher in Sections, or nobody confirms this class and parents are not texted.`,
          };
          this.s.notifications.set(n.id, n);
          this.put('notifications', n.id, n);
        }
    }
    await this.logAudit(active ? 'teacher.activate' : 'teacher.deactivate', t.name);
    this.emit();
  }
  // Adds or edits a section. A teacher may have several, but not at overlapping times.
  async saveSection(input) {
    if (input.teacherId) {
      // A teacher can handle several classes, as long as their times do not overlap.
      const clash = [...this.s.sections.values()].find(
        (s) => s.teacherId === input.teacherId && s.id !== input.id && !s.archived && schedulesOverlap(s.schedule, input.schedule),
      );
      if (clash)
        throw new Error(
          `That teacher already handles ${clash.name} at the same time (${to12h(clash.schedule.startTime)} to ${to12h(clash.schedule.endTime)}).`,
        );
    }
    const existing = input.id ? this.s.sections.get(input.id) : undefined;
    const section = existing
      ? {
          ...existing,
          name: input.name,
          color: input.color,
          capacity: input.capacity,
          teacherId: input.teacherId,
          gradeLevel: input.gradeLevel ?? existing.gradeLevel ?? 'K',
          // Grades 4 to 6: the class program (periods, subjects, teachers). Kindergarten to Grade 3: none.
          program: input.program ?? existing.program ?? [],
          // Subject teachers (never the class teacher, never a deactivated one).
          subjectTeacherIds: (input.subjectTeacherIds ?? existing.subjectTeacherIds ?? []).filter((t) => t !== input.teacherId && this.s.teachers.get(t)?.active !== false),
          // keep the teacher-away days when the admin edits the class hours
          schedule: { ...input.schedule, teacherAway: existing.schedule?.teacherAway ?? input.schedule.teacherAway },
        }
      : { id: uid('sec'), schoolYearId: this.year.id, gradeLevel: 'K', archived: false, ...input };
    if (!hasSubjectTeachers(section.gradeLevel)) {
      // Kindergarten to Grade 3: one teacher all day. The program keeps its periods but no teachers.
      section.program = (section.program ?? []).filter((p) => p.start && p.end && p.subject).map(({ teacherId, ...p }) => p).sort((a, b) => a.start.localeCompare(b.start));
      section.subjectTeacherIds = [];
    } else if (section.program?.length) {
      // The subject teachers are the teachers in the class program (the adviser is not one of them).
      section.program = section.program.filter((p) => p.start && p.end && p.subject).sort((a, b) => a.start.localeCompare(b.start));
      section.subjectTeacherIds = [...new Set(section.program.map((p) => p.teacherId).filter((t) => t && t !== section.teacherId && this.s.teachers.get(t)?.active !== false))];
    }
    this.normalizeSection(section);
    this.s.sections.set(section.id, section);
    this.put('sections', section.id, section);
    await this.logAudit(existing ? 'section.update' : 'section.create', section.name);
    this.refreshSession();
    this.emit();
    return section;
  }
  // ---------------------------------------------------------------------
  // TEACHER ABSENT: Admin -> Sections -> a class -> "Teacher absent"
  //   kind 'substitute': teacherId covers the class on those dates (sees it, takes and confirms attendance)
  //   kind 'noclass':    no class for this section on those dates (children are not marked absent)
  // Only class days in from..to that are not confirmed yet are changed. Returns the dates changed.
  // ---------------------------------------------------------------------
  async setTeacherAway(sectionId, { from, to, kind, teacherId, note }) {
    const sec = this.s.sections.get(sectionId);
    if (!sec) throw new Error('Class not found.');
    if (!from) throw new Error('Pick the date the teacher is absent.');
    const end = to && to >= from ? to : from;
    if (kind === 'substitute') {
      const sub = teacherId && this.s.teachers.get(teacherId);
      if (!sub || sub.active === false) throw new Error('Pick the substitute teacher.');
      if (teacherId === sec.teacherId) throw new Error('Pick a different teacher than the class teacher.');
    }
    const base = { ...sec.schedule, teacherAway: undefined }; // class days without any teacher-away marks
    const dates = eachDate(from, end).filter(
      (d) => isSchoolDay(d, base, this.s.calendar) && d >= this.year.start && d <= this.year.end && !this.s.confirmations.has(dayId(sectionId, d)),
    );
    if (!dates.length) throw new Error('No class days to change in those dates (weekends, holidays and confirmed days are skipped).');
    const away = { ...(sec.schedule.teacherAway ?? {}) };
    const entry = { kind, teacherId: kind === 'substitute' ? teacherId : null, note: note?.trim() || '', by: this.actor(), at: new Date().toISOString() };
    dates.forEach((d) => (away[d] = entry));
    sec.schedule = { ...sec.schedule, teacherAway: away };
    this.put('sections', sec.id, sec);
    const subName = kind === 'substitute' ? this.s.teachers.get(teacherId)?.name : '';
    const when = dates.length === 1 ? fmtDay(dates[0]) : `${fmtDay(dates[0])} to ${fmtDay(dates[dates.length - 1])} (${dates.length} class days)`;
    await this.logAudit('section.teacher_away', sec.name, `${when}: ${kind === 'substitute' ? `covered by ${subName}` : 'no class'}${entry.note ? ` (${entry.note})` : ''}`);
    // Tell the class teacher (and the substitute on the day itself: they see alerts of the classes they cover).
    const n = {
      id: uid('cov'),
      kind: 'cover',
      sectionId: sec.id,
      createdAt: this.nowIso(),
      read: false,
      title: kind === 'substitute' ? `${subName} covers ${sec.name}: ${when}` : `No class for ${sec.name}: ${when}`,
      body:
        kind === 'substitute'
          ? `${subName} takes and confirms attendance on ${dates.length === 1 ? 'that day' : 'those days'}.${entry.note ? ` Note: ${entry.note}` : ''}`
          : `Set by ${this.actor()} because the teacher is absent. Children are not marked absent and the 3-day count is not affected.${entry.note ? ` Note: ${entry.note}` : ''}`,
    };
    this.s.notifications.set(n.id, n);
    this.put('notifications', n.id, n);
    // CHILD SAFETY: class cancelled for TODAY after children already scanned in: list them for the staff.
    const today = this.clock.today();
    if (kind === 'noclass' && dates.includes(today)) {
      const here = this.rosterOn(sec.id, today).filter((k) => this.record(sec.id, today, k.id)?.scannedAt);
      if (here.length) {
        const m = {
          id: `oncampus_${sec.id}_${today}`,
          kind: 'missing',
          sectionId: sec.id,
          createdAt: this.nowIso(),
          read: false,
          title: `${here.length} ${here.length === 1 ? 'child of' : 'children of'} ${sec.name} already scanned in, but the class has no class today`,
          body: `${here.map((k) => `${k.firstName} ${k.lastName}`).join(', ')}. Keep them with a staff member and call their guardians.`,
        };
        this.s.notifications.set(m.id, m);
        this.put('notifications', m.id, m);
      }
    }
    this.refreshSession();
    this.emit();
    return dates;
  }
  // Undoes one teacher-away day (back to a normal class day with the class teacher).
  async clearTeacherAway(sectionId, date) {
    const sec = this.s.sections.get(sectionId);
    if (!sec?.schedule.teacherAway?.[date]) return;
    const away = { ...sec.schedule.teacherAway };
    delete away[date];
    sec.schedule = { ...sec.schedule, teacherAway: away };
    this.put('sections', sec.id, sec);
    await this.logAudit('section.teacher_away_removed', sec.name, fmtDay(date));
    this.refreshSession();
    this.emit();
  }
  /** Teacher-away days from today on, for one class or all: [{ section, date, kind, teacherId, teacherName, note }]. */
  async listTeacherAway(sectionId) {
    await this.ready;
    const today = this.clock.today();
    const out = [];
    for (const sec of this.s.sections.values()) {
      if (sectionId && sec.id !== sectionId) continue;
      for (const [date, a] of Object.entries(sec.schedule?.teacherAway ?? {})) {
        if (date < today) continue;
        out.push({ section: sec, date, ...a, teacherName: a.teacherId ? this.s.teachers.get(a.teacherId)?.name : undefined });
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.section.name.localeCompare(b.section.name));
  }
  // Hides a section (only when no child is in it). History is kept.
  async archiveSection(id, archived) {
    const s = this.s.sections.get(id);
    if (!s) return;
    const enrolled = [...this.s.enrollments.values()].filter((e) => e.sectionId === id && e.status === 'active').length;
    if (archived && enrolled > 0) throw new Error(`Move the ${enrolled} students out of ${s.name} first.`);
    s.archived = archived;
    this.put('sections', id, s);
    await this.logAudit(archived ? 'section.archive' : 'section.restore', s.name);
    this.emit();
  }
  // Every child with guardian, current enrollment and section (Admin -> Students).
  async listStudentRows() {
    await this.ready;
    return [...this.s.students.values()]
      .filter((s) => !s.id.includes('-old-'))
      .map((student) => {
        const all = [...this.s.enrollments.values()].filter((e) => e.studentId === student.id && e.status !== 'moved');
        const enrollment = all.find((e) => e.status === 'active') ?? all.sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))[0];
        return {
          student,
          guardian: this.guardianOf(student.id),
          enrollment,
          section: enrollment ? this.s.sections.get(enrollment.sectionId) : undefined,
        };
      })
      // Kindergarten first, then Grade 1 ... Grade 6 (by section), then by name; not yet placed last.
      .sort((a, b) => (a.section ? 0 : 1) - (b.section ? 0 : 1) || bySectionGrade(a.section, b.section) || byName(a.student, b.student));
  }
  // A random card code like 'DB-7K2M9Q4XAB'. No personal data, so a lost card reveals nothing.
  newToken() {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return `DB-${Array.from(bytes, (b) => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b % 32]).join('')}`;
  }
  // Moves a child to a section (or out of all sections). The old placement is closed, not deleted, to keep history.
  placeStudent(studentId, sectionId) {
    const today = this.clock.today();
    const current = this.activeEnrollment(studentId);
    if (current?.sectionId === sectionId) return;
    if (current) {
      // Keep history: close the old enrollment instead of deleting it.
      if (current.startDate >= today) {
        this.s.enrollments.delete(current.id);
        this.persistence.remove('enrollments', current.id);
      } else {
        current.status = 'moved';
        current.endDate = today;
        this.put('enrollments', current.id, current);
      }
    }
    if (sectionId) {
      const start = today < this.year.start ? this.year.start : today;
      const e = { id: uid('enr'), studentId, sectionId, schoolYearId: this.year.id, status: 'active', startDate: start };
      this.s.enrollments.set(e.id, e);
      this.put('enrollments', e.id, e);
      // Moved during the school day: today's gate scan (or mark) goes with the child to the new class,
      // so the new teacher sees it and the child is not marked absent there.
      const rec = current ? this.record(current.sectionId, today, studentId) : undefined;
      if (rec && !this.s.confirmations.has(dayId(sectionId, today)) && !this.record(sectionId, today, studentId)) {
        this.writeRecord({ ...rec, sectionId });
        if (!this.s.confirmations.has(dayId(current.sectionId, today))) {
          const old = this.s.attendance.get(dayId(current.sectionId, today));
          delete old.records[studentId];
          this.put('attendance', old.id, old);
        }
      }
    }
  }
  // Rewrites the parent portal keys of these children's guardians (the key holds each child's class).
  async syncKeysFor(studentIds) {
    const seen = new Set();
    for (const id of studentIds) {
      const g = this.guardianOf(id);
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id);
      await this.syncParentKey(g);
    }
  }
  // Creates or updates a child and their guardian. Children with the SAME guardian mobile
  // number share one guardian record (siblings), so the parent gets texts for both.
  upsertStudent(input) {
    let student = input.id ? this.s.students.get(input.id) : undefined;
    const fields = {
      lrn: input.lrn,
      firstName: input.firstName,
      middleName: input.middleName,
      lastName: input.lastName,
      birthdate: input.birthdate,
      sex: input.sex,
    };
    if (student) Object.assign(student, fields);
    else {
      student = { id: uid('stu'), ...fields, qrToken: this.newToken(), qrStatus: 'active' };
      this.s.students.set(student.id, student);
    }
    this.put('students', student.id, student);
    let sibling = false;
    const touched = []; // guardians whose parent portal key must be updated
    let g = [...this.s.guardians.values()].find((x) => x.mobile === input.guardianMobile);
    // A child has ONE guardian record: take the child off any other number (the old number then
    // stops getting texts and loses the child in the parent portal).
    for (const other of this.s.guardians.values()) {
      if (other !== g && other.studentIds.includes(student.id)) {
        other.studentIds = other.studentIds.filter((id) => id !== student.id);
        this.put('guardians', other.id, other);
        touched.push(other);
      }
    }
    if (!g) {
      g = {
        id: uid('g'),
        name: input.guardianName,
        mobile: input.guardianMobile,
        relationship: input.relationship,
        smsConsent: input.smsConsent,
        preferredLanguage: input.preferredLanguage,
        numberStatus: 'unverified',
        studentIds: [],
      };
      this.s.guardians.set(g.id, g);
    }
    if (!g.studentIds.includes(student.id)) {
      g.studentIds.push(student.id);
      sibling = g.studentIds.length > 1;
    }
    Object.assign(g, {
      name: input.guardianName,
      relationship: input.relationship,
      smsConsent: input.smsConsent,
      preferredLanguage: input.preferredLanguage,
    });
    this.put('guardians', g.id, g);
    touched.push(g);
    if (input.sectionId !== undefined) this.placeStudent(student.id, input.sectionId);
    return { student, sibling, touched };
  }
  async saveStudent(input) {
    await this.ready;
    const { student, touched } = this.upsertStudent(input);
    for (const g of touched) await this.syncParentKey(g);
    await this.logAudit(input.id ? 'student.update' : 'student.create', `${student.firstName} ${student.lastName}`);
    this.emit();
    return student;
  }
  // Places many children at once (auto-assign or bulk move). Remembers the previous state for "Undo".
  async assignStudents(assignments, label) {
    await this.ready;
    this.lastAssign = { label, before: structuredClone([...this.s.enrollments.values()]) };
    Object.entries(assignments).forEach(([studentId, sectionId]) => this.placeStudent(studentId, sectionId));
    await this.syncKeysFor(Object.keys(assignments));
    await this.logAudit('student.assign', label, `${Object.keys(assignments).length} students`);
    this.emit();
  }
  // Puts back the placements from before the last assign or move.
  async undoLastAssign() {
    if (!this.lastAssign) return null;
    const { label, before } = this.lastAssign;
    const keep = new Set(before.map((e) => e.id));
    for (const id of [...this.s.enrollments.keys()])
      if (!keep.has(id)) {
        this.s.enrollments.delete(id);
        this.persistence.remove('enrollments', id);
      }
    for (const e of before) {
      this.s.enrollments.set(e.id, e);
      this.put('enrollments', e.id, e);
    }
    this.lastAssign = null;
    await this.syncKeysFor(before.map((e) => e.studentId));
    await this.logAudit('student.assign_undo', label);
    this.emit();
    return label;
  }
  // A child transfers or drops out. They leave the class list from that date; records stay.
  async setEnrollmentStatus(studentId, status, date) {
    const e = this.activeEnrollment(studentId);
    if (!e) throw new Error('Student is not in a section.');
    e.status = status;
    e.endDate = date;
    this.put('enrollments', e.id, e);
    await this.syncKeysFor([studentId]);
    const stu = this.s.students.get(studentId);
    await this.logAudit(`student.${status}`, stu ? `${stu.firstName} ${stu.lastName}` : studentId, `effective ${date}`);
    this.emit();
  }
  // Lost card: makes a new code. A revoked copy of the old card is kept so scanning it says "card revoked".
  async reissueQr(studentId) {
    const s = this.s.students.get(studentId);
    if (!s) throw new Error('Student not found');
    // Keep a revoked copy of the old code so scanning the lost card shows "card revoked".
    const old = { ...s, id: `${s.id}-old-${Date.now()}`, qrStatus: 'revoked' };
    this.s.students.set(old.id, old);
    this.put('students', old.id, old);
    s.qrToken = this.newToken();
    s.qrStatus = 'active';
    this.put('students', s.id, s);
    await this.logAudit('student.qr_reissue', `${s.firstName} ${s.lastName}`);
    this.emit();
    return s;
  }
  // Admin -> Settings test message.
  async sendTestSms(to) {
    const msg = {
      id: uid('sms'),
      to,
      body: `Doorbell test message from ${this.settings.schoolName}. If you got this, SMS works.`,
      kind: 'test',
      status: this.newSmsStatus(),
      createdAt: this.nowIso(),
      attempts: 1,
    };
    this.s.sms.set(msg.id, msg);
    this.put('sms', msg.id, msg);
    await this.logAudit('sms.test', to);
    this.emit();
    return msg;
  }
}

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
// Password for every demo-mode account (demo mode only).
export const DEMO_PASSWORD = 'Doorbell2026!';
// The usual kindergarten morning schedule: Mon-Fri, 8:00-11:30, late after 15 min.
const schedule = {
  classDays: [1, 2, 3, 4, 5],
  startTime: '08:00',
  endTime: '11:30',
  scanWindowMins: 30,
  lateCutoffMins: 15,
  autoFinalizeMins: 60, // absence texts go out 60 minutes after class starts (end of first period)
};
export const schoolYear = { id: 'sy-2026', name: 'SY 2026-2027', start: '2026-06-08', end: '2027-04-08', isActive: true };
// Default school settings. {child}, {time}, {school}, {contact} and {streak} are filled in by renderTemplate().
export const settings = {
  schoolName: 'Sunnyside Elementary School',
  contactNumber: '0917 555 0123',
  arrivalSmsEnabled: true,
  // The school gate opens (scanning starts) at this time for every class. DepEd sets no national time;
  // each school decides. 6:00 AM by default.
  gateOpens: '06:00',
  // Absence texts go out when the first period ends: class start + this many minutes.
  firstPeriodMins: 60,
  streakDays: 3,
  // Totals (not in a row): see DEFAULT_LIMITS in logic.js. Empty = the defaults.
  limits: {},
  // The day the 2nd semester starts ('' = halfway through the school year).
  semester2Start: '',
  // How texts are sent: 'simulated' (saved only, for demos), 'phone' (the gate phone's SIM, see gate-app/README.md)
  // or 'semaphore' (real SMS through Semaphore, sent by the free Cloudflare Worker, see worker/README.md)
  smsProvider: 'simulated',
  senderName: '', // Semaphore sender name; empty = the default sender name of the Semaphore account
  templates: {
    // arrival / late: sent when the TEACHER confirms the class, so they can say "in class".
    // arrivalAuto / lateAuto: sent when the class was auto-confirmed (no teacher checked), or when the
    // child arrived after the class was confirmed: they only say "arrived at school".
    en: {
      arrival: 'Doorbell: {child} is in class. Arrived at {time}, confirmed by the teacher. - {school}',
      late: 'Doorbell: {child} arrived late at {time} and is in class, confirmed by the teacher. - {school}',
      arrivalAuto: 'Doorbell: {child} arrived at school at {time}. - {school}',
      lateAuto: 'Doorbell: {child} arrived late at school at {time}. - {school}',
      streak: '{school}: {child} has been {streak}. We hope all is well. Please call {contact}.',
      total: '{school}: {child} has been {summary}. We hope all is well. Please call {contact}.',
      missing: '{school}: {child} entered the school at {time} but is not in class. The school is looking for {child} now. Please call {contact}.',
      absent: '{school}: As of {time}, {child} has not arrived at school and is marked absent today. If {child} should be in school, please call {contact}.',
      laterPeriod: 'Doorbell: {child} arrived at school at {time} ({period}) and is in class, confirmed by the teacher. - {school}',
    },
    fil: {
      arrival: 'Doorbell: Nasa klase na si {child}. Dumating ng {time}, kinumpirma ng guro. - {school}',
      late: 'Doorbell: Nahuli si {child} ng dating ({time}) at nasa klase na, kinumpirma ng guro. - {school}',
      arrivalAuto: 'Doorbell: Nakarating na si {child} sa paaralan ng {time}. - {school}',
      lateAuto: 'Doorbell: Nahuli si {child} ng dating sa paaralan, {time}. - {school}',
      streak: '{school}: Si {child} ay {streak}. Sana ay maayos siya. Pakitawagan ang {contact}.',
      total: '{school}: Si {child} ay {summary}. Sana ay maayos siya. Pakitawagan ang {contact}.',
      missing: '{school}: Pumasok si {child} sa paaralan ng {time} pero wala sa klase. Hinahanap na siya ng paaralan. Pakitawagan ang {contact}.',
      absent: '{school}: Hanggang {time}, hindi pa dumarating si {child} sa paaralan at absent siya ngayong araw. Kung dapat ay nasa paaralan siya, pakitawagan ang {contact}.',
      laterPeriod: 'Doorbell: Dumating si {child} sa paaralan ng {time} ({period}) at nasa klase na, kinumpirma ng guro. - {school}',
    },
  },
};
// The kinds of parent texts, in the order the Settings pages show them.
// (arrivalAuto / lateAuto were the auto-confirm texts: no longer sent, kept only in old saved settings.)
export const TEMPLATE_KINDS = ['arrival', 'late', 'laterPeriod', 'absent', 'missing', 'streak', 'total'];
// The old default texts (sent at the gate scan). Saved settings that still have them get the new ones.
const OLD_DEFAULTS = {
  en: { arrival: 'Doorbell: {child} arrived at school at {time}. - {school}', late: 'Doorbell: {child} arrived late at {time}. - {school}' },
  fil: { arrival: 'Doorbell: Nakarating na si {child} sa paaralan ng {time}. - {school}', late: 'Doorbell: Nahuli si {child} ng dating, {time}. - {school}' },
};
/** Settings with every template kind filled in (missing or untouched old defaults -> new defaults). */
export function withTemplateDefaults(saved) {
  const templates = {};
  for (const lang of ['en', 'fil']) {
    const mine = saved.templates?.[lang] ?? {};
    templates[lang] = {};
    for (const k of TEMPLATE_KINDS) {
      const v = mine[k];
      templates[lang][k] = v == null || v === OLD_DEFAULTS[lang]?.[k] ? settings.templates[lang][k] : v;
    }
  }
  return { ...saved, templates };
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
    const k = out.filter((x) => x.gradeLevel === sec.gradeLevel).indexOf(sec);
    const teacherFor = (sub) => byName(SUBJECT_TEACHERS[sec.gradeLevel]?.[sub] ?? SPECIAL[sub]);
    sec.program = sampleProgramFor(sec.gradeLevel, sec.schedule.startTime, teacherFor, k * 2);
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
