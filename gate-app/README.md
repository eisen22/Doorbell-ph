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
3. **Put the gate account in the app.** Open `gate-app/local.properties` (Android Studio makes it;
   it is never uploaded to GitHub) and add two lines:
   ```
   gate.email=gate@yourschool.edu.ph
   gate.password=the gate account's password
   ```
   The app signs in by itself with this account, so there is no sign-in screen.
4. **Install the app.** Open this `gate-app` folder in Android Studio (File → Open), wait for Gradle
   to finish, plug in the phone (USB debugging on) and press **Run ▶**.
   Or build an APK: Build → Generate App Bundles or APKs → Build APK, then copy it to the phone.
5. On the phone: allow the camera. Press **Scan ID** and hold the card in front of the camera: one card per press.
   Each scan is saved to the cloud right away and shows on the website.

This phone app is temporary, for showing the idea. A dedicated QR scanner will replace it.

## Texting parents from the gate phone (free, no Blaze plan)

The gate phone can also send the parent texts from its own SIM:

1. Website → admin → **Settings & SMS** → **How texts are sent** → **Gate phone's SIM** → **Save changes**.
2. Open Doorbell Gate on the phone. It asks once: **Allow Doorbell Gate to send and view SMS messages** → **Allow**.
3. Put load on the SIM (an unlimited-texts promo is cheapest).
4. Website → **Send a test SMS to** your number → the phone sends it within a few seconds, and
   SMS Messages shows **Sent**.

Every text (arrival, late, 3-day alert, test) is saved as `queued`; the app claims it, sends it, and
saves `sent` or `failed` with the reason ("No signal", "Airplane mode is on", "The network refused it"...).
A failed text can be sent again with **Resend** on the website. Texts only go out while the app is open;
texts that waited more than 12 hours are not sent (press Resend). If Android shows "This app is sending a
large number of messages", choose **Always allow**. Texts come from the phone's own number (no sender name).

## How a scan works

| What the guard sees | Meaning |
|---|---|
| Green, one beep | Arrived on time. Saved; the parent is texted once the teacher confirms the class |
| Amber, two beeps | Late (after start + late cutoff), or the teacher already confirmed the day |
| Blue | Already scanned today: the first scan is kept |
| Grey | No class today for that section (weekend, holiday, suspension) |
| Red, low buzz | Unknown card, old replaced card, or the child is not in a section yet |

Scanning the same card again within 10 seconds shows its first result again (it is not saved twice).

Scanning works offline for a while: Firestore keeps a copy on the phone and sends the saves when the
Wi-Fi comes back. The barcode reader runs on the phone, so it needs no internet either.

## The files (app/src/main/java/ph/doorbell/gate)

| File | What is inside |
|---|---|
| `GateConfig.kt` | Which Firebase project to use (same values as the website's `src/firebase.js`) |
| `Rules.kt` | **The rules**: present or late, school days, SMS text. A copy of the website's `src/logic.js`; tested in `app/src/test/.../RulesTest.kt` |
| `Models.kt` | The data read from Firestore (students, sections, guardians, settings) and the scan results |
| `GateRepository.kt` | Live listeners and `scan()`, the same steps as `recordScan()` in the website's `src/engine.js` |
| `GateViewModel.kt` | Automatic sign-in with the account in `local.properties`, and the Scan ID button |
| `MainActivity.kt` | Where the app starts; camera permission; keeps the screen on |
| `ui/CameraScanner.kt` | CameraX preview + ML Kit reading QR codes and CODE-128 barcodes |
| `ui/ScannerScreen.kt` | The only screen: camera, result banner and the Scan ID button |
| `ui/Logo.kt` | The Doorbell logo |
| `ui/Theme.kt`, `ui/Squircle.kt` | Colors, font (Plus Jakarta Sans) and the Apple-style squircle corners |
| `ui/Feedback.kt` | Beep and vibration after a scan |
| `SmsGateway.kt` | "Gate phone's SIM" mode: sends the queued parent texts with Android's SmsManager |
| `TimeSync.kt` | Uses internet time for scans when the phone's clock is wrong |

## Debugging tips

* **Logcat** (bottom of Android Studio) shows errors; filter by `ph.doorbell.gate`.
* "Cannot read the school data: PERMISSION_DENIED" → the new `firestore.rules` is not published, or
  the account is not a gate/admin account.
* "Card not recognized" for a real card → the student's `qrToken` in Firestore must match the code
  printed on the card (reprint it from the website's ID Cards page).
* Try the rules without a phone: right-click `RulesTest.kt` → Run.
