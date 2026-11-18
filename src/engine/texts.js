// =====================================================================
// engine/texts.js — PARENT TEXTS AND ALERTS
// queueSms (every text), 3-day streaks, absence/late totals.
// These are methods of the Engine class (engine.js adds them to it), so `this` is the engine.
// =====================================================================
import {
  describeStreak,
  renderTemplate,
  shouldAlertStreak,
  bySectionGrade,
  to12h,
  DEFAULT_LIMITS,
  attendanceTotals,
  totalLevels,
  describeTotal,
} from '../logic';
import { byName } from './util';

export const textsMethods = {
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
    // Leaving school: one text per child per day (opts.id = out_<child>_<date>).
    if (kind === 'departure' && (this.settings.departureSmsEnabled === false || this.s.sms.has(opts.id))) return null;
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
  },
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
  },
  // The limits for totals (Settings -> Attendance limits), filled in with the defaults.
  get limits() {
    const mine = this.settings.limits ?? {};
    const out = {};
    for (const k of Object.keys(DEFAULT_LIMITS)) out[k] = { ...DEFAULT_LIMITS[k], ...(mine[k] ?? {}) };
    return out;
  },
  // One child's absences and lates this month and this semester (not in a row), with their levels.
  totalsFor(section, studentId, date) {
    const t = attendanceTotals(
      date,
      this.statusMap(section.id, studentId),
      section.schedule,
      this.s.calendar,
      this.year,
      this.settings.semester2Start,
      this.cutsByDate(studentId),
    );
    return { ...t, levels: totalLevels(t, this.limits) };
  },
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
      const what0 = metric.startsWith('absent') ? 'absent' : metric.startsWith('late') ? 'late' : 'cut';
      const n = (month ? t.month : t.semester)[what0];
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
  },
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
  },
};
