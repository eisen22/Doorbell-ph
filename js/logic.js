// =====================================================================
// logic.js — THE RULES OF THE SYSTEM (no Firebase, no web page code)
// ---------------------------------------------------------------------
// Everything here is a plain function: you give it values, it gives back
// an answer. That makes these the easiest functions to debug: open the
// browser console (F12) on any page and try them, for example:
//     import('./js/logic.js').then(m => console.log(m.statusForScan('08:20', '08:00')))
// If a student is marked late when they should be on time, or a 3-day
// alert is wrong, the bug is most likely in this file.
// =====================================================================

// ----- Settings you can change -----

// How many minutes after class starts a child is still "present" (on time).
// Example: class starts 8:00, LATE_AFTER_MINUTES = 15 -> 8:16 is late.
export const LATE_AFTER_MINUTES = 15;

// How many school days in a row of being absent or late before the parent
// gets the warning text. The DepEd-friendly default is 3.
export const STREAK_DAYS = 3;

// Name printed at the end of every text message to parents.
export const SCHOOL_NAME = 'Sunnyside Kinder';

// The school's time zone. All dates and times use Philippine time,
// even if the computer's clock is set to another country.
const TIME_ZONE = 'Asia/Manila';

// ----- Dates and times -----

// Today's date in the Philippines as text, like '2026-10-29'.
// 'en-CA' is used only because Canada writes dates as YYYY-MM-DD.
export function todayManila() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// The time now in the Philippines as 24-hour text, like '07:45' or '13:05'.
export function nowTimeManila() {
  return new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

// Turns '08:30' into minutes after midnight (510) so times can be compared with < and >.
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number); // '08:30' -> [8, 30]
  return h * 60 + m;
}

// Turns '13:05' into '1:05 PM' for showing to people.
export function to12h(hhmm) {
  if (!hhmm) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12; // 0 -> 12 (midnight), 13 -> 1
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

// Adds minutes to a time: addMinutes('08:00', 25) -> '08:25'.
export function addMinutes(hhmm, minutes) {
  const total = toMinutes(hhmm) + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

// Adds (or subtracts, with a negative number) days to a 'YYYY-MM-DD' date.
// The 'T12:00:00Z' (noon) avoids time-zone surprises when the day changes.
export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 1 = Monday ... 7 = Sunday for a 'YYYY-MM-DD' date.
export function weekday(date) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday ... 6 = Saturday
  return day === 0 ? 7 : day;
}

// 'Thu, Oct 29' for showing a date to people.
export function prettyDate(date) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ----- School days -----

// A school day is Monday to Friday that is NOT in the admin's "No class days" list.
// noClassDates is a Set of 'YYYY-MM-DD' strings (holidays and suspensions).
// To add Saturday classes, change "<= 5" to "<= 6".
export function isSchoolDay(date, noClassDates) {
  return weekday(date) <= 5 && !noClassDates.has(date);
}

// The last `count` school days ending on `date` (that date included if it is a school day).
// Newest first, for example ['2026-10-29', '2026-10-28', '2026-10-27'].
export function recentSchoolDays(date, count, noClassDates) {
  const days = [];
  let d = date;
  let guard = 0; // stops the loop if something is wrong (e.g. a whole year of holidays)
  while (days.length < count && guard < 60) {
    if (isSchoolDay(d, noClassDates)) days.push(d);
    d = addDays(d, -1);
    guard++;
  }
  return days;
}

// ----- Scanning -----

// Decides if a child who scanned at `time` is on time or late.
// Example: statusForScan('08:10', '08:00') -> 'present', statusForScan('08:20', '08:00') -> 'late'.
export function statusForScan(time, classStart) {
  return toMinutes(time) > toMinutes(classStart) + LATE_AFTER_MINUTES ? 'late' : 'present';
}

// Which of a teacher's classes to show first: the one happening now.
// A class "is happening" from 30 minutes before it starts until it ends.
// If none is happening, the next one today; if all are over, the last one.
export function pickClassForNow(sections, time) {
  if (!sections.length) return null;
  const now = toMinutes(time);
  const sorted = [...sections].sort((a, b) => a.startTime.localeCompare(b.startTime)); // earliest first
  return sorted.find((s) => now >= toMinutes(s.startTime) - 30 && now <= toMinutes(s.endTime))
    || sorted.find((s) => now < toMinutes(s.startTime))
    || sorted[sorted.length - 1];
}

// ----- 3-day streaks -----

// Counts how many school days IN A ROW (most recent first) a child was absent or late.
//   studentId      - the child
//   daysNewestFirst - school days to look at, from recentSchoolDays()
//   attendanceByDate - an object like { '2026-10-29': {records: {...}}, ... } for the child's section
// Days with no attendance taken are skipped (they neither break nor add to the streak).
// Returns { count, absent, late } e.g. { count: 3, absent: 2, late: 1 }.
export function countStreak(studentId, daysNewestFirst, attendanceByDate) {
  const result = { count: 0, absent: 0, late: 0 };
  for (const date of daysNewestFirst) {
    const day = attendanceByDate[date];
    if (!day || !day.confirmed) continue;            // attendance not finished that day: skip it
    const status = day.records?.[studentId]?.status;
    if (status === 'absent') result.absent++;
    else if (status === 'late') result.late++;
    else break;                                      // present, excused or no record: the streak ends
    result.count++;
  }
  return result;
}

// Words for a streak, always saying exactly what happened (never "absent or late").
// { count: 3, absent: 3, late: 0 } -> 'absent for 3 school days in a row'
// { count: 3, absent: 2, late: 1 } -> 'absent 2 days and late 1 day, 3 school days in a row'
export function describeStreak(s) {
  if (s.late === 0) return `absent for ${s.count} school days in a row`;
  if (s.absent === 0) return `late for ${s.count} school days in a row`;
  return `absent ${s.absent} day${s.absent > 1 ? 's' : ''} and late ${s.late} day${s.late > 1 ? 's' : ''}, ${s.count} school days in a row`;
}

// ----- Text messages (SMS) -----

// Builds the text a parent receives. Change the wording here.
//   kind: 'arrival' | 'late' | 'streak'
export function smsText(kind, childFirstName, time, streak) {
  if (kind === 'arrival') return `Doorbell: ${childFirstName} arrived at school at ${to12h(time)}. - ${SCHOOL_NAME}`;
  if (kind === 'late') return `Doorbell: ${childFirstName} arrived late at ${to12h(time)}. - ${SCHOOL_NAME}`;
  return `${SCHOOL_NAME}: ${childFirstName} has been ${describeStreak(streak)}. We hope all is well. Please contact the school.`;
}

// Cleans a Philippine mobile number into +639XXXXXXXXX.
// Accepts 09171234567, 0917 123 4567, 639171234567 or +639171234567.
// Returns null if the number is not a valid PH mobile number.
export function normalizePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');           // keep numbers only
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;    // 09XXXXXXXXX
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;              // 639XXXXXXXXX
  return null;
}

// ----- ID cards -----

// Makes a random code for a child's ID card barcode, like 'DB-7K2M9Q4X'.
// It contains no personal data, so a lost card reveals nothing about the child.
// Letters that look alike (I, L, O, U) are left out to avoid misreading.
export function newCardCode() {
  const chars = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let code = 'DB-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
