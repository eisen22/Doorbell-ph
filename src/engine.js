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
  autoFinalizeTime,
  streakInfo,
  to12h,
  toMinutes,
  fromMinutes,
  DEPED_SY_2026_2027,
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
      if (id === 'school' && data) s.meta = data;
      if (id === 'calendar' && data) s.calendar = new Map((data.days ?? []).map((c) => [c.date, c]));
    } else {
      const map = s[col];
      if (data === null) map.delete(id);
      else map.set(id, data);
    }
    this.emit();
  }
  /** Classes a teacher handles, earliest start first. */
  classesOf(teacherId) {
    if (!teacherId) return [];
    return sortByStart([...this.s.sections.values()].filter((x) => x.teacherId === teacherId && !x.archived));
  }
  // Remembers who is signed in. For a teacher it also works out their classes
  // (sectionIds) and which one is happening now (sectionId).
  setSession(account) {
    if (!account) {
      this.session = null;
      this.emit();
      return;
    }
    const classes = this.classesOf(account.teacherId);
    const now = classNow(classes, this.clock.peek(), this.clock.today());
    this.session = {
      uid: account.uid,
      name: account.name,
      email: account.email,
      role: account.role,
      teacherId: account.teacherId,
      sectionIds: classes.map((c) => c.id),
      sectionId: now?.id ?? classes[0]?.id ?? null,
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
  get settings() {
    return this.s.meta.settings;
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
  statusMap(sectionId, studentId) {
    const out = {};
    for (const day of this.s.attendance.values()) {
      if (day.sectionId !== sectionId) continue;
      const r = day.records[studentId];
      if (r) out[day.date] = r.status;
    }
    return out;
  }
  // The child's current absent/late streak (see streakInfo in logic.js).
  streakFor(section, studentId, date) {
    return streakInfo(date, this.statusMap(section.id, studentId), section.schedule, this.s.calendar);
  }
  // One child's attendance record for one day, if there is one.
  record(sectionId, date, studentId) {
    return this.s.attendance.get(dayId(sectionId, date))?.records[studentId];
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
  // queueSms builds and "sends" a text to the child's guardian. Sending is SIMULATED:
  // the message is saved in the 'sms' collection with status 'sent' (or 'failed' when the
  // guardian's number is marked failed). A real SMS gateway could read that collection later.
  // No text is sent when the guardian did not give SMS consent, or when arrival texts are turned off.
  //   kind: 'arrival' | 'late' | 'streak'
  // =====================================================================
  queueSms(student, kind, opts) {
    const g = this.guardianOf(student.id);
    if (!g || !g.smsConsent) return null;
    if ((kind === 'arrival' || kind === 'late') && !this.settings.arrivalSmsEnabled) return null;
    const tpl = this.settings.templates[g.preferredLanguage] ?? this.settings.templates.en;
    const body = renderTemplate(kind === 'streak' ? tpl.streak : kind === 'late' ? tpl.late : tpl.arrival, {
      child: student.firstName,
      time: opts.time ? to12h(opts.time) : '',
      school: this.settings.schoolName,
      contact: this.settings.contactNumber,
      streak: opts.streak ? describeStreak(opts.streak, g.preferredLanguage) : '',
    });
    // Deterministic ids: two devices processing the same event write the same document once.
    const id = kind === 'streak' ? `stk_${student.id}_${opts.date}` : `arr_${student.id}_${opts.date}`;
    const failed = g.numberStatus === 'failed';
    const msg = {
      id,
      studentId: student.id,
      guardianId: g.id,
      sectionId: opts.sectionId,
      to: g.mobile,
      body,
      kind,
      status: failed ? 'failed' : 'sent',
      createdAt: opts.createdAt ?? this.nowIso(opts.date),
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
  checkStreak(section, stu, date, at) {
    const info = this.streakFor(section, stu.id, date);
    if (!shouldAlertStreak(info.count, this.settings.streakDays)) return;
    const sms = this.queueSms(stu, 'streak', { streak: info, date, sectionId: section.id, createdAt: at });
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
      body: `${dates}. ${sms ? `${g?.name ?? 'The guardian'} was sent an SMS.` : 'No SMS sent (no consent on file). Please call the family.'}`,
    };
    this.s.notifications.set(n.id, n);
    this.put('notifications', n.id, n);
  }
  /** Marks unscanned children absent, locks the day, then applies the streak rule. Idempotent. */
  finalize(sectionId, date, by, auto, at = this.nowIso(date)) {
    const existing = this.s.confirmations.get(dayId(sectionId, date));
    if (existing) return existing;
    const section = this.s.sections.get(sectionId);
    const roster = this.rosterOn(sectionId, date);
    const id = dayId(sectionId, date);
    const day = this.s.attendance.get(id) ?? { id, sectionId, date, records: {} };
    for (const stu of roster) {
      if (!day.records[stu.id]) day.records[stu.id] = { date, studentId: stu.id, sectionId, status: 'absent', source: 'auto' };
    }
    this.s.attendance.set(id, day);
    this.put('attendance', id, day);
    const conf = { id, sectionId, date, confirmedBy: by, confirmedAt: at, auto };
    this.s.confirmations.set(id, conf);
    this.put('confirmations', id, conf);
    for (const stu of roster) this.checkStreak(section, stu, date, at);
    return conf;
  }
  /** Auto-confirms past school days nobody confirmed, and today after the auto-confirm time. */
  // Runs every minute (and at sign-in): confirms past school days nobody confirmed, and today once the auto-confirm time passes.
  catchUp() {
    const today = this.clock.today();
    const end = today < this.year.end ? today : this.year.end;
    for (const sec of this.writableSections()) {
      for (let d = this.year.start; d <= end; d = addDays(d, 1)) {
        if (!isSchoolDay(d, sec.schedule, this.s.calendar) || this.s.confirmations.has(dayId(sec.id, d))) continue;
        if (d < today || (d === today && shouldAutoFinalize(this.clock.peek(), sec.schedule))) {
          // Stamp it with the class's auto-confirm time (e.g. 8:45 AM on that day), not the moment the
          // app happened to be opened. A day caught up later (nobody was signed in at 8:45) still reads 8:45 AM.
          this.finalize(sec.id, d, 'Auto-confirm', true, `${d}T${autoFinalizeTime(sec.schedule)}:00+08:00`);
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
    return [...this.s.sections.values()].sort((a, b) => a.name.localeCompare(b.name));
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
  //  4. save the record and text the parent (arrival or late)
  // A child scanned after the day was confirmed is recorded as late, and it is written in the audit log.
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
    if (!isSchoolDay(today, sec.schedule, this.s.calendar) || today < this.year.start || today > this.year.end) return { kind: 'not_school_day' };
    const last = this.lastScanAt.get(token);
    const nowMs = Date.now();
    this.lastScanAt.set(token, nowMs);
    const existing = this.record(sec.id, today, student.id);
    const time = this.clock.scanTime();
    const decision = decideScan({
      time,
      schedule: sec.schedule,
      existingScanAt: existing?.scannedAt,
      secondsSinceLastSameCode: last ? (nowMs - last) / 1000 : undefined,
    });
    if (decision.kind === 'ignore') return { kind: 'ignore' };
    if (decision.kind === 'duplicate') return { kind: 'duplicate', student, firstScanAt: decision.firstScanAt };
    const locked = this.s.confirmations.has(dayId(sec.id, today));
    const status = locked ? 'late' : decision.status;
    this.writeRecord({
      date: today,
      studentId: student.id,
      sectionId: sec.id,
      status,
      scannedAt: time,
      source: 'scanner',
      editedReason: locked ? 'Arrived after attendance was confirmed' : undefined,
    });
    if (locked) await this.logAudit('attendance.scan_after_lock', `${student.firstName} ${student.lastName}`, `absent -> late at ${time}`);
    this.queueSms(student, status === 'late' ? 'late' : 'arrival', { time, date: today, sectionId: sec.id });
    this.emit();
    return { kind: 'recorded', student, status, time };
  }
  // A teacher changes a status by hand, before or after confirming (every change is saved in the audit log).
  async setStatus(input) {
    await this.ready;
    const locked = this.s.confirmations.has(dayId(input.sectionId, input.date));
    const prev = this.record(input.sectionId, input.date, input.studentId);
    this.writeRecord({
      date: input.date,
      studentId: input.studentId,
      sectionId: input.sectionId,
      status: input.status,
      scannedAt: prev?.scannedAt,
      source: 'manual',
      excusedNote: input.status === 'excused' ? input.note : undefined,
      editedReason: input.reason,
    });
    const stu = this.s.students.get(input.studentId);
    await this.logAudit(
      'attendance.edit',
      stu ? `${stu.firstName} ${stu.lastName}` : input.studentId,
      `${input.date}: ${prev?.status ?? 'none'} -> ${input.status}${input.reason ? ` (${input.reason})` : ''}`,
    );
    if (locked && stu && (input.status === 'absent' || input.status === 'late')) {
      this.checkStreak(this.s.sections.get(input.sectionId), stu, input.date, this.nowIso());
    }
    this.emit();
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
      .filter((n) => !vis || (n.sectionId && vis.has(n.sectionId)))
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
  // Tries a failed text again (still fails if the number is marked failed).
  async resendSms(id) {
    const m = this.s.sms.get(id);
    if (!m) return;
    const g = m.guardianId ? this.s.guardians.get(m.guardianId) : undefined;
    m.attempts += 1;
    m.status = g?.numberStatus === 'failed' ? 'failed' : 'sent';
    this.put('sms', id, m);
    await this.logAudit('sms.resend', m.to, m.status);
    this.emit();
  }
  // Children absent or late `minDays` or more school days in a row, longest streak first (dashboard and Absence Watch).
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
    return out.sort((a, b) => b.streak.count - a.streak.count || byName(a.student, b.student));
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
    const title =
      first.type === 'suspension'
        ? `Classes suspended: ${when}`
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
      `${first.label}.${noClass ? ' Attendance is not taken and these days do not count in absence streaks.' : ''}`,
      first.date,
    );
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
    this.emit();
  }
  // Shortcut for one suspended day.
  async declareSuspension(date, label) {
    await this.saveCalendarDays([{ date, type: 'suspension', label }]);
  }
  async listTeachers() {
    await this.ready;
    return [...this.s.teachers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  // Adds or edits a teacher. A NEW teacher also gets a sign-in account with a temporary password
  // (returned so the admin can hand it over). The email cannot change after creation.
  async saveTeacher(input) {
    const dupe = [...this.s.teachers.values()].find((t) => t.email.toLowerCase() === input.email.toLowerCase() && t.id !== input.id);
    if (dupe) throw new Error('Another teacher already uses this email.');
    const existing = input.id ? this.s.teachers.get(input.id) : undefined;
    if (existing) {
      Object.assign(existing, { name: input.name, mobile: input.mobile });
      this.put('teachers', existing.id, existing);
      await this.logAudit('teacher.update', existing.name);
      this.emit();
      return { teacher: existing };
    }
    const teacher = { id: uid('t'), name: input.name, email: input.email, mobile: input.mobile, active: true };
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
          schedule: input.schedule,
        }
      : { id: uid('sec'), schoolYearId: this.year.id, gradeLevel: 'K', archived: false, ...input };
    this.s.sections.set(section.id, section);
    this.put('sections', section.id, section);
    await this.logAudit(existing ? 'section.update' : 'section.create', section.name);
    this.refreshSession();
    this.emit();
    return section;
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
      .sort((a, b) => byName(a.student, b.student));
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
    let g = [...this.s.guardians.values()].find((x) => x.mobile === input.guardianMobile);
    if (!g) {
      for (const other of this.s.guardians.values()) {
        if (other.studentIds.includes(student.id)) {
          other.studentIds = other.studentIds.filter((id) => id !== student.id);
          this.put('guardians', other.id, other);
        }
      }
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
    if (input.sectionId !== undefined) this.placeStudent(student.id, input.sectionId);
    return { student, sibling };
  }
  async saveStudent(input) {
    await this.ready;
    const { student } = this.upsertStudent(input);
    await this.logAudit(input.id ? 'student.update' : 'student.create', `${student.firstName} ${student.lastName}`);
    this.emit();
    return student;
  }
  // Adds many children at once (Excel import).
  async importStudents(inputs) {
    await this.ready;
    let linkedSiblings = 0;
    for (const input of inputs) if (this.upsertStudent(input).sibling) linkedSiblings++;
    await this.logAudit('student.import', `${inputs.length} students`, `${linkedSiblings} linked to an existing guardian`);
    this.emit();
    return { created: inputs.length, linkedSiblings };
  }
  // Places many children at once (auto-assign or bulk move). Remembers the previous state for "Undo".
  async assignStudents(assignments, label) {
    await this.ready;
    this.lastAssign = { label, before: structuredClone([...this.s.enrollments.values()]) };
    Object.entries(assignments).forEach(([studentId, sectionId]) => this.placeStudent(studentId, sectionId));
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
      status: 'sent',
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
  autoFinalizeMins: 45,
};
export const schoolYear = { id: 'sy-2026', name: 'SY 2026-2027', start: '2026-06-08', end: '2027-04-08', isActive: true };
// Default school settings. {child}, {time}, {school}, {contact} and {streak} are filled in by renderTemplate().
export const settings = {
  schoolName: 'Sunnyside Kinder',
  contactNumber: '0917 555 0123',
  arrivalSmsEnabled: true,
  streakDays: 3,
  templates: {
    en: {
      arrival: 'Doorbell: {child} arrived at school at {time}. - {school}',
      late: 'Doorbell: {child} arrived late at {time}. - {school}',
      streak: '{school}: {child} has been {streak}. We hope all is well. Please call {contact}.',
    },
    fil: {
      arrival: 'Doorbell: Nakarating na si {child} sa paaralan ng {time}. - {school}',
      late: 'Doorbell: Nahuli si {child} ng dating, {time}. - {school}',
      streak: '{school}: Si {child} ay {streak}. Sana ay maayos siya. Pakitawagan ang {contact}.',
    },
  },
};
export const teachers = [
  { id: 't-maria', name: 'Maria Santos', email: 'maria.santos@sunnyside.edu.ph', active: true, uid: 'u-maria' },
  { id: 't-jose', name: 'Jose Ramirez', email: 'jose.ramirez@sunnyside.edu.ph', active: true, uid: 'u-jose' },
  { id: 't-ana', name: 'Ana Villanueva', email: 'ana.villanueva@sunnyside.edu.ph', active: true, uid: 'u-ana' },
  { id: 't-liza', name: 'Liza Aquino', email: 'liza.aquino@sunnyside.edu.ph', active: true, uid: 'u-liza' },
];
export const users = [
  { uid: 'u-admin', email: 'admin@sunnyside.edu.ph', name: 'Rosario Dizon', role: 'admin' },
  ...teachers.map((t) => ({ uid: t.uid, email: t.email, name: t.name, role: 'teacher', teacherId: t.id })),
];
export const sections = [
  {
    id: 'sec-apple',
    schoolYearId: 'sy-2026',
    name: 'Kindergarten I - Apple',
    gradeLevel: 'K',
    color: '#FFD9A8',
    schedule,
    capacity: 25,
    teacherId: 't-maria',
    archived: false,
  },
  {
    id: 'sec-mango',
    schoolYearId: 'sy-2026',
    name: 'Kindergarten I - Mango',
    gradeLevel: 'K',
    color: '#D8F5A2',
    schedule,
    capacity: 25,
    teacherId: 't-jose',
    archived: false,
  },
  {
    id: 'sec-banana',
    schoolYearId: 'sy-2026',
    name: 'Kindergarten II - Banana',
    gradeLevel: 'K',
    color: '#E4D6FA',
    schedule: { ...schedule, startTime: '12:30', endTime: '16:00' },
    capacity: 25,
    teacherId: 't-ana',
    archived: false,
  },
  // Maria handles two classes: Apple in the morning and Cherry in the afternoon.
  {
    id: 'sec-cherry',
    schoolYearId: 'sy-2026',
    name: 'Kindergarten II - Cherry',
    gradeLevel: 'K',
    color: '#FBD3E0',
    schedule: { ...schedule, startTime: '12:30', endTime: '16:00' },
    capacity: 25,
    teacherId: 't-maria',
    archived: false,
  },
];
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
  const newStudent = (prefix) => {
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
      birthdate: `2021-0${1 + Math.floor(r() * 9)}-${String(10 + Math.floor(r() * 18))}`,
      sex,
      qrToken: `${prefix}${token}`,
      qrStatus: 'active',
    };
  };
  for (const sec of sections) {
    for (let i = 0; i < 20; i++) {
      const s = newStudent('DB-');
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
        guardians[guardians.length - 1].studentIds.push(s.id);
        continue;
      } // siblings
      guardians.push({
        id: `g-${s.id}`,
        name: `${r() < 0.6 ? pick(FIRST_F) : pick(FIRST_M)} ${s.lastName}`,
        mobile: `+639${String(170000000 + Math.floor(r() * 9999999)).slice(0, 9)}`,
        relationship: r() < 0.6 ? 'Mother' : r() < 0.8 ? 'Father' : 'Grandmother',
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
      { email: 'maria.santos@sunnyside.edu.ph', password: DEMO_PASSWORD, label: 'Teacher, Apple (AM) and Cherry (PM)' },
      { email: 'jose.ramirez@sunnyside.edu.ph', password: DEMO_PASSWORD, label: 'Teacher, Kinder I - Mango' },
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
  for (const sec of state.sections.values()) {
    const days = [];
    for (let d = schoolYear.start; d <= yesterday && d <= schoolYear.end; d = addDays(d, 1))
      if (isSchoolDay(d, sec.schedule, state.calendar)) days.push(d);
    const roster = engine.rosterOn(sec.id, schoolYear.start);
    const last = days.length - 1;
    days.forEach((date, idx) => {
      const id = `${sec.id}_${date}`;
      const day = { id, sectionId: sec.id, date, records: {} };
      roster.forEach((stu, i) => {
        const x = r();
        let status = x < 0.86 ? 'present' : x < 0.93 ? 'late' : x < 0.97 ? 'absent' : 'excused';
        // Stories for the demo (Apple section), ending yesterday:
        if (sec.id === 'sec-apple') {
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
        };
      });
      state.attendance.set(id, day);
      const conf = `${date}T${fromMinutes(toMinutes(sec.schedule.startTime) + 20 + Math.floor(r() * 25))}:00+08:00`;
      engine.finalize(sec.id, date, r() < 0.8 ? (state.teachers.get(sec.teacherId ?? '')?.name ?? 'Auto-confirm') : 'Auto-confirm', false, conf);
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
  // Arrival texts for today, as the scanner would have sent them.
  for (const day of state.attendance.values()) {
    if (day.date !== today) continue;
    for (const rec of Object.values(day.records)) {
      const stu = state.students.get(rec.studentId);
      engine.queueSms(stu, rec.status === 'late' ? 'late' : 'arrival', {
        time: rec.scannedAt,
        date: today,
        sectionId: day.sectionId,
        createdAt: `${today}T${rec.scannedAt}:00+08:00`,
      });
    }
  }
  // Older alerts are already read.
  for (const n of state.notifications.values()) if (n.createdAt < addDays(today, -1)) n.read = true;
  return state;
}
