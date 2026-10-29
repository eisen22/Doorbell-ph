# Doorbell (JavaScript edition)

**Safe Arrival: A Barcode-Based Attendance Checking and SMS Notification System for Child Safety in Schools**

This is the full Doorbell system, rewritten in plain **JavaScript**, with the same features and the same look as the main version (written in TypeScript). The code is in **9 source files** instead of about 50, and every file is commented so it can be read and debugged.

## Run it on your computer

You need [Node.js](https://nodejs.org) (version 20 or newer).

```bash
npm install      # once: downloads the packages (React, Firebase, ...)
npm run dev      # starts the app at http://localhost:5173
```

Press `Ctrl + C` in the terminal to stop it. `npm run build` makes the finished website in `dist/`.

## The files

| File | What is inside |
|---|---|
| `src/main.jsx` | Where the app starts: sign-in page, the frame around every page (menu), and the list of pages (routes) |
| `src/logic.js` | **The rules**: late or on time, school days, 3-day streaks, SMS wording, phone numbers, DepEd calendar, auto-assign. No screens, no database: the best place to start debugging |
| `src/engine.js` | **The engine**: holds the school's data and does every action (scan, confirm, alerts, texts, sections, students...). Also the sample school |
| `src/firebase.js` | Connection to Firebase (sign-in and database), first-time setup, "Load sample school". **`MODE`** here switches cloud / demo |
| `src/ui.jsx` | Shared pieces: cards, pop-ups, status chips, date picker, year calendar, class switcher |
| `src/teacher.jsx` | Teacher screens: Dashboard, Attendance, My Students, Calendar, Reports, Alerts, SMS Messages, Settings |
| `src/admin.jsx` | Admin screens: Overview, Absence Watch, School Calendar, Sections, Teachers, Students, ID Cards, Settings & SMS, Audit Log |
| `src/files.js` | Excel: attendance report download and student import |
| `src/style.css` | How everything looks (colors at the top) |
| `firestore.rules` | Who may read and write what in the database |
| `index.html`, `vite.config.js`, `package.json` | Project setup |
| `.github/workflows/deploy.yml` | Publishes the site to GitHub Pages on every push |

### How a screen gets its data

```
screen (teacher.jsx / admin.jsx)
   └─ useLive(r => r.getRoster(...))        ui.jsx: loads data and reloads on every change
        └─ Engine method (engine.js)         rules from logic.js, data in memory (engine.s)
             └─ persistence.put(...)         firebase.js: saves to Firestore (cloud mode)
```

## Firebase setup (once)

1. Firebase console → **Firestore Database → Rules** → paste `firestore.rules` → **Publish**.
2. **Authentication → Settings → Authorized domains** → add `eisen22.github.io`.
3. Open the app. The sign-in page shows **First-time setup**: create the admin account.
4. As admin, the Overview page offers **Load sample school** (4 teachers, 4 sections, 89 children, attendance since June 8). Sample teachers sign in with password `Teacher-2026!`.

**Demo mode** (no internet, sample data that resets): set `MODE = 'demo'` in `src/firebase.js`.

## Publish on GitHub Pages

GitHub → repository **Settings → Pages → Source: GitHub Actions**. Every push to `main` rebuilds the site at `https://eisen22.github.io/Doorbell-ph/`.

## Debugging tips

* **F12 → Console** shows errors with the file and line number. Vite keeps the original file names, so the line points into `src/...`.
* Look at the data while the app runs: type `doorbell.s.students` or `doorbell.session` in the console.
* Try a rule directly: `const L = await import('/src/logic.js'); L.classifyScan('08:20', { startTime: '08:00', scanWindowMins: 30, lateCutoffMins: 15 })`.
* `Missing or insufficient permissions` → `firestore.rules` blocked it (wrong role, or not that class's teacher).
* `useLive load skipped: ...` in the console → a screen's loading code threw an error; the message says why.
* The React Developer Tools browser extension shows each screen's state.
