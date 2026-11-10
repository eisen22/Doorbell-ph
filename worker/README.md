# Doorbell Worker (free, on Cloudflare)

This small program runs on Cloudflare's **free plan**, every minute, even when nobody has Doorbell open.
You don't need the Firebase Blaze plan or a credit card.

It does two things:

1. **Sends real texts through Semaphore.** This works when *Settings & SMS → How texts are sent* is set to **Semaphore**. Every text Doorbell saves as "Sending" goes out within about a minute. It is then marked *Sent*, or *Failed* with Semaphore's reason, and the teacher gets an alert.
2. **Auto-confirms classes on time.** It runs every 5 minutes from 6 AM to 6 PM, Monday to Saturday, Philippine time. Each class is confirmed after its own auto-confirm time. Unscanned children are marked absent, and the 3-day absence texts are sent. It uses the same rules as the website (`src/engine.js`).

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
| Auto-confirm doesn't happen | `npx wrangler tail` shows "Missing or insufficient permissions" when step 3 (Publish rules) was skipped. |
| "Exceeded CPU limit" in the logs | This is unlikely for one school. The next run continues where it stopped. |

## Turning it off

- **To stop real texts:** set *How texts are sent* back to **Simulated** or **Gate phone**. The Worker skips sending, but auto-confirm keeps running.
- **To stop everything:** run `npx wrangler delete`.

## For developers

- `npm test` runs the Worker against a fake Firestore and a fake Semaphore. It needs no internet.
- `src/index.js` holds the schedule, Semaphore sending and auto-confirm. `src/firestore.js` is the Firestore REST helper.
- The Worker reuses `../src/engine.js` and `../src/logic.js`. A change in how the website confirms days changes the Worker too, after `npx wrangler deploy`.
