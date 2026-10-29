# Doorbell (simple version)

**Safe Arrival: A Barcode-Based Attendance Checking and SMS Notification System for Child Safety in Schools**

This is a small, plain-JavaScript version of Doorbell, made to be easy to read and debug. No frameworks, no build step, no `npm install`. The browser loads the files as they are.

## What it does

| Who | Can do |
|---|---|
| **Teacher** | Scan ID cards (barcode scanner or typing the code) → child marked present or late → parent texted. Change statuses by hand. Confirm attendance → unscanned children become absent → a child absent or late **3 school days in a row** triggers a warning text to the parent and an alert. Sees "Attention needed", alerts and today's texts. A teacher with several classes picks one; the class happening now is shown first. |
| **Admin** | Absence watch, sections (teacher and class times), teachers (creates their accounts), students (add, edit, move, transfer, drop, new card), printable ID cards with barcodes, no-class days (holidays and suspensions; teachers are alerted), log of all texts. |

Texts are **simulated**: they are saved in the `sms` collection instead of being sent. Connecting a real SMS provider later only needs a small program that reads new `sms` documents and sends them.

## Files (10)

```
index.html        sign-in page (+ first-time admin setup)
teacher.html      teacher page
admin.html        admin page (tabs)
css/style.css     all the styling
js/firebase.js    connection to Firebase + small shared helpers   <- paste your Firebase config here
js/logic.js       THE RULES: late or not, school days, 3-day streak, SMS wording (no Firebase)
js/login.js       code for index.html
js/teacher.js     code for teacher.html
js/admin.js       code for admin.html
firestore.rules   security rules (who can read/write what)
```

Every file has comments explaining what each part does and what you can safely change.

## Data in Firestore

| Collection | One document is | Main fields |
|---|---|---|
| `users/{uid}` | a staff account's profile | `name, email, role: 'admin' or 'teacher'` |
| `sections` | a class | `name, teacherUid, startTime, endTime, startDate` |
| `students` | a child | `firstName, lastName, sectionId, code (barcode), guardianName, guardianPhone, active` |
| `attendance/{sectionId}_{date}` | one class on one day | `confirmed, records: { studentId: { status, time } }` |
| `noClassDays/{date}` | a holiday or suspension | `type, reason` |
| `sms` | a text to a parent | `to, body, kind, studentName, date` |
| `alerts` | a message for teachers | `sectionId ('all' = everyone), title, body` |
| `meta/setup` | marks that the first admin exists | `done` |

## Setting up

1. Create a Firebase project; turn on **Authentication → Email/Password**; create a **Firestore** database.
2. Add `eisen22.github.io` under Authentication → Settings → Authorized domains.
3. Paste your web app's `firebaseConfig` into `js/firebase.js`.
4. Firestore → **Rules** → paste the contents of `firestore.rules` → **Publish**.
5. Open the site. The sign-in page shows **First-time setup**: create the admin account.
6. As admin: **Add sample data** (optional) → **Teachers → Add teacher** → **Sections** → choose the teacher for each class.

### Running it

* **Online:** GitHub repository → Settings → Pages → Source: *Deploy from a branch* → `main` / root → the site appears at `https://eisen22.github.io/Doorbell-ph/`.
* **On your computer:** the files must be served (opening `index.html` by double-click does not allow modules). In VS Code install **Live Server** and click *Go Live*, or run `npx serve` in this folder.

## Debugging tips

* Press **F12** → **Console** to see errors. Most errors name the file and line.
* `Missing or insufficient permissions` → a rule in `firestore.rules` blocked it (wrong role, or the teacher is not that section's teacher).
* `Failed to resolve module` / blank page → open the site through Live Server or GitHub Pages, not by double-clicking.
* Wrong late/on-time result or wrong 3-day count → test the functions in `js/logic.js` from the console:
  ```js
  const L = await import('./js/logic.js');
  L.statusForScan('08:20', '08:00');            // 'late'
  L.recentSchoolDays(L.todayManila(), 5, new Set());
  ```
* To see what is saved: Firebase console → Firestore Database → Data.
