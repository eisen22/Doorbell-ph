package ph.doorbell.gate

// =====================================================================
// GateConfig.kt — WHICH FIREBASE PROJECT THE GATE PHONE USES
// ---------------------------------------------------------------------
// These are the same values as `firebaseConfig` in the website's src/firebase.js
// (project doorbell-ph-f12d0). They are not secret: firestore.rules protects the data.
// If you move Doorbell to another Firebase project, change them in BOTH places.
// =====================================================================
object GateConfig {
    const val API_KEY = "AIzaSyClVWQwsBbDPrIUqrASHSnowVWqVLowT4o"
    const val PROJECT_ID = "doorbell-ph-f12d0"
    const val STORAGE_BUCKET = "doorbell-ph-f12d0.firebasestorage.app"
    const val SENDER_ID = "870779183956"

    // The web app's id works for sign-in and the database. If you register an Android app in
    // Firebase console (Project settings -> Add app -> Android, package name ph.doorbell.gate),
    // you can paste its "App ID" here instead (it looks like 1:870779183956:android:...).
    const val APP_ID = "1:870779183956:web:21fa604c5f23c0c5301ec1"

    // Same as the website: a code scanned again within this many seconds is ignored (a double beep).
    const val DEBOUNCE_SECONDS = 10
}
