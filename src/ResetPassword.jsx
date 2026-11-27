// =====================================================================
// ResetPassword.jsx — TWO SMALL PAGES OPENED FROM AN EMAIL (no sign-in needed)
// ---------------------------------------------------------------------
//   /reset?oobCode=...          "Set a new password" from the "Forgot password?" email (worker/src/account.js).
//                                The code is Firebase's own one-time reset code: it works once and expires
//                                after 1 hour. Firebase checks it (verifyPasswordResetCode) and saves the new
//                                password (confirmPasswordReset). Then the person signs in again.
//   /confirm-email?token=...    "Confirm this Gmail" from the email sent when a parent changes their Gmail
//                                in the parent portal: the Worker saves the new Gmail.
// =====================================================================
import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getApps, initializeApp } from 'firebase/app';
import { getAuth, verifyPasswordResetCode, confirmPasswordReset } from 'firebase/auth';
import { KeyRound, CheckCircle2, AlertTriangle, MailCheck } from 'lucide-react';
import { Logo, Wordmark, PasswordInput } from './ui';
import { firebaseConfig, cloudConfigured } from './firebase';
import { callWorker, maskMobile, maskEmail, SCHOOL_HELP } from './accountHelp';
import { PARENT_EMAIL_DOMAIN } from './logic';

// A separate copy of Firebase, so this page never touches a sign-in kept on this device.
const resetAuth = () => getAuth(getApps().find((a) => a.name === 'reset') ?? initializeApp(firebaseConfig, 'reset'));
const setLoginAs = (who) => {
  try {
    localStorage.setItem('doorbell-login-as', who);
  } catch {
    /* storage blocked */
  }
};

function Card({ children }) {
  return (
    <div className="login-wrap">
      <div className="login-card single">
        <section className="login-form">
          <div className="login-brand-row">
            <Logo size={34} />
            <Wordmark height={21} />
          </div>
          {children}
          <p className="muted small">
            Need help? Contact the school: <a href={`mailto:${SCHOOL_HELP.email}`}>{SCHOOL_HELP.email}</a> or {SCHOOL_HELP.phone}.
          </p>
        </section>
      </div>
    </div>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const code = params.get('oobCode') ?? '';
  const [step, setStep] = useState('checking'); // 'checking' | 'form' | 'bad' | 'done'
  const [account, setAccount] = useState(null); // { who: 'parent' | 'staff', shown, username }
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    document.title = 'Set a new password · Doorbell';
    if (!code || !cloudConfigured()) return setStep('bad');
    verifyPasswordResetCode(resetAuth(), code)
      .then((email) => {
        const parent = email.endsWith(`@${PARENT_EMAIL_DOMAIN}`);
        const number = parent ? email.slice(1, 12) : null;
        setAccount(parent ? { who: 'parent', shown: maskMobile(number), username: number } : { who: 'staff', shown: maskEmail(email), username: email });
        setStep('form');
      })
      .catch(() => setStep('bad'));
  }, [code]);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (a.length < 8) return setError('Use at least 8 characters.');
    if (a !== b) return setError("The two passwords don't match.");
    setBusy(true);
    try {
      await confirmPasswordReset(resetAuth(), code, a);
      setLoginAs(account.who);
      setStep('done');
    } catch (err) {
      const c = err?.code ?? '';
      if (c.includes('expired') || c.includes('invalid-action-code')) setStep('bad');
      else setError(c.includes('weak-password') ? 'That password is too weak. Use at least 8 characters.' : c.includes('network') ? 'No internet connection. Try again.' : err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      {step === 'checking' && <p className="muted">Checking the link…</p>}
      {step === 'bad' && (
        <>
          <h1>
            <AlertTriangle size={24} aria-hidden="true" /> Link not valid
          </h1>
          <p>This link has expired or was already used. Request a new one: on the sign-in page, type your mobile number or email and press "Forgot password?".</p>
          <Link className="btn btn-ink wide" to="/login">
            Back to sign in
          </Link>
        </>
      )}
      {step === 'form' && (
        <form onSubmit={submit} autoComplete="on">
          <h1>
            <KeyRound size={24} aria-hidden="true" /> New password
          </h1>
          <p className="muted">For {account.shown}</p>
          {/* Lets the browser's password manager update the saved password for this account. */}
          <input type="text" name="username" autoComplete="username" value={account.username} readOnly hidden />
          <label className="field">
            <span>New password</span>
            <PasswordInput name="new-password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} autoFocus />
          </label>
          <label className="field">
            <span>Type it again</span>
            <PasswordInput autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} />
          </label>
          <p className="muted small">At least 8 characters. Don't use your child's name or birthday.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-ink wide" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save new password'}
          </button>
        </form>
      )}
      {step === 'done' && (
        <>
          <h1>
            <CheckCircle2 size={24} aria-hidden="true" /> Password changed
          </h1>
          <p>Sign in with your new password. Other devices signed in to this account will need to sign in again.</p>
          <Link className="btn btn-ink wide" to="/login">
            Sign in
          </Link>
        </>
      )}
    </Card>
  );
}

export function ConfirmEmail() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [st, setSt] = useState({ step: 'working' });
  const once = useRef(false);
  useEffect(() => {
    document.title = 'Confirm your Gmail · Doorbell';
    if (once.current) return; // the link works once: don't send it twice (React may run this twice in development)
    once.current = true;
    callWorker('/account/confirm-gmail', { token })
      .then((r) => setSt(r.ok ? { step: 'done', email: r.email } : { step: 'bad', error: r.error }))
      .catch((e) => setSt({ step: 'bad', error: e.message }));
  }, [token]);
  return (
    <Card>
      {st.step === 'working' && <p className="muted">Confirming your Gmail…</p>}
      {st.step === 'done' && (
        <>
          <h1>
            <MailCheck size={24} aria-hidden="true" /> Gmail confirmed
          </h1>
          <p>
            {st.email} is now the Gmail of your parent portal account. You can sign in with Google using it, and a forgotten password can be reset
            through it.
          </p>
          <Link className="btn btn-ink wide" to="/login">
            Go to sign in
          </Link>
        </>
      )}
      {st.step === 'bad' && (
        <>
          <h1>
            <AlertTriangle size={24} aria-hidden="true" /> Not confirmed
          </h1>
          <p>{st.error}</p>
          <Link className="btn btn-ink wide" to="/login">
            Back to sign in
          </Link>
        </>
      )}
    </Card>
  );
}
