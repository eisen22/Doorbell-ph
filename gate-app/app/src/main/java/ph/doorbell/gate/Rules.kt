package ph.doorbell.gate

import java.time.LocalDate
import java.time.ZoneId
import java.time.ZonedDateTime

// =====================================================================
// Rules.kt — THE ATTENDANCE RULES (a copy of the website's src/logic.js)
// ---------------------------------------------------------------------
// No camera, no database, no screens here: just the rules, so they are easy to test
// (see app/src/test/.../RulesTest.kt). If you change a rule on the website, change it here too.
// Times are 'HH:mm' strings ('07:45') and dates are 'yyyy-MM-dd' strings ('2026-10-29'),
// exactly like the website stores them.
// =====================================================================
object Rules {
    // Every date and time is in the Philippines, whatever time zone the phone is set to.
    val MANILA: ZoneId = ZoneId.of("Asia/Manila")

    /** Today's date in the Philippines, e.g. "2026-10-29". */
    fun today(now: ZonedDateTime = ZonedDateTime.now(MANILA)): String = now.withZoneSameInstant(MANILA).toLocalDate().toString()

    /** The time now in the Philippines, e.g. "07:45". */
    fun timeNow(now: ZonedDateTime = ZonedDateTime.now(MANILA)): String {
        val t = now.withZoneSameInstant(MANILA)
        return "%02d:%02d".format(t.hour, t.minute)
    }

    /** "08:30" -> 510 (minutes after midnight). */
    fun toMinutes(hhmm: String): Int {
        val (h, m) = hhmm.split(":").map { it.trim().toInt() }
        return h * 60 + m
    }

    /** "07:42" -> "7:42 AM", "13:05" -> "1:05 PM". */
    fun to12h(hhmm: String): String {
        val mins = toMinutes(hhmm)
        val h = mins / 60
        val m = mins % 60
        val suffix = if (h >= 12) "PM" else "AM"
        val h12 = if (h % 12 == 0) 12 else h % 12
        return "$h12:%02d $suffix".format(m)
    }

    /** 1 = Monday ... 7 = Sunday (same numbers as a section's classDays). */
    fun isoWeekday(date: String): Int = LocalDate.parse(date).dayOfWeek.value

    /**
     * Is there class on this date for this section?
     *  - a make-up class day is always a school day (even on a Saturday)
     *  - holidays, suspensions and breaks are never school days
     *  - otherwise: is the weekday one of the section's class days?
     * calendar = date -> day type from the admin's School Calendar ('holiday', 'suspension', ...).
     */
    fun isSchoolDay(date: String, schedule: Schedule, calendar: Map<String, String>): Boolean {
        when (calendar[date]) {
            "makeup" -> return true
            "holiday", "suspension", "break" -> return false
        }
        return isoWeekday(date) in schedule.classDays
    }

    /**
     * "too_early", "present" or "late" for a scan at [time].
     * Example with start 08:00, window 30, cutoff 15: 07:29 too early, 07:30-08:15 present, 08:16+ late.
     */
    fun classifyScan(time: String, schedule: Schedule): String {
        val t = toMinutes(time)
        val start = toMinutes(schedule.startTime)
        if (t < start - schedule.scanWindowMins) return "too_early"
        return if (t <= start + schedule.lateCutoffMins) "present" else "late"
    }

    /** The status saved for a first scan. A too-early arrival is saved as present, like the website. */
    fun statusForScan(time: String, schedule: Schedule, dayConfirmed: Boolean): String = when {
        dayConfirmed -> "late" // the teacher already confirmed the day: the child came in late
        classifyScan(time, schedule) == "late" -> "late"
        else -> "present"
    }

    /** Fills {child}, {time}, {school}... in an SMS template. Unknown names stay as they are. */
    fun renderTemplate(template: String, vars: Map<String, String>): String =
        Regex("\\{(\\w+)\\}").replace(template) { m -> vars[m.groupValues[1]] ?: m.value }
}
