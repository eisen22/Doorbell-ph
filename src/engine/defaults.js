// =====================================================================
// engine/defaults.js — the school's default settings, school year and parent text templates.
// =====================================================================

// Password for every demo-mode account (demo mode only).
export const DEMO_PASSWORD = 'Doorbell2026!';
// The usual kindergarten morning schedule: Mon-Fri, 8:00-11:30, late after 15 min.
export const schedule = {
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
  // Text parents when their child leaves school (scanned out at the gate, or marked picked up by staff).
  departureSmsEnabled: true,
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
      departure: 'Doorbell: {child} left school at {time} (scanned out at the gate). - {school}',
      pickedUp: 'Doorbell: {child} was picked up from school at {time}, recorded by the school. - {school}',
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
      departure: 'Doorbell: Umalis na si {child} sa paaralan ng {time} (na-scan palabas sa gate). - {school}',
      pickedUp: 'Doorbell: Sinundo na si {child} sa paaralan ng {time}, ayon sa paaralan. - {school}',
    },
  },
};
// The kinds of parent texts, in the order the Settings pages show them.
// (arrivalAuto / lateAuto were the auto-confirm texts: no longer sent, kept only in old saved settings.)
export const TEMPLATE_KINDS = ['arrival', 'late', 'laterPeriod', 'absent', 'missing', 'departure', 'pickedUp', 'streak', 'total'];
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
  // The first sample school was a kindergarten called "Sunnyside Kinder"; loading the sample again keeps
  // the saved settings, so that old name stayed. Untouched, it becomes the sample school's name.
  const schoolName = !saved.schoolName || saved.schoolName === 'Sunnyside Kinder' ? settings.schoolName : saved.schoolName;
  return { ...saved, schoolName, templates };
}
