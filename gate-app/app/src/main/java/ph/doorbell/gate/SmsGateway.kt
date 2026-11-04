package ph.doorbell.gate

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.os.Build
import android.telephony.SmsManager
import androidx.core.content.ContextCompat
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ListenerRegistration
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeoutOrNull
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.coroutines.resume

// =====================================================================
// SmsGateway.kt — THE GATE PHONE SENDS THE PARENT TEXTS FROM ITS OWN SIM
// ---------------------------------------------------------------------
// Used when the admin chooses Settings & SMS -> How texts are sent -> "Gate phone (SIM)".
// Every text Doorbell creates (arrival, late, 3-day alert, test) is saved in Firestore with
// status 'queued'. This class watches for those, and for each one:
//   1. claims it (status 'sending'), so two phones never send the same text
//   2. sends it with Android's SmsManager (long texts are split into parts automatically)
//   3. waits for the network's answer, then saves 'sent' or 'failed' (+ the reason)
// Texts are sent one at a time, a second apart. The app must be open (it keeps the screen on).
// Costs: only the SIM's load. An "unlimited texts" promo covers a demo week.
// =====================================================================
class SmsGateway(private val context: Context, private val db: FirebaseFirestore) {

    private val _waiting = MutableStateFlow(0)
    val waiting: StateFlow<Int> = _waiting // texts still waiting to be sent (shown on the scanner screen)
    private val _sentToday = MutableStateFlow(0)
    val sentToday: StateFlow<Int> = _sentToday

    private var registration: ListenerRegistration? = null
    private var worker: Job? = null
    private var retry: Job? = null
    private val todo = Channel<String>(Channel.UNLIMITED) // ids of texts to try
    private val inFlight = mutableSetOf<String>() // ids already in `todo` or being sent
    private var latestQueued = listOf<String>()

    /** True once the guard allowed "Send and view SMS messages". */
    fun hasPermission() = ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED

    /** Starts watching for queued texts. `active()` says whether this phone should send them right now. */
    fun start(scope: CoroutineScope, active: () -> Boolean) {
        stop()
        registration = db.collection("sms").whereEqualTo("status", "queued").addSnapshotListener { snap, _ ->
            latestQueued = snap?.documents?.map { it.id } ?: emptyList()
            _waiting.value = latestQueued.size
            if (active()) latestQueued.forEach(::enqueue)
        }
        // One text at a time.
        worker = scope.launch {
            for (id in todo) {
                try {
                    if (active() && hasPermission()) send(id)
                } catch (e: Exception) {
                    // Offline, or the claim failed: it stays 'queued' and is tried again below.
                } finally {
                    synchronized(inFlight) { inFlight.remove(id) }
                }
                delay(1000)
            }
        }
        // Every 30 seconds, try again texts that could not be sent (no signal, no internet, no permission yet).
        retry = scope.launch {
            while (true) {
                delay(30_000)
                if (active()) latestQueued.forEach(::enqueue)
            }
        }
    }

    fun stop() {
        registration?.remove()
        registration = null
        worker?.cancel()
        retry?.cancel()
        synchronized(inFlight) { inFlight.clear() }
    }

    private fun enqueue(id: String) {
        val added = synchronized(inFlight) { inFlight.add(id) }
        if (added) todo.trySend(id)
    }

    private suspend fun send(id: String) {
        val ref = db.collection("sms").document(id)
        // 1. Claim it (a transaction: only one phone can change 'queued' to 'sending').
        val data = db.runTransaction { tx ->
            val snap = tx.get(ref)
            if (snap.getString("status") != "queued") null else {
                tx.update(ref, "status", "sending")
                snap.data
            }
        }.await() ?: return

        val to = data["to"] as? String ?: ""
        val body = data["body"] as? String ?: ""
        // A text left waiting for more than 12 hours (e.g. the phone was off overnight) is not sent
        // late by surprise: it is marked failed, and the teacher can press Resend.
        val since = parseTime(data["queuedAt"] as? String) ?: parseTime(data["createdAt"] as? String)
        if (since != null && Duration.between(since, Instant.now()).toHours() >= 12) {
            return fail(ref.id, data, "Not sent: it waited more than 12 hours. Press Resend to send it now.")
        }
        if (to.isBlank() || body.isBlank()) return fail(ref.id, data, "No number or no message")

        // 2. Send, and 3. wait for the network's answer.
        val error = sendThroughSim(id, to, body)
        if (error == null) {
            ref.update(mapOf("status" to "sent", "provider" to "phone", "sentAt" to Instant.now().toString(), "error" to null)).await()
            _sentToday.value += 1
        } else {
            fail(ref.id, data, error)
        }
    }

    // Returns null when every part was accepted by the network, or the reason it failed.
    private suspend fun sendThroughSim(id: String, to: String, body: String): String? {
        val sms = if (Build.VERSION.SDK_INT >= 31) context.getSystemService(SmsManager::class.java) else @Suppress("DEPRECATION") SmsManager.getDefault()
            ?: return "This phone cannot send SMS"
        val parts = sms.divideMessage(body)
        val action = "ph.doorbell.gate.SMS_SENT.$id"
        val result: String = withTimeoutOrNull(60_000L) {
            suspendCancellableCoroutine<String> { cont ->
                var answered = 0
                var firstError: String? = null
                val receiver = object : BroadcastReceiver() {
                    override fun onReceive(c: Context, intent: Intent) {
                        if (resultCode != Activity.RESULT_OK && firstError == null) firstError = reason(resultCode)
                        answered += 1
                        if (answered == parts.size) {
                            runCatching { context.unregisterReceiver(this) }
                            if (cont.isActive) cont.resume(firstError ?: "")
                        }
                    }
                }
                ContextCompat.registerReceiver(context, receiver, IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED)
                cont.invokeOnCancellation { runCatching { context.unregisterReceiver(receiver) } }
                val sent = ArrayList(parts.indices.map { i ->
                    PendingIntent.getBroadcast(
                        context,
                        (id.hashCode() * 31) + i,
                        Intent(action).setPackage(context.packageName),
                        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT,
                    )
                })
                try {
                    if (parts.size == 1) sms.sendTextMessage(to, null, body, sent[0], null)
                    else sms.sendMultipartTextMessage(to, null, parts, sent, null)
                } catch (e: Exception) {
                    runCatching { context.unregisterReceiver(receiver) }
                    if (cont.isActive) cont.resume("Could not send: ${e.message}")
                }
            }
        } ?: return "No answer from the phone network within a minute"
        return if (result.isEmpty()) null else result
    }

    // Saves 'failed' with the reason, and tells the teacher (Alerts page) like the website does.
    private suspend fun fail(id: String, data: Map<String, Any?>, reason: String) {
        db.collection("sms").document(id).update(mapOf("status" to "failed", "error" to reason, "failedAt" to Instant.now().toString())).await()
        val studentId = data["studentId"] as? String ?: return
        val nid = "smsf_$id"
        db.collection("notifications").document(nid).set(
            mapOf(
                "id" to nid, "kind" to "sms_failed", "studentId" to studentId, "sectionId" to data["sectionId"],
                "createdAt" to (data["createdAt"] ?: Instant.now().toString()), "read" to false,
                "title" to "A text to a guardian did not go through",
                "body" to "The gate phone said: $reason. Check the number and the phone's load, then press Resend.",
            ),
        ).await()
    }

    private fun parseTime(s: String?): Instant? = s?.let { runCatching { OffsetDateTime.parse(it).toInstant() }.getOrNull() ?: runCatching { Instant.parse(it) }.getOrNull() }

    // Android's error codes in plain words.
    private fun reason(code: Int): String = when (code) {
        SmsManager.RESULT_ERROR_GENERIC_FAILURE -> "The network refused it (check the SIM's load or the number)"
        SmsManager.RESULT_ERROR_NO_SERVICE -> "No signal"
        SmsManager.RESULT_ERROR_RADIO_OFF -> "Airplane mode is on"
        SmsManager.RESULT_ERROR_NULL_PDU -> "The message could not be prepared"
        else -> "Phone error $code"
    }
}
