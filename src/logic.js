// =====================================================================
// logic.js — THE RULES OF DOORBELL (pure functions, no screens, no database)
// ---------------------------------------------------------------------
// Every function here takes values in and gives an answer back. Nothing is
// saved and nothing is drawn, which makes this the easiest file to debug:
// if a child is marked late when they should not be, a streak is counted
// wrong, or a date is off, look here first.
//
// You can try any function in the browser console (F12) while `npm run dev` runs:
//     const L = await import('/src/logic.js');
//     L.classifyScan('08:20', { startTime: '08:00', scanWindowMins: 30, lateCutoffMins: 15 })   // -> 'late'
//
// Words used in this file:
//   date     = text like '2026-10-29' (year-month-day, Philippine date)
//   time     = text like '07:45' (24-hour clock)
//   schedule = a section's times: { classDays: [1..5], startTime, endTime,
//              scanWindowMins, lateCutoffMins, autoFinalizeMins }
//   calendar = the school calendar entries: [{ date, type, label }]
//              type is one of holiday, suspension, break, halfday, event, exam, makeup
//
// Sections of this file:
//   1. Dates and times      4. 3-day streaks       7. School calendar + DepEd template
//   2. School days          5. SMS text            8. Which class is "now"
//   3. Scanning             6. Phone numbers       9. Auto-assign students
// =====================================================================

// Finds the calendar entry for a date. `calendar` can be a list or a Map (the engine uses a Map).
const entryOf = (calendar, date) => (calendar instanceof Map ? calendar.get(date) : calendar.find((c) => c.date === date));

/* =====================================================================
   1. DATES AND TIMES
   Dates are handled as text ('YYYY-MM-DD') so the computer's own time zone
   can never move a date by one day. Time zone is always Asia/Manila.
   ===================================================================== */

/** '08:30' -> 510 (minutes after midnight). Lets us compare times with < and >. */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 510 -> '08:30'. The opposite of toMinutes. */
export function fromMinutes(mins) {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** '07:42' -> '7:42 AM', '13:05' -> '1:05 PM' (for showing to people). */
export function to12h(hhmm) {
  const mins = toMinutes(hhmm);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12; // 0 and 12 both show as 12
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

// '2026-10-29' -> a Date at midnight UTC (UTC so the local time zone cannot shift it).
function parseDate(d) {
  const [y, mo, da] = d.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, da)); // months start at 0 in JavaScript
}

/** A Date -> '2026-10-29'. */
export function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

/** addDays('2026-10-31', 1) -> '2026-11-01'. Use a negative number to go back. */
export function addDays(d, n) {
  const x = parseDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return formatDate(x);
}

/** 1 = Monday ... 7 = Sunday. */
export function isoWeekday(d) {
  const w = parseDate(d).getUTCDay(); // JavaScript: 0 = Sunday
  return w === 0 ? 7 : w;
}

/** Today's date in the Philippines, e.g. '2026-10-29', whatever time zone the device uses. */
export function manilaToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now); // en-CA writes YYYY-MM-DD
}

/** The time now in the Philippines, e.g. '07:45'. */
export function manilaTime(now = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

/* =====================================================================
   2. SCHOOL DAYS
   ===================================================================== */

/**
 * Is there class on this date for this section?
 *  - a make-up class day is always a school day (even on a Saturday)
 *  - holidays, suspensions and breaks are never school days
 *  - otherwise: is the weekday one of the section's class days (Mon-Fri by default)?
 * Half days, events and exams still count as class days.
 */
export function isSchoolDay(date, schedule, calendar) {
  const entry = entryOf(calendar, date);
  if (entry?.type === 'makeup') return true;
  if (entry && (entry.type === 'holiday' || entry.type === 'suspension' || entry.type === 'break')) return false;
  return schedule.classDays.includes(isoWeekday(date));
}

/**
 * The last `count` school days up to and including `date`, newest first.
 * Example: recentSchoolDays('2026-10-29', 3, ...) -> ['2026-10-29', '2026-10-28', '2026-10-27'].
 * maxLookback stops the search after that many calendar days (e.g. during a long break).
 */
export function recentSchoolDays(date, count, schedule, calendar, maxLookback = 60) {
  const out = [];
  let d = date;
  for (let i = 0; i < maxLookback && out.length < count; i++) {
    if (isSchoolDay(d, schedule, calendar)) out.push(d);
    d = addDays(d, -1);
  }
  return out;
}

/* =====================================================================
   3. SCANNING
   A section's schedule decides everything about a scan:
     scanWindowMins   - scanning opens this many minutes before class (earlier = "too early")
     lateCutoffMins   - after start + this many minutes, the child is late
     autoFinalizeMins - at start + this many minutes, the day is confirmed automatically
   Example with start 08:00, window 30, cutoff 15: 07:29 too early, 07:30-08:15 present, 08:16+ late.
   ===================================================================== */

/** 'too_early', 'present' or 'late' for a scan at `time`. */
export function classifyScan(time, schedule) {
  const t = toMinutes(time);
  const start = toMinutes(schedule.startTime);
  if (t < start - schedule.scanWindowMins) return 'too_early';
  return t <= start + schedule.lateCutoffMins ? 'present' : 'late';
}

/** The time the day confirms itself, e.g. '08:45'. */
export function autoFinalizeTime(schedule) {
  return fromMinutes(toMinutes(schedule.startTime) + schedule.autoFinalizeMins);
}

/** True once it is time to auto-confirm today's attendance. */
export function shouldAutoFinalize(nowTime, schedule) {
  return toMinutes(nowTime) >= toMinutes(schedule.startTime) + schedule.autoFinalizeMins;
}

/**
 * What to do with a scan:
 *   { kind: 'ignore' }                 the same card was scanned seconds ago (a double beep)
 *   { kind: 'duplicate', firstScanAt } the child already scanned today: keep the first time
 *   { kind: 'record', status }         save it as 'present' or 'late'
 * debounceSeconds (default 10) is how long a repeat scan of the same card is ignored.
 */
export function decideScan(args) {
  const debounce = args.debounceSeconds ?? 10;
  if (args.secondsSinceLastSameCode !== undefined && args.secondsSinceLastSameCode < debounce) {
    return { kind: 'ignore' };
  }
  if (args.existingScanAt) return { kind: 'duplicate', firstScanAt: args.existingScanAt };
  const c = classifyScan(args.time, args.schedule);
  return { kind: 'record', status: c === 'late' ? 'late' : 'present' }; // 'too_early' is saved as present
}

/* =====================================================================
   4. 3-DAY STREAKS (absent or late several school days in a row)
   ===================================================================== */

/** Just the number of days in the streak. */
export function computeStreak(date, statusByDate, schedule, calendar, lookback = 30) {
  return streakInfo(date, statusByDate, schedule, calendar, lookback).count;
}

/**
 * Counts consecutive absent/late school days ending at `date`, going backwards.
 *   statusByDate: { '2026-10-29': 'absent', '2026-10-28': 'late', ... } for ONE child
 * Rules:
 *   - excused days are skipped (they neither add to nor break the streak)
 *   - a present day ends the streak
 *   - a day with no record (not yet enrolled, not confirmed) ends the streak
 * Returns { count, absent, late, dates } e.g. { count: 3, absent: 2, late: 1, dates: [...newest first] }.
 */
export function streakInfo(date, statusByDate, schedule, calendar, lookback = 30) {
  const days = recentSchoolDays(date, lookback, schedule, calendar, lookback * 3);
  const info = { count: 0, absent: 0, late: 0, dates: [] };
  for (const d of days) {
    const s = statusByDate[d];
    if (s === undefined) break; // no record: stop counting
    if (s === 'excused') continue; // skip, keep counting
    if (s === 'present') break; // on time: the streak is over
    info.count++;
    info.dates.push(d);
    if (s === 'absent') info.absent++;
    else info.late++;
  }
  return info;
}

/**
 * Exact wording for alerts and SMS, never just "late or absent":
 *   "absent for 3 school days in a row", "late for 3 school days in a row",
 *   "absent 2 days and late 1 day, 3 school days in a row" (and the same in Filipino).
 */
export function describeStreak(s, lang = 'en') {
  const n = s.count;
  const day = (k) => (k === 1 ? 'day' : 'days');
  if (lang === 'fil') {
    if (s.late === 0) return `absent nang ${n} araw na magkakasunod`;
    if (s.absent === 0) return `late nang ${n} araw na magkakasunod`;
    return `absent nang ${s.absent} araw at late nang ${s.late} araw, ${n} araw na magkakasunod`;
  }
  if (s.late === 0) return `absent for ${n} school days in a row`;
  if (s.absent === 0) return `late for ${n} school days in a row`;
  return `absent ${s.absent} ${day(s.absent)} and late ${s.late} ${day(s.late)}, ${n} school days in a row`;
}

/**
 * Should the parent be texted now? Only EXACTLY when the streak reaches the threshold
 * (3 by default, set in Admin -> Settings), so one streak sends one text.
 * Change `===` to `>=` to text every day the streak continues.
 */
export function shouldAlertStreak(streak, threshold = 3) {
  return streak === threshold;
}

/* =====================================================================
   5. SMS TEXT
   ===================================================================== */

/** Fills a template: renderTemplate('Hi {child}', { child: 'Juan' }) -> 'Hi Juan'. Unknown {words} stay as they are. */
export function renderTemplate(tpl, vars) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

// Characters that fit the normal SMS alphabet (GSM-7). Anything else (like emoji or ñ in some phones)
// switches the text to Unicode, where one SMS holds only 70 characters instead of 160.
const GSM_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
export function isGsmPlain(text) {
  return [...text].every((ch) => GSM_BASIC.includes(ch));
}

/** How many SMS parts a message costs: 1 up to 160 plain characters, then 153 per part. */
export function smsSegments(text) {
  if (!isGsmPlain(text)) return Math.ceil(text.length / 67) || 1;
  return text.length <= 160 ? 1 : Math.ceil(text.length / 153);
}

/* =====================================================================
   6. PHILIPPINE MOBILE NUMBERS
   Numbers are saved as +639XXXXXXXXX and shown as 0917 123 4567.
   ===================================================================== */

/** Accepts 09XXXXXXXXX, 9XXXXXXXXX, 639XXXXXXXXX or +639XXXXXXXXX (spaces allowed). Returns +639XXXXXXXXX or null. */
export function normalizePhMobile(input) {
  const digits = input.replace(/[\s\-()]/g, '');
  const m = digits.match(/^(?:\+?63|0)?(9\d{9})$/);
  return m ? `+63${m[1]}` : null;
}

/** '+639171234567' -> '0917 123 4567'. */
export function displayPhMobile(normalized) {
  const local = normalized.replace(/^\+63/, '0');
  return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
}

/* ---------- reports ---------- */

/** Attendance rate in %: (present + late) out of (present + late + absent). Excused days are left out. */
export function attendanceRate(counts) {
  const counted = counts.present + counts.late + counts.absent;
  if (counted === 0) return 0;
  return Math.round(((counts.present + counts.late) / counted) * 100);
}

/** A fresh counter: { present: 0, late: 0, absent: 0, excused: 0 }. */
export function emptyCounts() {
  return { present: 0, late: 0, absent: 0, excused: 0 };
}

/* =====================================================================
   7. SCHOOL CALENDAR
   Source: DepEd Order No. 009, s. 2026 (Three-Term School Calendar), Annex B.
   Local: Baguio Charter Day, RA 6710 (September 1, special non-working holiday in Baguio City).
   The admin can change any day in Admin -> School Calendar.
   ===================================================================== */

// The kinds of day on the year calendar. isClass = attendance is taken that day.
// Change a `label` to rename it everywhere; colors are in style.css (.k-holiday, .k-exam, ...).
export const DAY_KIND_META = {
  class: { label: 'Class day', short: 'Class', isClass: true },
  halfday: { label: 'Half day', short: 'Half day', isClass: true },
  event: { label: 'Class day with school event', short: 'Event', isClass: true },
  exam: { label: 'Exam or test day', short: 'Exam', isClass: true },
  makeup: { label: 'Make-up class', short: 'Make-up', isClass: true },
  holiday: { label: 'Holiday', short: 'Holiday', isClass: false },
  suspension: { label: 'Class suspension', short: 'Suspended', isClass: false },
  break: { label: 'Break (no classes)', short: 'Break', isClass: false },
  weekend: { label: 'Weekend', short: 'Weekend', isClass: false },
  outside: { label: 'Outside the school year', short: '', isClass: false },
};

/** What a date looks like on the year calendar: an entry's type, or 'class', 'weekend' or 'outside'. */
export function dayKind(date, year, calendar, classDays = [1, 2, 3, 4, 5]) {
  const entry = calendar instanceof Map ? calendar.get(date) : calendar.find((c) => c.date === date);
  if (entry) return entry.type;
  if (date < year.start || date > year.end) return 'outside'; // before the first or after the last day of classes
  return classDays.includes(isoWeekday(date)) ? 'class' : 'weekend';
}

/** Every date from `from` to `to`, both included. */
export function eachDate(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Number of class days in the school year. */
export function countClassDays(year, calendar) {
  return eachDate(year.start, year.end).filter((d) => DAY_KIND_META[dayKind(d, year, calendar)].isClass).length;
}

// Short helpers to write the template below: H = holiday, E = event, X = exam, B = break, HD = half day.
const H = (date, label, scope = 'national') => ({ date, type: 'holiday', label, scope });
const E = (date, label) => ({ date, type: 'event', label });
const X = (date, label) => ({ date, type: 'exam', label });
const B = (date, label) => ({ date, type: 'break', label });
const HD = (date, label) => ({ date, type: 'halfday', label });
// Makes one entry for every weekday from `from` to `to`.
const range = (from, to, make) =>
  eachDate(from, to)
    .filter((d) => isoWeekday(d) <= 5)
    .map(make);

/** The DepEd SY 2026-2027 calendar, loaded when the school is set up (and by "Reset to DepEd template"). */
export const DEPED_SY_2026_2027 = [
  // Term 1: June 8 - September 15, 2026
  ...range('2026-06-08', '2026-06-11', (d) => E(d, 'Opening Block: start of Term 1')),
  E('2026-06-08', 'First day of classes (Opening Block)'),
  H('2026-06-12', 'Independence Day'),
  E('2026-06-23', 'DepEd Founding Anniversary: flag raising'),
  E('2026-06-24', 'DepEd Founding Anniversary'),
  X('2026-07-06', 'Term 1: first summative test'),
  X('2026-07-28', 'Term 1: second summative test'),
  H('2026-08-21', 'Ninoy Aquino Day'),
  X('2026-08-28', 'Term 1 examination'),
  H('2026-08-31', "National Heroes' Day"),
  H('2026-09-01', 'Baguio Charter Day (DepEd lists Term 1 exam)', 'local'),
  ...range('2026-09-02', '2026-09-08', (d) => E(d, 'End-of-Term Block: ARAL, grades, activities')),
  HD('2026-09-09', 'PTA meeting and report cards (example half day)'),
  ...range('2026-09-10', '2026-09-15', (d) => B(d, "Learners' wellness break")),
  // Term 2: September 16 - December 18, 2026
  E('2026-09-16', 'Start of Term 2'),
  E('2026-10-05', "World Teachers' Day"),
  X('2026-10-07', 'Term 2: first summative test'),
  X('2026-10-29', 'Term 2: second summative test'),
  H('2026-11-01', "All Saints' Day"),
  H('2026-11-02', "All Souls' Day"),
  E('2026-11-27', 'Araw ng Pagbasa'),
  H('2026-11-30', 'Bonifacio Day'),
  X('2026-12-03', 'Term 2 examination'),
  X('2026-12-04', 'Term 2 examination'),
  ...range('2026-12-07', '2026-12-14', (d) => E(d, 'End-of-Term Block: ARAL, grades, activities')),
  H('2026-12-08', 'Feast of the Immaculate Conception'),
  HD('2026-12-15', 'PTA meeting and progress reports (example half day)'),
  E('2026-12-16', 'Year-end activity'),
  B('2026-12-17', "INSET / learners' wellness break"),
  B('2026-12-18', "INSET / learners' wellness break, end of Term 2"),
  ...range('2026-12-19', '2026-12-31', (d) => B(d, 'Year-end break')),
  H('2026-12-24', 'Christmas Eve'),
  H('2026-12-25', 'Christmas Day'),
  H('2026-12-30', 'Rizal Day'),
  H('2026-12-31', 'Last day of the year'),
  H('2027-01-01', "New Year's Day"),
  // Term 3: January 4 - April 8, 2027
  E('2027-01-04', 'Start of Term 3'),
  X('2027-01-25', 'Term 3: first summative test'),
  H('2027-02-06', 'Chinese New Year'),
  X('2027-02-16', 'Term 3: second summative test'),
  X('2027-03-15', 'Term 3 examination (moving up)'),
  X('2027-03-16', 'Term 3 examination (moving up)'),
  X('2027-03-22', 'Term 3 examination'),
  X('2027-03-23', 'Term 3 examination'),
  E('2027-03-24', 'End-of-Term Block, academic awardees'),
  H('2027-03-25', 'Maundy Thursday'),
  H('2027-03-26', 'Good Friday'),
  H('2027-03-27', 'Black Saturday'),
  ...['2027-03-29', '2027-03-30', '2027-03-31', '2027-04-01'].map((d) => E(d, 'End-of-Term Block')),
  B('2027-04-02', 'INSET (no classes for learners)'),
  B('2027-04-05', 'INSET (no classes for learners)'),
  E('2027-04-06', 'End-of-school-year rites'),
  E('2027-04-07', 'End-of-school-year rites'),
  E('2027-04-08', 'Last day of classes: PTA meeting and report cards'),
  H('2027-04-09', 'Day of Valor'),
]
  // If a date appears twice, the LATER line wins (e.g. a holiday inside a break range).
  .reduce((acc, day) => {
    const i = acc.findIndex((x) => x.date === day.date);
    if (i >= 0) acc[i] = day;
    else acc.push(day);
    return acc;
  }, [])
  .sort((a, b) => a.date.localeCompare(b.date));

/* =====================================================================
   8. WHICH OF A TEACHER'S CLASSES IS "NOW"
   A teacher can have several classes (e.g. morning and afternoon kindergarten).
   ===================================================================== */

/** Classes sorted by start time, earliest first. */
export const sortByStart = (list) =>
  [...list].sort((a, b) => a.schedule.startTime.localeCompare(b.schedule.startTime) || a.name.localeCompare(b.name));

/**
 * Where a class stands at `time`:
 *   'now'  - scanning is open or class is going on (start - scanWindow ... end)
 *   'next' - later today
 *   'done' - over for today
 *   'off'  - no class on this weekday (only when `date` is given)
 */
export function classPhase(section, time, date) {
  if (date && !section.schedule.classDays.includes(isoWeekday(date))) return 'off';
  const m = toMinutes(time);
  const open = toMinutes(section.schedule.startTime) - section.schedule.scanWindowMins;
  const end = toMinutes(section.schedule.endTime);
  if (m < open) return 'next';
  if (m <= end) return 'now';
  return 'done';
}

/**
 * The class to show first: the one in session now; otherwise the next one today;
 * otherwise the one that ended most recently. At 8:30 the 8:00 class, at 1:00 PM the 12:30 class.
 */
export function classNow(classes, time, date) {
  if (!classes.length) return undefined;
  const sorted = sortByStart(classes);
  const today = date ? sorted.filter((c) => classPhase(c, time, date) !== 'off') : sorted;
  const pool = today.length ? today : sorted;
  return (
    pool.find((c) => classPhase(c, time) === 'now') ??
    pool.find((c) => classPhase(c, time) === 'next') ??
    [...pool].reverse().find((c) => classPhase(c, time) === 'done') ??
    pool[0]
  );
}

/** Short name for buttons: 'Kindergarten I - Apple' -> 'Apple'. */
export const shortClassName = (name) => name.split(' - ').slice(-1)[0] || name;

/* =====================================================================
   9. AUTO-ASSIGN STUDENTS TO SECTIONS (Admin -> Students -> Auto-assign)
   ===================================================================== */

// The methods shown in the Auto-assign window. Add one here AND handle it in autoAssign() below.
export const ASSIGN_METHODS = {
  balanced: 'Balanced: equal class sizes',
  fill: 'Fill in order: fill the first section, then the next',
  alphabetical: 'Alphabetical split: A-L in one, M-Z in the next',
  age: 'By age: older children together',
  gender: 'Gender-balanced: mix boys and girls evenly',
};

/**
 * Decides a section for each student.
 *   students: [{ id, firstName, lastName, birthdate, sex, siblingKey, pinnedSectionId }]
 *   sections: [{ id, capacity, current }]   current = children already in it
 *   keepSiblings: siblings (same siblingKey = same guardian mobile) go to the same section
 * Returns { assignments: { studentId: sectionId }, unplaced: [studentIds that did not fit] }.
 * Nothing is saved here; the admin sees a preview first.
 */
export function autoAssign(students, sections, method, keepSiblings) {
  const load = new Map(sections.map((s) => [s.id, s.current])); // children per section so far
  const cap = new Map(sections.map((s) => [s.id, s.capacity]));
  const room = (id) => (cap.get(id) ?? 0) - (load.get(id) ?? 0); // seats left
  const assignments = {};
  const unplaced = [];

  // 1. Students the admin pinned to a section go there first.
  const free = [];
  for (const s of students) {
    if (s.pinnedSectionId && load.has(s.pinnedSectionId)) {
      assignments[s.id] = s.pinnedSectionId;
      load.set(s.pinnedSectionId, (load.get(s.pinnedSectionId) ?? 0) + 1);
    } else free.push(s);
  }

  // 2. Put the rest in order for the chosen method.
  const byName = (a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
  let ordered = [...free].sort(byName);
  if (method === 'age') ordered.sort((a, b) => a.birthdate.localeCompare(b.birthdate)); // oldest first
  if (method === 'gender') {
    // Alternate boy, girl, boy, girl... so each section gets a mix.
    const boys = ordered.filter((s) => s.sex === 'M');
    const girls = ordered.filter((s) => s.sex === 'F');
    ordered = [];
    while (boys.length || girls.length) {
      if (boys.length) ordered.push(boys.shift());
      if (girls.length) ordered.push(girls.shift());
    }
  }

  // 3. Group siblings so they move together.
  const groups = [];
  const seen = new Map();
  for (const s of ordered) {
    if (keepSiblings && s.siblingKey) {
      const g = seen.get(s.siblingKey);
      if (g) {
        g.push(s);
        continue;
      }
      const ng = [s];
      seen.set(s.siblingKey, ng);
      groups.push(ng);
    } else groups.push([s]);
  }

  // 4. For alphabetical and age: each section gets a fair share (quota) of a continuous block.
  const total = [...load.values()].reduce((a, b) => a + b, 0) + groups.reduce((a, g) => a + g.length, 0);
  const totalCap = sections.reduce((a, s) => a + s.capacity, 0) || 1;
  const quota = new Map(sections.map((s) => [s.id, Math.ceil((total * s.capacity) / totalCap)]));
  const contiguous = method === 'alphabetical' || method === 'age';

  // 5. Place each group.
  for (const g of groups) {
    let target;
    if (method === 'fill') {
      target = sections.find((s) => room(s.id) >= g.length)?.id; // first section with space
    } else if (contiguous) {
      target =
        sections.find((s) => room(s.id) >= g.length && (load.get(s.id) ?? 0) + g.length <= (quota.get(s.id) ?? 0))?.id ??
        sections.find((s) => room(s.id) >= g.length)?.id;
    } else {
      // balanced and gender: the section that is the least full (by percentage)
      target = [...sections].filter((s) => room(s.id) >= g.length).sort((a, b) => load.get(a.id) / a.capacity - load.get(b.id) / b.capacity)[0]?.id;
    }
    if (!target) {
      g.forEach((s) => unplaced.push(s.id)); // no section has room
      continue;
    }
    g.forEach((s) => {
      assignments[s.id] = target;
    });
    load.set(target, (load.get(target) ?? 0) + g.length);
  }
  return { assignments, unplaced };
}
