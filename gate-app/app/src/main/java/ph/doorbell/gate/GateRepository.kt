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
// 1. start() opens live listeners: students, sections, enrollments, the school
//    settings and calendar, plus TODAY's attendance and confirmations. Firestore keeps a copy
//    on the phone, so scanning keeps working if the school Wi-Fi drops for a while; the saves
//    are sent when the connection comes back.
// 2. scan(code) does what recordScan() does on the website (src/engine.js):
//      find the child -> check the card, section and school day -> ignore a double beep ->
//      keep the first scan of the day -> save present/late. No text is sent here: the parent is
//      texted when a teacher confirms the child in class (website).
// The documents written here have exactly the same shape as the website's, so the teacher
// sees the arrival appear live on the Attendance page and confirms it once the class is inside.
// =====================================================================
class GateRepository(private val db: FirebaseFirestore = FirebaseFirestore.getInstance()) {

    // ----- live copies of the school data (filled by the listeners) -----
    private var students = mapOf<String, Student>() // student id -> student
    private var byToken = mapOf<String, Student>() // card code -> student
    private var sections = mapOf<String, Section>()
    private var sectionOf = mapOf<String, String>() // student id -> section id (active enrollments only)
    private var guardianOf = mapOf<String, Guardian>() // student id -> parent or guardian (for the "left school" text)
    private var calendar = mapOf<String, String>() // date -> day type ('holiday', 'suspension', ...)
    private var calendarLevels = mapOf<String, List<String>>() // date -> grade levels it applies to (empty = all)
    private var settings = SchoolSettings()

    // ----- today -----
    private var day = "" // the date the "today" listeners are for
    private val scannedToday = mutableMapOf<String, MutableMap<String, String>>() // section id -> (student id -> scan time)
    private val statusToday = mutableMapOf<String, String>() // student id -> today's status on the class list (also set by a teacher)
    private val outToday = mutableSetOf<String>() // children who already left school today (scanned out or picked up)
    private var confirmedToday = setOf<String>() // sections whose teacher already confirmed today
    private val lastSeen = mutableMapOf<String, Long>() // card code -> when it was last scanned (ms), for the double-beep check

    private val schoolListeners = mutableListOf<ListenerRegistration>()
    private val dayListeners = mutableListOf<ListenerRegistration>()

    // ----- what the screens watch -----
    private val _status = MutableStateFlow(GateStatus())
    val status: StateFlow<GateStatus> = _status
    private val _saveError = MutableStateFlow<String?>(null)
    val saveError: StateFlow<String?> = _saveError // shown in red when Firestore refuses a save
    private val _phoneSms = MutableStateFlow(false)
    val phoneSms: StateFlow<Boolean> = _phoneSms // the screen shows the SMS row and asks for permission when true

    /** True when the admin chose "Gate phone (SIM)": this app sends the queued texts (SmsGateway.kt). */
    fun phoneSendsTexts() = settings.smsProvider == "phone"

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
            val list = snap?.documents?.mapNotNull { d -> d.data?.let { Guardian.from(d.id, it) } } ?: emptyList()
            guardianOf = list.flatMap { g -> g.studentIds.map { it to g } }.toMap()
        }
        schoolListeners += db.collection("meta").document("school").addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            settings = SchoolSettings.from(snap?.data)
            refreshStatus()
            _phoneSms.value = phoneSendsTexts()
        }
        schoolListeners += db.collection("meta").document("calendar").addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            @Suppress("UNCHECKED_CAST")
            val days = snap?.get("days") as? List<Map<String, Any?>> ?: emptyList()
            calendar = days.mapNotNull { e -> (e["date"] as? String)?.let { it to (e["type"] as? String ?: "") } }.toMap()
            @Suppress("UNCHECKED_CAST")
            calendarLevels = days.mapNotNull { e ->
                val d = e["date"] as? String
                val lv = (e["levels"] as? List<Any?>)?.mapNotNull { it as? String }
                if (d != null && !lv.isNullOrEmpty()) d to lv else null
            }.toMap()
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
        statusToday.clear()
        outToday.clear()
        confirmedToday = emptySet()
        dayListeners += db.collection("attendance").whereEqualTo("date", date).addSnapshotListener { snap, err ->
            if (err != null) return@addSnapshotListener onListenError(err)
            for (d in snap?.documents ?: emptyList()) {
                val sectionId = d.getString("sectionId") ?: continue
                @Suppress("UNCHECKED_CAST")
                val records = d.get("records") as? Map<String, Map<String, Any?>> ?: continue
                val map = scannedToday.getOrPut(sectionId) { mutableMapOf() }
                for ((studentId, rec) in records) {
                    (rec["status"] as? String)?.let { statusToday[studentId] = it }
                    if (rec["scannedOut"] != null) outToday.add(studentId)
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
        val withClass = sections.values.filter { Rules.isSchoolDay(today, it.schedule, calendar, calendarLevels, it.gradeLevel) && today in settings.yearStart..settings.yearEnd }.map { it.id }.toSet()
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
        if (!Rules.isSchoolDay(today, section.schedule, calendar, calendarLevels, section.gradeLevel) || today < settings.yearStart || today > settings.yearEnd) {
            // CHILD SAFETY: the child came in, then the day became a no-class day (a suspension declared
            // during class hours): scanning the card again records the time the child left, and the parent
            // is texted.
            if (scannedToday[section.id]?.containsKey(student.id) == true && student.id !in outToday) {
                val nowMs = System.currentTimeMillis()
                val last = lastSeen[code]
                lastSeen[code] = nowMs
                if (last != null && nowMs - last < GateConfig.DEBOUNCE_SECONDS * 1000) return ScanResult.Ignored
                return recordOut(student, section, today, Rules.timeNow())
            }
            // CHILD SAFETY: the class was cancelled for today (teacher absent) but the child came anyway:
            // tell the staff (shows as an urgent alert on the website).
            if (today in section.schedule.noClassDates && today >= settings.yearStart && today <= settings.yearEnd) {
                val nid = "oncampus_${student.id}_$today"
                val time = Rules.timeNow()
                save(
                    "notifications", nid,
                    mapOf(
                        "id" to nid, "kind" to "missing", "studentId" to student.id, "sectionId" to section.id,
                        "createdAt" to "${today}T$time:00+08:00", "read" to false,
                        "title" to "${student.fullName} came to school at ${Rules.to12h(time)} but ${section.name} has no class today",
                        "body" to "The class was cancelled because the teacher is absent. Keep the child with a staff member and call the guardian.",
                    ),
                )
            }
            return ScanResult.NoClassToday(student, section)
        }

        // 3. A double beep (same card again within a few seconds) is ignored.
        val nowMs = System.currentTimeMillis()
        val last = lastSeen[code]
        lastSeen[code] = nowMs
        if (last != null && nowMs - last < GateConfig.DEBOUNCE_SECONDS * 1000) return ScanResult.Ignored

        // 4. Only the first scan of the day counts as coming in. Scanned again 30 minutes or more later
        //    (or, for a child the teacher marked present without a scan, in the last hour of class) =
        //    going home: the time out is saved and the parent is texted (once a day).
        val nowTime = Rules.timeNow()
        val inAt = scannedToday[section.id]?.get(student.id)
        val manualIn = inAt == null && (statusToday[student.id] == "present" || statusToday[student.id] == "late")
        if ((inAt != null && Rules.toMinutes(nowTime) - Rules.toMinutes(inAt) >= 30) ||
            (manualIn && Rules.toMinutes(nowTime) >= Rules.toMinutes(section.schedule.endTime) - 60)
        ) {
            return recordOut(student, section, today, nowTime)
        }
        inAt?.let { return ScanResult.AlreadyIn(student, section, it) }

        // 5. Present or late, by the clock. NO text is sent at the gate: the parent is texted when a
        //    teacher confirms the child in class (website).
        val time = Rules.timeNow()
        val confirmed = section.id in confirmedToday
        val dayId = "${section.id}_$today"
        val already = statusToday[student.id]

        // 5a. A teacher already marked this child Present or Late without a scan (e.g. forgot the ID):
        //     keep that status and only add the scan time. merge = the other fields stay untouched.
        if (already == "present" || already == "late") {
            save("attendance", dayId, mapOf("records" to mapOf(student.id to mapOf("scannedAt" to time))), merge = true)
            scannedToday.getOrPut(section.id) { mutableMapOf() }[student.id] = time
            refreshStatus()
            return ScanResult.Recorded(student, section, already, time, false)
        }

        // 6. Save it inside the section's attendance document for today: attendance/{sectionId}_{date}.
        //    merge = only this child's record is changed; the other children's records stay untouched.
        //    After the teacher confirmed the class, the scan is marked needsCheck: the child waits on the
        //    class list until a teacher marks Present or Late (then the parent is texted).
        val status = Rules.statusForScan(time, section.schedule, false)
        val record = mutableMapOf<String, Any>(
            "date" to today,
            "studentId" to student.id,
            "sectionId" to section.id,
            "status" to status,
            "scannedAt" to time,
            "source" to "scanner",
        )
        // Excused for part of the day (e.g. the morning, by the parent's request through the portal):
        // merge = the excuse on the record stays; the alert says the child was expected.
        val partExcused = already == "excused"
        if (confirmed) {
            record["needsCheck"] = true
            record["editedReason"] = if (partExcused) "Arrived after an excused part of the day" else "Arrived after attendance was confirmed"
        }
        save("attendance", dayId, mapOf("id" to dayId, "sectionId" to section.id, "date" to today, "records" to mapOf(student.id to record)), merge = true)
        scannedToday.getOrPut(section.id) { mutableMapOf() }[student.id] = time // show it at once, even offline
        statusToday[student.id] = status
        refreshStatus()
        if (confirmed) {
            audit("attendance.scan_after_lock", student.fullName, "scanned at $time, waiting for the teacher")
            val nid = "late_${student.id}_$today"
            save(
                "notifications", nid,
                mapOf(
                    "id" to nid, "kind" to "missing", "studentId" to student.id, "sectionId" to section.id,
                    "createdAt" to "${today}T$time:00+08:00", "read" to false,
                    "title" to if (partExcused) "${student.fullName} arrived at ${Rules.to12h(time)} (excused earlier today by the parent's request)"
                        else "${student.fullName} scanned at the gate at ${Rules.to12h(time)}, after attendance was confirmed",
                    "body" to "Check that ${student.firstName} is in ${section.name}, then mark Present or Late on the Attendance page. The parent is texted when you do.",
                ),
            )
        }
        return ScanResult.Recorded(student, section, status, time, confirmed) // last value: waiting for the teacher
    }

    // The child left school: saves the time out (class list and parent portal) and texts the parent,
    // like recordOut() on the website (src/engine/attendance.js).
    private fun recordOut(student: Student, section: Section, today: String, time: String): ScanResult {
        val dayIdOut = "${section.id}_$today"
        save("attendance", dayIdOut, mapOf("records" to mapOf(student.id to mapOf("scannedOut" to time))), merge = true)
        // The parent portal's month for this child (only the time out; the website rewrites the rest).
        val month = today.substring(0, 7)
        save(
            "parentDays", "${student.id}_$month",
            mapOf("studentId" to student.id, "month" to month, "days" to mapOf(today to mapOf("o" to time))),
            merge = true,
        )
        if (outToday.add(student.id)) queueDepartureText(student, section, today, time)
        return ScanResult.Out(student, section, time)
    }

    // "Doorbell: Mikaela left school at 2:54 PM (scanned out at the gate)." One per child per day, only with
    // the parent's SMS consent. Same document as the website's queueSms(); sent by Semaphore or this phone.
    private fun queueDepartureText(student: Student, section: Section, today: String, time: String) {
        if (!settings.departureSmsEnabled) return
        val g = guardianOf[student.id] ?: return
        if (!g.smsConsent || g.mobile.isBlank()) return
        val id = "out_${student.id}_$today"
        val body = Rules.renderTemplate(
            settings.template(g.language, "departure"),
            mapOf("child" to student.firstName, "time" to Rules.to12h(time), "school" to settings.schoolName, "contact" to settings.contactNumber),
        )
        save(
            "sms", id,
            mapOf(
                "id" to id, "studentId" to student.id, "guardianId" to g.id, "sectionId" to section.id, "to" to g.mobile,
                "body" to body, "kind" to "departure",
                "status" to if (g.numberFailed) "failed" else if (settings.realSms) "queued" else "sent",
                "createdAt" to "${today}T$time:00+08:00", "queuedAt" to Instant.now().toString(), "attempts" to 1,
            ),
        )
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
