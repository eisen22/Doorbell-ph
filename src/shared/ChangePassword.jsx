import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useRepo, PasswordInput } from '../ui';

// =====================================================================
// CHANGE PASSWORD (teacher Settings, and the admin's Settings -> Admins & gate phone):
// the current password, then the new one twice. Each box has Show / Hide.
// "Forgot it?" sends a reset link to the email instead.
// =====================================================================
export function ChangePassword({ email }) {
  const repo = useRepo();
  const [current, setCurrent] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [error, setError] = useState(null);
  const save = async (e) => {
    e.preventDefault();
    setMsg(null);
    setError(null);
    if (a !== b) return setError('The two new passwords are not the same.');
    setBusy(true);
    try {
      await repo.changePassword(current, a);
      setCurrent('');
      setA('');
      setB('');
      setMsg('Password changed. Use the new one next time you sign in.');
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  };
  const forgot = async () => {
    setMsg(null);
    setError(null);
    try {
      await repo.sendPasswordReset(email);
      setMsg(`A password reset link was sent to ${email}.`);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <form className="change-pw" onSubmit={save}>
      <label className="field">
        <span>Current password</span>
        <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      </label>
      <label className="field">
        <span>New password</span>
        <PasswordInput autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} required />
      </label>
      <label className="field">
        <span>Type the new password again</span>
        <PasswordInput autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} required />
      </label>
      <p className="muted small">At least 8 characters.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {msg && (
        <p className="ok-note" role="status">
          {msg}
        </p>
      )}
      <div className="change-pw-actions">
        <button className="btn btn-ink" disabled={busy || !current || !a || !b}>
          <KeyRound size={16} /> {busy ? 'Saving…' : 'Save new password'}
        </button>
        <button type="button" className="link-btn" onClick={forgot}>
          Forgot your current password? Send a reset link
        </button>
      </div>
    </form>
  );
}
