package ph.doorbell.gate

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import java.time.Instant
import java.util.UUID

// =====================================================================
// GateRepository.kt — THE GATE PHONE'S CONNECTION TO THE DOORBELL DATABASE
// ---------------------------------------------------------------------
// 1. start() opens live listeners: students, sections, enrollments, guardians, the school
//    settings and calendar, plus TODAY's attendance and confirmations. Firestore keeps a copy
//    on the phone, so scanning keeps working if the school Wi-Fi drops for a while; the saves
//    are sent when the connection comes back.
// 2. scan(code) does what recordScan() does on the website (src/engine.js):
//      find the child -> check the card, section and school day -> ignore a double beep ->
//      keep the first scan of the day -> save present/late -> text the parent (arrival or late)
// The documents written here have exactly the same shape as the website's, so the teacher
// sees the arrival appear live on the Attendance page and confirms it once the class is inside.
// =====================================================================
class GateRepository(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {

    // ----- live copies of the school data (filled by the listeners) -----
    private var students = mapOf<String, Student>() // student id -> student
    private var byToken = mapOf<String, Student>() // card code -> student
    private var sections = mapOf<String, Section>()
    private var sectionOf = mapOf<String, String>() // student id -> section id (active enrollments only)
    private var guardians = listOf<Guardian>()
    private var calendar = mapOf<String, String>() // date -> day type ('holiday', 'suspension', ...)
    private var settings = SchoolSettings()

    // ----- today -----
    private var day = "" // the date the "today" listeners are for
    private val scannedToday = mutableMapOf<String, MutableMap<String, String>>() // section id -> (student id -> scan time)
    private var confirmedToday = setOf<String>() // sections whose teacher already confirmed today
    private val lastSeen = mutableMapOf<String, Long>() // card code -> when it was last scanned (ms), for the double-beep check

    private val schoolListeners = mutableListOf<ListenerRegistration>()
    private val dayListeners = mutableListOf<ListenerRegistration>()

    // ----- what the screens watch -----
    private val _status = MutableStateFlow(GateStatus())
    val status: StateFlow<GateStatus> = _status
    private val _saveError = MutableStateFlow<String?>(null)
    val saveError: StateFlow<String?> = _saveError // shown in red when Firestore refuses a save

    /** Opens all listeners. Call once after signing in. */
    fun start() {
        stop()
        schoolListeners += db.collection("students").addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            val list = snap?.documents?.mapNotNull { d -> d.data?.let { Student.from(d.id, it) } } ?: emptyList()
            students = list.associateBy { it.id }
            byToken = list.filter { it.qrToken.isNotBlank() }.associateBy { it.qrToken.trim() }
            refreshStatus()
        }
        schoolListeners += db.collection("sections").addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            sections = snap?.documents?.mapNotNull { d -> d.data?.let { Section.from(d.id, it) } }?.associateBy { it.id } ?: emptyMap()
            refreshStatus()
        }
        schoolListeners += db.collection("enrollments").whereEqualTo("status", "active").addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            sectionOf = snap?.documents?.mapNotNull { d ->
                val s = d.getString("studentId")
                val sec = d.getString("sectionId")
                if (s != null && sec != null) s to sec else null
            }?.toMap() ?: emptyMap()
            refreshStatus()
        }
        schoolListeners += db.collection("guardians").addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            guardians = snap?.documents?.mapNotNull { d -> d.data?.let { Guardian.from(d.id, it) } } ?: emptyList()
        }
        schoolListeners += db.collection("meta").document("school").addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            settings = SchoolSettings.from(snap?.data)
            refreshStatus()
        }
        schoolListeners += db.collection("meta").document("calendar").addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            @Suppress("UNCHECKED_CAST")
            val days = snap?.get("days") as? List<Map<String, Any?>> ?: emptyList()
            calendar = days.mapNotNull { e -> (e["date"] as? String)?.let { it to (e["type"] as? String ?: "") } }.toMap()
            refreshStatus()
        }
        listenToToday(Rules.today())
    }

    /** Closes all listeners (when signing out). */
    fun stop() {
        (schoolListeners + dayListeners).forEach { it.remove() }
        schoolListeners.clear()
        dayListeners.clear()
        day = ""
    }

    // Today's attendance documents (one per section) and confirmations. Re-opened after midnight.
    private fun listenToToday(date: String) {
        dayListeners.forEach { it.remove() }
        dayListeners.clear()
        day = date
        scannedToday.clear()
        confirmedToday = emptySet()
        dayListeners += db.collection("attendance").whereEqualTo("date", date).addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            for (d in snap?.documents ?: emptyList()) {
                val sectionId = d.getString("sectionId") ?: continue
                @Suppress("UNCHECKED_CAST")
                val records = d.get("records") as? Map<String, Map<String, Any?>> ?: continue
                val map = scannedToday.getOrPut(sectionId) { mutableMapOf() }
                for ((studentId, rec) in records) {
                    val at = rec["scannedAt"] as? String ?: continue // manual records without a scan don't count
                    map[studentId] = at
                }
            }
            refreshStatus()
        }
        dayListeners += db.collection("confirmations").whereEqualTo("date", date).addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            confirmedToday = snap?.documents?.mapNotNull { it.getString("sectionId") }?.toSet() ?: emptySet()
        }
    }

    private fun onListenError(err: Exception) {
        // Usually "PERMISSION_DENIED": firestore.rules is old, or this account is not a gate account.
        _saveError.value = "Cannot read the school data: ${err.message}"
    }

    fun clearError() {
        _saveError.value = null
    }

    // Counts for the top of the scanner screen.
    private fun refreshStatus() {
        val today = Rules.today()
        val withClass = sections.values.filter { Rules.isSchoolDay(today, it.schedule, calendar) && today in settings.yearStart..settings.yearEnd }.map { it.id }.toSet()
        val expected = sectionOf.count { (_, sec) -> sec in withClass }
        val arrived = scannedToday.filterKeys { it in withClass }.values.sumOf { it.size }
        _status.value = GateStatus(
            ready = students.isNotEmpty() || sections.isNotEmpty(),
            schoolName = settings.schoolName,
            arrived = arrived,
            expected = expected,
            classToday = withClass.isNotEmpty(),
        )
    }

    /**
     * Handles one scanned code. Same steps as recordScan() in the website's src/engine.js.
     * Saving does not wait for the internet: Firestore sends it as soon as it can.
     */
    fun scan(rawCode: String): ScanResult {
        val code = rawCode.trim()
        val today = Rules.today()
        if (today != day) listenToToday(today) // the app stayed open past midnight

        // 1. Whose card is it?
        val student = byToken[code] ?: return ScanResult.Unknown(code)
        if (student.revoked) return ScanResult.Revoked(student)
        val section = sectionOf[student.id]?.let { sections[it] } ?: return ScanResult.NotEnrolled(student)

        // 2. Is there class today?
        if (!Rules.isSchoolDay(today, section.schedule, calendar) || today < settings.yearStart || today > settings.yearEnd) {
            return ScanResult.NoClassToday(student, section)
        }

        // 3. A double beep (same card again within a few seconds) is ignored.
        val nowMs = System.currentTimeMillis()
        val last = lastSeen[code]
        lastSeen[code] = nowMs
        if (last != null && nowMs - last < GateConfig.DEBOUNCE_SECONDS * 1000) return ScanResult.Ignored

        // 4. Only the first scan of the day counts.
        scannedToday[section.id]?.get(student.id)?.let { return ScanResult.AlreadyIn(student, section, it) }

        // 5. Present or late?
        val time = Rules.timeNow()
        val confirmed = section.id in confirmedToday
        val status = Rules.statusForScan(time, section.schedule, confirmed)

        // 6. Save it inside the section's attendance document for today: attendance/{sectionId}_{date}.
        //    merge = only this child's record is added; the other children's records stay untouched.
        val dayId = "${section.id}_$today"
        val record = mutableMapOf<String, Any>(
            "date" to today,
            "studentId" to student.id,
            "sectionId" to section.id,
            "status" to status,
            "scannedAt" to time,
            "source" to "scanner",
        )
        if (confirmed) record["editedReason"] = "Arrived after attendance was confirmed"
        save("attendance", dayId, mapOf("id" to dayId, "sectionId" to section.id, "date" to today, "records" to mapOf(student.id to record)), merge = true)
        scannedToday.getOrPut(section.id) { mutableMapOf() }[student.id] = time // show it at once, even offline
        refreshStatus()
        if (confirmed) audit("attendance.scan_after_lock", student.fullName, "absent -> late at $time")

        // 7. Text the parent (simulated like the website: saved in 'sms' with status 'sent').
        val texted = queueSms(student, section, if (status == "late") "late" else "arrival", today, time)
        return ScanResult.Recorded(student, section, status, time, texted)
    }

    // Same as queueSms() on the website. Returns true when a text was queued.
    private fun queueSms(student: Student, section: Section, kind: String, date: String, time: String): Boolean {
        val g = guardians.firstOrNull { student.id in it.studentIds } ?: return false
        if (!g.smsConsent || !settings.arrivalSmsEnabled) return false
        val body = Rules.renderTemplate(
            settings.template(g.language, kind),
            mapOf("child" to student.firstName, "time" to Rules.to12h(time), "school" to settings.schoolName, "contact" to settings.contactNumber),
        )
        val id = "arr_${student.id}_$date" // same id as the website: never two arrival texts for one day
        val createdAt = "${date}T$time:00+08:00"
        save(
            "sms", id,
            mapOf(
                "id" to id, "studentId" to student.id, "guardianId" to g.id, "sectionId" to section.id,
                "to" to g.mobile, "body" to body, "kind" to kind,
                "status" to if (g.numberFailed) "failed" else "sent",
                "createdAt" to createdAt, "attempts" to 1,
            ),
        )
        if (g.numberFailed) {
            // Tell the teacher the text did not go through (shows in Alerts on the website).
            val nid = "smsf_$id"
            save(
                "notifications", nid,
                mapOf(
                    "id" to nid, "kind" to "sms_failed", "studentId" to student.id, "sectionId" to section.id,
                    "createdAt" to createdAt, "read" to false,
                    "title" to "Text to ${student.fullName}'s guardian did not go through",
                    "body" to "${g.name}'s number could not be reached. Ask the office to update it, or call the family.",
                ),
            )
        }
        return !g.numberFailed
    }

    // An audit log entry, like logAudit() on the website.
    private fun audit(action: String, target: String, detail: String) {
        val id = "aud-gate-${UUID.randomUUID().toString().take(8)}"
        save("audit", id, mapOf("id" to id, "at" to Instant.now().toString(), "actor" to "School gate", "action" to action, "target" to target, "detail" to detail))
    }

    private fun save(collection: String, id: String, data: Map<String, Any>, merge: Boolean = false) {
        val ref = db.collection(collection).document(id)
        val task = if (merge) ref.set(data, SetOptions.merge()) else ref.set(data)
        task.addOnFailureListener { e -> _saveError.value = "Could not save to Doorbell: ${e.message}" }
    }
}

/** The numbers at the top of the scanner screen. */
data class GateStatus(
    val ready: Boolean = false,
    val schoolName: String = "",
    val arrived: Int = 0,
    val expected: Int = 0,
    val classToday: Boolean = true,
)
