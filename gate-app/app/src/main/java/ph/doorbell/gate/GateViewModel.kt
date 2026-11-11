package ph.doorbell.gate

import android.app.Application
import androidx.lifecycle.AndroidViewModel
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
// GateViewModel.kt — WHAT THE SCREEN SHOWS, AND WHAT THE SCAN BUTTON DOES
// ---------------------------------------------------------------------
// This is a temporary gate app for showing the idea: it only scans ID cards and saves them
// to the cloud, so they appear on the website.
// Sign-in:  automatic, with the gate account in local.properties (see app/build.gradle.kts).
//           firestore.rules still only accepts scans from a gate (or admin) account.
// Scanning: the camera reads a card only after "Scan ID" is pressed: one card per press.
// In the background: internet-time correction (so on time / late is right) and, when the admin
// chose "Gate phone's SIM", sending the parent texts from this phone (SmsGateway.kt).
// =====================================================================
class GateViewModel(app: Application) : AndroidViewModel(app) {
    private val auth = FirebaseAuth.getInstance()
    private val db = FirebaseFirestore.getInstance()
    val repo = GateRepository(db)
    val sms = SmsGateway(app, db)

    sealed class Screen {
        data object Loading : Screen()
        data class Problem(val message: String) : Screen()
        data object Scanner : Screen()
    }

    private val _screen = MutableStateFlow<Screen>(Screen.Loading)
    val screen: StateFlow<Screen> = _screen

    private val _result = MutableStateFlow<ScanResult?>(null) // the big banner under the camera
    val result: StateFlow<ScanResult?> = _result
    private val _scanning = MutableStateFlow(false) // true after "Scan ID" is pressed, until a card is read
    val scanning: StateFlow<Boolean> = _scanning
    private val _hint = MutableStateFlow<String?>(null) // e.g. "No ID found"
    val hint: StateFlow<String?> = _hint

    private var lastShown: ScanResult? = null
    private var scanJob: Job? = null
    private var clearJob: Job? = null
    private var clockJob: Job? = null

    init {
        connect()
    }

    /** Signs in with the built-in gate account (or reuses last time's sign-in), then opens the scanner. */
    fun connect() {
        _screen.value = Screen.Loading
        viewModelScope.launch {
            try {
                val user = auth.currentUser ?: run {
                    if (BuildConfig.GATE_EMAIL.isBlank() || BuildConfig.GATE_PASSWORD.isBlank()) {
                        _screen.value = Screen.Problem("The gate account is not set in this app. Add gate.email and gate.password to gate-app/local.properties, then build the app again.")
                        return@launch
                    }
                    auth.signInWithEmailAndPassword(BuildConfig.GATE_EMAIL.trim(), BuildConfig.GATE_PASSWORD).await().user!!
                }
                val role = db.collection("users").document(user.uid).get().await().getString("role")
                if (role == "gate" || role == "admin") {
                    startClockSync()
                    repo.start()
                    sms.start(viewModelScope) { repo.phoneSendsTexts() }
                    _screen.value = Screen.Scanner
                } else {
                    auth.signOut()
                    _screen.value = Screen.Problem("The account in local.properties is not a gate account. Make one in Doorbell: Settings & SMS -> Gate scanner phone.")
                }
            } catch (e: Exception) {
                auth.signOut()
                _screen.value = Screen.Problem(friendly(e))
            }
        }
    }

    // Keeps the phone's time in line with internet time (checked now and every 30 minutes).
    private fun startClockSync() {
        clockJob?.cancel()
        clockJob = viewModelScope.launch {
            while (true) {
                val offset = TimeSync.sync()
                delay(if (offset == null) 60_000 else 30 * 60_000) // offline: try again in a minute
            }
        }
    }

    /** "Scan ID" pressed: the camera looks for one card for up to 15 seconds. */
    fun startScan() {
        _result.value = null
        _hint.value = null
        _scanning.value = true
        scanJob?.cancel()
        scanJob = viewModelScope.launch {
            delay(15_000)
            if (_scanning.value) {
                _scanning.value = false
                _hint.value = "No ID found. Press Scan ID and hold the card inside the frame."
            }
        }
    }

    /** Called by the camera with each code it reads. Only the first one after "Scan ID" counts. */
    fun onCode(code: String): ScanResult? {
        if (!_scanning.value) return null
        _scanning.value = false
        scanJob?.cancel()
        var r = repo.scan(code)
        // The same card again within a few seconds: it is already saved, so show its result again.
        if (r is ScanResult.Ignored) r = lastShown ?: return null
        lastShown = r
        _result.value = r
        clearJob?.cancel()
        clearJob = viewModelScope.launch {
            delay(8000)
            _result.value = null
        }
        return r
    }

    fun clearError() = repo.clearError()

    // Firebase error messages are technical; these are the common ones in plain words.
    private fun friendly(e: Exception): String {
        val m = e.message ?: ""
        return when {
            "INVALID_LOGIN_CREDENTIALS" in m || "password is invalid" in m || "no user record" in m || "credential" in m.lowercase() ->
                "The gate account's email or password in local.properties is wrong."
            "network" in m.lowercase() -> "No internet. Connect the phone to Wi-Fi or mobile data, then press Try again."
            "PERMISSION_DENIED" in m -> "Doorbell refused the account. Publish the newest firestore.rules in Firebase console."
            "blocked" in m.lowercase() || "too many" in m.lowercase() -> "Too many tries. Wait a minute, then press Try again."
            else -> m.ifBlank { "Something went wrong. Press Try again." }
        }
    }

    override fun onCleared() {
        sms.stop()
        repo.stop()
    }
}
