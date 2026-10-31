package ph.doorbell.gate

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// Tests for Rules.kt. Run them in Android Studio: right-click this file -> Run 'RulesTest'.
// They use the same examples as the website's rules, so both stay in agreement.
class RulesTest {
    private val schedule = Schedule(classDays = listOf(1, 2, 3, 4, 5), startTime = "08:00", scanWindowMins = 30, lateCutoffMins = 15)

    @Test fun classifiesScans() {
        assertEquals("too_early", Rules.classifyScan("07:29", schedule))
        assertEquals("present", Rules.classifyScan("07:30", schedule))
        assertEquals("present", Rules.classifyScan("08:15", schedule))
        assertEquals("late", Rules.classifyScan("08:16", schedule))
    }

    @Test fun tooEarlyIsSavedAsPresent_andConfirmedDayIsLate() {
        assertEquals("present", Rules.statusForScan("06:50", schedule, dayConfirmed = false))
        assertEquals("late", Rules.statusForScan("07:40", schedule, dayConfirmed = true))
    }

    @Test fun schoolDays() {
        assertTrue(Rules.isSchoolDay("2026-10-29", schedule, emptyMap())) // Thursday
        assertFalse(Rules.isSchoolDay("2026-10-31", schedule, emptyMap())) // Saturday
        assertTrue(Rules.isSchoolDay("2026-10-31", schedule, mapOf("2026-10-31" to "makeup")))
        assertFalse(Rules.isSchoolDay("2026-10-29", schedule, mapOf("2026-10-29" to "suspension")))
    }

    @Test fun times() {
        assertEquals("7:42 AM", Rules.to12h("07:42"))
        assertEquals("12:00 PM", Rules.to12h("12:00"))
        assertEquals("1:05 PM", Rules.to12h("13:05"))
    }

    @Test fun templates() {
        assertEquals(
            "Doorbell: Juan arrived at school at 7:42 AM. - Sunnyside",
            Rules.renderTemplate("Doorbell: {child} arrived at school at {time}. - {school}", mapOf("child" to "Juan", "time" to "7:42 AM", "school" to "Sunnyside")),
        )
        assertEquals("Hi {nobody}", Rules.renderTemplate("Hi {nobody}", emptyMap()))
    }
}
