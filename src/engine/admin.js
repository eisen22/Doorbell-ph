// =====================================================================
// engine/admin.js — SCHOOL SETUP (admin)
// Audit log, settings, school year, calendar, teachers, gate and admin accounts, sections, students.
// These are methods of the Engine class (engine.js adds them to it), so `this` is the engine.
// =====================================================================
import {
  isSchoolDay,
  gradeRank,
  bySectionGrade,
  levelsLabel,
  hasSubjectTeachers,
  to12h,
  eachDate,
  isoWeekday,
  addDays,
} from '../logic';
import { dayId, fmtDay, schedulesOverlap, uid, byName } from './util';

export const adminMethods = {
  // =====================================================================
  // ADMIN ACTIONS
  // =====================================================================
  async listAudit(limit = 300) {
    await this.ready;
    return [...this.s.audit.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  },
  // Audit entries of one day ('YYYY-MM-DD', Philippine time), newest first. The cloud version
  // (firebase.js) asks Firestore, because only the newest 300 entries are kept loaded.
  async listAuditOn(date) {
    await this.ready;
    const since = new Date(`${date}T00:00:00+08:00`).toISOString();
    const until = new Date(`${addDays(date, 1)}T00:00:00+08:00`).toISOString();
    return [...this.s.audit.values()].filter((a) => a.at >= since && a.at < until).sort((a, b) => b.at.localeCompare(a.at));
  },
  // Adds a line to the audit log: who did what, to whom, and when.
  async logAudit(action, target, detail) {
    const e = { id: uid('aud'), at: new Date().toISOString(), actor: this.actor(), action, target, detail };
    this.s.audit.set(e.id, e);
    this.put('audit', e.id, e);
  },
  // meta/school = { settings, schoolYear }; meta/calendar = { days: [...], notices: [...] }.
  saveMeta() {
    this.put('meta', 'school', this.s.meta);
  },
  saveCalendar() {
    this.put('meta', 'calendar', {
      days: [...this.s.calendar.values()].sort((a, b) => a.date.localeCompare(b.date)),
      notices: this.s.calendarNotices ?? [],
    });
  },
  // Admin -> Settings: SMS templates, streak days, school name, etc.
  async updateSettings(patch) {
    const renamed = patch.schoolName !== undefined && patch.schoolName !== this.settings.schoolName;
    this.s.meta = { ...this.s.meta, settings: { ...this.settings, ...patch } };
    this.normalizeSections();
    this.saveMeta();
    // The parent portal shows the school's name: rewrite this month's pages with the new one.
    if (renamed) this.syncParentDays(null, [this.clock.today().slice(0, 7)]);
    await this.logAudit('settings.update', 'settings', Object.keys(patch).join(', '));
    this.emit();
    return this.settings;
  },
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
  },
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
  },
  // Remembers a calendar change for the parent portal ("Classes suspended: Tue, Nov 18"). The portal shows
  // the ones from the last 14 days that apply to the child (levels: some grade levels only; sectionId: one
  // class only, e.g. no class because the teacher is absent). Saved in meta/calendar with the last 30.
  addCalendarNotice(n) {
    const notice = { id: uid('ntc'), at: new Date().toISOString(), by: this.actor(), levels: null, sectionId: null, ...n };
    this.s.calendarNotices = [notice, ...(this.s.calendarNotices ?? [])].slice(0, 30);
    return notice;
  },
  // One alert per class with children who came in today and have not left, after today became a no-class
  // day for them. They stay with staff until fetched; scanning out or "Picked up" texts the parent.
  alertStillAtSchool(entry) {
    const today = this.clock.today();
    for (const sec of this.s.sections.values()) {
      if (sec.archived || (entry.levels?.length && !entry.levels.includes(sec.gradeLevel))) continue;
      if (entry.type === 'partial' && sec.schedule.endTime <= entry.from) continue;
      const here = this.rosterOn(sec.id, today).filter((k) => {
        const r = this.record(sec.id, today, k.id);
        return r?.scannedAt && !r.scannedOut;
      });
      if (!here.length) continue;
      const n = {
        id: `oncampus_${sec.id}_${today}`,
        kind: 'missing',
        sectionId: sec.id,
        createdAt: this.nowIso(),
        read: false,
        title:
          entry.type === 'partial'
            ? `Classes are suspended from ${to12h(entry.from)} today: ${here.length} ${here.length === 1 ? 'child of' : 'children of'} ${sec.name} ${here.length === 1 ? 'is' : 'are'} at school`
            : `${here.length} ${here.length === 1 ? 'child of' : 'children of'} ${sec.name} ${here.length === 1 ? 'is' : 'are'} at school, but classes are ${entry.type === 'suspension' ? 'suspended' : 'off'} today`,
        body: `${here.map((k) => `${k.firstName} ${k.lastName}`).join(', ')}. ${
          entry.type === 'partial' ? `Parents were asked to fetch them at ${to12h(entry.from)}. Until then classes go on; after that, keep` : 'Keep'
        } them with a staff member until they are fetched. Scan their ID at the gate (or press Picked up on the Attendance page) as each one leaves: the parent is texted.`,
      };
      this.s.notifications.set(n.id, n);
      this.put('notifications', n.id, n);
    }
  },
  // Admin: a message from the school to parents, e.g. "Please fetch your children by 11 AM due to an
  // earthquake drill." To the whole school, some grade levels, or one class. It shows at the top of the
  // parent portal for `days` days and (textParents) is texted, one text per family.
  async sendAnnouncement({ message, messageFil, levels, sectionId, sectionIds, days = 3, textParents = true }) {
    await this.ready;
    const text = (message ?? '').trim();
    if (!text) throw new Error('Write the message first.');
    if (text.length > 300 || (messageFil ?? '').trim().length > 300) throw new Error('Keep the message under 300 characters (2 texts).');
    const today = this.clock.today();
    const admin = this.session?.role === 'admin';
    const ids = sectionIds?.length ? [...new Set(sectionIds)] : sectionId ? [sectionId] : [];
    // A teacher: only to the classes they teach (adviser or subject teacher), one or all of them.
    if (!admin) {
      const mine = new Set([...this.classesOf(this.session.teacherId), ...this.subjectClassesOf(this.session.teacherId)].map((c) => c.id));
      if (!ids.length) throw new Error('Choose one of your classes.');
      if (ids.some((id) => !mine.has(id))) throw new Error('You can send announcements only to the classes you teach.');
    }
    const secs = ids.map((id) => this.s.sections.get(id)).filter(Boolean);
    const only = levelsLabel(levels);
    const who = secs.length ? secs.map((x) => x.name).join(', ') : only || 'the whole school';
    const base = {
      type: 'announcement',
      title: admin ? 'Announcement from the school' : `Announcement from Teacher ${this.actor()}`,
      // A teacher's announcement says who it is from in the text too.
      fromTeacher: admin ? null : `Teacher ${this.actor()}`,
      body: text,
      bodyFil: (messageFil ?? '').trim() || null,
      dates: Array.from({ length: Math.max(1, days) }, (_, i) => addDays(today, i)),
      at: new Date().toISOString(),
      by: this.actor(),
    };
    // One announcement per class (firestore.rules lets a teacher write only for a class they teach), or
    // one for the whole school / some grade levels. Kept in the announcements collection.
    const notices = secs.length
      ? secs.map((x) => ({ ...base, id: uid('ann'), sectionId: x.id, levels: null }))
      : [{ ...base, id: uid('ann'), sectionId: null, levels: levels?.length ? levels : null }];
    const seen = new Set(); // a family with children in two of these classes gets one text
    let texted = 0;
    for (const n of notices) {
      this.s.announcements.set(n.id, n);
      this.put('announcements', n.id, n);
      if (textParents) texted += this.textFamilies(n, seen);
      // Teachers of that class (and the admin) see it in their alerts.
      const alert = {
        id: uid('cal'),
        kind: 'calendar',
        sectionId: n.sectionId ?? 'all',
        date: today,
        createdAt: n.at,
        read: false,
        title: `Announcement to parents (${n.sectionId ? this.s.sections.get(n.sectionId).name : who})`,
        body: `"${text}" Sent by ${this.actor()}.`,
      };
      this.s.notifications.set(alert.id, alert);
      this.put('notifications', alert.id, alert);
    }
    await this.logAudit('announcement.send', who, `${text}${texted ? ` (texted ${texted} families)` : ''}`);
    this.syncParentDays(secs.length ? secs.flatMap((x) => this.rosterOn(x.id, today).map((k) => k.id)) : null, [today.slice(0, 7)]);
    this.emit();
    return texted;
  },
  // The classes this user can send an announcement to: every class (admin) or the ones they teach.
  async listAnnounceClasses() {
    await this.ready;
    if (this.session?.role === 'admin') return [...this.s.sections.values()].filter((x) => !x.archived);
    const t = this.session?.teacherId;
    return [...new Map([...this.classesOf(t), ...this.subjectClassesOf(t)].map((c) => [c.id, c])).values()];
  },
  // Texts every family the notice applies to: one text per family (siblings share one), only with SMS
  // consent, in the family's language. Returns how many families were texted.
  // seen (optional): guardians already texted in this send (skipped, and added to it).
  textFamilies(notice, seen) {
    const kids = this.familiesFor(notice);
    if (seen) {
      for (const gid of [...kids.keys()]) {
        if (seen.has(gid)) kids.delete(gid);
        else seen.add(gid);
      }
    }
    for (const { g, student, section, here } of kids.values()) {
      const fil = g.preferredLanguage === 'fil';
      const id = `ntc_${notice.id}_${g.id}`;
      const msg = {
        id,
        studentId: student.id,
        guardianId: g.id,
        sectionId: section.id,
        to: g.mobile,
        body: noticeText(notice, { fil, child: student.firstName, section: section.name, school: this.settings.schoolName, today: this.clock.today(), here }),
        kind: 'notice',
        status: g.numberStatus === 'failed' ? 'failed' : this.newSmsStatus(),
        createdAt: this.nowIso(),
        queuedAt: new Date().toISOString(),
        attempts: 1,
      };
      this.s.sms.set(id, msg);
      this.put('sms', id, msg);
    }
    return kids.size;
  },
  // Before sending (the "Tell parents" window): how many families a notice would text, and the exact text
  // the first of them would get (made by the same noticeText() as the real one).
  //   { type, dates, levels, sectionId, from, until, body, bodyFil, title }
  async previewNotice(n) {
    await this.ready;
    const notice = { dates: [this.clock.today()], levels: null, sectionId: null, title: '', ...n };
    // Several classes (a teacher's "All my classes"): the families of all of them, each once.
    const kids = n.sectionIds?.length
      ? new Map(n.sectionIds.flatMap((sectionId) => [...this.familiesFor({ ...notice, sectionId })]))
      : this.familiesFor(notice);
    const first = kids.values().next().value;
    const text = noticeText(notice, {
      fil: false,
      child: first?.student.firstName ?? 'Juan',
      section: first?.section.name ?? 'Grade 1 - Rizal',
      school: this.settings.schoolName,
      today: this.clock.today(),
      here: [],
    });
    return { families: kids.size, text };
  },
  // The families a notice concerns: guardian id -> { g, student (eldest), section, here (children at school now) }.
  familiesFor(notice) {
    const today = this.clock.today();
    const dates = [...notice.dates].sort();
    const kids = new Map(); // guardian id -> { g, student, section }
    for (const e of this.s.enrollments.values()) {
      if (e.status !== 'active') continue;
      const sec = this.s.sections.get(e.sectionId);
      const stu = this.s.students.get(e.studentId);
      if (!sec || sec.archived || !stu || stu.id.includes('-old-')) continue;
      if (notice.sectionId && sec.id !== notice.sectionId) continue;
      if (notice.levels?.length && !notice.levels.includes(sec.gradeLevel)) continue;
      // Suspended from 1:00 PM: a class that ends before then is not affected.
      if (notice.type === 'partial' && sec.schedule.endTime <= notice.from) continue;
      // Only classes that meet on one of those days (a Saturday holiday does not concern a Mon-Fri class).
      if (!['makeup', 'announcement'].includes(notice.type) && !dates.some((d) => sec.schedule.classDays.includes(isoWeekday(d)))) continue;
      const g = this.guardianOf(stu.id);
      if (!g?.smsConsent || !g.mobile) continue;
      // No class today but the child is already at school (came in before the suspension): say so.
      const r = dates.includes(today) && ['suspension', 'partial', 'holiday', 'break', 'noclass'].includes(notice.type) ? this.record(sec.id, today, stu.id) : null;
      const atSchool = r?.scannedAt && !r.scannedOut ? [stu.firstName] : [];
      const had = kids.get(g.id);
      const here = [...(had?.here ?? []), ...atSchool];
      if (!had || byName(stu, had.student) < 0) kids.set(g.id, { g, student: stu, section: sec, here });
      else had.here = here;
    }
    return kids;
  },
  // Admin marks one or more days (holiday, suspension, exam...). Every teacher gets an alert, the parent
  // portal shows the change, and with opts.textParents the families it affects get one text each.
  // Returns how many families were texted.
  async saveCalendarDays(days, opts = {}) {
    if (!days.length) return 0;
    days.forEach((d) => this.s.calendar.set(d.date, d));
    const first = days[0];
    const last = days[days.length - 1];
    const when = days.length === 1 ? fmtDay(first.date) : `${fmtDay(first.date)} to ${fmtDay(last.date)}`;
    await this.logAudit('calendar.update', days.length === 1 ? first.date : `${first.date} to ${last.date}`, `${first.type}: ${first.label}`);
    const noClass = first.type === 'holiday' || first.type === 'suspension' || first.type === 'break';
    const only = levelsLabel(first.levels);
    const partial = first.type === 'partial'; // suspended from a time (e.g. 1:00 PM); morning classes go on
    const title =
      first.type === 'suspension'
        ? `Classes suspended${only ? ` (${only})` : ''}: ${when}`
        : partial
          ? `Classes suspended from ${to12h(first.from)}${only ? ` (${only})` : ''}: ${when}`
        : noClass
          ? `No classes: ${when}`
          : first.type === 'exam'
            ? `Exam day: ${when}`
            : first.type === 'halfday'
              ? `Half day${first.until ? ` (classes end at ${to12h(first.until)})` : ''}: ${when}`
              : first.type === 'makeup'
                ? `Make-up class: ${when}`
                : `School event: ${when}`;
    this.notifyCalendar(
      title,
      `${first.label}.${noClass ? ` ${only ? `Only ${only.replace(/ only$/, '')} classes are affected. ` : ''}Attendance is not taken and these days do not count in absence streaks.` : ''}${
        partial ? ` ${only ? `Only ${only.replace(/ only$/, '')} classes are affected. ` : ''}Classes before ${to12h(first.from)} go on and attendance is taken as usual; children go home at ${to12h(first.from)}.` : ''
      }`,
      first.date,
    );
    const notice = this.addCalendarNotice({
      type: first.type,
      title,
      body: first.label,
      dates: days.map((d) => d.date),
      levels: first.levels?.length ? first.levels : null,
      ...(partial ? { from: first.from } : {}),
      ...(first.type === 'halfday' && first.until ? { until: first.until } : {}),
    });
    this.saveCalendar();
    // CHILD SAFETY: no class TODAY, declared after children already came in (e.g. a suspension during
    // class hours): staff get the list of each class's children still at school.
    if ((noClass || partial) && days.some((d) => d.date === this.clock.today())) this.alertStillAtSchool(first);
    const texted = opts.textParents ? this.textFamilies(notice) : 0;
    this.syncParentDays(null, [this.clock.today().slice(0, 7), ...days.map((d) => d.date.slice(0, 7))]);
    this.emit();
    return texted;
  },
  // Makes days regular class days again (and alerts teachers).
  async removeCalendarDays(dates, opts = {}) {
    if (!dates.length) return 0;
    // Which levels the removed days applied to (a Kindergarten-only suspension lifted -> only K parents).
    const removed = dates.map((d) => this.s.calendar.get(d)).filter(Boolean);
    const wasNoClass = removed.some((e) => ['holiday', 'suspension', 'break', 'partial'].includes(e.type));
    const levels = removed.length && removed.every((e) => e.levels?.length) ? [...new Set(removed.flatMap((e) => e.levels))] : null;
    dates.forEach((d) => this.s.calendar.delete(d));
    await this.logAudit('calendar.clear', dates.length === 1 ? dates[0] : `${dates.length} days`);
    const sorted = [...dates].sort();
    const when = sorted.length === 1 ? fmtDay(sorted[0]) : `${fmtDay(sorted[0])} to ${fmtDay(sorted[sorted.length - 1])}`;
    this.notifyCalendar(
      `Calendar change: ${when}`,
      `${sorted.length === 1 ? 'This day is' : 'These days are'} back to the regular class schedule.`,
      sorted[0],
    );
    let texted = 0;
    if (removed.length) {
      const notice = this.addCalendarNotice({
        type: wasNoClass ? 'resume' : 'class',
        title: `${wasNoClass ? 'Classes as usual' : 'Calendar change'}: ${when}`,
        body: `${sorted.length === 1 ? 'This day is' : 'These days are'} back to the regular class schedule.`,
        dates: sorted,
        levels,
      });
      if (opts.textParents && wasNoClass) texted = this.textFamilies(notice);
    }
    this.saveCalendar();
    this.syncParentDays(null, [this.clock.today().slice(0, 7), ...sorted.map((d) => d.slice(0, 7))]);
    this.emit();
    return texted;
  },
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
  },
  // Shortcut for one suspended day.
  // levels: which grade levels are suspended (empty or all = the whole school). DepEd Order 22, s. 2024:
  // Signal No. 1 suspends Kindergarten only; Signal No. 2 Kindergarten to Grade 10; Signal No. 3 all levels.
  // The one way to suspend classes (the "Tell parents" window, and the day editor's "Class suspension"):
  //   opts.to = last date ('YYYY-MM-DD', Saturdays and Sundays skipped); opts.time = 'HH:MM': suspended from
  //   that time only (classes before it go on, attendance is taken); opts.textParents.
  async declareSuspension(date, label, levels = [], opts = {}) {
    return this.saveCalendarDays(this.suspensionDays(date, label, levels, opts), opts);
  },
  suspensionDays(date, label, levels = [], opts = {}) {
    const some = levels.length && levels.length < 7;
    const time = opts.time ?? opts.from ?? null;
    const end = opts.to && opts.to > date ? opts.to : date;
    const dates = eachDate(date, end).filter((d) => d === date || isoWeekday(d) <= 5);
    return dates.map((d) => ({
      date: d,
      type: time ? 'partial' : 'suspension',
      label,
      ...(time ? { from: time } : {}),
      ...(some ? { levels: [...levels].sort((a, b) => gradeRank(a) - gradeRank(b)) } : {}),
    }));
  },
  async listTeachers() {
    await this.ready;
    // By the grade they advise (Kindergarten, Grade 1 ... Grade 6), then by name; teachers with no class last.
    const level = (t) => Math.min(99, ...[...this.s.sections.values()].filter((x) => !x.archived && x.teacherId === t.id).map((x) => gradeRank(x.gradeLevel)));
    return [...this.s.teachers.values()].sort((a, b) => level(a) - level(b) || a.name.localeCompare(b.name));
  },
  // Adds or edits a teacher. A NEW teacher also gets a sign-in account with a temporary password
  // (returned so the admin can hand it over). The email cannot change after creation.
  async saveTeacher(input) {
    const dupe = [...this.s.teachers.values()].find((t) => t.email.toLowerCase() === input.email.toLowerCase() && t.id !== input.id);
    if (dupe) throw new Error('Another teacher already uses this email.');
    const existing = input.id ? this.s.teachers.get(input.id) : undefined;
    if (existing) {
      Object.assign(existing, { name: input.name, mobile: input.mobile, subjects: input.subjects ?? existing.subjects ?? [], gradeLevel: input.gradeLevel ?? existing.gradeLevel ?? null });
      this.put('teachers', existing.id, existing);
      await this.logAudit('teacher.update', existing.name);
      this.emit();
      return { teacher: existing };
    }
    // gradeLevel: the grade they teach ('K'...'6'), used to show only that grade's classes when placing them.
    const teacher = { id: uid('t'), name: input.name, email: input.email, mobile: input.mobile, subjects: input.subjects ?? [], gradeLevel: input.gradeLevel ?? null, active: true };
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
  },
  // ---------------------------------------------------------------------
  // GATE SCANNER ACCOUNTS
  // The phone at the school gate runs the Doorbell Gate app (gate-app/ folder). It signs in with
  // its own account whose role is 'gate': it can record scans and queue the parent texts, but it
  // cannot open this website. Removing the account's profile stops the phone from scanning.
  // ---------------------------------------------------------------------
  gateAccounts() {
    return [...this.s.users.values()].filter((u) => u.role === 'gate').sort((a, b) => a.email.localeCompare(b.email));
  },
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
  },
  async removeGateAccount(accountUid) {
    const acc = this.s.users.get(accountUid);
    if (!acc || acc.role !== 'gate') return;
    this.s.users.delete(accountUid);
    this.persistence.remove('users', accountUid);
    await this.logAudit('gate.remove', acc.email, 'gate scanner account removed');
    this.emit();
  },
  // ---------------------------------------------------------------------
  // ADMIN ACCOUNTS (Settings -> Admins). The school can have several admins; each one can do
  // everything. Removing an admin deletes their profile (users/{uid}), so they can no longer
  // open the website. Nobody can remove their own access or the last admin, so the school
  // can never lock itself out.
  // ---------------------------------------------------------------------
  admins() {
    return [...this.s.users.values()].filter((u) => u.role === 'admin').sort((a, b) => a.name.localeCompare(b.name));
  },
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
  },
  async removeAdmin(accountUid) {
    const acc = this.s.users.get(accountUid);
    if (!acc || acc.role !== 'admin') return;
    if (accountUid === this.session?.uid) throw new Error('You cannot remove your own admin access. Ask another admin to do it.');
    if (this.admins().length <= 1) throw new Error('The school must keep at least one admin.');
    this.s.users.delete(accountUid);
    this.persistence.remove('users', accountUid);
    await this.logAudit('admin.remove', acc.name, acc.email);
    this.emit();
  },
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
  },
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
  },
  // ---------------------------------------------------------------------
  // TEACHER ABSENT: Admin -> Sections -> a class -> "Teacher absent"
  //   kind 'substitute': teacherId covers the class on those dates (sees it, takes and confirms attendance)
  //   kind 'noclass':    no class for this section on those dates (children are not marked absent)
  // Only class days in from..to that are not confirmed yet are changed. Returns the dates changed.
  // ---------------------------------------------------------------------
  async setTeacherAway(sectionId, { from, to, kind, teacherId, note, textParents }) {
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
    // No class: the parents of this class see it in the portal (and get a text when asked), so no
    // child is sent to school for a class that is not held.
    if (kind === 'noclass') {
      const notice = this.addCalendarNotice({
        type: 'noclass',
        title: `No class for ${sec.name}: ${when}`,
        body: `The class teacher is absent.${entry.note ? ` ${entry.note}` : ''}`,
        dates,
        sectionId: sec.id,
      });
      this.saveCalendar();
      if (textParents) this.textFamilies(notice);
      this.syncParentDays(
        this.rosterOn(sec.id, dates[0]).map((k) => k.id),
        [today.slice(0, 7), ...dates.map((d) => d.slice(0, 7))],
      );
    }
    this.refreshSession();
    this.emit();
    return dates;
  },
  // Undoes one teacher-away day (back to a normal class day with the class teacher).
  async clearTeacherAway(sectionId, date) {
    const sec = this.s.sections.get(sectionId);
    if (!sec?.schedule.teacherAway?.[date]) return;
    const away = { ...sec.schedule.teacherAway };
    delete away[date];
    sec.schedule = { ...sec.schedule, teacherAway: away };
    this.put('sections', sec.id, sec);
    await this.logAudit('section.teacher_away_removed', sec.name, fmtDay(date));
    this.syncParentDays(this.rosterOn(sec.id, date).map((k) => k.id), [this.clock.today().slice(0, 7), date.slice(0, 7)]);
    this.refreshSession();
    this.emit();
  },
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
  },
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
  },
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
  },
  // A random card code like 'DB-7K2M9Q4XAB'. No personal data, so a lost card reveals nothing.
  newToken() {
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return `DB-${Array.from(bytes, (b) => '0123456789ABCDEFGHJKMNPQRSTVWXYZ'[b % 32]).join('')}`;
  },
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
  },
  // Rewrites the parent portal keys of these children's guardians (the key holds each child's class).
  async syncKeysFor(studentIds) {
    const seen = new Set();
    for (const id of studentIds) {
      const g = this.guardianOf(id);
      if (!g || seen.has(g.id)) continue;
      seen.add(g.id);
      await this.syncParentKey(g);
    }
  },
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
  },
  async saveStudent(input) {
    await this.ready;
    const { student, touched } = this.upsertStudent(input);
    for (const g of touched) await this.syncParentKey(g);
    await this.logAudit(input.id ? 'student.update' : 'student.create', `${student.firstName} ${student.lastName}`);
    this.emit();
    return student;
  },
  // Places many children at once (auto-assign or bulk move). Remembers the previous state for "Undo".
  async assignStudents(assignments, label) {
    await this.ready;
    this.lastAssign = { label, before: structuredClone([...this.s.enrollments.values()]) };
    Object.entries(assignments).forEach(([studentId, sectionId]) => this.placeStudent(studentId, sectionId));
    await this.syncKeysFor(Object.keys(assignments));
    await this.logAudit('student.assign', label, `${Object.keys(assignments).length} students`);
    this.emit();
  },
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
  },
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
  },
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
  },
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
  },
};

// The text a family gets about a calendar change, e.g. "Sunnyside ES: Kindergarten classes are suspended
// tomorrow, Tue, Nov 17. Reason: Tropical Cyclone Wind Signal No. 1."
function noticeText(n, opts) {
  const base = noticeBody(n, opts);
  const here = opts.here ?? [];
  if (!here.length) return base;
  const list = here.length === 1 ? here[0] : `${here.slice(0, -1).join(', ')} ${opts.fil ? 'at' : 'and'} ${here[here.length - 1]}`;
  const at = n.type === 'partial' ? (opts.fil ? ` ng ${to12h(n.from)}` : ` at ${to12h(n.from)}`) : '';
  return opts.fil
    ? `${base} Nasa paaralan na ${here.length > 1 ? 'sina' : 'si'} ${list}. Pakisundo po${at}, o hintayin ang abiso ng paaralan.`
    : `${base} ${list} ${here.length > 1 ? 'are' : 'is'} at school now. Please fetch ${here.length > 1 ? 'them' : list}${at}, or wait for the school's advice.`;
}
function noticeBody(n, { fil, child, section, school, today }) {
  const dates = [...n.dates].sort();
  const day = (d) => (d === today ? `${fil ? 'ngayong araw' : 'today'}, ${fmtDay(d)}` : d === addDays(today, 1) ? `${fil ? 'bukas' : 'tomorrow'}, ${fmtDay(d)}` : `on ${fmtDay(d)}`);
  const plain = (d) => day(d).replace(/^on /, fil ? 'sa ' : 'on ');
  const when = dates.length === 1 ? plain(dates[0]) : `${fil ? 'mula' : 'from'} ${fmtDay(dates[0])} ${fil ? 'hanggang' : 'to'} ${fmtDay(dates[dates.length - 1])}`;
  const only = levelsLabel(n.levels).replace(/ only$/, ''); // 'Kindergarten', 'Grades 1 and 2'
  const who = only ? `${only} classes` : 'Classes';
  const whoFil = only ? ` ng ${only}` : '';
  const reason = n.body ? (fil ? ` Dahilan: ${n.body.replace(/\.$/, '')}.` : ` Reason: ${n.body.replace(/\.$/, '')}.`) : '';
  const head = school ? `${school}: ` : '';
  switch (n.type) {
    case 'suspension':
      return fil ? `${head}Suspendido ang klase${whoFil} ${when}.${reason}` : `${head}${who} are suspended ${when}.${reason}`;
    case 'partial':
      return fil
        ? `${head}Suspendido ang klase${whoFil} mula ${to12h(n.from)} ${when}.${reason}`
        : `${head}${who} are suspended from ${to12h(n.from)} ${when}.${reason}`;
    case 'holiday':
    case 'break':
      return fil ? `${head}Walang pasok${whoFil} ${when}.${reason}` : `${head}No classes${only ? ` for ${only}` : ''} ${when}.${reason}`;
    case 'halfday':
      return fil
        ? `${head}Half day ang klase${whoFil} ${when}; ${n.until ? `matatapos ang klase ng ${to12h(n.until)}` : 'mas maagang matatapos ang klase'}.${reason}`
        : `${head}${who} are half day ${when}; ${n.until ? `classes end at ${to12h(n.until)}` : 'classes end early'}.${reason}`;
    case 'makeup':
      return fil ? `${head}May make-up class${whoFil} ${when}. Kailangang pumasok si ${child}.${reason}` : `${head}${who} have a make-up class ${when}. ${child} should come to school.${reason}`;
    case 'resume':
      return fil ? `${head}Tuloy ang klase${whoFil} ${when}.` : `${head}${who} will push through as usual ${when}.`;
    case 'announcement':
      return `${head}${n.fromTeacher ? `${n.fromTeacher}: ` : ''}${fil && n.bodyFil ? n.bodyFil : n.body}`;
    case 'noclass':
      return fil
        ? `${head}Walang klase ang ${section} ${when} dahil liban ang guro.`
        : `${head}${child}'s class (${section}) has no class ${when} because the teacher is absent.`;
    default:
      return `${head}${n.title.replace(/:.*$/, '')} ${when}.${reason}`;
  }
}
