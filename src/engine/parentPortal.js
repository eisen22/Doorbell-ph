// =====================================================================
// engine/parentPortal.js — PARENT PORTAL
// parentKeys and parentDays for the portal, excuse requests, the demo parent view.
// These are methods of the Engine class (engine.js adds them to it), so `this` is the engine.
// =====================================================================
import {
  addDays,
  isSchoolDay,
  isoWeekday,
  parentKeyOf,
  defaultParentPassword,
  eldestChild,
  sha256Hex,
  classPeriods,
  to12h,
} from '../logic';
import { dayId } from './util';

export const parentPortalMethods = {
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
  },
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
  },
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
        ...(r.excusedPeriods?.length ? { xp: r.excusedPeriods } : {}), // excused for these class periods only
        // Class periods missed at school: n period, j subject, a time marked, b back in class (time), bp back period
        ...(() => {
          const cuts = this.cutsOn(r.sectionId, date, studentId);
          return cuts.length ? { x: cuts.map((c) => ({ n: c.period, j: c.subject ?? null, a: c.start ?? c.at, b: c.backAt ?? null, bp: c.backPeriod ?? null })) } : {};
        })(),
      };
    }
    // Class days with no class (holidays, breaks, suspensions, teacher absent), with their names.
    const noClass = {};
    if (section) {
      for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) {
        if (d < this.year.start || d > this.year.end) continue;
        const usual = section.schedule.classDays.includes(isoWeekday(d));
        if (usual && !isSchoolDay(d, section.schedule, this.s.calendar)) noClass[d] = this.noClassLabel(section, d);
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
      yearStart: this.year.start, // first day of classes: the portal's calendar goes back to it
      // The class periods (for "excuse for certain periods" in the portal): number, subject, start time.
      periods: classPeriods(section?.program).map((p, i) => ({ n: i + 1, subject: p.subject, start: p.start })),
      days,
      noClass,
      totals,
      // What is coming up for this child's class (no class, half day, make-up class...) and the latest
      // calendar changes, shown at the top of the portal. Rewritten whenever the calendar changes.
      upcoming: section ? this.parentUpcoming(section, today) : [],
      notices: section ? this.parentNotices(section, today) : [],
      // Announcements from the school and the child's teachers this school year (the portal keeps one
      // at the top until the parent closes it, and lists them all on its Announcements page).
      announcements: section ? this.parentAnnouncements(section) : [],
      updatedAt: new Date().toISOString(),
    };
  },
  // Why a usual class day has no class: the calendar's name for it, or the teacher being absent.
  noClassLabel(section, d) {
    if (section.schedule.teacherAway?.[d]?.kind === 'noclass') return 'No class: the teacher is absent';
    return this.s.calendar.get(d)?.label ?? 'No class';
  },
  // The calendar entry for a day if it applies to this class's grade level.
  entryFor(section, d) {
    const e = this.s.calendar.get(d);
    return e && (!e.levels?.length || e.levels.includes(section.gradeLevel)) ? e : undefined;
  },
  // The next 45 days for one class: days with no class, half days, exams, make-up classes and events.
  parentUpcoming(section, today) {
    const out = [];
    for (let i = 0, d = today; i <= 45 && out.length < 8; i++, d = addDays(d, 1)) {
      if (d > this.year.end) break;
      const e = this.entryFor(section, d);
      const usual = section.schedule.classDays.includes(isoWeekday(d));
      if (usual && !isSchoolDay(d, section.schedule, this.s.calendar)) {
        const away = section.schedule.teacherAway?.[d]?.kind === 'noclass';
        out.push({ date: d, type: away ? 'noclass' : (e?.type ?? 'noclass'), label: this.noClassLabel(section, d) });
      } else if (e?.type === 'partial') {
        out.push({ date: d, type: 'partial', label: `Suspended from ${to12h(e.from)}: ${e.label}` });
      } else if (e?.type === 'halfday') {
        out.push({ date: d, type: 'halfday', label: `${e.label}${e.until ? ` (classes end at ${to12h(e.until)})` : ''}` });
      } else if (e && ['makeup', 'exam', 'event'].includes(e.type)) {
        out.push({ date: d, type: e.type, label: e.label });
      }
    }
    return out;
  },
  // Calendar changes from the last 14 days that concern this class (newest first, at most 3).
  parentNotices(section, today) {
    const since = addDays(today, -14);
    // Calendar changes (meta/calendar). Announcements have their own list (parentAnnouncements).
    return (this.s.calendarNotices ?? [])
      .filter((n) => n.type !== 'announcement')
      .filter((n) => n.at.slice(0, 10) >= since)
      .filter((n) => (!n.sectionId || n.sectionId === section.id) && (!n.levels?.length || n.levels.includes(section.gradeLevel)))
      .slice(0, 3)
      .map((n) => ({ at: n.at, type: n.type, title: n.title, body: n.body ?? '', dates: n.dates }));
  },
  // Announcements for one class this school year, newest first (at most 40): from the school (whole
  // school, its grade level, or the class) or from a teacher of the class.
  parentAnnouncements(section) {
    const since = this.year?.start ?? '0000';
    const old = (this.s.calendarNotices ?? []).filter((n) => n.type === 'announcement'); // sent before Nov 18, 2026
    return [...(this.s.announcements?.values() ?? []), ...old]
      .filter((n) => n.at.slice(0, 10) >= since)
      .filter((n) => (!n.sectionId || n.sectionId === section.id) && (!n.levels?.length || n.levels.includes(section.gradeLevel)))
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 40)
      .map((n) => ({
        id: n.id,
        at: n.at,
        from: n.fromTeacher ? 'teacher' : 'school',
        title: n.title,
        body: n.body ?? '',
        ...(n.bodyFil ? { bodyFil: n.bodyFil } : {}),
      }));
  },
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
  },
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
  },
  // DEMO MODE ONLY: what the parent portal would show for one guardian (the same shape watchParent()
  // gives in the cloud), so the portal can be tried without the cloud. Default: a parent with 2 children.
  demoParentState(guardianId) {
    const gs = [...this.s.guardians.values()].filter((g) => g.studentIds.length);
    const g = gs.find((x) => x.id === guardianId) ?? gs.find((x) => x.studentIds.length > 1) ?? gs[0];
    if (!g) return { status: 'error', error: 'No sample parents.' };
    const kids = g.studentIds.map((id) => this.s.students.get(id)).filter(Boolean);
    const months = [...new Set([...this.s.attendance.values()].map((d) => d.date.slice(0, 7)))].sort();
    return {
      status: 'ready',
      demo: true,
      profile: { mobile: g.mobile, defaultPassword: true },
      key: {
        guardianName: g.name,
        studentIds: kids.map((k) => k.id),
        children: kids.map((k) => ({ id: k.id, firstName: k.firstName, lastName: k.lastName, sectionId: this.activeEnrollment(k.id)?.sectionId ?? null })),
      },
      months: Object.fromEntries(kids.map((k) => [k.id, months.map((m) => this.parentMonthDoc(k.id, m)).filter(Boolean)])),
      excuses: [...this.s.excuses.values()].filter((x) => g.studentIds.includes(x.studentId)),
      parents: gs.map((x) => ({ id: x.id, label: `${x.name} (${x.studentIds.map((id) => this.s.students.get(id)?.firstName).join(', ')})` })),
    };
  },
  // Parents who cannot sign in yet because no child of theirs has a birthday (no default password).
  parentsWithoutPassword() {
    return [...this.s.guardians.values()].filter((g) => g.studentIds.length && !defaultParentPassword(eldestChild(g.studentIds.map((id) => this.s.students.get(id)).filter(Boolean))));
  },
  // Excuse requests the signed-in person may see (a teacher: their classes), newest first.
  async listExcuses() {
    await this.ready;
    const vis = this.visibleSectionIds();
    return [...this.s.excuses.values()]
      .filter((x) => !vis || vis.has(x.sectionId))
      .map((x) => ({ ...x, student: this.s.students.get(x.studentId), section: this.s.sections.get(x.sectionId), canDecide: this.canDecideExcuse(x.sectionId) }))
      // Waiting requests first, then newest first.
      .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.createdAt.localeCompare(a.createdAt));
  },
  // The teacher approves or declines a parent's excuse request. Approved: the days that already
  // happened become Excused (unless the child came to school); later days are excused when the
  // class is confirmed (finalize).
  // Who answers a parent's excuse request: the class adviser, a teacher covering the class today, or an admin.
  // (Subject teachers see the request and the approved excuse, but the adviser decides.)
  canDecideExcuse(sectionId) {
    const s = this.session;
    if (!s) return false;
    if (s.role === 'admin') return true;
    const sec = this.s.sections.get(sectionId);
    return !!sec && (sec.teacherId === s.teacherId || this.coveringToday(s.teacherId).some((c) => c.id === sectionId));
  },
  async decideExcuse(id, decision, note) {
    await this.ready;
    const ex = this.s.excuses.get(id);
    if (!ex || ex.status !== 'pending') return;
    if (!this.canDecideExcuse(ex.sectionId)) throw new Error("Only the class adviser (or the admin) can answer a parent's excuse request.");
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
        const periods = ex.periods?.length ? [...ex.periods].sort((a, b) => a - b) : null; // null = the whole day
        if (rec && (rec.status === 'present' || rec.status === 'late')) {
          // The child came. A late child with a valid reason (or excused for the 1st period) stays Late on the
          // list but is not counted in the late totals; an excuse for some periods is noted on the day.
          const lateOk = rec.status === 'late' && (!periods || periods.includes(1));
          if (!periods && (rec.status !== 'late' || rec.lateExcused)) continue;
          this.writeRecord({
            ...rec,
            ...(lateOk ? { lateExcused: true } : {}),
            ...(periods ? { excusedPeriods: periods } : {}),
            excusedNote: `Parent: ${ex.reason}`,
            excuse: { id: ex.id, by: ex.decidedBy },
          });
          this.syncParentDays([ex.studentId], [date.slice(0, 7)]);
          continue;
        }
        if (rec && rec.status !== 'absent') continue; // already excused
        await this.setStatus({
          studentId: ex.studentId,
          sectionId: ex.sectionId,
          date,
          status: 'excused',
          note: `Parent: ${ex.reason}`,
          reason: 'Parent excuse approved',
          excusedPeriods: periods ?? [],
          excuse: { id: ex.id, by: ex.decidedBy },
        });
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
  },
  /* ---------- admin ---------- */
};
