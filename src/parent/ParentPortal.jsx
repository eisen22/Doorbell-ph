// =====================================================================
// parent/ParentPortal.jsx — THE PARENT PORTAL (/parent)
// ---------------------------------------------------------------------
// A phone-first page for parents: sign in with the mobile number + password, then see each child's
// CONFIRMED attendance (calendar, month and semester totals) and send an excuse request to the teacher.
// Parents sign in on the shared sign-in page (/login, main.jsx) with their mobile number.
// Screens: Home (one tab per child) -> ExcuseForm / ChangePassword. Signed out -> back to /login.
// The data comes from parentCloud.js (not from the engine: parents never load the whole school).
// =====================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, CalendarClock, CalendarDays, CloudRain, Megaphone, ChevronLeft, ChevronRight, FileText, KeyRound, LogOut, Send } from 'lucide-react';
import { Logo, Wordmark, useRepo } from '../ui';
import { addDays, isoWeekday, manilaToday, to12h, ordinal, periodsLabel, excuseStatusLabel, EXCUSE_REASONS } from '../logic';
import { changeParentPassword, portalAvailable, sendExcuse, signOutParent, watchParent } from './parentCloud';

// "Coming up" tags: what kind of day it is for the child.
const UP_KIND = {
  noclass: 'No class',
  holiday: 'No class',
  break: 'No class',
  suspension: 'Suspended',
  halfday: 'Half day',
  makeup: 'Make-up class',
  exam: 'Exam',
  event: 'Event',
};
const STATUS_WORD = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };
const monthName = (m) => new Date(`${m}-01T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
// When a notice was posted, in Philippine time: "Tue, Nov 17, 6:10 AM".
const postedAt = (iso) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const prevMonth = (m) => addDays(`${m}-01`, -1).slice(0, 7);
const nextMonth = (m) => addDays(`${m}-28`, 7).slice(0, 7);

export function ParentPortal() {
  const repo = useRepo();
  const [st, setSt] = useState({ status: 'loading' });
  const [demoParent, setDemoParent] = useState(null);
  useEffect(() => {
    // Demo mode (no cloud): show a sample parent's view from the demo data instead.
    if (!portalAvailable()) {
      if (repo.demoParentState) {
        const load = () => setSt(repo.demoParentState(demoParent));
        load();
        return repo.subscribe(load);
      }
      return setSt({ status: 'unavailable' });
    }
    return watchParent(setSt);
  }, [repo, demoParent]);
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
      {st.status === 'signedOut' && <Navigate to="/login" replace />}
      {st.status === 'ready' && st.demo && (
        <div className="pp-demo">
          <span>Demo mode: viewing as</span>
          <select value={demoParent ?? ''} onChange={(e) => setDemoParent(e.target.value || null)} aria-label="Sample parent">
            <option value="">A parent with 2 children</option>
            {st.parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <a href={`${import.meta.env.BASE_URL}login`}>Back to sign-in</a>
        </div>
      )}
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
          <Wordmark height={17} />
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
  // The calendar goes back to the first day of classes this school year (not only to the first month on record).
  // Months saved before Nov 16, 2026 don't carry yearStart: fall back to June of this school year
  // (Philippine classes start in June), so parents can always page back to the start of classes.
  const [ty, tm] = thisMonth.split('-').map(Number);
  const yearStartMonth = latest?.yearStart?.slice(0, 7) ?? `${tm >= 6 ? ty : ty - 1}-06`;
  const first = [docs[0]?.month ?? thisMonth, yearStartMonth].filter(Boolean).sort()[0];
  const last = latest && latest.month > thisMonth ? latest.month : thisMonth;
  const [month, setMonth] = useState(byMonth.has(thisMonth) || !latest ? thisMonth : latest.month);
  const [picked, setPicked] = useState(today);
  useEffect(() => {
    setPicked(today);
  }, [child.id, today]);
  const cur = byMonth.get(thisMonth);
  const todayRec = cur?.days?.[today]?.s ? cur.days[today] : undefined; // a day with only a gate "out" time is not confirmed yet
  const todayNoClass = cur?.noClass?.[today];
  const weekend = isoWeekday(today) >= 6;
  const totals = cur?.totals ?? latest?.totals;
  const monthTotals = cur?.totals?.month ?? { absent: 0, late: 0, excused: 0 };
  const name = `${child.firstName} ${child.lastName}`;
  // School notices (suspension, no class, classes as usual...) and the days coming up, from the newest month.
  const src = cur?.upcoming ? cur : latest;
  const notices = (src?.notices ?? []).filter((n) => n.dates?.some((d) => d >= today) || n.at.slice(0, 10) >= addDays(today, -2));
  const upcoming = (src?.upcoming ?? []).filter((u) => u.date > today);

  return (
    <>
      {notices.map((n) => (
        <section key={n.at} className={`pp-notice pp-notice-${n.type}`} role="status">
          {n.type === 'suspension' ? <CloudRain size={20} aria-hidden="true" /> : <Megaphone size={20} aria-hidden="true" />}
          <div>
            <strong>{n.title}</strong>
            {n.body && <p>{n.body}</p>}
            <span className="pp-small">Posted by the school {postedAt(n.at)}</span>
          </div>
        </section>
      ))}
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
          {todayRec ? (
            <DayTimes rec={todayRec} date={today} today={today} endTime={cur?.endTime} />
          ) : (
            <span>
              {todayNoClass
                ? `No class: ${todayNoClass}.`
                : weekend
                  ? 'No class today.'
                  : 'Not confirmed yet. It shows here after the teacher confirms attendance.'}
            </span>
          )}
        </div>
        {/* The parent's main action, near the top (not under the long lists). */}
        <button type="button" className="btn btn-ink wide pp-big" onClick={onExcuse}>
          <FileText size={18} aria-hidden="true" /> Excuse {child.firstName}
        </button>
      </section>

      <section className="pp-card">
        <h2 className="pp-h2">
          <CalendarClock size={17} aria-hidden="true" /> Coming up
        </h2>
        {upcoming.length ? (
          <ul className="pp-upcoming">
            {upcoming.slice(0, 5).map((u) => (
              <li key={u.date}>
                <time>{shortDay(u.date)}</time>
                <span>{u.label}</span>
                <span className={`pp-up-kind pp-up-${UP_KIND[u.type] ? u.type : 'noclass'}`}>{UP_KIND[u.type] ?? 'No class'}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pp-muted pp-small">No holidays, suspensions or schedule changes in the next weeks.</p>
        )}
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
        {!byMonth.has(month) && month <= thisMonth && <p className="pp-muted pp-small pp-center">No attendance recorded for {monthName(month)}.</p>}
        <PickedDay date={picked} doc={byMonth.get(picked.slice(0, 7))} today={today} />
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
                  <strong>
                    {x.dates.map(shortDay).join(', ')}
                    {x.periods?.length ? ` · ${periodsLabel(x.periods)}` : ''}
                  </strong>
                  <span className="pp-muted pp-small">
                    {x.reason}
                    {x.teacherNote ? ` · Teacher: ${x.teacherNote}` : ''}
                  </span>
                </div>
                <span className={`pp-pill pp-pill-${x.status}`}>{excuseStatusLabel(x)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="pp-muted pp-center pp-small">You can also call the teacher or send a note to school.</p>
    </>
  );
}

// The times of one day: in at the gate, confirmed in class by the teacher, out at the gate.
// After class, a child with no "out" scan shows "Did not scan out" (just information, no alert).
function timesOf(rec, date, today, endTime) {
  const lines = [];
  if (rec.s === 'absent' || rec.s === 'excused') {
    lines.push(
      rec.s === 'absent'
        ? rec.t
          ? `Scanned in at the gate ${to12h(rec.t)}, but not in class`
          : 'Absent: did not come to school'
        : rec.xp?.length
          ? `Excused for the ${periodsLabel(rec.xp)}`
          : 'Excused for the whole day',
    );
    return lines;
  }
  if (rec.xp?.length) lines.push(`Excused for the ${periodsLabel(rec.xp)}`);
  // Before the teacher's confirmation, in time order: the gate scan and any earlier text
  // ("absent" at the end of the 1st period, or "entered the school but not in class").
  const before = [];
  before.push([rec.t ?? '', rec.t ? `Scanned in at the gate: ${to12h(rec.t)}` : 'Did not scan in (marked by the teacher)']);
  if (rec.e && rec.et)
    before.push([rec.et, rec.e === 'missing' ? `Text sent ${to12h(rec.et)}: entered the school but not in class yet` : `Text sent ${to12h(rec.et)}: absent at the 1st period`]);
  before.sort((a, b) => a[0].localeCompare(b[0])).forEach(([, l]) => lines.push(l));
  const joined = rec.p ? ` · joined at the ${ordinal(rec.p)} period${rec.j ? ` (${rec.j})` : ''}` : '';
  lines.push(
    rec.c
      ? `Confirmed in class by the teacher: ${to12h(rec.c)}${rec.s === 'late' ? ' (late)' : ''}${joined}`
      : `In class${rec.s === 'late' ? ' (late)' : ''}${joined}`,
  );
  const nowTime = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
  if (rec.o) lines.push(`Scanned out at the gate: ${to12h(rec.o)}`);
  else if (date < today || (endTime && nowTime > endTime)) lines.push('Did not scan out');
  else lines.push('Not scanned out yet');
  return lines;
}
// The same day as a table (What | Time), for the day picked on the calendar.
function rowsOf(rec, date, today, endTime) {
  const rows = [];
  if (rec.s === 'absent' && rec.t) rows.push(['Scanned in at the gate (not found in class)', to12h(rec.t)]);
  if (rec.s === 'absent' && !rec.t) rows.push(['Did not come to school', '—']);
  if (rec.s === 'excused') rows.push([rec.xp?.length ? `Excused for the ${periodsLabel(rec.xp)}` : 'Excused for the whole day', '—']);
  if (rec.s === 'present' || rec.s === 'late') {
    if (rec.xp?.length) rows.push([`Excused for the ${periodsLabel(rec.xp)}`, '—']);
    rows.push(['Scanned in at the gate', rec.t ? to12h(rec.t) : 'Did not scan in']);
    if (rec.e && rec.et) rows.push([rec.e === 'missing' ? 'Text sent: entered the school but not in class yet' : 'Text sent: absent at the 1st period', to12h(rec.et)]);
    const joined = rec.p ? ` (joined at the ${ordinal(rec.p)} period${rec.j ? `, ${rec.j}` : ''})` : '';
    rows.push([`Confirmed in class by the teacher${rec.s === 'late' ? ', late' : ''}${joined}`, rec.c ? to12h(rec.c) : '—']);
    const nowTime = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' });
    rows.push(['Scanned out at the gate', rec.o ? to12h(rec.o) : date < today || (endTime && nowTime > endTime) ? 'Did not scan out' : 'Not yet']);
  }
  // Time order (rows without a time keep their place at the top).
  return rows;
}
function PickedDay({ date, doc, today }) {
  const rec = doc?.days?.[date]?.s ? doc.days[date] : undefined;
  if (!rec)
    return (
      <p className="pp-day-info" aria-live="polite">
        {dayInfo(date, doc, today)}
      </p>
    );
  return (
    <div className="pp-day-info pp-day-table" aria-live="polite">
      <div className="pp-day-title">
        <strong>{shortDay(date)}</strong>
        <span className={`pp-pill pp-st-${rec.s}`}>{STATUS_WORD[rec.s]}</span>
      </div>
      <table>
        <tbody>
          {rowsOf(rec, date, today, doc.endTime).map(([what, time]) => (
            <tr key={what}>
              <td>{what}</td>
              <td className="pp-time">{time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function DayTimes({ rec, date, today, endTime }) {
  return (
    <ul className="pp-times">
      {timesOf(rec, date, today, endTime).map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
}

function dayInfo(d, doc, today) {
  const rec = doc?.days?.[d]?.s ? doc.days[d] : undefined;
  if (rec) return `${shortDay(d)} · ${STATUS_WORD[rec.s]} · ${timesOf(rec, d, today, doc.endTime).join(' · ')}`;
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
        const rec = doc?.days?.[d]?.s ? doc.days[d] : undefined;
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

// A month calendar where a parent taps several days (tap again to remove). Weekends and days outside
// min..max can't be picked. Used by the excuse form ("More days…").
function MultiDayCalendar({ today, selected, onToggle, min, max }) {
  const [month, setMonth] = useState(today.slice(0, 7));
  const step = (n) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  };
  const firstDay = `${month}-01`;
  const lead = isoWeekday(firstDay) % 7;
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = firstDay; d.startsWith(month); d = addDays(d, 1)) cells.push(d);
  return (
    <div className="pp-multical">
      <div className="pp-cal-head">
        <button type="button" className="icon-btn" onClick={() => step(-1)} disabled={month <= min.slice(0, 7)} aria-label="Previous month">
          <ChevronLeft size={18} />
        </button>
        <h3>{monthName(month)}</h3>
        <button type="button" className="icon-btn" onClick={() => step(1)} disabled={month >= max.slice(0, 7)} aria-label="Next month">
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="pp-grid" role="grid" aria-label={`Pick days in ${monthName(month)}`}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
          <span key={i} className="pp-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`x${i}`} />;
          const off = isoWeekday(d) >= 6 || d < min || d > max;
          const on = selected.includes(d);
          return (
            <button
              key={d}
              type="button"
              className={`pp-day ${on ? 'is-chosen' : ''} ${d === today ? 'is-today' : ''}`}
              disabled={off}
              aria-pressed={on}
              aria-label={`${shortDay(d)}${on ? ', picked' : ''}`}
              onClick={() => onToggle(d)}
            >
              {Number(d.slice(8))}
            </button>
          );
        })}
      </div>
      <p className="pp-muted pp-small">Tap each day your child will miss. Tap again to remove it.</p>
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
  const [reason, setReason] = useState(null);
  const [note, setNote] = useState('');
  const [whole, setWhole] = useState(true); // the whole day, or certain class periods only
  const [periods, setPeriods] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The class periods (from the class program); older saved months don't have them: 1st to 8th.
  const classPeriodList = latest?.periods?.length ? latest.periods : [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n }));
  const togglePeriod = (n) => setPeriods((xs) => (xs.includes(n) ? xs.filter((x) => x !== n) : [...xs, n].sort((a, b) => a - b)));
  const [calOpen, setCalOpen] = useState(false);
  // "Today", "Tomorrow", else "Mon, Nov 23".
  const dayChip = (d) => (d === today ? 'Today' : d === addDays(today, 1) ? 'Tomorrow' : shortDay(d));
  const toggle = (d) => setDates((xs) => (xs.includes(d) ? xs.filter((x) => x !== d) : [...xs, d]));
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!sectionId) return setError(`${child.firstName} is not in a class yet. Please contact the school.`);
    if (!dates.length) return setError('Pick at least one day.');
    if (dates.length > 10) return setError('Up to 10 days in one request. Send another request for the rest.');
    if (!reason) return setError('Pick a reason.');
    if (!whole && !periods.length) return setError('Pick the class periods, or choose The whole day.');
    setBusy(true);
    try {
      await sendExcuse({ studentId: child.id, sectionId, studentName: `${child.firstName} ${child.lastName}`, guardianName, dates, reason, note, periods: whole ? [] : periods });
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
            {[...new Set([...quick, ...dates.filter((d) => quick.includes(d))])].sort().map((d) => (
              <button key={d} type="button" className={`pp-chip ${dates.includes(d) ? 'on' : ''}`} aria-pressed={dates.includes(d)} onClick={() => toggle(d)}>
                {dayChip(d)}
              </button>
            ))}
            <button type="button" className={`pp-chip ${calOpen ? 'on' : ''}`} aria-expanded={calOpen} onClick={() => setCalOpen(!calOpen)}>
              <CalendarDays size={16} aria-hidden="true" /> More days…
            </button>
          </div>
          {/* Several days: tap each day on the calendar (tap again to remove). Weekends can't be picked. */}
          {calOpen && <MultiDayCalendar today={today} selected={dates} onToggle={toggle} min={addDays(today, -30)} max={addDays(today, 30)} />}
          {dates.length > 0 && (
            <p className="pp-picked">
              <b>
                {dates.length} {dates.length === 1 ? 'day' : 'days'}:
              </b>{' '}
              {[...dates].sort().map(dayChip).join(', ')}
            </p>
          )}
        </fieldset>
        <fieldset className="pp-fieldset">
          <legend>For how long?</legend>
          <div className="pp-chips">
            <button type="button" className={`pp-chip ${whole ? 'on' : ''}`} aria-pressed={whole} onClick={() => setWhole(true)}>
              The whole day
            </button>
            <button type="button" className={`pp-chip ${!whole ? 'on' : ''}`} aria-pressed={!whole} onClick={() => setWhole(false)}>
              Certain class periods only
            </button>
          </div>
          {!whole && (
            <>
              <div className="pp-periods">
                {classPeriodList.map((p) => (
                  <button
                    key={p.n}
                    type="button"
                    className={`pp-period ${periods.includes(p.n) ? 'on' : ''}`}
                    aria-pressed={periods.includes(p.n)}
                    onClick={() => togglePeriod(p.n)}
                  >
                    <b>{ordinal(p.n)}</b>
                    {p.subject ? (
                      <span>
                        {p.subject} · {to12h(p.start)}
                      </span>
                    ) : (
                      <span>period</span>
                    )}
                  </button>
                ))}
              </div>
              <p className="pp-muted pp-small">
                e.g. a check-up in the morning: pick the periods {child.firstName} will miss. {child.firstName} is not marked absent and the teacher marks
                the arrival as usual.
              </p>
            </>
          )}
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
        <p className="pp-muted pp-small">
          Have an excuse letter or a medical certificate? Send it to school with {child.firstName} when they return, and give it to the teacher.
        </p>
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
