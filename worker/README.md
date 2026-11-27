# Doorbell Worker (free, on Cloudflare)

This small program runs on Cloudflare's **free plan**, every minute, even when nobody has Doorbell open.
You don't need the Firebase Blaze plan or a credit card.

It does two things:

1. **Sends real texts through Semaphore.** This works when *Settings & SMS → How texts are sent* is set to **Semaphore**. Every text Doorbell saves as "Sending" goes out within about a minute. It is then marked *Sent*, or *Failed* with Semaphore's reason, and the teacher gets an alert.
2. **Does the class work on time, even when nobody has Doorbell open.** It runs every 5 minutes from 6 AM to 6 PM, Monday to Saturday, Philippine time. It never confirms a class in the morning: only a teacher does. For a class a teacher confirmed, it queues the absence texts ("has not arrived at school") and the 3-day and limit texts at the section's absence text time (end of first period). A class nobody confirmed is closed quietly after it ends: scanned children are recorded, the rest absent, no parent texts, and staff get an alert. It uses the same rules as the website (`src/engine.js`).

The Worker signs in to Firebase with a normal Doorbell **gate account**, so `firestore.rules` limits what it can do, the same as for any user. Passwords and the Semaphore API key are saved as Cloudflare secrets. They are never put in this folder or on GitHub.

## Free plan limits (plenty for one school)

- **Cloudflare:** 100,000 runs a day. This Worker uses about 1,440.
- **Firebase Spark:** 50,000 reads a day. When Semaphore is on, the text check reads 1 document a minute plus the texts waiting. Each auto-confirm check reads a few documents. The full load happens only once per class per day.
- **Semaphore:** ₱0.56 + VAT per text of up to 160 characters, from your Semaphore credits.

## Set it up once (about 15 minutes)

You need Node.js (already installed for the website) and the Doorbell-ph folder.

1. **Create a free Cloudflare account** at <https://dash.cloudflare.com/sign-up>.

2. **Create a separate account for the Worker.** In Doorbell, sign in as the admin and go to *Settings & SMS → Gate scanner phone*. Create a gate account, for example `worker@yourschool.ph`, with a long random password. Use a *new* account instead of the gate phone's, so either one can be changed without affecting the other.

3. **Publish the updated rules.** In the Firebase console, open *Firestore Database → Rules*, paste all of `firestore.rules`, and click **Publish**. The new rules let a gate account save auto-confirmations.

4. **Install and sign in to Cloudflare.** In PowerShell:
   ```powershell
   cd C:\Users\diego\Documents\Doorbell-ph\worker
   npm install
   npx wrangler login
   ```
   A browser window opens. Click **Allow**.

5. **Save the three secrets.** Each command asks you to type the value, which is not shown on screen:
   ```powershell
   npx wrangler secret put GATE_EMAIL
   npx wrangler secret put GATE_PASSWORD
   npx wrangler secret put SEMAPHORE_API_KEY
   ```
   - `GATE_EMAIL` and `GATE_PASSWORD` are the account from step 2.
   - The Semaphore API key is on <https://semaphore.co> under *Account → API*.
   - If wrangler asks whether to create the Worker first, answer **yes**.

6. **Deploy:**
   ```powershell
   npx wrangler deploy
   ```
   It prints an address like `https://doorbell-worker.<you>.workers.dev`. Opening it shows "Doorbell worker is running."

7. **Turn on Semaphore in Doorbell.** Go to *Settings & SMS → How texts are sent*, choose **Semaphore**, and click **Save**. If you registered a sender name with Semaphore, type it in *Sender name*. Otherwise leave it empty and Semaphore uses its default.

8. **Test it.** Use *Send a test text* to your own number. Within a minute it should change from *Sending* to *Sent*, and you should get the text. To watch the Worker live:
   ```powershell
   npx wrangler tail
   ```

## If something goes wrong

| What you see | What to do |
|---|---|
| Texts stay **Sending** | Check `npx wrangler tail`. "Sign-in failed" means GATE_EMAIL or GATE_PASSWORD is wrong (step 5). "SEMAPHORE_API_KEY secret is missing" means you need to redo step 5. |
| Text **Failed**: "not a Philippine mobile number" | Fix the guardian's number (09XX XXX XXXX) on the Students page, then press **Resend**. |
| Text **Failed** with a Semaphore message about credits or the sender name | Buy credits on Semaphore, or clear *Sender name* until Semaphore approves yours. |
| Absence texts or the end-of-day close don't happen | `npx wrangler tail` shows "Missing or insufficient permissions" when step 3 (Publish rules) was skipped. |
| "Exceeded CPU limit" in the logs | This is unlikely for one school. The next run continues where it stopped. |

## Turning it off

- **To stop real texts:** set *How texts are sent* back to **Simulated** or **Gate phone**. The Worker skips sending, but auto-confirm keeps running.
- **To stop everything:** run `npx wrangler delete`.

## For developers

- `npm test` runs the Worker against a fake Firestore and a fake Semaphore. It needs no internet.
- `src/index.js` holds the schedule, Semaphore sending (only to a child's guardian number on file) and the class work. `src/firestore.js` is the Firestore REST helper.
- The Worker reuses `../src/engine.js` and `../src/logic.js`. A change in how the website confirms days changes the Worker too, after `npx wrangler deploy`.

## Email alerts for new messages (optional, free)

When a parent, a teacher or the office writes in **Messages**, the teachers and the school office in that
conversation get an email a few minutes later *if they haven't opened it yet*: "Althea Dela Cruz sent you a
message in Doorbell about Daniel", with a link. The email never contains the message itself. Parents are not
emailed. Teachers can turn it off in *Settings → Email alerts*; the office gets them only if *Settings → School
office email* is filled in. Emails go out from 6 AM to 9 PM (Philippine time), at most 10 every 5 minutes.

It uses **Brevo**'s free plan (300 emails a day, no credit card):

1. Sign up at <https://www.brevo.com> (free plan).
2. Add the sender: *Senders, domains & dedicated IPs → Senders → Add a sender*, e.g. the school's Gmail, and
   click the link Brevo emails to that address. (With a Gmail sender, Brevo may show a Brevo address as the
   sender to pass Gmail's checks; with the school's own domain, authenticate it there instead.)
3. Make an API key: *SMTP & API → API keys → Generate a new API key*.
4. Save both in Cloudflare and deploy:
   ```powershell
   cd C:\Users\diego\Documents\Doorbell-ph\worker
   npx wrangler secret put BREVO_API_KEY
   npx wrangler secret put EMAIL_FROM
   npx wrangler deploy
   ```
   (EMAIL_FROM = the sender address from step 2.)

Check it: send a message as a parent, wait about 10 minutes without opening it as the teacher, then look in the
teacher's Gmail (and Spam). `npx wrangler tail` shows "Brevo refused an email" if something is wrong.

## New passwords by text (parents, and staff without a Gmail address)

When the admin adds a parent number (or a teacher or admin with a mobile number), or someone presses
"Forgot password?" and accepts, the Worker makes a random password, sets it on the account and texts it.
The password is never saved in Firestore; the SMS log shows it hidden. Accounts with a Gmail (or a staff
member's real email) get a reset link instead (see "Forgot password and account changes" below). This needs the Firebase **service account** key, because only a trusted
server may set someone else's password:

1. Firebase console → Project settings → **Service accounts** → **Generate new private key**. A `.json` file downloads.
2. In this `worker` folder:
   ```
   npx wrangler secret put FIREBASE_SERVICE_ACCOUNT
   ```
   Paste the whole contents of the `.json` file and press Enter.
3. Delete the downloaded file, or keep it somewhere safe outside this project. Never commit it.
4. Publish the newest `firestore.rules` (it adds `passwordRequests`).

`npx wrangler tail` shows "Password step failed" or `passwords: "skipped (FIREBASE_SERVICE_ACCOUNT is not set)"` if something is missing.
"Forgot password?" for the same account works at most once every 5 minutes.

### By email too (with Brevo)

When the account has a real email address, the password is also emailed (same password as the text):

- a **new** parent whose guardian has a Gmail (Admin → Students → Gmail): "your account was created" email;
- a **new** teacher or admin: the welcome email, with a **Confirm this email address** link (Firebase);
  a teacher or admin with no mobile number now gets the password by email only;
- **Send new password** (admin): by text and by email.

"Forgot password?" sends a reset link instead (below). If neither a mobile number nor a real email (and Brevo)
is available, the password is not changed. For the confirm link to
open the sign-in page afterwards, the website's domain must be in Firebase → Authentication → Settings →
Authorized domains (it already is if Google sign-in works).

## Forgot password and account changes (`src/account.js`)

The website calls the Worker's address directly (`https://doorbell-worker.doorbell-ph.workers.dev`, set in
`src/accountHelp.js`). Only the website's own address (`SITE_URL`) and `localhost` may call it.

| Address | What it does |
|---|---|
| `POST /auth/forgot` | Mobile number or email. With a Gmail on file (or a staff real email): an email with **Set a new password**, a link to the website's `/reset` page (Firebase's one-time code, 1 hour). The old password works until a new one is chosen. Without one: a new password by text. Once per account every 5 minutes; the answer never says whether the account exists. |
| `POST /auth/signin` | A parent's Gmail or a teacher's/admin's mobile number with the password: if the password is right, answers which sign-in to use. 10 wrong tries = 15 minutes wait. |
| `POST /account/change-number` | A signed-in parent (password typed again in the last 10 minutes) changes their number. Their sign-in account, parent portal, Gmail link and conversations move to the new number. Notices go to the old number, the new number and the Gmail. |
| `POST /account/change-gmail` and `/account/confirm-gmail` | A signed-in parent asks for a new Gmail; a link is sent TO the new Gmail and opening it (website page `/confirm-email`) makes the change. A notice goes to the old Gmail and the number. |

The admin's changes go through `accountChanges/{id}` (checked every minute): **Admin → Students → Change number**
(the same move as above) and **Admin → Teachers → Change email** (a teacher who lost their Gmail; same account and
password). Wait times and confirm links are kept in `limits/` and `emailChanges/`, which only the Worker can read.

Needs `FIREBASE_SERVICE_ACCOUNT`, `BREVO_API_KEY`, `EMAIL_FROM` and `SITE_URL`, and the newest `firestore.rules`
(it adds `accountChanges`). Test without the internet: `npm test` (runs `test.mjs` and `test-account.mjs`).

## Demo switch: everything every minute (for the defense)

In `wrangler.toml`, set `FAST_MODE = "1"` and run `npx wrangler deploy`. The class work (absence texts, "class not
confirmed" alerts, closing classes) then runs every minute instead of every 5, and nothing slows down at night.
Afterwards set it back to `"0"` and deploy again: fast mode uses more of the free 50,000 database reads a day.

## At night

From 10 PM to 5 AM the Worker checks for texts and password requests every 5 minutes instead of every minute
(each check costs database reads). Texts are still sent at night, e.g. a suspension announced late.

## Classes not confirmed yet (alert to the office and the adviser)

Parents get the arrival and absence texts only after a teacher confirms the class. If no teacher has
confirmed a class **15 minutes after it started** (Settings → School & attendance → "Alert if a class is not confirmed
after", 0 = off), the Worker, once per class per day:

- puts an alert on the website (admin Overview → "Needs your attention", and the teacher's Alerts);
- emails the adviser (and today's substitute) and the school office email (needs `BREVO_API_KEY` and `EMAIL_FROM`);
- texts the adviser's mobile, and sends ONE text to the school's contact number listing all the classes of that
  run (needs Settings → How texts are sent = Semaphore).

At most 4 classes are alerted per run (the rest 5 minutes later), to stay within the 50 web requests a run may
make. A teacher or the admin can still confirm the class until it ends; the waiting texts are then sent.

## The gate scanner (ESP32 + GM65)

The scanner never holds Firebase access. In the website, **Settings → Admins & gate scanners → Gate scanners → Add scanner** makes a
scanner key, shown once (only its SHA-256 is saved). Put it in the scanner. **Cancel key** stops a lost or
copied key at once. Publish `firestore.rules` after updating (it adds `scanners`).

The scanner sends the key as `Authorization: Bearer <key>` to the Worker's address:

| Request | Body | Answer |
|---|---|---|
| `GET /scanner/cards` | | `{ ok, updatedAt, hashes: [...] }` the SHA-256 (hex) of every valid card code |
| `POST /scanner/scan` | `{ "code": "<QR text>", "at": "<ISO time, optional>" }` | `{ ok, result, name, time }` |

`result` is `present`, `late`, `out` (going home), `already_in`, `no_class_today`, `unknown`, `revoked`,
`no_class_found` or `old_scan` (kept from an earlier day: not recorded). `bad_key` comes with status 401;
`server_error` with status 503 (keep the scan and try again).

Suggested scanner program:

1. On start-up and every 30 minutes, download `/scanner/cards` and keep the hashes in flash (LittleFS).
2. On each scan: SHA-256 the code, beep "accepted" or "not a Doorbell card" at once from the saved list.
3. Save the scan (code + time from the DS3231 clock) in a queue file, then send it with `at`. Remove it from the
   queue when the answer is 200 (any `result`) or 401; keep it on 503 or no connection and retry.
4. Run on a power bank or a small UPS so scanning continues during brownouts.

Each scan uses about 7 database reads (the meta documents are kept in the Worker's memory for 5 minutes), so
600 pupils scanning in and out use about 8,000 of the free 50,000 daily reads.
