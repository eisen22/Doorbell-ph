// =====================================================================
// engine/attendance.js — ATTENDANCE
// Rosters, gate scans, teacher statuses, alerts, SMS list, Absence Watch, a child's history.
// These are methods of the Engine class (engine.js adds them to it), so `this` is the engine.
// =====================================================================
import {
  addDays,
  decideScan,
  isSchoolDay,
  recentSchoolDays,
  bySectionGrade,
  classPeriods,
  to12h,
  toMinutes,
  displayPhMobile,
  periodsLabel,
} from '../logic';
import { dayId, byName } from './util';

export const attendanceMethods = {
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
        // A parent's excuse for this day that the adviser approved (Parent portal): every teacher of the
        // class sees it on the class list, even before the class is confirmed.
        excuse: (() => {
          // Confirmed by the adviser, or still waiting for the adviser.
          const ex =
            this.approvedExcuse(student.id, date) ??
            [...this.s.excuses.values()].find((x) => x.status === 'pending' && x.studentId === student.id && x.dates?.includes(date));
          return ex ? { periods: ex.periods ?? null, reason: ex.reason, by: ex.decidedBy ?? null, note: ex.note ?? '', pending: ex.status === 'pending' } : null;
        })(),
        // Not scanned yet today: show the streak as of the previous school day.
        streak: record || !prev ? this.streakFor(sec, student.id, date) : this.streakFor(sec, student.id, prev),
      };
    });
  },
  // All records of a section between two dates (for the weekly card and Excel reports).
  async getAttendanceRange(sectionId, from, to) {
    await this.ready;
    const out = [];
    for (const day of this.s.attendance.values()) {
      if (day.sectionId === sectionId && day.date >= from && day.date <= to) out.push(...Object.values(day.records));
    }
    return out;
  },
  // The confirmation of a day (who confirmed and when), or null if not yet confirmed.
  async getConfirmation(sectionId, date) {
    await this.ready;
    return this.s.confirmations.get(dayId(sectionId, date)) ?? null;
  },
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
      // CHILD SAFETY: the child came in, then the day became a no-class day (a suspension declared during
      // class hours): scanning the card again records the time the child left, and the parent is texted.
      const cameIn = this.record(sec.id, today, student.id);
      if (cameIn?.scannedAt && !cameIn.scannedOut) {
        const prev = this.lastScanAt.get(token);
        this.lastScanAt.set(token, Date.now());
        if (prev !== undefined && (Date.now() - prev) / 1000 < 10) return { kind: 'ignore' };
        return this.recordOut(student, sec, cameIn, time, today);
      }
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
        return this.recordOut(student, sec, existing, time, today);
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
    // Excused for part of the day (e.g. the morning, by a parent's request): the excuse stays on the record.
    const partExcused = existing?.status === 'excused' && existing.excusedPeriods?.length;
    this.writeRecord({
      date: today,
      studentId: student.id,
      sectionId: sec.id,
      status,
      scannedAt: time,
      source: 'scanner',
      ...(partExcused ? { excusedPeriods: existing.excusedPeriods, excusedNote: existing.excusedNote, excuse: existing.excuse } : {}),
      ...(locked
        ? { needsCheck: true, editedReason: partExcused ? 'Arrived after an excused part of the day' : 'Arrived after attendance was confirmed' }
        : {}),
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
        title: partExcused
          ? `${student.firstName} ${student.lastName} arrived at ${to12h(time)} (excused for the ${periodsLabel(existing.excusedPeriods)} by the parent's request)`
          : `${student.firstName} ${student.lastName} scanned at the gate at ${to12h(time)}, after attendance was confirmed`,
        body: `Check that ${student.firstName} is in ${sec.name}, then mark Present or Late on the Attendance page. The parent is texted when you do.`,
      };
      this.s.notifications.set(n.id, n);
      this.put('notifications', n.id, n);
    }
    this.emit();
    return { kind: 'recorded', student, status, time, needsCheck: locked };
  },
  // The child left school: saves the time out and texts the parent ("left school at 2:54 PM").
  // by: a staff member's name when the child was picked up without scanning (no ID card, or a suspension).
  recordOut(student, sec, rec, time, today, by) {
    this.writeRecord({ ...rec, scannedOut: time, ...(by ? { pickedUpBy: by } : {}) });
    this.queueSms(student, 'departure', {
      id: `out_${student.id}_${today}`,
      date: today,
      time,
      sectionId: sec.id,
      template: by ? 'pickedUp' : 'departure',
      createdAt: this.nowIso(today),
    });
    this.syncParentDays([student.id], [today.slice(0, 7)]);
    this.emit();
    return { kind: 'out', student, time };
  },
  // Staff: "Picked up" for a child who leaves without scanning out (forgot the ID, fetched during a
  // suspension...). Today only. The parent is texted and the audit log says who marked it.
  async markPickedUp(sectionId, studentId) {
    await this.ready;
    const today = this.clock.today();
    const sec = this.s.sections.get(sectionId);
    const student = this.s.students.get(studentId);
    const rec = this.record(sectionId, today, studentId);
    if (!sec || !student || !rec) throw new Error('No record for this child today.');
    if (rec.scannedOut) return { kind: 'already', time: rec.scannedOut };
    const time = this.clock.scanTime();
    await this.logAudit('attendance.picked_up', `${student.firstName} ${student.lastName}`, `left at ${time}, marked by ${this.actor()}`);
    return this.recordOut(student, sec, rec, time, today, this.actor());
  },
  // Children who came to school today and have not left yet, for the classes this user can see.
  // Used on a day the class has no class (suspension during class hours, teacher absent): staff keep
  // them until they are fetched. [{ student, section, scannedAt, guardian: { name, mobile } }]
  async listStillAtSchool(sectionId) {
    await this.ready;
    const today = this.clock.today();
    const out = [];
    for (const sec of this.s.sections.values()) {
      if (sec.archived || (sectionId && sec.id !== sectionId)) continue;
      const day = this.s.attendance.get(dayId(sec.id, today));
      for (const r of Object.values(day?.records ?? {})) {
        if (!r.scannedAt || r.scannedOut) continue;
        const student = this.s.students.get(r.studentId);
        if (!student) continue;
        const g = this.guardianOf(student.id);
        out.push({ student, section: sec, scannedAt: r.scannedAt, guardian: g ? { name: g.name, mobile: g.mobile } : null });
      }
    }
    return out.sort((a, b) => a.section.name.localeCompare(b.section.name) || a.student.lastName.localeCompare(b.student.lastName));
  },
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
      markedBy: this.actor(), // who set this status (shown in a child's attendance history)
      excusedNote: input.status === 'excused' ? input.note : prev?.excusedNote && inClass && prev?.excusedPeriods?.length ? prev.excusedNote : undefined,
      // Excused for some class periods only (e.g. [1, 2]); empty/absent = the whole day. A child excused for
      // some periods and in class for the others keeps the list when the teacher marks them present or late.
      // Excused through the parent portal: { id, by } (the request and who approved it). Kept while the
      // child is excused or, for a period excuse, in class.
      excuse: input.status === 'excused' ? input.excuse : inClass && prev?.excusedPeriods?.length ? prev.excuse : undefined,
      excusedPeriods:
        input.status === 'excused'
          ? (input.excusedPeriods ?? []).map(Number).filter((n) => n > 0).sort((a, b) => a - b)
          : inClass && prev?.excusedPeriods?.length
            ? prev.excusedPeriods
            : undefined,
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
  },
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
  },
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
  },
  // The teacher presses "Confirm attendance" (same as finalize, plus an audit entry).
  async confirmDay(sectionId, date) {
    await this.ready;
    const conf = this.finalize(sectionId, date, this.actor(), false);
    await this.logAudit('attendance.confirm', this.s.sections.get(sectionId)?.name ?? sectionId, date);
    this.emit();
    return conf;
  },
  // Demo helper: scans a random child who has not arrived yet.
  async simulateScan(sectionId) {
    const today = this.clock.today();
    const waiting = this.rosterOn(sectionId, today).filter((s) => !this.record(sectionId, today, s.id)?.scannedAt);
    if (!waiting.length) return { kind: 'ignore' };
    return this.recordScan({ qrToken: waiting[Math.floor(Math.random() * waiting.length)].qrToken, sectionId });
  },
  // Alerts this person may see, newest first.
  async listNotifications() {
    await this.ready;
    const vis = this.visibleSectionIds();
    return [...this.s.notifications.values()]
      .filter((n) => n.kind !== 'system' && (!vis || (n.sectionId && vis.has(n.sectionId))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  // Marks alerts as read (all of them, or only the ids given).
  async markNotificationsRead(ids) {
    for (const n of await this.listNotifications()) {
      if (n.read || (ids && !ids.includes(n.id))) continue;
      n.read = true;
      this.put('notifications', n.id, n);
    }
    this.emit();
  },
  // Texts this person may see, newest first.
  async listSms(limit = 300) {
    await this.ready;
    const vis = this.visibleSectionIds();
    return [...this.s.sms.values()]
      .filter((m) => !vis || !m.sectionId || vis.has(m.sectionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  },
  // 'queued' when real texts are on (sent by the Cloudflare Worker through Semaphore, or by the
  // Doorbell Gate app from the gate phone's SIM), 'sent' in simulated mode.
  newSmsStatus() {
    return ['semaphore', 'phone'].includes(this.settings.smsProvider) ? 'queued' : 'sent';
  },
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
  },
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
  },
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
      // Everything the history shows when a day is clicked: gate times, the teacher's confirmation,
      // a later-period arrival, and the texts the parent got that day.
      const conf = this.s.confirmations.get(dayId(r.sectionId, date));
      days[date] = {
        status: r.status,
        scannedAt: r.scannedAt ?? null,
        scannedOut: r.scannedOut ?? null,
        confirmedAt: r.confirmedAt ?? null,
        markedBy: r.markedBy ?? null,
        source: r.source ?? null,
        joinedPeriod: r.joinedPeriod ?? null,
        joinedSubject: r.joinedSubject ?? null,
        excusedNote: r.excusedNote ?? null,
        excusedPeriods: r.excusedPeriods ?? null,
        excuse: r.excuse ?? null,
        editedReason: r.editedReason ?? null,
        needsCheck: !!r.needsCheck,
        sectionName: sec?.name ?? null,
        classConfirmed: conf ? { by: conf.confirmedBy ?? null, at: conf.confirmedAt?.slice(11, 16) ?? null, auto: !!conf.auto } : null,
        texts: [],
      };
    }
    // The texts to this child's parent, by day (only the ones this device has loaded).
    for (const m of this.s.sms.values()) {
      if (m.studentId !== studentId || !m.createdAt) continue;
      const d = days[m.createdAt.slice(0, 10)];
      if (d) d.texts.push({ kind: m.kind, at: m.createdAt.slice(11, 16), status: m.status });
    }
    for (const d of Object.values(days)) d.texts.sort((a, b) => a.at.localeCompare(b.at));
    const today = this.clock.today();
    return {
      days,
      today,
      year: this.year,
      calendar: [...this.s.calendar.values()],
      schedule: section?.schedule,
      streak: section ? this.streakFor(section, studentId, today) : null,
    };
  },
  /* ---------- parent portal ---------- */
};
