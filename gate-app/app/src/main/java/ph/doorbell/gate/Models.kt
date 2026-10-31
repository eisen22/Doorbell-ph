package ph.doorbell.gate

// =====================================================================
// Models.kt — THE DATA THE GATE PHONE READS FROM FIRESTORE
// ---------------------------------------------------------------------
// Each class matches one collection of the website (see the data model in README.md).
// The `from(...)` functions turn a Firestore document (a Map) into the class and use safe
// defaults when a field is missing, so one bad document cannot crash the scanner.
// =====================================================================

/** A section's class hours. Same fields as `schedule` in sections/{id}. */
data class Schedule(
    val classDays: List<Int> = listOf(1, 2, 3, 4, 5), // 1 = Monday ... 7 = Sunday
    val startTime: String = "08:00",
    val endTime: String = "11:30",
    val scanWindowMins: Int = 30, // scanning opens this many minutes before class
    val lateCutoffMins: Int = 15, // after start + this, the child is late
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Map<String, Any?>?): Schedule {
            if (m == null) return Schedule()
            return Schedule(
                classDays = (m["classDays"] as? List<Any?>)?.mapNotNull { (it as? Number)?.toInt() } ?: listOf(1, 2, 3, 4, 5),
                startTime = m["startTime"] as? String ?: "08:00",
                endTime = m["endTime"] as? String ?: "11:30",
                scanWindowMins = (m["scanWindowMins"] as? Number)?.toInt() ?: 30,
                lateCutoffMins = (m["lateCutoffMins"] as? Number)?.toInt() ?: 15,
            )
        }
    }
}

data class Section(val id: String, val name: String, val color: String, val schedule: Schedule) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(id: String, m: Map<String, Any?>) = Section(
            id = id,
            name = m["name"] as? String ?: id,
            color = m["color"] as? String ?: "#D8F29F",
            schedule = Schedule.from(m["schedule"] as? Map<String, Any?>),
        )
    }
}

data class Student(
    val id: String,
    val firstName: String,
    val lastName: String,
    val qrToken: String, // the text inside the ID card's QR code / barcode
    val revoked: Boolean, // true when the card was replaced (lost card)
) {
    val fullName get() = "$firstName $lastName"

    companion object {
        fun from(id: String, m: Map<String, Any?>) = Student(
            id = id,
            firstName = m["firstName"] as? String ?: "",
            lastName = m["lastName"] as? String ?: "",
            qrToken = m["qrToken"] as? String ?: "",
            revoked = m["qrStatus"] == "revoked",
        )
    }
}

data class Guardian(
    val id: String,
    val name: String,
    val mobile: String,
    val studentIds: List<String>,
    val smsConsent: Boolean,
    val language: String, // "en" or "fil"
    val numberFailed: Boolean, // the office marked this number as not working
) {
    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(id: String, m: Map<String, Any?>) = Guardian(
            id = id,
            name = m["name"] as? String ?: "",
            mobile = m["mobile"] as? String ?: "",
            studentIds = (m["studentIds"] as? List<Any?>)?.filterIsInstance<String>() ?: emptyList(),
            smsConsent = m["smsConsent"] == true,
            language = m["preferredLanguage"] as? String ?: "en",
            numberFailed = m["numberStatus"] == "failed",
        )
    }
}

/** School settings from meta/school (the admin's Settings & SMS page). */
data class SchoolSettings(
    val schoolName: String = "Doorbell",
    val contactNumber: String = "",
    val arrivalSmsEnabled: Boolean = true,
    val templates: Map<String, Map<String, String>> = emptyMap(), // language -> kind -> text
    val yearStart: String = "2000-01-01",
    val yearEnd: String = "2100-12-31",
) {
    /** The SMS text for a language and kind ("arrival" or "late"), English if missing. */
    fun template(language: String, kind: String): String =
        templates[language]?.get(kind) ?: templates["en"]?.get(kind)
            ?: if (kind == "late") "Doorbell: {child} arrived late at {time}. - {school}" else "Doorbell: {child} arrived at school at {time}. - {school}"

    companion object {
        @Suppress("UNCHECKED_CAST")
        fun from(m: Map<String, Any?>?): SchoolSettings {
            val s = m?.get("settings") as? Map<String, Any?> ?: emptyMap()
            val y = m?.get("schoolYear") as? Map<String, Any?> ?: emptyMap()
            val tpl = (s["templates"] as? Map<String, Any?>)?.mapValues { (_, v) ->
                (v as? Map<String, Any?>)?.mapValues { it.value as? String ?: "" } ?: emptyMap()
            } ?: emptyMap()
            return SchoolSettings(
                schoolName = s["schoolName"] as? String ?: "Doorbell",
                contactNumber = s["contactNumber"] as? String ?: "",
                arrivalSmsEnabled = s["arrivalSmsEnabled"] != false,
                templates = tpl,
                yearStart = y["start"] as? String ?: "2000-01-01",
                yearEnd = y["end"] as? String ?: "2100-12-31",
            )
        }
    }
}

/** What happened after one scan. The scanner screen shows a different color for each. */
sealed class ScanResult {
    /** Saved: the child arrived. status is "present" or "late". */
    data class Recorded(val student: Student, val section: Section, val status: String, val time: String, val parentTexted: Boolean) : ScanResult()
    /** The child was already scanned today (first scan kept). */
    data class AlreadyIn(val student: Student, val section: Section, val firstScanAt: String) : ScanResult()
    /** The code is not on any Doorbell ID card. */
    data class Unknown(val code: String) : ScanResult()
    /** An old card that was replaced (lost card). */
    data class Revoked(val student: Student) : ScanResult()
    /** The child is not in any section yet (ask the office). */
    data class NotEnrolled(val student: Student) : ScanResult()
    /** No class today for this child's section (weekend, holiday, suspension...). */
    data class NoClassToday(val student: Student, val section: Section) : ScanResult()
    /** The same card was scanned again within a few seconds: nothing to show. */
    data object Ignored : ScanResult()
}

/** One line in the "Recent scans" list. */
data class RecentScan(val name: String, val detail: String, val tone: Tone, val at: String)

enum class Tone { OK, LATE, INFO, BAD }
