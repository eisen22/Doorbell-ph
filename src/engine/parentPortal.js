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
      yearStart: this.year.start, // first day of classes: the portal's calendar goes back to it
      days,
      noClass,
      totals,
      updatedAt: new Date().toISOString(),
    };
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
      .map((x) => ({ ...x, student: this.s.students.get(x.studentId), section: this.s.sections.get(x.sectionId) }))
      // Waiting requests first, then newest first.
      .sort((a, b) => (b.status === 'pending') - (a.status === 'pending') || b.createdAt.localeCompare(a.createdAt));
  },
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
  },
  /* ---------- admin ---------- */
};
