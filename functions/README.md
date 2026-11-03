# Doorbell Cloud Functions (real SMS + scheduled auto-confirm)

Two small jobs that run on Google's servers, not in anyone's browser:

| Function | When it runs | What it does |
|---|---|---|
| `sendSms` | Every time a text is saved with status `queued` | Sends it through **Semaphore**, then marks it `sent` (with Semaphore's message id) or `failed` (with the reason, and an alert for the teacher) |
| `autoConfirm` | Every 15 minutes, 6 AM to 6 PM, Monday to Saturday (Philippine time) | Confirms each class after its auto-confirm time, even if nobody has Doorbell open. Unscanned children become absent and 3-day texts go out. Uses the same rules as the website (`src/engine.js`) |

The Semaphore API key is saved as a **Firebase secret**. It is never written in the code, in
`firestore.rules`, or on GitHub.

## Before you start

* **Firebase Blaze plan.** Cloud Functions (and calling Semaphore from them) need it. Blaze is
  pay-as-you-go with a free monthly allowance (2 million function runs, 3 scheduled jobs);
  a school of this size stays inside it. You still have to add a payment card.
  Firebase console → bottom-left **Upgrade** → **Blaze** → link or create a billing account.
  Then set a budget alert: Google Cloud console → Billing → **Budgets & alerts** → e.g. ₱50 per month.
* **Semaphore account** with credits (semaphore.co → Dashboard → **Buy credits**). 1 credit = 1 SMS
  of up to 160 characters.
* **Node.js 22** on your computer (`node -v` should say v22 or newer).

## 1. Semaphore: get the API key and a sender name

1. Sign in at **semaphore.co** and open the **API** page of your dashboard. Copy the **API key**
   (a long string of letters and numbers). Treat it like a password.
2. **Sender Names** → **Add Sender Name** → e.g. `SUNNYSIDE` (max 11 letters). It takes a few
   working days to be approved by the networks. Until then Semaphore uses its default sender name.
3. Buy a small amount of credits for testing.

## 2. Install the Firebase tools (once)

In PowerShell:

```powershell
npm install -g firebase-tools
firebase login
cd C:\Users\diego\Documents\Doorbell-ph
firebase use doorbell-ph-f12d0
```

## 3. Save the API key as a secret

```powershell
firebase functions:secrets:set SEMAPHORE_API_KEY
```

Paste the API key when it asks (nothing shows while you paste) and press Enter.

## 4. Deploy the functions and the rules

```powershell
cd C:\Users\diego\Documents\Doorbell-ph\functions
npm install
cd ..
firebase deploy --only functions,firestore:rules
```

The first deploy takes a few minutes and may ask to turn on some Google APIs: answer **Yes**.
When it finishes it lists `sendSms` and `autoConfirm`.

## 5. Switch Doorbell to real texts

1. Website → sign in as admin → **Settings & SMS**.
2. **How texts are sent** → **Semaphore (real SMS, uses credits)**.
3. **Sender name**: the approved name, or leave empty for your account's default.
4. **Save changes**.
5. **Send a test SMS to** your own number → **Send test**. Within a few seconds the phone gets it,
   and **SMS Messages** shows it as **Sent**. On semaphore.co → **Messages** it appears too.

To go back to demo texts (nothing sent, no credits used), choose **Simulated** again.

## Checking and fixing

* See what happened: `firebase functions:log` (or Firebase console → Functions → **Logs**).
* A text stays **Sending** → the functions are not deployed, or the Blaze plan is off.
* A text is **Failed** → open it on the SMS Messages page: "Why it failed" shows Semaphore's reason
  (wrong number, no credits, sender name not approved...). Fix it, then press **Resend**.
* Messages that start with the word `TEST` are silently skipped by Semaphore: don't start a
  template with it.
* Changed the API key? Run step 3 again, then `firebase deploy --only functions`.

## The files

| File | What is inside |
|---|---|
| `index.js` | Both functions, with comments |
| `package.json` | The libraries, and the `build` script: esbuild bundles `index.js` together with `../src/engine.js` and `../src/logic.js` into `lib/index.js` (that bundle is what is uploaded) |
| `../firebase.json`, `../.firebaserc` | Which Firebase project and which folders `firebase deploy` uses |
