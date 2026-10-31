package ph.doorbell.gate.ui

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.VibrationEffect
import android.os.Vibrator
import ph.doorbell.gate.ScanResult

// =====================================================================
// Feedback.kt — A BEEP AND A BUZZ AFTER EACH SCAN
// The guard can tell the result without looking: one short beep = arrived,
// two beeps = late or already in, low buzz = problem with the card.
// =====================================================================
class Feedback(context: Context) {
    private val tone = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 90) }.getOrNull()
    private val vibrator = context.getSystemService(Vibrator::class.java)

    fun play(r: ScanResult) {
        when (r) {
            is ScanResult.Recorded -> if (r.status == "late") beep(ToneGenerator.TONE_PROP_BEEP2, 60) else beep(ToneGenerator.TONE_PROP_BEEP, 40)
            is ScanResult.AlreadyIn, is ScanResult.NoClassToday -> beep(ToneGenerator.TONE_PROP_BEEP2, 60)
            is ScanResult.Unknown, is ScanResult.Revoked, is ScanResult.NotEnrolled -> beep(ToneGenerator.TONE_SUP_ERROR, 300)
            ScanResult.Ignored -> {}
        }
    }

    private fun beep(kind: Int, buzzMs: Long) {
        tone?.startTone(kind, 150)
        runCatching { vibrator?.vibrate(VibrationEffect.createOneShot(buzzMs, VibrationEffect.DEFAULT_AMPLITUDE)) }
    }

    fun release() {
        tone?.release()
    }
}
