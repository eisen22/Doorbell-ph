package ph.doorbell.gate

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await

// =====================================================================
// GateViewModel.kt — WHAT THE SCREENS SHOW, AND WHAT BUTTONS DO
// ---------------------------------------------------------------------
// Sign-in:  only accounts whose users/{uid} role is 'gate' (made by the admin in
//           Settings & SMS -> Gate scanner phone) or 'admin' (for testing) may scan.
// Scanning: the camera calls onCode(); the result is shown for a few seconds and added to
//           the "Recent scans" list.
// The ViewModel survives screen rotation, so a scan in progress is never lost.
// =====================================================================
class GateViewModel : ViewModel() {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    val repo = GateRepository(db)

    sealed class Screen {
        data object Loading : Screen()
        data object SignIn : Screen()
        data object Scanner : Screen()
    }

    private val _screen = MutableStateFlow<Screen>(Screen.Loading)
    val screen: StateFlow<Screen> = _screen

    private val _signInError = MutableStateFlow<String?>(null)
    val signInError: StateFlow<String?> = _signInError
    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy

    private val _result = MutableStateFlow<ScanResult?>(null) // the big banner under the camera
    val result: StateFlow<ScanResult?> = _result
    private val _recent = MutableStateFlow<List<RecentScan>>(emptyList())
    val recent: StateFlow<List<RecentScan>> = _recent

    private var clearJob: Job? = null
    private var lastShownAt = 0L

    init {
        // Already signed in from last time? Check the account again, then open the scanner.
        val user = auth.currentUser
        if (user == null) _screen.value = Screen.SignIn
        else viewModelScope.launch { openIfAllowed(user.uid) }
    }

    fun signIn(email: String, password: String) {
        if (email.isBlank() || password.isBlank()) {
            _signInError.value = "Enter the gate account's email and password."
            return
        }
        viewModelScope.launch {
            _busy.value = true
            _signInError.value = null
            try {
                val cred = auth.signInWithEmailAndPassword(email.trim(), password).await()
                openIfAllowed(cred.user!!.uid)
            } catch (e: Exception) {
                _signInError.value = friendly(e)
            } finally {
                _busy.value = false
            }
        }
    }

    // Reads users/{uid} and checks the role.
    private suspend fun openIfAllowed(uid: String) {
        try {
            val role = db.collection("users").document(uid).get().await().getString("role")
            if (role == "gate" || role == "admin") {
                repo.start()
                _screen.value = Screen.Scanner
            } else {
                auth.signOut()
                _signInError.value = if (role == null) "This account is not set up in Doorbell." else "Use the gate account. Teacher accounts sign in on the website."
                _screen.value = Screen.SignIn
            }
        } catch (e: Exception) {
            auth.signOut()
            _signInError.value = friendly(e)
            _screen.value = Screen.SignIn
        }
    }

    fun signOut() {
        repo.stop()
        auth.signOut()
        _result.value = null
        _recent.value = emptyList()
        _screen.value = Screen.SignIn
    }

    /** Called by the camera for every code it reads (many times per second while a card is in view). */
    fun onCode(code: String): ScanResult? {
        val now = System.currentTimeMillis()
        if (now - lastShownAt < 700) return null // give each result a moment on screen
        val r = repo.scan(code)
        if (r is ScanResult.Ignored) return null // the same card is still in front of the camera
        lastShownAt = now
        _result.value = r
        _recent.value = (listOf(toRecent(r)) + _recent.value).take(30)
        // Clear the banner after a few seconds so the next child sees a fresh screen.
        clearJob?.cancel()
        clearJob = viewModelScope.launch {
            delay(6000)
            _result.value = null
        }
        return r
    }

    fun clearError() = repo.clearError()

    private fun toRecent(r: ScanResult): RecentScan {
        val at = Rules.to12h(Rules.timeNow())
        return when (r) {
            is ScanResult.Recorded -> RecentScan(r.student.fullName, if (r.status == "late") "Late · ${r.section.name}" else "Arrived · ${r.section.name}", if (r.status == "late") Tone.LATE else Tone.OK, at)
            is ScanResult.AlreadyIn -> RecentScan(r.student.fullName, "Already in since ${Rules.to12h(r.firstScanAt)}", Tone.INFO, at)
            is ScanResult.Unknown -> RecentScan("Unknown card", r.code.take(24), Tone.BAD, at)
            is ScanResult.Revoked -> RecentScan(r.student.fullName, "Old card, replaced", Tone.BAD, at)
            is ScanResult.NotEnrolled -> RecentScan(r.student.fullName, "Not in a section", Tone.BAD, at)
            is ScanResult.NoClassToday -> RecentScan(r.student.fullName, "No class today", Tone.INFO, at)
            ScanResult.Ignored -> RecentScan("", "", Tone.INFO, at)
        }
    }

    // Firebase error messages are technical; these are the common ones in plain words.
    private fun friendly(e: Exception): String {
        val m = e.message ?: ""
        return when {
            "INVALID_LOGIN_CREDENTIALS" in m || "password is invalid" in m || "no user record" in m || "credential" in m.lowercase() -> "Wrong email or password."
            "network" in m.lowercase() -> "No internet. Connect the phone to Wi-Fi or mobile data and try again."
            "PERMISSION_DENIED" in m -> "Doorbell refused the account. Publish the newest firestore.rules in Firebase console."
            "blocked" in m.lowercase() || "too many" in m.lowercase() -> "Too many tries. Wait a minute and try again."
            else -> m.ifBlank { "Something went wrong. Try again." }
        }
    }

    override fun onCleared() {
        repo.stop()
    }
}
