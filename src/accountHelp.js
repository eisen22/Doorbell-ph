// =====================================================================
// accountHelp.js — THE WEBSITE'S CALLS TO THE SCHOOL SERVER FOR SIGN-IN AND ACCOUNT CHANGES
// ---------------------------------------------------------------------
// The Cloudflare Worker (worker/src/account.js) does what the website cannot do by itself:
//   * sign in with a parent's Gmail, or with a teacher's or admin's mobile number
//   * "Forgot password?": a reset link to the Gmail on file, or a new password by text
//   * a parent changing their mobile number or their Gmail
// SCHOOL_HELP is shown when someone cannot get in by themselves.
// =====================================================================
export const WORKER_URL = 'https://doorbell-worker.doorbell-ph.workers.dev';

// Who to contact when someone lost their number and cannot open their Gmail.
// PLACEHOLDER contact details for now: put the school's real email and number here.
export const SCHOOL_HELP = { email: 'sunnysideelementary@gmail.com', phone: '0917 123 4567' };

/** POSTs to the Worker; resolves to its answer ({ ok, error?, ... }). */
export async function callWorker(path, body) {
  let res;
  try {
    res = await fetch(`${WORKER_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    throw Object.assign(new Error('Cannot reach the school server. Check your internet connection and try again.'), { offline: true });
  }
  const data = await res.json().catch(() => null);
  if (!data) throw new Error('The school server did not answer. Try again in a minute.');
  return data;
}

export const looksLikeEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(s ?? '').trim());
/** '09171234567' -> '0917 ••• 4567' */
export const maskMobile = (key) => (key ? `${key.slice(0, 4)} ••• ${key.slice(7)}` : '');
/** 'dianne18@gmail.com' -> 'd•••••8@gmail.com' */
export const maskEmail = (e) => {
  const [user, host] = String(e ?? '').split('@');
  if (!host) return '';
  return `${user.slice(0, 1)}${'•'.repeat(Math.max(2, Math.min(6, user.length - 2)))}${user.length > 2 ? user.slice(-1) : ''}@${host}`;
};

/**
 * Asks the browser to save the sign-in (Chrome and Edge show "Save password?", and it is kept in the
 * Google account's Password Manager when the browser is signed in). Other browsers offer it by themselves
 * from the sign-in form. Never fails.
 */
export function offerToSavePassword(id, password) {
  try {
    if (window.PasswordCredential && navigator.credentials?.store) {
      navigator.credentials.store(new window.PasswordCredential({ id: String(id).trim(), password })).catch(() => {});
    }
  } catch {
    /* not supported */
  }
}
