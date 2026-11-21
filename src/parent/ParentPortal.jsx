// =====================================================================
// parent/ParentPortal.jsx — THE PARENT PORTAL (/parent)
// ---------------------------------------------------------------------
// A phone-first page for parents: sign in with the mobile number + password, then see each child's
// CONFIRMED attendance (calendar, month and semester totals) and send an excuse request to the teacher.
// Parents sign in on the shared sign-in page (/login, main.jsx) with their mobile number.
// Screens: Home (one tab per child) -> ExcuseForm / ChangePassword / Messages. Signed out -> back to /login.
// The data comes from parentCloud.js (not from the engine: parents never load the whole school).
// =====================================================================
import React, { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AlertTriangle, X, CalendarClock, CalendarDays, CloudRain, Megaphone, ChevronLeft, ChevronRight, FileText, KeyRound, LogOut, Send, MessagesSquare } from 'lucide-react';
import { Logo, Wordmark, useRepo, PasswordInput } from '../ui';
import { addDays, isoWeekday, manilaToday, manilaTime, to12h, ordinal, periodsLabel, excuseStatusLabel, EXCUSE_REASONS } from '../logic';
import { changeParentPassword, dismissAnnouncement, portalAvailable, sendExcuse, signOutParent, watchParent, sendParentMessage, markParentRead, fetchParentAttachment } from './parentCloud';
import { ParentMessages, parentUnread, latestMonth } from './ParentMessages';
import { AttachButton, PendingFiles } from '../shared/Attachments';

// "Coming up" tags: what kind of day it is for the child.
const UP_KIND = {
  noclass: 'No class',
  holiday: 'No class',
  break: 'No class',
  suspension: 'Suspended',
  partial: 'Suspended',
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
// A calendar notice has no id of its own: its time and title make one (used to remember "closed").
const noticeId = (n) => `cal:${n.at}:${n.title}`;
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

// wide: the home page on a computer uses the whole screen (dashboard); other screens stay phone-width.
function Shell({ children, school, onSignOut, wide = false }) {
  return (
    <div className={`pp-wrap ${wide ? 'pp-wrap-wide' : ''}`}>
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
  const repo = useRepo();
  const demoLoad = useMemo(() => (id) => repo.fetchAttachment(id), [repo]);
  const children = st.key?.children ?? [];
  const [childId, setChildId] = useState(children[0]?.id ?? null);
  const [screen, setScreen] = useState('home'); // 'home' | 'excuse' | 'password' | 'announcements' | 'messages'
  const [closedHere, setClosedHere] = useState([]); // closed on this page (the demo, or before the cloud saves it)
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
  const latest = latestMonth(docs);
  const school = latest?.schoolName;
  // Announcements for all the parent's children (each once), newest first.
  const announcements = [
    ...new Map(
      children.flatMap((c) => {
        const d = st.months?.[c.id] ?? [];
        return (latestMonth(d)?.announcements ?? []).map((a) => [a.id, { ...a, child: c.firstName }]);
      }),
    ).values(),
  ].sort((a, b) => b.at.localeCompare(a.at));
  // Calendar changes from the school (no class, suspension, make-up class...) are listed with the
  // announcements too; they show above the child's attendance until the parent closes them.
  for (const [id, n] of new Map(
    children.flatMap((c) => {
      const d = st.months?.[c.id] ?? [];
      return (latestMonth(d)?.notices ?? []).map((n) => [noticeId(n), n]);
    }),
  )) {
    if (!announcements.some((a) => a.id === id)) announcements.push({ id, at: n.at, from: 'school', title: n.title, body: n.body ?? '', calendar: true, type: n.type });
  }
  announcements.sort((a, b) => b.at.localeCompare(a.at));
  const closed = new Set([...(st.profile?.dismissed ?? []), ...closedHere]);
  // Shown at the top until the parent closes it (only the last 30 days, at most 3).
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const open = announcements.filter((a) => !a.calendar && !closed.has(a.id) && a.at >= since).slice(0, 3);
  const close = (id) => {
    setClosedHere((x) => [...x, id]);
    if (!st.demo) dismissAnnouncement(id).catch(() => {});
  };
  // Messages: the cloud (parentCloud.js) or, in demo mode, the engine acting as this parent.
  // (a stable function, so attachments are not downloaded again on every redraw)
  const mobile = st.profile?.mobile;
  const parentName = st.key?.guardianName ?? st.guardianName ?? 'Parent';
  const msgApi = st.demo
    ? {
        send: async ({ thread, to, about, text, files }) => repo.demoParentSend({ mobile, parentName, threadId: thread?.id, studentId: about?.studentId, to, text, files }),
        markRead: async (thread) => repo.demoParentRead(mobile, thread.id),
        load: demoLoad,
      }
    : {
        send: ({ thread, to, about, contacts, text, files }) => sendParentMessage({ mobile, parentName, thread, threads: st.threads ?? [], to, about, contacts, text, files }),
        markRead: (thread) => markParentRead(mobile, thread),
        load: fetchParentAttachment,
      };
  const unreadMsgs = parentUnread(st);
  if (screen === 'messages')
    return (
      <Shell school={school}>
        <ParentMessages st={st} api={msgApi} onBack={() => setScreen('home')} />
      </Shell>
    );
  if (screen === 'announcements')
    return (
      <Shell school={school}>
        <AnnouncementsPage items={announcements} closed={closed} onBack={() => setScreen('home')} />
      </Shell>
    );

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
          send={(x) => (st.demo ? repo.demoSendExcuse({ ...x, mobile }) : sendExcuse({ ...x, mobile }))}
          onDone={() => {
            setScreen('home');
            setFlash(`Excuse request sent to ${latest?.teacherName ?? 'the teacher'}.`);
          }}
          onBack={() => setScreen('home')}
        />
      </Shell>
    );

  return (
    <Shell school={school} onSignOut={signOutParent} wide>
      <div className="pp-alerts">
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
      {open.map((a) => (
        <section key={a.id} className={`pp-notice pp-notice-announcement pp-ann-${a.from}`} role="status">
          <Megaphone size={20} aria-hidden="true" />
          <div>
            <strong>{a.title}</strong>
            <p>{a.body}</p>
            <span className="pp-small">{postedAt(a.at)}</span>
          </div>
          <button type="button" className="pp-ann-close" onClick={() => close(a.id)} aria-label="Got it, close this announcement">
            <X size={18} aria-hidden="true" />
          </button>
        </section>
      ))}
      </div>
      {/* Messages, Announcements and the child tabs: one row on a computer. */}
      <div className="pp-toolbar">
      {mobile && (
        <button type="button" className={`pp-msg-entry ${unreadMsgs ? 'has-new' : ''}`} onClick={() => setScreen('messages')}>
          <MessagesSquare size={20} aria-hidden="true" />
          <span>
            <b>Messages</b>
            <small>{unreadMsgs ? `${unreadMsgs} new ${unreadMsgs === 1 ? 'message' : 'messages'}` : 'Write to the teacher or the school office'}</small>
          </span>
          {unreadMsgs > 0 && <span className="pp-msg-count">{unreadMsgs}</span>}
        </button>
      )}
      {announcements.length > 0 && (
        <button type="button" className="pp-link pp-ann-link" onClick={() => setScreen('announcements')}>
          <Megaphone size={15} aria-hidden="true" /> Announcements ({announcements.length})
        </button>
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
      </div>
      {child && (
        <ChildView
          child={child}
          docs={docs}
          excuses={(st.excuses ?? []).filter((x) => x.studentId === child.id)}
          onExcuse={() => setScreen('excuse')}
          closed={closed}
          onClose={close}
        />
      )}
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

// closed / onClose: calendar notices the parent closed ("Got it"); they stay on the Announcements page.
function ChildView({ child, docs, excuses, onExcuse, closed = new Set(), onClose = () => {} }) {
  const today = manilaToday();
  const thisMonth = today.slice(0, 7);
  const byMonth = useMemo(() => new Map(docs.map((d) => [d.month, d])), [docs]);
  const latest = latestMonth(docs);
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
  const notices = (src?.notices ?? [])
    .filter((n) => n.dates?.some((d) => d >= today) || n.at.slice(0, 10) >= addDays(today, -2))
    .filter((n) => !closed.has(noticeId(n)));
  const upcoming = (src?.upcoming ?? []).filter((u) => u.date > today);

  return (
    <>
      {notices.length > 0 && (
        <div className="pp-alerts">
          {notices.map((n) => (
            <section key={noticeId(n)} className={`pp-notice pp-notice-${n.type}`} role="status">
              {n.type === 'suspension' || n.type === 'partial' ? <CloudRain size={20} aria-hidden="true" /> : <Megaphone size={20} aria-hidden="true" />}
              <div>
                <strong>{n.title}</strong>
                {n.body && <p>{n.body}</p>}
                <span className="pp-small">Posted by the school {postedAt(n.at)}</span>
              </div>
              <button type="button" className="pp-ann-close" onClick={() => onClose(noticeId(n))} aria-label="Got it, close this notice">
                <X size={18} aria-hidden="true" />
              </button>
            </section>
          ))}
        </div>
      )}
      {/* Phone: one column in this order. Computer: a dashboard (see .pp-dash in style.css). */}
      <div className="pp-dash">
      <section className="pp-card pp-child pp-a-child">
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

      <section className="pp-card pp-a-up">
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

      <section className="pp-card pp-a-cal">
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

      <section className="pp-totals pp-a-totals">
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
        <section className="pp-card pp-a-excuses">
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
                    {x.files?.length ? ` · ${x.files.length} ${x.files.length === 1 ? 'file' : 'files'} attached` : ''}
                    {x.teacherNote ? ` · Teacher: ${x.teacherNote}` : ''}
                  </span>
                </div>
                <span className={`pp-pill pp-pill-${x.status}`}>{excuseStatusLabel(x)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      </div>
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
  // Class periods missed while at school, and when the child was back in class.
  for (const c of rec.x ?? [])
    lines.push(
      `Not in class for the ${ordinal(c.n)} period${c.j ? ` (${c.j})` : ''}${c.b ? `, back in class at ${to12h(c.b)}` : ''}`,
    );
  const nowTime = manilaTime();
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
    for (const c of rec.x ?? []) {
      rows.push([`Not in class: ${ordinal(c.n)} period${c.j ? ` (${c.j})` : ''}`, c.a ? to12h(c.a) : '—']);
      if (c.b) rows.push([`Back in class${c.bp ? ` (${ordinal(c.bp)} period)` : ''}`, to12h(c.b)]);
    }
    const nowTime = manilaTime();
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
function ExcuseForm({ child, docs, excuses, guardianName, send, onDone, onBack }) {
  const today = manilaToday();
  const latest = latestMonth(docs);
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
  const [files, setFiles] = useState([]); // photo of the excuse letter or medical certificate (optional)
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
      await send({ studentId: child.id, sectionId, studentName: `${child.firstName} ${child.lastName}`, guardianName, dates, reason, note, periods: whole ? [] : periods, files });
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
        <fieldset className="pp-fieldset">
          <legend>Excuse letter or medical certificate (optional)</legend>
          <div className="att-row">
            <AttachButton files={files} onChange={setFiles} onError={setError} disabled={busy} className="btn btn-sm" label />
            <span className="pp-muted pp-small">Take a photo of it. Up to 3 files.</span>
          </div>
          <PendingFiles files={files} onChange={setFiles} />
          <p className="pp-muted pp-small">The teacher may still ask for the paper copy when {child.firstName} returns.</p>
        </fieldset>
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
          <PasswordInput autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </label>
        <label className="pp-field">
          <span>New password</span>
          <PasswordInput autoComplete="new-password" value={a} onChange={(e) => setA(e.target.value)} required />
        </label>
        <label className="pp-field">
          <span>Type the new password again</span>
          <PasswordInput autoComplete="new-password" value={b} onChange={(e) => setB(e.target.value)} required />
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

// ---------------------------------------------------------------------
// ANNOUNCEMENTS: everything the school and the children's teachers sent this school year, newest first.
// Filter: all, from the school, from teachers. Closed ones are still listed here.
// ---------------------------------------------------------------------
function AnnouncementsPage({ items, closed, onBack }) {
  const [from, setFrom] = useState('all'); // 'all' | 'school' | 'teacher'
  const list = items.filter((a) => from === 'all' || a.from === from);
  const count = (f) => items.filter((a) => a.from === f).length;
  return (
    <section className="pp-card">
      <button type="button" className="pp-link" onClick={onBack}>
        <ChevronLeft size={16} aria-hidden="true" /> Back
      </button>
      <h2 className="pp-h2">
        <Megaphone size={17} aria-hidden="true" /> Announcements
      </h2>
      <div className="pp-chips" role="group" aria-label="Show">
        {[
          ['all', `All (${items.length})`],
          ['school', `From the school (${count('school')})`],
          ['teacher', `From teachers (${count('teacher')})`],
        ].map(([k, label]) => (
          <button key={k} type="button" className={from === k ? 'on' : ''} aria-pressed={from === k} onClick={() => setFrom(k)}>
            {label}
          </button>
        ))}
      </div>
      {list.length ? (
        <ul className="pp-ann-list">
          {list.map((a) => (
            <li key={a.id} className={closed.has(a.id) ? '' : 'pp-ann-new'}>
              <strong>{a.title}</strong>
              {a.body && <p>{a.body}</p>}
              {a.bodyFil && <p className="pp-muted">{a.bodyFil}</p>}
              {a.calendar && <span className="pp-ann-tag">School calendar</span>}
              <span className="pp-small">
                {postedAt(a.at)}
                {!closed.has(a.id) && ' · New'}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="pp-muted">No announcements {from === 'school' ? 'from the school' : from === 'teacher' ? 'from teachers' : ''} yet.</p>
      )}
    </section>
  );
}
