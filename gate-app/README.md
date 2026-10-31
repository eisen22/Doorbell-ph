# Doorbell Gate (Android)

The scanner app for the phone at the **school gate**. Each child shows their Doorbell ID card to the
camera; the app records the arrival (present or late) and the parent gets the arrival text. The
teacher sees the arrival live on the Attendance page and **confirms attendance once the class is inside
the classroom**.

Written in Kotlin with Jetpack Compose. It uses the same Firebase project as the website
(`doorbell-ph-f12d0`) and writes the same documents, so nothing else has to change.

## Set up (once)

1. **Publish the new rules.** Firebase console → Firestore Database → Rules → paste `../firestore.rules` → Publish.
   (They add the `gate` role.)
2. **Make the gate account.** Website → sign in as admin → **Settings & SMS → Gate scanner phone** →
   enter an email (e.g. `gate@yourschool.edu.ph`) and a password → **Create gate account**.
3. **Install the app.** Open this `gate-app` folder in Android Studio (File → Open), wait for Gradle
   to finish, plug in the phone (USB debugging on) and press **Run ▶**.
   Or build an APK: Build → Generate App Bundles or APKs → Build APK, then copy it to the phone.
4. On the phone: sign in with the gate account, allow the camera, put the phone on a stand at the gate.

## How a scan works

| What the guard sees | Meaning |
|---|---|
| Green, one beep | Arrived on time. Saved, parent texted |
| Amber, two beeps | Late (after start + late cutoff), or the teacher already confirmed the day |
| Blue | Already scanned today: the first scan is kept |
| Grey | No class today for that section (weekend, holiday, suspension) |
| Red, low buzz | Unknown card, old replaced card, or the child is not in a section yet |

The same card held in front of the camera again within 10 seconds is ignored (no double beeps).

Scanning works offline for a while: Firestore keeps a copy on the phone and sends the saves when the
Wi-Fi comes back. The barcode reader runs on the phone, so it needs no internet either.

## The files (app/src/main/java/ph/doorbell/gate)

| File | What is inside |
|---|---|
| `GateConfig.kt` | Which Firebase project to use (same values as the website's `src/firebase.js`) |
| `Rules.kt` | **The rules**: present or late, school days, SMS text. A copy of the website's `src/logic.js`; tested in `app/src/test/.../RulesTest.kt` |
| `Models.kt` | The data read from Firestore (students, sections, guardians, settings) and the scan results |
| `GateRepository.kt` | Live listeners and `scan()`, the same steps as `recordScan()` in the website's `src/engine.js` |
| `GateViewModel.kt` | Sign-in (gate or admin accounts only), and what happens after each scan |
| `MainActivity.kt` | Where the app starts; camera permission; keeps the screen on |
| `ui/CameraScanner.kt` | CameraX preview + ML Kit reading QR codes and CODE-128 barcodes |
| `ui/ScannerScreen.kt` | The scanner screen: counts, camera, result banner, recent scans |
| `ui/SignInScreen.kt` | The sign-in screen and the logo |
| `ui/Theme.kt`, `ui/Squircle.kt` | Colors, font (Plus Jakarta Sans) and the Apple-style squircle corners |
| `ui/Feedback.kt` | Beep and vibration after a scan |

## Debugging tips

* **Logcat** (bottom of Android Studio) shows errors; filter by `ph.doorbell.gate`.
* "Cannot read the school data: PERMISSION_DENIED" → the new `firestore.rules` is not published, or
  the account is not a gate/admin account.
* "Card not recognized" for a real card → the student's `qrToken` in Firestore must match the code
  printed on the card (reprint it from the website's ID Cards page).
* Try the rules without a phone: right-click `RulesTest.kt` → Run.
