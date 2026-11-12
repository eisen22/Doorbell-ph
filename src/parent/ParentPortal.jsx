// =====================================================================
// parent/ParentPortal.jsx — THE PARENT PORTAL (/parent)
// ---------------------------------------------------------------------
// A phone-first page for parents: sign in with the mobile number + password, then see each child's
// CONFIRMED attendance (calendar, month and semester totals) and send an excuse request to the teacher.
// Screens: SignIn -> Home (one tab per child) -> ExcuseForm / ChangePassword.
// The data comes from parentCloud.js (not from the engine: parents never load the whole school).
// =====================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, FileText, KeyRound, LogIn, LogOut, Send } from 'lucide-react';
import { Logo, StatusChip, DatePicker, longDate } from '../ui';
import { addDays, isoWeekday, manilaToday, to12h, EXCUSE_REASONS } from '../logic';
import { changeParentPassword, portalAvailable, sendExcuse, signInParent, signOutParent, watchParent } from './parentCloud';

const STATUS_WORD = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const prevMonth = (m) => addDays(`${m}-01`, -1).slice(0, 7);
const nextMonth = (m) => addDays(`${m}-28`, 7).slice(0, 7);

export function ParentPortal() {
  const [st, setSt] = useState({ status: 'loading' });
  useEffect(() => {
    if (!portalAvailable()) return setSt({ status: 'unavailable' });
    return watchParent(setSt);
  }, []);
  useEffect(() => {
    document.title = 'Doorbell Parent Portal';
  }, []);
  return (
    <div className="pp">
      {st.status === 'unavailable' && (
        <Shell>
          <p className="pp-card">The parent portal works only when the website is connected to the cloud (MODE = 'cloud' in firebase.js).</p>
        </Shell>
      )}
      {st.status === 'loading' && (
        <Shell>
          <p className="pp-muted pp-center">Loading…</p>
        </Shell>
      )}
      {st.status === 'error' && (
        <Shell onSignOut={signOutParent}>
          <p className="pp-card pp-error" role="alert">
            Something went wrong: {st.error}
          </p>
        </Shell>
      )}
      {st.status === 'signedOut' && <SignIn />}
      {st.status === 'ready' && <Home st={st} />}
    </div>
  );
}

function Shell({ children, school, onSignOut }) {
  return (
    <div className="pp-wrap">
      <header className="pp-head">
        <Logo size={36} />
        <div className="pp-head-text">
          <strong>Doorbell</strong>
          <span>{school || 'Parent portal'}</span>
        </div>
        {onSignOut && (
          <button type="button" className="pp-link" onClick={onSignOut}>
            <LogOut size={16} aria-hidden="true" /> Sign out
          </button>
        )}
      </header>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------
// SIGN IN: mobile number + password. The first time, the password is the default password.
// ---------------------------------------------------------------------
function SignIn() {
  // ?m=09171234567: sent here from the staff sign-in page with the number already typed.
  const [mobile, setMobile] = useState(() => new URLSearchParams(window.location.search).get('m') ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signInParent(mobile, password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Shell>
      <h1 className="pp-h1">Parent portal</h1>
      <p className="pp-muted">See your child's attendance and send excuse notes to the teacher.</p>
      <form className="pp-card pp-form" onSubmit={submit}>
        <label className="pp-field">
          <span>Mobile number</span>
          <input
            className="input"
            type="tel"
            inputMode="tel"
            autoComplete="username"
            placeholder="0917 123 4567"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            autoFocus={!mobile}
          />
        </label>
        <label className="pp-field">
          <span>Password</span>
          <div className="pw">
            <input
              className="input"
              type={show ? 'text' : 'password'}
              autoFocus={!!mobile}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button type="button" className="icon-btn sm" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-ink wide pp-big" type="submit" disabled={busy}>
          <LogIn size={18} aria-hidden="true" /> {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <section className="pp-help">
        <strong>First time signing in?</strong>
        <p>Use the mobile number the school has on file. Your default password is your child's initials (first, middle, last name) and birthday (MMDDYY), in small letters.</p>
        <p>
          Example: <b>Alice Pati Garcia</b>, born Aug 13, 2021 → <code>apg081321</code>
        </p>
        <p>Two or more children at this school? Use the eldest child's.</p>
        <p>Forgot your password? Ask your child's teacher or the school office to reset it.</p>
      </section>
      <p className="pp-muted pp-center pp-small">
        School staff? <Link to="/login">Sign in here</Link>
      </p>
    </Shell>
  );
}

// ---------------------------------------------------------------------
// HOME: one tab per child, the default-password warning, today, the calendar, totals, excuse requests.
// ---------------------------------------------------------------------
function Home({ st }) {
  const children = st.key?.children ?? [];
  const [childId, setChildId] = useState(children[0]?.id ?? null);
  const [screen, setScreen] = useState('home'); // 'home' | 'excuse' | 'password'
  const [flash, setFlash] = useState(null);
  useEffect(() => {
    if (!children.some((c) => c.id === childId)) setChildId(children[0]?.id ?? null);
  }, [children, childId]);
  useEffect(() => {
    if (!flash) return undefined;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash]);
  const child = children.find((c) => c.id === childId);
  const docs = (childId && st.months?.[childId]) || [];
  const latest = docs[docs.length - 1];
  const school = latest?.schoolName;

  if (screen === 'password')
    return (
      <Shell school={school}>
        <ChangePassword
          codeHash={st.key?.codeHash}
          onDone={() => {
            setScreen('home');
            setFlash('Password changed.');
          }}
          onBack={() => setScreen('home')}
        />
      </Shell>
    );
  if (screen === 'excuse' && child)
    return (
      <Shell school={school}>
        <ExcuseForm
          child={child}
          docs={docs}
          excuses={st.excuses ?? []}
          guardianName={st.key?.guardianName}
          onDone={() => {
            setScreen('home');
            setFlash(`Excuse request sent to ${latest?.teacherName ?? 'the teacher'}.`);
          }}
          onBack={() => setScreen('home')}
        />
      </Shell>
    );

  return (
    <Shell school={school} onSignOut={signOutParent}>
      {st.profile?.defaultPassword && (
        <section className="pp-warn" role="alert">
          <AlertTriangle size={20} aria-hidden="true" />
          <div>
            <strong>You're still using the default password</strong>
            <p>Anyone who knows your child's name and birthday could sign in. Please change it.</p>
            <button type="button" className="pp-warn-btn" onClick={() => setScreen('password')}>
              <KeyRound size={15} aria-hidden="true" /> Change password
            </button>
          </div>
        </section>
      )}
      {flash && (
        <p className="pp-flash" role="status">
          {flash}
        </p>
      )}
      {!children.length && (
        <p className="pp-card">No child is linked to this number yet. Ask your child's teacher to check the mobile number on file.</p>
      )}
      {children.length > 1 && (
        <div className="pp-tabs" role="tablist" aria-label="Your children">
          {children.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={c.id === childId} className={c.id === childId ? 'on' : ''} onClick={() => setChildId(c.id)}>
              {c.firstName}
            </button>
          ))}
        </div>
      )}
      {child && <ChildView child={child} docs={docs} excuses={(st.excuses ?? []).filter((x) => x.studentId === child.id)} onExcuse={() => setScreen('excuse')} />}
      <div className="pp-foot">
        {!st.profile?.defaultPassword && (
          <button type="button" className="pp-link" onClick={() => setScreen('password')}>
            <KeyRound size={15} aria-hidden="true" /> Change password
          </button>
        )}
      </div>
    </Shell>
  );
}

function ChildView({ child, docs, excuses, onExcuse }) {
  const today = manilaToday();
  const thisMonth = today.slice(0, 7);
  const byMonth = useMemo(() => new Map(docs.map((d) => [d.month, d])), [docs]);
  const latest = docs[docs.length - 1];
  const first = docs[0]?.month ?? thisMonth;
  const last = latest && latest.month > thisMonth ? latest.month : thisMonth;
  const [month, setMonth] = useState(byMonth.has(thisMonth) || !latest ? thisMonth : latest.month);
  const [picked, setPicked] = useState(today);
  useEffect(() => {
    setPicked(today);
  }, [child.id, today]);
  const cur = byMonth.get(thisMonth);
  const todayRec = cur?.days?.[today];
  const todayNoClass = cur?.noClass?.[today];
  const weekend = isoWeekday(today) >= 6;
  const totals = cur?.totals ?? latest?.totals;
  const monthTotals = cur?.totals?.month ?? { absent: 0, late: 0, excused: 0 };
  const name = `${child.firstName} ${child.lastName}`;

  return (
    <>
      <section className="pp-card pp-child">
        <div className="pp-child-row">
          <span className="avatar" aria-hidden="true">
            {(child.firstName[0] ?? '') + (child.lastName[0] ?? '')}
          </span>
          <div>
            <strong className="pp-name">{name}</strong>
            <span className="pp-muted pp-small">
              {[latest?.sectionName, latest?.teacherName && `Adviser: ${latest.teacherName}`].filter(Boolean).join(' · ') || 'Class not set yet'}
            </span>
          </div>
        </div>
        <div className={`pp-today ${todayRec ? `pp-today-${todayRec.s}` : ''}`}>
          <strong>Today, {shortDay(today)}</strong>
          <span>
            {todayRec
              ? `${STATUS_WORD[todayRec.s]}${todayRec.t ? `, arrived ${to12h(todayRec.t)}` : ''}. Confirmed by the teacher.`
              : todayNoClass
                ? `No class: ${todayNoClass}.`
                : weekend
                  ? 'No class today.'
                  : 'Not confirmed yet. It shows here after the teacher confirms attendance.'}
          </span>
        </div>
      </section>

      <section className="pp-card">
        <div className="pp-cal-head">
          <button type="button" className="icon-btn" onClick={() => setMonth(prevMonth(month))} disabled={month <= first} aria-label="Previous month">
            <ChevronLeft size={18} />
          </button>
          <h2>{monthName(month)}</h2>
          <button type="button" className="icon-btn" onClick={() => setMonth(nextMonth(month))} disabled={month >= last} aria-label="Next month">
            <ChevronRight size={18} />
          </button>
        </div>
        <MonthGrid month={month} doc={byMonth.get(month)} today={today} picked={picked} onPick={setPicked} />
        <p className="pp-day-info" aria-live="polite">
          {dayInfo(picked, byMonth.get(picked.slice(0, 7)), today)}
        </p>
        <div className="pp-legend" aria-hidden="true">
          <span><i className="d-present" />Present</span>
          <span><i className="d-late" />Late</span>
          <span><i className="d-absent" />Absent</span>
          <span><i className="d-excused" />Excused</span>
          <span><i className="d-noclass" />No class</span>
        </div>
      </section>

      <section className="pp-totals">
        <div className="pp-card">
          <span className="pp-muted pp-small">This month</span>
          <strong className="t-absent">{monthTotals.absent} absent</strong>
          <strong className="t-late">{monthTotals.late} late</strong>
          {monthTotals.excused > 0 && <span className="t-excused">{monthTotals.excused} excused</span>}
        </div>
        <div className="pp-card">
          <span className="pp-muted pp-small">This semester</span>
          <strong className="t-absent">{totals?.semester.absent ?? 0} absent</strong>
          <strong className="t-late">{totals?.semester.late ?? 0} late</strong>
          {totals?.semester.excused > 0 && <span className="t-excused">{totals.semester.excused} excused</span>}
        </div>
      </section>

      {excuses.length > 0 && (
        <section className="pp-card">
          <h2 className="pp-h2">Excuse requests</h2>
          <ul className="pp-excuses">
            {excuses.slice(0, 6).map((x) => (
              <li key={x.id}>
                <div>
                  <strong>{x.dates.map(shortDay).join(', ')}</strong>
                  <span className="pp-muted pp-small">
                    {x.reason}
                    {x.teacherNote ? ` · Teacher: ${x.teacherNote}` : ''}
                  </span>
                </div>
                <span className={`pp-pill pp-pill-${x.status}`}>{x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Declined'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <button type="button" className="btn btn-ink wide pp-big" onClick={onExcuse}>
        <FileText size={18} aria-hidden="true" /> Excuse my child
      </button>
      <p className="pp-muted pp-center pp-small">You can also call the teacher or send a note to school.</p>
    </>
  );
}

function dayInfo(d, doc, today) {
  const rec = doc?.days?.[d];
  if (rec) return `${shortDay(d)} · ${STATUS_WORD[rec.s]}${rec.t ? `, arrived ${to12h(rec.t)}` : ''}`;
  if (doc?.noClass?.[d]) return `${shortDay(d)} · No class (${doc.noClass[d]})`;
  if (d > today) return `${shortDay(d)} · Upcoming`;
  if (isoWeekday(d) >= 6) return `${shortDay(d)} · Weekend`;
  if (d === today) return `${shortDay(d)} · Not confirmed yet`;
  return `${shortDay(d)} · No record`;
}

function MonthGrid({ month, doc, today, picked, onPick }) {
  const firstDay = `${month}-01`;
  const lead = isoWeekday(firstDay) % 7; // Sunday first
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = firstDay; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  return (
    <div className="pp-grid" role="grid" aria-label={monthName(month)}>
      {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
        <span key={i} className="pp-wd" aria-hidden="true">
          {w}
        </span>
      ))}
      {cells.map((d, i) => {
        if (!d) return <span key={`x${i}`} />;
        const rec = doc?.days?.[d];
        const kind = rec ? `d-${rec.s}` : doc?.noClass?.[d] ? 'd-noclass' : '';
        const label = dayInfo(d, doc, today);
        return (
          <button
            key={d}
            type="button"
            className={`pp-day ${kind} ${d === today ? 'is-today' : ''} ${d === picked ? 'is-picked' : ''}`}
            onClick={() => onPick(d)}
            aria-label={label}
            aria-pressed={d === picked}
          >
            {Number(d.slice(8))}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// EXCUSE FORM: which day(s), the reason, an optional message. The teacher approves or declines.
// ---------------------------------------------------------------------
function ExcuseForm({ child, docs, excuses, guardianName, onDone, onBack }) {
  const today = manilaToday();
  const latest = docs[docs.length - 1];
  const sectionId = child.sectionId ?? latest?.sectionId;
  // Absent days in the last 30 days that are not excused and not already asked about.
  const asked = new Set(excuses.filter((x) => x.studentId === child.id && x.status !== 'declined').flatMap((x) => x.dates));
  const recentAbsent = docs
    .flatMap((m) => Object.entries(m.days ?? {}))
    .filter(([d, r]) => r.s === 'absent' && d >= addDays(today, -30) && !asked.has(d))
    .map(([d]) => d)
    .sort()
    .reverse()
    .slice(0, 6);
  let next = addDays(today, 1);
  while (isoWeekday(next) >= 6) next = addDays(next, 1);
  const quick = [...new Set([...recentAbsent, today, next])].sort();
  const [dates, setDates] = useState(recentAbsent.length ? [recentAbsent[0]] : [today]);
  const [other, setOther] = useState('');
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggle = (d) => setDates((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!sectionId) return setError(`${child.firstName} is not in a class yet. Please contact the school.`);
    if (!dates.length) return setError('Pick at least one day.');
    if (!reason) return setError('Pick a reason.');
    setBusy(true);
    try {
      await sendExcuse({ studentId: child.id, sectionId, studentName: `${child.firstName} ${child.lastName}`, guardianName, dates, reason, note });
      onDone();
    } catch (err) {
      setError(err.code === 'permission-denied' ? 'Could not send. Sign out and sign in again, then try again.' : err.message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="pp-stack">
      <button type="button" className="pp-back" onClick={onBack}>
        <ChevronLeft size={18} aria-hidden="true" /> Back
      </button>
      <h1 className="pp-h1">Excuse {child.firstName}</h1>
      <p className="pp-muted">{latest?.teacherName ?? 'The teacher'} will check your request. Excused days do not count against your child.</p>
      <section className="pp-card pp-form">
        <fieldset className="pp-fieldset">
          <legend>Which day(s)?</legend>
          <div className="pp-chips">
            {[...new Set([...quick, ...dates])].sort().map((d) => (
              <button key={d} type="button" className={`pp-chip ${dates.includes(d) ? 'on' : ''}`} aria-pressed={dates.includes(d)} onClick={() => toggle(d)}>
                {d === today ? 'Today' : shortDay(d)}
              </button>
            ))}
          </div>
          <div className="pp-other">
            <DatePicker
              value={other}
              onChange={(v) => {
                setOther('');
                if (v && !dates.includes(v)) setDates((xs) => [...xs, v]);
              }}
              min={addDays(today, -30)}
              max={addDays(today, 30)}
              placeholder="Another day…"
              ariaLabel="Add another day"
              compact
            />
          </div>
        </fieldset>
        <fieldset className="pp-fieldset">
          <legend>Reason</legend>
          <div className="pp-chips">
            {EXCUSE_REASONS.map((r) => (
              <button key={r} type="button" className={`pp-chip ${reason === r ? 'on' : ''}`} aria-pressed={reason === r} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="pp-field">
          <span>Message to the teacher (optional)</span>
          <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. He has a fever. We will see the doctor today." />
        </label>
        <p className="pp-muted pp-small">Have a medical certificate? Send it to school with your child when they return.</p>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-ink wide pp-big" type="submit" disabled={busy}>
        <Send size={18} aria-hidden="true" /> {busy ? 'Sending…' : `Send to ${latest?.teacherName ?? 'the teacher'}`}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------
// CHANGE PASSWORD (not required, but the warning stays until the parent does it).
// ---------------------------------------------------------------------
function ChangePassword({ codeHash, onDone, onBack }) {
  const [current, setCurrent] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (a !== b) return setError("The two new passwords don't match.");
    setBusy(true);
    try {
      await changeParentPassword(current, a, codeHash);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="pp-stack">
      <button type="button" className="pp-back" onClick={onBack}>
        <ChevronLeft size={18} aria-hidden="true" /> Back
      </button>
      <h1 className="pp-h1">Change password</h1>
      <section className="pp-card pp-form">
        <label className="pp-field">
          <span>Current password</span>
          <input className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="pp-field">
          <span>New password</span>
          <input className="input" type="password" autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} required />
        </label>
        <label className="pp-field">
          <span>Type the new password again</span>
          <input className="input" type="password" autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} required />
        </label>
        <p className="pp-muted pp-small">At least 8 characters. Don't use your child's name or birthday.</p>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-ink wide pp-big" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save new password'}
      </button>
    </form>
  );
}
