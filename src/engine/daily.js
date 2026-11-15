// =====================================================================
// engine/daily.js — THE SCHOOL DAY
// Confirming a class (finalize), the absence texts after the 1st period, catching up missed days.
// These are methods of the Engine class (engine.js adds them to it), so `this` is the engine.
// =====================================================================
import {
  addDays,
  isSchoolDay,
  shouldAlertStreak,
  shouldAutoFinalize,
  classEnded,
} from '../logic';
import { dayId, fmtDay } from './util';

export const dailyMethods = {
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
          ? {
              date,
              studentId: stu.id,
              sectionId,
              status: 'excused',
              source: 'excuse',
              excusedNote: `Parent: ${ex.reason}`,
              // Excused for some periods only (e.g. arrives after a check-up): not absent, no absence text;
              // the teacher marks them Present or Late when they come, and the excuse is kept.
              ...(ex.periods?.length ? { excusedPeriods: [...ex.periods].sort((a, b) => a - b) } : {}),
            }
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
  },
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
  },
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
  },
  /* ---------- auth ---------- */
};
