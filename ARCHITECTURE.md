# Doorbell — how the code is organized

Doorbell is one React website (admin, teacher and parent pages), a Cloudflare Worker that sends texts
and runs the daily jobs, and an Android app for the gate. All three share one Firebase project.

```
 Gate phone (gate-app, Kotlin)        Website (src/, React + Vite)            Worker (worker/, every minute)
   scans a QR card  ─────────┐        admin · teacher · parent pages          sends queued texts (Semaphore)
   writes the scan           │              │                                 absence texts after 1st period
                             ▼              ▼                                 closes unconfirmed classes
                       ┌─────────────── Firestore (Firebase) ───────────────┐   uses the same engine (src/engine.js)
                       │ sections · students · guardians · attendance ·     │
                       │ sms · notifications · parentKeys · parentDays ...  │
                       └────────────────────────────────────────────────────┘
```

## The three layers of the website

| Layer | Files | Rule of thumb |
|---|---|---|
| **Rules** | `src/logic.js` | Pure functions: late or on time, school days, streaks, SMS wording, the DepEd class day, a teacher's periods. No screens, no database. Start debugging here. |
| **Engine** | `src/engine.js` + `src/engine/*.js` | Holds the school's data in memory (`engine.s`) and does every action. Screens never write to the database directly. |
| **Screens** | `src/admin/`, `src/teacher/`, `src/shared/`, `src/parent/`, `src/ui.jsx` | Read with `useLive(r => r.something())`, act with `repo.something()`. |

`src/firebase.js` connects the engine to Firestore (cloud mode) or runs it on sample data (demo mode: `MODE` at the top).

## The engine, file by file

The `Engine` class is in `src/engine.js`; its methods are grouped by topic in `src/engine/` and added to the class at the bottom of `engine.js`. Inside every method `this` is the engine.

| File | What it does |
|---|---|
| `engine.js` | The core: state, sessions (who is signed in, which classes they see), records, reading the school's data, sign-in |
| `engine/texts.js` | Every parent text (`queueSms`), 3-day streaks, absence and late totals |
| `engine/daily.js` | The school day: a teacher confirms a class (`finalize`), the absence texts after the 1st period (`runAbsence`), catching up missed days |
| `engine/attendance.js` | Class lists, gate scans (`recordScan`), teacher statuses (`setStatus`), alerts, the SMS list, Absence Watch, a child's history |
| `engine/parentPortal.js` | What the parent portal reads (`parentKeys`, `parentDays`), excuse requests, the demo parent view |
| `engine/messages.js` | Messages: conversations between parents, teachers and the school office (one can hold all three). Pure helpers and the document shapes are in `src/messaging.js` |
| `engine/admin.js` | School setup: settings, school year, calendar and suspensions, teachers, admin and gate accounts, sections (class programs), students |
| `engine/defaults.js` | Default settings, school year and parent text templates |
| `engine/sample.js` | The sample school (demo mode and "Load sample school") |
| `engine/clocks.js`, `engine/util.js` | Real and demo clocks, the empty starting state, small helpers |

## Where to look for…

| I want to change… | Go to |
|---|---|
| When a child counts as late, school days, holidays | `logic.js` (`decideScan`, `isSchoolDay`) |
| The wording of a parent text | Admin → Settings → Parent texts (defaults in `engine/defaults.js`) |
| When absence texts go out | `engine/daily.js` (`runAbsence`) and the class's 1st period (`logic.js`: `programSlots`) |
| The periods of the DepEd class day | `logic.js`: `programSlots`, `fitToSlots` |
| A page's layout | its file in `src/admin/`, `src/teacher/`, `src/shared/` or `src/parent/`; styles in `src/style.css` |
| Who may read or write what | `firestore.rules` |
| Messages (who can talk to whom, the inbox, 3-way) | `src/messaging.js`, `engine/messages.js`, `shared/Messages.jsx`, `parent/ParentMessages.jsx`, rules under MESSAGES |
| Sending texts, the minute-by-minute jobs | `worker/src/index.js` |
| The gate scanner | `gate-app/` (its own rules in `Rules.kt` mirror `logic.js`) |

## Checking a change

```
node --import ./worker/resolve-hook.mjs tests/day-flow.test.mjs
node --import ./worker/resolve-hook.mjs tests/admin-and-parents.test.mjs
node --import ./worker/resolve-hook.mjs tests/messages.test.mjs
cd worker && node --import ./resolve-hook.mjs test.mjs
npm run build
```

The tests run whole school days through the real engine (no internet). After a change to the engine,
also redeploy the Worker (`cd worker && npx wrangler deploy`), since it bundles the engine.
