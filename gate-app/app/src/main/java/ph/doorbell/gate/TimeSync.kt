package ph.doorbell.gate

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZonedDateTime

// =====================================================================
// TimeSync.kt — THE RIGHT TIME, EVEN IF THE PHONE'S CLOCK IS WRONG
// ---------------------------------------------------------------------
// Present or late depends on the time of the scan. If the phone's clock is 20 minutes off,
// children would be marked wrongly. So the app asks an internet server for the time
// (the "Date" header of a tiny Google page) and remembers the difference ("offset").
// Every scan uses phone time + offset. Without internet the last known offset keeps being used.
// =====================================================================
object TimeSync {
    @Volatile
    var offsetMs = 0L // internet time minus phone time
        private set

    @Volatile
    var synced = false
        private set

    /** The corrected time now, in the Philippines. */
    fun now(): ZonedDateTime = Instant.ofEpochMilli(System.currentTimeMillis() + offsetMs).atZone(Rules.MANILA)

    /** Asks the internet for the time. Returns the offset in ms, or null when offline. */
    suspend fun sync(): Long? = withContext(Dispatchers.IO) {
        runCatching {
            val c = URL("https://www.google.com/generate_204").openConnection() as HttpURLConnection
            c.requestMethod = "HEAD"
            c.connectTimeout = 5000
            c.readTimeout = 5000
            c.useCaches = false
            val before = System.currentTimeMillis()
            c.connect()
            val server = c.date // the "Date" header in ms (whole seconds), 0 if missing
            val after = System.currentTimeMillis()
            c.disconnect()
            if (server <= 0) return@runCatching null
            // +500 ms because the header drops the milliseconds; compare with the middle of the request.
            val offset = server + 500 - (before + after) / 2
            offsetMs = offset
            synced = true
            offset
        }.getOrNull()
    }
}
