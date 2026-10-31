import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  CalendarDays,
  ArrowUpRight,
  Lock,
  ChevronRight,
  BookOpenCheck,
  CalendarClock,
  Check,
  ShieldCheck,
  MessageSquareOff,
  ChevronLeft,
  MessageSquare,
  AlertTriangle,
  BadgeCheck,
  HelpCircle,
  FileSpreadsheet,
  Download,
  ShieldAlert,
  UserX,
  Clock3,
  Shuffle,
  MessageSquareWarning,
  RotateCw,
  CheckCheck,
  MessageSquareText,
  Smartphone,
  ArrowDownUp,
  X,
  KeyRound,
} from 'lucide-react';
import {
  addDays,
  attendanceRate,
  autoFinalizeTime,
  describeStreak,
  emptyCounts,
  fromMinutes,
  isoWeekday,
  isSchoolDay,
  to12h,
  toMinutes,
  classPhase,
  shortClassName,
  recentSchoolDays,
  displayPhMobile,
  DAY_KIND_META,
  dayKind,
  eachDate,
  manilaToday,
  smsSegments,
  renderTemplate,
} from './logic';
import {
  useLive,
  useRepo,
  textOn,
  loadMyClasses,
  useClassParam,
  Avatar,
  Card,
  CountUp,
  Empty,
  Skeleton,
  StatusChip,
  StreakChip,
  Modal,
  Toast,
  DatePicker,
  ClassSwitch,
  CalendarLegend,
  YearCalendar,
  streakShort,
} from './ui';
import { exportAttendanceXlsx } from './files';

// =====================================================================
// teacher.jsx — EVERY SCREEN OF THE TEACHER PORTAL
// ---------------------------------------------------------------------
//  Dashboard      (/)              Reports        (/reports)
//  Attendance     (/attendance)    Alerts         (/notifications)
//  My Students    (/students)      SMS Messages   (/sms)
//  Calendar       (/calendar)      Settings       (/settings)
// Every screen follows the same pattern:
//   1. useLive(...) loads what it needs from the engine (and reloads on any change)
//   2. while data is loading it shows <Skeleton> placeholders
//   3. it returns the page as JSX (HTML-like code). Buttons call repo.something(...)
// The page addresses are set in main.jsx. The looks are in style.css.
// =====================================================================
// Weekday names for the date strip and weekly table. wd() turns a date into 0 = Monday ... 6 = Sunday.
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const wd = (d) => isoWeekday(d) - 1;
// Words shown on each class card depending on the time (see classPhase in logic.js).
const PHASE = { now: 'In session now', next: 'Later today', done: 'Done for today', off: 'No class today' };
// ---------------------------------------------------------------------
// DASHBOARD
// Order: calendar notices from the admin -> my classes today -> attention needed
// -> arrivals (class in session) and weekly attendance (P/L/A/E counts).
// ---------------------------------------------------------------------
export function Dashboard() {
  const repo = useRepo();
  const [classId, setClass] = useClassParam();
  // Everything the dashboard needs, loaded together. The ?class= in the address bar (classId) picks the class; otherwise the class happening now.
  const { data } = useLive(
    async (r) => {
      const { session, today, classes, current, section } = await loadMyClasses(r, classId);
      const calendar = await r.getCalendar();
      const settings = await r.getSettings();
      const monday = addDays(today.date, -wd(today.date));
      const perClass = await Promise.all(
        classes.map(async (c) => ({
          section: c,
          roster: await r.getRoster(c.id, today.date),
          confirmation: await r.getConfirmation(c.id, today.date),
        })),
      );
      const records = await r.getAttendanceRange(section.id, monday, addDays(monday, 6));
      const sms = (await r.listSms(500)).filter((m) => m.createdAt.startsWith(today.date));
      const notes = await r.listNotifications();
      const attention = await r.listAttention(2);
      return { session, today, classes, current, section, calendar, settings, monday, perClass, records, sms, notes, attention };
    },
    [classId],
  );
  // selected = the day picked in the Arrivals date strip; filter = All / On time / Late.
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState('all');
  // Weekly table: present/late/absent/excused counts for Monday to Friday of this week. Today uses the live class list.
  const week = useMemo(() => {
    if (!data) return null;
    const { records, monday, perClass, section, calendar, today } = data;
    const focus = perClass.find((p) => p.section.id === section.id);
    const days = Array.from({ length: 5 }, (_, i) => addDays(monday, i)).map((d) => {
      const c = emptyCounts();
      const recs = d === today.date ? focus.roster.map((r) => r.record).filter(Boolean) : records.filter((r) => r.date === d);
      recs.forEach((r) => c[r.status]++);
      return {
        date: d,
        label: DAYS[wd(d)],
        school: isSchoolDay(d, section.schedule, calendar),
        future: d > today.date,
        counts: c,
        entry: calendar.find((x) => x.date === d),
      };
    });
    const total = emptyCounts();
    days.forEach((d) => {
      if (d.school && !d.future)
        Object.keys(total).forEach((k) => {
          total[k] += d.counts[k];
        });
    });
    return { days, total, rate: attendanceRate(total) };
  }, [data]);
  if (!data || !week) return <DashboardSkeleton />;
  // Values used below. `focus` = the class shown in Arrivals and Weekly attendance.
  const { session, today, classes, section, perClass, calendar, settings, sms, notes, attention, records, monday } = data;
  const focus = perClass.find((p) => p.section.id === section.id);
  const day = selected ?? today.date;
  const strip = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const feedSource = day === today.date ? focus.roster.map((r) => r.record).filter(Boolean) : records.filter((r) => r.date === day);
  const nameOf = new Map(focus.roster.map((r) => [r.student.id, r.student]));
  const feed = feedSource
    .filter((r) => r.scannedAt && (filter === 'all' || r.status === filter))
    .sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
  const failed = sms.filter((m) => m.status === 'failed').length;
  const unreadStreaks = notes.filter((n) => !n.read && n.kind === 'streak').length;
  const calendarNotes = notes.filter((n) => n.kind === 'calendar' && !n.read).slice(0, 3);
  const hour = Number(today.time.slice(0, 2));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayEntry = calendar.find((c) => c.date === today.date);
  const focusPhase = classPhase(section, today.time, today.actualDate);
  const multi = classes.length > 1;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">
            {greet}, Teacher {session.name.split(' ')[0]}
          </p>
        </div>
        <p className="muted">
          {format(parseISO(today.date), 'EEEE, MMMM d, yyyy')}
          {today.date !== today.actualDate && (
            <span className="demo-tag" title="Today has no class">
              Showing last class day
            </span>
          )}
          {today.simulated && (
            <span className="demo-tag" title="Outside class hours the demo simulates a school morning">
              Demo clock {to12h(today.time)}
            </span>
          )}
        </p>
      </div>

      {/* Calendar changes from the admin (e.g. a suspension). "Got it" marks the alert as read so the notice disappears. */}
      {calendarNotes.map((n) => (
        <div key={n.id} className="cal-notice" role="status">
          <CalendarClock size={20} aria-hidden="true" />
          <div>
            <strong>{n.title}</strong>
            <span>{n.body}</span>
          </div>
          <Link className="btn btn-sm" to="/calendar">
            View calendar
          </Link>
          <button className="btn btn-sm btn-ink" onClick={() => repo.markNotificationsRead([n.id])}>
            <Check size={15} /> Got it
          </button>
        </div>
      ))}
      {/* Banner when today is an exam, event or half day. */}
      {todayEntry && (todayEntry.type === 'exam' || todayEntry.type === 'event' || todayEntry.type === 'halfday') && (
        <Link to="/calendar" className={`day-banner k-${todayEntry.type}`}>
          <BookOpenCheck size={18} /> Today: {todayEntry.label}
          <ChevronRight size={16} />
        </Link>
      )}

      {/* One card per class (the class in session is marked). Clicking a card shows that class in the cards below. */}
      <Card title={multi ? 'My classes today' : 'My class today'}>
        <div className="card-row">
          {perClass.map(({ section: c, roster, confirmation }) => {
            const s = c.schedule;
            const arrived = roster.filter((r) => r.record?.scannedAt).length;
            const pct = Math.round((arrived / Math.max(1, roster.length)) * 100);
            const phase = classPhase(c, today.time, today.actualDate);
            const on = c.id === section.id;
            return (
              <div key={c.id} className={`tile class-tile ${on ? 'class-on' : ''}`} style={{ background: c.color, color: textOn(c.color) }}>
                <button
                  className="class-tile-main"
                  onClick={() => setClass(c.id)}
                  aria-pressed={on}
                  title={multi ? 'Show this class on the dashboard' : undefined}
                >
                  <span className="date-chip">
                    {phase === 'now' && <span className="live-dot" aria-hidden="true" />}
                    {PHASE[phase]}
                  </span>
                  <h3>{c.name}</h3>
                  <p>
                    {to12h(s.startTime)} to {to12h(s.endTime)} · late after {to12h(fromMinutes(toMinutes(s.startTime) + s.lateCutoffMins))}
                  </p>
                  <Progress value={pct} label={`${arrived} of ${roster.length} arrived`} />
                  <p className="class-tile-foot">
                    <span>
                      {arrived} of {roster.length} arrived
                    </span>
                    <span>
                      {confirmation ? (
                        <>
                          <Lock size={12} /> Confirmed
                        </>
                      ) : (
                        `Confirm by ${to12h(autoFinalizeTime(s))}`
                      )}
                    </span>
                  </p>
                </button>
                <Link to={`/attendance?class=${c.id}`} className="class-tile-link">
                  Take attendance <ArrowUpRight size={14} />
                </Link>
              </div>
            );
          })}
          <Link to="/sms" className="tile tile-link tile-sky">
            <span className="date-chip">Parent SMS</span>
            <h3>{sms.length} sent today</h3>
            <p>{failed ? `${failed} failed. Check the numbers on file.` : 'Every text delivered.'}</p>
            <Progress value={sms.length ? Math.round(((sms.length - failed) / sms.length) * 100) : 0} label="delivered" />
          </Link>
        </div>
      </Card>

      {/* Children absent or late 2+ school days in a row in any of my classes. At the streak limit (default 3) the parent is texted. */}
      <Card
        title={
          <>
            Attention needed {attention.length > 0 && <span className="count-pill">{attention.length}</span>}
            {unreadStreaks > 0 && <span className="new-pill">{unreadStreaks} new</span>}
          </>
        }
        action={
          <Link className="link" to="/notifications?tab=streak">
            All alerts <ArrowUpRight size={15} />
          </Link>
        }
        className="attention-card"
      >
        {attention.length === 0 ? (
          <Empty title="Everyone is on track" hint="No child is absent or late two school days in a row." />
        ) : (
          <ul className="attention">
            {attention.map((r) => (
              <li key={r.student.id}>
                <Link
                  to={`/students?class=${r.section.id}&q=${encodeURIComponent(`${r.student.firstName} ${r.student.lastName}`)}`}
                  className="attention-link"
                >
                  <Avatar first={r.student.firstName} last={r.student.lastName} tone={r.section.color} />
                  <div>
                    <strong>
                      {r.student.firstName} {r.student.lastName}
                    </strong>
                    <span className="muted small">
                      {describeStreak(r.streak)}
                      {multi ? ` · ${shortClassName(r.section.name)}` : ''}
                    </span>
                    <span className="muted small">{r.guardian ? `${r.guardian.relationship}: ${r.guardian.name}` : 'No guardian on file'}</span>
                  </div>
                  <StreakChip s={r.streak} threshold={settings.streakDays} />
                  <span className="muted small">
                    {r.streak.count >= settings.streakDays
                      ? r.guardian?.smsConsent
                        ? 'Parent texted'
                        : 'Call parent (no SMS consent)'
                      : `Text at ${settings.streakDays}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid-2">
        {/* Live list of scans for the chosen day (newest first), for the class in focus. */}
        <Card
          title={
            <>
              Arrivals{' '}
              <span className="card-sub">
                {shortClassName(section.name)} · {to12h(section.schedule.startTime)} to {to12h(section.schedule.endTime)}
                {focusPhase === 'now' ? ' · now' : ''}
              </span>
            </>
          }
        >
          {multi && (
            <div className="chips tight" role="group" aria-label="Choose a class">
              {classes.map((c) => (
                <button key={c.id} className={`fchip sm ${c.id === section.id ? 'fchip-on' : ''}`} onClick={() => setClass(c.id)}>
                  <span className="sec-dot sm" style={{ background: c.color }} />
                  {shortClassName(c.name)} · {to12h(c.schedule.startTime)}
                </button>
              ))}
            </div>
          )}
          <div className="date-strip">
            {strip.map((d) => (
              <button key={d} className={`day ${d === day ? 'day-on' : ''}`} disabled={d > today.date} onClick={() => setSelected(d)}>
                <span>{DAYS[wd(d)]}</span>
                <b>{d.slice(8)}</b>
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Filter arrivals">
            {['all', 'present', 'late'].map((f) => (
              <button key={f} className={`fchip ${filter === f ? 'fchip-on' : ''}`} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All' : f === 'present' ? 'On time' : 'Late'}
              </button>
            ))}
            <Link className="link push" to={`/attendance?class=${section.id}&date=${day}`}>
              Full list <ArrowUpRight size={14} />
            </Link>
          </div>
          <ul className="feed">
            {feed.length === 0 && (
              <li>
                <Empty title="No scans for this day" hint="Arrivals appear here the moment a card is scanned." />
              </li>
            )}
            {feed.slice(0, 8).map((r) => {
              const st = nameOf.get(r.studentId);
              if (!st) return null;
              return (
                <li key={r.studentId}>
                  <Link to={`/students?class=${section.id}&q=${encodeURIComponent(`${st.firstName} ${st.lastName}`)}`} className="feed-row">
                    <Avatar first={st.firstName} last={st.lastName} tone={section.color} />
                    <div className="feed-main">
                      <strong>
                        {st.firstName} {st.lastName}
                      </strong>
                      <StatusChip status={r.status} />
                    </div>
                    <time>{to12h(r.scannedAt)}</time>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* Counts only. The calendar icon opens the Attendance page. */}
        <Card
          title={
            <>
              Weekly attendance <span className="card-sub">{shortClassName(section.name)}</span>
            </>
          }
          action={
            <Link to={`/attendance?class=${section.id}`} className="icon-badge" aria-label="Open attendance" title="Open attendance">
              <CalendarDays size={17} />
            </Link>
          }
        >
          <div className="big-number">
            <strong>
              <CountUp value={week.rate} suffix="%" />
            </strong>
            <span>attendance this week</span>
          </div>
          <table className="week-table">
            <thead>
              <tr>
                <th scope="col">Day</th>
                <th scope="col" title="Present">
                  P
                </th>
                <th scope="col" title="Late">
                  L
                </th>
                <th scope="col" title="Absent">
                  A
                </th>
                <th scope="col" title="Excused">
                  E
                </th>
              </tr>
            </thead>
            <tbody>
              {week.days.map((d) => (
                <tr key={d.date} className={d.date === today.date ? 'is-today' : ''}>
                  <th scope="row">
                    <b>{d.label}</b> <span className="muted">{format(parseISO(d.date), 'MMM d')}</span>
                  </th>
                  {!d.school ? (
                    <td colSpan={4} className="week-off">
                      {d.entry?.label ?? 'No class'}
                    </td>
                  ) : d.future ? (
                    <td colSpan={4} className="week-off">
                      Upcoming{d.entry ? ` · ${d.entry.label}` : ''}
                    </td>
                  ) : (
                    ['present', 'late', 'absent', 'excused'].map((k) => (
                      <td key={k}>
                        <span className={`n-pill n-${k} ${d.counts[k] === 0 ? 'zero' : ''}`}>{d.counts[k]}</span>
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Week</th>
                {['present', 'late', 'absent', 'excused'].map((k) => (
                  <td key={k}>
                    <strong>{week.total[k]}</strong>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
          <p className="muted small week-key">
            P present · L late · A absent · E excused
            {!focus.confirmation && today.date === today.actualDate ? " · today's absences count after attendance is confirmed" : ''}
          </p>
        </Card>
      </div>
    </div>
  );
}
// Thin progress bar with a percentage, used on the class cards.
function Progress({ value, label }) {
  return (
    <div className="progress" aria-label={`${label}: ${value}%`}>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${value}%` }} />
      </div>
      <span>{value}%</span>
      <span className="sr-only">{label}</span>
    </div>
  );
}
// Grey placeholders shown while the dashboard loads.
function DashboardSkeleton() {
  return (
    <div className="page">
      <Skeleton h={44} w={260} />
      <div className="card">
        <div className="card-row">
          {[0, 1, 2].map((k) => (
            <Skeleton key={k} h={170} w={250} />
          ))}
        </div>
      </div>
      <div className="card">
        <Skeleton h={160} />
      </div>
      <div className="grid-2">
        <div className="card">
          <Skeleton h={260} />
        </div>
        <div className="card">
          <Skeleton h={260} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// ATTENDANCE: the class list for one day with Present / Late / Absent / Excused buttons,
// and the "Confirm attendance" button. The date and class are kept in the address bar
// (?date=2026-10-29&class=...), so a link can open a specific day.
// ---------------------------------------------------------------------
const OPTIONS = ['present', 'late', 'absent', 'excused'];
export function Attendance() {
  const repo = useRepo();
  const [params, setParams] = useSearchParams();
  const date = params.get('date');
  const statusFilter = params.get('status');
  const setDate = (d) => {
    const p = new URLSearchParams(params);
    p.set('date', d);
    setParams(p);
  };
  const clearFilter = () => {
    const p = new URLSearchParams(params);
    p.delete('status');
    setParams(p);
  };
  // pending = a change that needs a note or reason first (Excused, or any change after confirming).
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [classId, setClass] = useClassParam();
  const { data } = useLive(
    async (r) => {
      const { session, today, classes, section } = await loadMyClasses(r, classId);
      const calendar = await r.getCalendar();
      const year = await r.getSchoolYear();
      const day = date ?? today.date;
      const roster = await r.getRoster(section.id, day);
      const confirmation = await r.getConfirmation(section.id, day);
      return { session, today, classes, section, calendar, year, day, roster, confirmation };
    },
    [date, classId],
  );
  if (!data)
    return (
      <div className="page">
        <Skeleton h={44} w={240} />
        <div className="card">
          <Skeleton h={400} />
        </div>
      </div>
    );
  const { today, classes, section, calendar, year, day, roster, confirmation } = data;
  const schoolDay = isSchoolDay(day, section.schedule, calendar);
  const counts = emptyCounts();
  let waiting = 0;
  // Count each status. Children with no record yet are 'waiting' (not yet scanned).
  roster.forEach((r) => (r.record ? counts[r.record.status]++ : waiting++));
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  // Previous / next arrows jump to the previous or next SCHOOL day (weekends and holidays are skipped).
  const step = (dir) => {
    const next =
      dir === -1
        ? recentSchoolDays(addDays(day, -1), 1, section.schedule, calendar)[0]
        : (() => {
            let d = addDays(day, 1);
            while (d <= today.date && !isSchoolDay(d, section.schedule, calendar)) d = addDays(d, 1);
            return d;
          })();
    if (next && next <= today.date) setDate(next);
  };
  // A status button was pressed. Excused, or any change after the day is confirmed, opens a window for a note/reason.
  const choose = async (row, status) => {
    if (row.record?.status === status) return;
    if (confirmation || status === 'excused') {
      setPending({ row, status });
      setText('');
      setError(null);
      return;
    }
    await repo.setStatus({ sectionId: section.id, date: day, studentId: row.student.id, status });
    flash(`${row.student.firstName} marked ${status}`);
  };
  const savePending = async () => {
    if (!pending) return;
    try {
      await repo.setStatus({
        sectionId: section.id,
        date: day,
        studentId: pending.row.student.id,
        status: pending.status,
        note: pending.status === 'excused' ? text : undefined,
        reason: confirmation ? text : undefined,
      });
      setPending(null);
      flash(`${pending.row.student.firstName} updated`);
    } catch (e) {
      setError(e.message);
    }
  };
  // "Confirm and lock": unscanned children become absent, streak alerts and texts are checked (engine.finalize).
  const confirm = async () => {
    await repo.confirmDay(section.id, day);
    setConfirmOpen(false);
    flash('Attendance confirmed and locked');
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Attendance</h1>
          <p className="page-sub">
            {section.name} · {to12h(section.schedule.startTime)} to {to12h(section.schedule.endTime)}
          </p>
        </div>
        <div className="date-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous school day">
            <ChevronLeft size={18} />
          </button>
          <DatePicker
            value={day}
            min={year.start}
            max={today.date}
            calendar={calendar}
            onChange={setDate}
            ariaLabel="Date"
            quick={[['Today', today.date]]}
          />
          <button className="icon-btn" onClick={() => step(1)} disabled={day >= today.date} aria-label="Next school day">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <ClassSwitch classes={classes} value={section.id} onChange={setClass} time={today.time} date={today.actualDate} />

      {/* Totals for the day and the Confirm button (or who confirmed it). */}
      <div className="summary-bar">
        <div className="summary-counts">
          <span>
            <StatusChip status="present" /> {counts.present}
          </span>
          <span>
            <StatusChip status="late" /> {counts.late}
          </span>
          <span>
            <StatusChip status="absent" /> {counts.absent}
          </span>
          <span>
            <StatusChip status="excused" /> {counts.excused}
          </span>
          {!confirmation && (
            <span>
              <StatusChip status="waiting" /> {waiting}
            </span>
          )}
        </div>
        {confirmation ? (
          <div className="locked-note">
            <Lock size={16} /> Confirmed by {confirmation.confirmedBy} at {format(new Date(confirmation.confirmedAt), 'h:mm a')}. Changes need a
            reason.
          </div>
        ) : schoolDay ? (
          <button className="btn btn-ink" onClick={() => setConfirmOpen(true)}>
            <ShieldCheck size={18} /> Confirm attendance
          </button>
        ) : null}
      </div>

      {!schoolDay ? (
        <Card>
          <Empty title="No class on this day" hint="Weekends, holidays and suspensions are skipped in streaks." />
        </Card>
      ) : (
        <Card>
          {!confirmation && day === today.date && (
            <p className="hint">
              Auto-confirms at {to12h(autoFinalizeTime(section.schedule))} if you do not confirm. Children not scanned by then are marked absent.
            </p>
          )}
          {/* One row per child: name, scan time, streak, SMS consent, and the four status buttons. */}
          <ul className="roster">
            {statusFilter && (
              <div className="filter-note">
                <span>
                  Showing <b>{statusFilter === 'waiting' ? 'not yet scanned' : statusFilter}</b> only
                </span>
                <button className="link-btn" onClick={clearFilter}>
                  Show everyone
                </button>
              </div>
            )}
            {roster
              .filter((row) => !statusFilter || (statusFilter === 'waiting' ? !row.record : row.record?.status === statusFilter))
              .map((row) => {
                const st = row.record?.status;
                return (
                  <li key={row.student.id} className="roster-row">
                    <Avatar first={row.student.firstName} last={row.student.lastName} tone={section.color} />
                    <div className="roster-name">
                      <strong>
                        {row.student.lastName}, {row.student.firstName}
                      </strong>
                      <span className="muted small">
                        {row.record?.scannedAt
                          ? `Scanned ${to12h(row.record.scannedAt)}`
                          : row.record
                            ? row.record.source === 'auto'
                              ? 'Not scanned'
                              : 'Set manually'
                            : 'Not yet scanned'}
                        {row.record?.excusedNote && ` · ${row.record.excusedNote}`}
                        {row.streak.count >= 2 && (
                          <>
                            {' '}
                            <StreakChip s={row.streak} />
                          </>
                        )}
                        {row.guardian && !row.guardian.smsConsent && (
                          <span className="no-sms" title="No SMS consent">
                            <MessageSquareOff size={13} /> No SMS
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="seg" role="radiogroup" aria-label={`Status for ${row.student.firstName}`}>
                      {OPTIONS.map((o) => (
                        <button
                          key={o}
                          role="radio"
                          aria-checked={st === o}
                          className={`seg-btn seg-${o} ${st === o ? 'on' : ''}`}
                          onClick={() => choose(row, o)}
                        >
                          {o[0].toUpperCase() + o.slice(1)}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}

      {/* Window for an excuse note or a change reason. */}
      {pending && (
        <Modal
          title={
            pending.status === 'excused' && !confirmation
              ? `Excuse ${pending.row.student.firstName}`
              : `Change ${pending.row.student.firstName} to ${pending.status}`
          }
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button className="btn btn-ink" onClick={savePending} disabled={!!confirmation && !text.trim()}>
                Save
              </button>
            </>
          }
        >
          <label className="field">
            <span>{confirmation ? 'Reason for the change (required, saved in the audit log)' : 'Note (optional), e.g. "Parent called, fever"'}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus />
          </label>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}

      {/* "Are you sure?" window before confirming. */}
      {confirmOpen && (
        <Modal
          title="Confirm today's attendance?"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmOpen(false)}>
                Not yet
              </button>
              <button className="btn btn-ink" onClick={confirm}>
                <Lock size={16} /> Confirm and lock
              </button>
            </>
          }
        >
          <p>
            {waiting} {waiting === 1 ? 'child has' : 'children have'} not been scanned and will be marked <b>absent</b>. Children who reach a
            3-school-day late or absent streak will trigger an SMS to their guardian.
          </p>
          <p className="muted small">
            Date: {format(parseISO(day), 'EEEE, MMMM d')}. A child who arrives later can still be scanned and will be recorded as late.
          </p>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------
// MY STUDENTS: the class list with guardian, mobile number status, SMS consent, streak and ID card.
// Teachers can only view; the admin edits student details.
// ---------------------------------------------------------------------
export function Students() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').toLowerCase();
  const [classId, setClass] = useClassParam();
  const { data } = useLive(
    async (r) => {
      const { today, classes, section } = await loadMyClasses(r, classId);
      return { today, classes, section, roster: await r.getRoster(section.id, today.date) };
    },
    [classId],
  );
  if (!data)
    return (
      <div className="page">
        <Skeleton h={44} w={240} />
        <div className="card">
          <Skeleton h={400} />
        </div>
      </div>
    );
  const rows = data.roster.filter((r) => !q || `${r.student.firstName} ${r.student.lastName} ${r.guardian?.name ?? ''}`.toLowerCase().includes(q));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My Students</h1>
          <p className="page-sub">
            {data.section.name} · {data.roster.length} learners
          </p>
        </div>
        <input
          className="input"
          placeholder="Filter by child or guardian"
          value={params.get('q') ?? ''}
          onChange={(e) => {
            const p = new URLSearchParams(params);
            if (e.target.value) p.set('q', e.target.value);
            else p.delete('q');
            setParams(p);
          }}
          aria-label="Filter students"
        />
      </div>
      <ClassSwitch classes={data.classes} value={data.section.id} onChange={setClass} time={data.today.time} date={data.today.actualDate} />
      <Card>
        {rows.length === 0 ? (
          <Empty title="No match" hint="Try another name." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Today</th>
                  <th>Guardian</th>
                  <th>Mobile</th>
                  <th>SMS</th>
                  <th>Streak</th>
                  <th>ID card</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ student, guardian, record, streak }) => (
                  <tr key={student.id}>
                    <td>
                      <div className="cell-person">
                        <Avatar first={student.firstName} last={student.lastName} tone={data.section.color} />
                        <span>
                          <strong>
                            {student.lastName}, {student.firstName}
                          </strong>
                          <span className="muted small">
                            {student.sex === 'M' ? 'Boy' : 'Girl'} · born {student.birthdate}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={record?.status ?? 'waiting'} />
                    </td>
                    <td>
                      {guardian ? (
                        <>
                          <strong>{guardian.name}</strong>
                          <span className="muted small block">
                            {guardian.relationship}
                            {guardian.studentIds.length > 1 ? ` · ${guardian.studentIds.length} children` : ''}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {guardian ? <span className="mono">{displayPhMobile(guardian.mobile)}</span> : '—'}
                      {guardian && <NumberStatus status={guardian.numberStatus} />}
                    </td>
                    <td>
                      {guardian?.smsConsent ? (
                        <span className="tag tag-ok">
                          <MessageSquare size={13} /> {guardian.preferredLanguage === 'fil' ? 'Filipino' : 'English'}
                        </span>
                      ) : (
                        <span className="tag tag-off">
                          <MessageSquareOff size={13} /> No consent
                        </span>
                      )}
                    </td>
                    <td>{streak.count >= 2 ? <StreakChip s={streak} /> : <span className="muted">-</span>}</td>
                    <td>
                      <span className={`tag ${student.qrStatus === 'active' ? 'tag-ok' : 'tag-bad'}`}>
                        {student.qrStatus === 'active' ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="muted small">
        Student records, guardians and ID cards are managed by the school admin. Contact them to fix a number or reissue a lost card.
      </p>
    </div>
  );
}
// Shows if a guardian's number is verified, unverified, or failed (texts did not go through).
function NumberStatus({ status }) {
  if (status === 'verified')
    return (
      <span className="num-status ok" title="Verified">
        <BadgeCheck size={14} /> Verified
      </span>
    );
  if (status === 'failed')
    return (
      <span className="num-status bad" title="SMS failed">
        <AlertTriangle size={14} /> Needs update
      </span>
    );
  return (
    <span className="num-status" title="Not yet confirmed">
      <HelpCircle size={14} /> Unverified
    </span>
  );
}

// ---------------------------------------------------------------------
// CALENDAR: the whole school year, read-only for teachers. Colors: see the legend and .k-* in style.css.
// ---------------------------------------------------------------------
/** Teacher view: the whole school year, read-only. */
export function CalendarPage() {
  const { data } = useLive(async (r) => ({
    year: await r.getSchoolYear(),
    calendar: await r.getCalendar(),
    today: await r.getToday(),
  }));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={500} />
      </div>
    );
  const { year, calendar, today } = data;
  const counts = {};
  let held = 0;
  let total = 0;
  for (const d of eachDate(year.start, year.end)) {
    const k = dayKind(d, year, calendar);
    counts[k] = (counts[k] ?? 0) + 1;
    if (DAY_KIND_META[k].isClass) {
      total++;
      if (d <= today.date) held++;
    }
  }
  const upcoming = calendar.filter((c) => c.date > today.date && !['event', 'exam'].includes(c.type)).slice(0, 8);
  const events = calendar.filter((c) => c.date >= today.date && (c.type === 'event' || c.type === 'exam')).slice(0, 8);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>School Calendar</h1>
          <p className="page-sub">
            {year.name} · {format(parseISO(year.start), 'MMM d, yyyy')} to {format(parseISO(year.end), 'MMM d, yyyy')}
          </p>
        </div>
        <div className="cal-stats">
          <div title="Days learners are in school. DepEd's 201 also counts wellness-break and INSET days.">
            <strong>{total}</strong>
            <span>days in school</span>
          </div>
          <div>
            <strong>{held}</strong>
            <span>done</span>
          </div>
          <div>
            <strong>{total - held}</strong>
            <span>to go</span>
          </div>
        </div>
      </div>
      <Card>
        <CalendarLegend counts={counts} />
        <YearCalendar year={year} calendar={calendar} today={today.date} />
      </Card>
      <div className="grid-2">
        <Card title="Coming up: no class or changed schedule">
          <ul className="cal-list">
            {upcoming.map((c) => (
              <li key={c.date}>
                <span className={`swatch k-${c.type} ${c.scope === 'local' ? 'is-local' : ''}`} />
                <time>{format(parseISO(c.date), 'EEE, MMM d')}</time>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Exams and school events (classes continue)">
          <ul className="cal-list">
            {events.map((c) => (
              <li key={c.date}>
                <span className={`swatch k-${c.type}`} />
                <time>{format(parseISO(c.date), 'EEE, MMM d')}</time>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="muted small">
        Based on DepEd Order No. 009, s. 2026 (three-term calendar) plus Baguio Charter Day (RA 6710). Your school admin can change any day, for
        example to declare a suspension.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// REPORTS: download attendance as an Excel file (the work is done in files.js).
// A privacy warning appears first, and each download is written in the audit log.
// ---------------------------------------------------------------------
export function Reports() {
  const repo = useRepo();
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [sheets, setSheets] = useState({ grid: true, summary: true, raw: true });
  const [warnOpen, setWarnOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);
  const [classId, setClass] = useClassParam();
  const { data } = useLive(
    async (r) => {
      const { session, today, classes, section } = await loadMyClasses(r, classId);
      return { session, today, classes, section, year: await r.getSchoolYear(), calendar: await r.getCalendar() };
    },
    [classId],
  );
  if (!data)
    return (
      <div className="page">
        <Skeleton h={300} />
      </div>
    );
  const start = from ?? `${data.today.date.slice(0, 8)}01`;
  const end = to ?? data.today.date;
  // Builds and downloads the .xlsx file for the chosen class and dates.
  const run = async () => {
    setWarnOpen(false);
    setBusy(true);
    try {
      const [settings, calendar, roster, records] = await Promise.all([
        repo.getSettings(),
        repo.getCalendar(),
        repo.getRoster(data.section.id, end),
        repo.getAttendanceRange(data.section.id, start, end),
      ]);
      const filename = await exportAttendanceXlsx({
        settings,
        schoolYearName: data.year.name,
        section: data.section,
        teacherName: data.session.name,
        students: roster.map((r) => r.student),
        records,
        calendar,
        from: start,
        to: end,
        sheets,
      });
      await repo.logAudit('export.excel', data.section.id, `${filename} (${start} to ${end})`);
      setToast(`Downloaded ${filename}`);
    } finally {
      setBusy(false);
      setTimeout(() => setToast(null), 3000);
    }
  };
  const presets = [
    ['This month', `${data.today.date.slice(0, 8)}01`, data.today.date],
    ['Last 7 days', addDays(data.today.date, -6), data.today.date],
    ['School year to date', data.year.start, data.today.date],
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="page-sub">{data.section.name}</p>
        </div>
      </div>
      <ClassSwitch classes={data.classes} value={data.section.id} onChange={setClass} />
      <div className="grid-2">
        <Card title="Export to Excel">
          <div className="chips">
            {presets.map(([label, a, b]) => (
              <button
                key={label}
                className={`fchip ${start === a && end === b ? 'fchip-on' : ''}`}
                onClick={() => {
                  setFrom(a);
                  setTo(b);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="form-row">
            <div className="field">
              <span>From</span>
              <DatePicker
                value={start}
                min={data.year.start}
                max={end}
                calendar={data.calendar}
                onChange={setFrom}
                ariaLabel="From"
                quick={[
                  ['First day of classes', data.year.start],
                  ['Start of month', `${data.today.date.slice(0, 8)}01`],
                ]}
              />
            </div>
            <div className="field">
              <span>To</span>
              <DatePicker
                value={end}
                min={start}
                max={data.today.date}
                calendar={data.calendar}
                onChange={setTo}
                ariaLabel="To"
                quick={[['Today', data.today.date]]}
              />
            </div>
          </div>
          <fieldset className="checks">
            <legend>Sheets</legend>
            <label>
              <input type="checkbox" checked={sheets.grid} onChange={(e) => setSheets({ ...sheets, grid: e.target.checked })} /> Daily grid (P / L / A
              / E per day)
            </label>
            <label>
              <input type="checkbox" checked={sheets.summary} onChange={(e) => setSheets({ ...sheets, summary: e.target.checked })} /> Summary with
              attendance rate
            </label>
            <label>
              <input type="checkbox" checked={sheets.raw} onChange={(e) => setSheets({ ...sheets, raw: e.target.checked })} /> Raw log with scan times
              and edits
            </label>
          </fieldset>
          <button className="btn btn-ink wide" disabled={busy || !(sheets.grid || sheets.summary || sheets.raw)} onClick={() => setWarnOpen(true)}>
            <Download size={18} /> {busy ? 'Preparing…' : 'Download .xlsx'}
          </button>
        </Card>
        <Card title="What you get">
          <div className="xl-preview" aria-hidden="true">
            <div className="xl-tabs">
              <span className="on">Daily Grid</span>
              <span>Summary</span>
              <span>Raw Log</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Student</th>
                  <th>10-26</th>
                  <th>10-27</th>
                  <th>10-28</th>
                  <th>P</th>
                  <th>A</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Dela Cruz, Juan</td>
                  <td className="p">P</td>
                  <td className="l">L</td>
                  <td className="p">P</td>
                  <td>2</td>
                  <td>0</td>
                </tr>
                <tr>
                  <td>Reyes, Bea</td>
                  <td className="a">A</td>
                  <td className="p">P</td>
                  <td className="e">E</td>
                  <td>1</td>
                  <td>1</td>
                </tr>
                <tr>
                  <td>Santos, Miguel</td>
                  <td className="p">P</td>
                  <td className="p">P</td>
                  <td className="p">P</td>
                  <td>3</td>
                  <td>0</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="muted small">
            <FileSpreadsheet size={14} /> Opens in Excel, Google Sheets or WPS. Header rows show the school, school year, section and teacher.
          </p>
        </Card>
      </div>
      {warnOpen && (
        <Modal
          title="This file contains learners' personal data"
          onClose={() => setWarnOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setWarnOpen(false)}>
                Cancel
              </button>
              <button className="btn btn-ink" onClick={run}>
                <Download size={16} /> I understand, download
              </button>
            </>
          }
        >
          <p className="warn-row">
            <ShieldAlert size={20} /> Keep it on a school device, do not post it in group chats, and delete copies you no longer need. This download
            is recorded in the audit log (Data Privacy Act of 2012).
          </p>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------
// ALERTS: streak alerts (always specific: absent / late / both), failed texts, and calendar changes.
// kindOf() decides which tab an alert belongs to.
// ---------------------------------------------------------------------
const kindOf = (n) =>
  n.kind === 'calendar'
    ? 'calendar'
    : n.kind === 'sms_failed'
      ? 'sms'
      : !n.streak
        ? 'absent'
        : n.streak.late === 0
          ? 'absent'
          : n.streak.absent === 0
            ? 'late'
            : 'mixed';
// The icon shown next to each kind of alert.
const ICON = { absent: UserX, late: Clock3, mixed: Shuffle, sms: MessageSquareWarning, calendar: CalendarClock, all: UserX };
export function Notifications() {
  const repo = useRepo();
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = raw === 'streak' ? 'all' : (raw ?? 'all');
  const { data } = useLive(async (r) => ({ list: await r.listNotifications(), sms: await r.listSms(500) }));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={300} />
      </div>
    );
  const list = data.list.filter((n) => (raw === 'streak' ? n.kind === 'streak' : tab === 'all' || kindOf(n) === tab));
  const failedFor = (n) => data.sms.find((m) => m.status === 'failed' && m.studentId === n.studentId);
  const count = (t) => data.list.filter((n) => kindOf(n) === t).length;
  const tabs = [
    ['all', 'All'],
    ['absent', `Absent ${count('absent')}`],
    ['late', `Late ${count('late')}`],
    ['mixed', `Absent and late ${count('mixed')}`],
    ['sms', `SMS problems ${count('sms')}`],
    ['calendar', `Calendar changes ${count('calendar')}`],
  ];
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Alerts</h1>
          <p className="page-sub">Absences and lateness in a row, failed texts, and calendar changes from the admin</p>
        </div>
        <button className="btn" onClick={() => repo.markNotificationsRead()}>
          <CheckCheck size={17} /> Mark all read
        </button>
      </div>
      <div className="chips">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            className={`fchip ${tab === k && raw !== 'streak' ? 'fchip-on' : ''}`}
            onClick={() => setParams(k === 'all' ? {} : { tab: k })}
          >
            {label}
          </button>
        ))}
      </div>
      <Card>
        {list.length === 0 ? (
          <Empty title="Nothing here" hint="Alerts appear when a child is absent or late 3 school days in a row, or a text fails." />
        ) : (
          <ul className="notes">
            {list.map((n) => {
              const k = kindOf(n);
              const Icon = ICON[k];
              const failed = n.kind === 'sms_failed' ? failedFor(n) : undefined;
              return (
                <li key={n.id} className={`note ${n.read ? '' : 'unread'}`}>
                  <span className={`note-icon note-${k}`}>
                    <Icon size={18} />
                  </span>
                  <div>
                    <strong>{n.title}</strong>
                    {n.streak && <span className={`streak note-chip ${k === 'late' ? '' : 'streak-hot'}`}>{streakShort(n.streak)}</span>}
                    <p>{n.body}</p>
                    <span className="muted small">{format(new Date(n.createdAt), 'EEE, MMM d · h:mm a')}</span>
                  </div>
                  <div className="note-actions">
                    {failed && (
                      <button className="btn btn-sm" onClick={() => repo.resendSms(failed.id)}>
                        <RotateCw size={15} /> Resend
                      </button>
                    )}
                    {n.kind === 'calendar' && (
                      <Link className="link" to="/calendar">
                        Calendar <ArrowUpRight size={14} />
                      </Link>
                    )}
                    {n.studentId && (
                      <Link
                        className="link"
                        to={`/students?q=${encodeURIComponent(
                          n.title
                            .split(' was ')[0]
                            .replace(/^Text to | guardian.*$/g, '')
                            .replace(/'s$/, ''),
                        )}`}
                      >
                        Student <ArrowUpRight size={14} />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------
// SMS MESSAGES: every text sent to parents, grouped by day, with a phone-style preview.
// (Texts are simulated: they are saved, not really sent. See queueSms in engine.js.)
// ---------------------------------------------------------------------
// The filter chips at the top. k = the SMS kind ('failed' filters by status instead).
const KINDS = [
  { k: 'all', label: 'All' },
  { k: 'arrival', label: 'Arrived' },
  { k: 'late', label: 'Arrived late' },
  { k: 'streak', label: '3-day alerts' },
  { k: 'failed', label: 'Failed' },
  { k: 'test', label: 'Tests' },
];
// The day part of a text's time stamp: '2026-10-29T07:45:00+08:00' -> '2026-10-29'.
const dayOf = (m) => m.createdAt.slice(0, 10);
/** Every text Doorbell sent to parents, grouped by day, with a phone-style preview. */
export function SmsMessages() {
  const repo = useRepo();
  const [kind, setKind] = useState('all');
  const [day, setDay] = useState(''); // '' = all days
  const [newestFirst, setNewestFirst] = useState(true);
  const [selected, setSelected] = useState(null);
  const { data } = useLive(async (r) => ({ sms: await r.listSms(1000), students: await r.listStudentRows().catch(() => []) }));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const byKind = data.sms.filter((m) => kind === 'all' || (kind === 'failed' ? m.status === 'failed' : m.kind === kind));
  const list = byKind
    .filter((m) => !day || dayOf(m) === day)
    .sort((a, b) => (newestFirst ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
  const groups = [];
  for (const m of list) {
    const d = dayOf(m);
    if (groups[groups.length - 1]?.date !== d) groups.push({ date: d, items: [] });
    groups[groups.length - 1].items.push(m);
  }
  const days = [...new Set(byKind.map(dayOf))].sort().reverse();
  const pick = list.find((m) => m.id === selected) ?? list[0];
  const name = (id) => {
    const s = data.students.find((x) => x.student.id === id)?.student;
    return s ? `${s.firstName} ${s.lastName}` : '';
  };
  const today = manilaToday();
  const dayTitle = (d) => (d === today ? `Today, ${format(parseISO(d), 'MMMM d')}` : format(parseISO(d), 'EEEE, MMMM d'));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>SMS Messages</h1>
          <p className="page-sub">
            {repo.mode === 'demo' ? 'Demo: messages are simulated, nothing is actually sent' : 'Messages sent to parents and guardians'}
          </p>
        </div>
        <div className="head-actions">
          <label className="sort-pick">
            <CalendarDays size={16} />
            <select className="input" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
              <option value="">All days</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayTitle(d)} ({byKind.filter((m) => dayOf(m) === d).length})
                </option>
              ))}
            </select>
          </label>
          {day && (
            <button className="icon-btn sm" onClick={() => setDay('')} aria-label="Show all days">
              <X size={15} />
            </button>
          )}
          <button className="btn" onClick={() => setNewestFirst((v) => !v)}>
            <ArrowDownUp size={16} /> {newestFirst ? 'Newest day first' : 'Oldest day first'}
          </button>
        </div>
      </div>
      <div className="chips">
        {KINDS.map(({ k, label }) => (
          <button key={k} className={`fchip ${kind === k ? 'fchip-on' : ''}`} onClick={() => setKind(k)}>
            {label}
            <b className="count">
              {k === 'all' ? data.sms.length : data.sms.filter((m) => (k === 'failed' ? m.status === 'failed' : m.kind === k)).length}
            </b>
          </button>
        ))}
      </div>
      <div className="sms-layout">
        <Card>
          {list.length === 0 ? (
            <Empty title="No messages here" hint={day ? 'Try another day.' : undefined} />
          ) : (
            <div className="sms-list">
              {groups.map((g) => (
                <section key={g.date} className="sms-day">
                  <h3 className="sms-day-head">
                    <span>{dayTitle(g.date)}</span>
                    <b>
                      {g.items.length} {g.items.length === 1 ? 'text' : 'texts'}
                    </b>
                  </h3>
                  <ul>
                    {g.items.map((m) => (
                      <li key={m.id}>
                        <button
                          className={`sms-row ${pick?.id === m.id ? 'on' : ''} ${m.status === 'failed' ? 'bad' : ''}`}
                          onClick={() => setSelected(m.id)}
                        >
                          <span className={`kind kind-${m.kind}`}>{m.kind === 'streak' ? '3-day' : m.kind}</span>
                          <span className="sms-to">
                            <strong>{name(m.studentId) || displayPhMobile(m.to)}</strong>
                            <span className="muted small">
                              {displayPhMobile(m.to)} · {format(new Date(m.createdAt), 'h:mm a')}
                            </span>
                          </span>
                          <span className={`tag ${m.status === 'failed' ? 'tag-bad' : 'tag-ok'}`}>{m.status === 'failed' ? 'Failed' : 'Sent'}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>
        <div className="phone-col">
          <div className="phone">
            <div className="phone-notch" />
            <div className="phone-screen">
              {!pick ? (
                <p className="sim-empty">
                  <MessageSquareText size={20} /> No message selected
                </p>
              ) : (
                <>
                  <p className="phone-from">
                    <Smartphone size={14} /> {displayPhMobile(pick.to)}
                  </p>
                  <div className={`bubble ${pick.status === 'failed' ? 'bubble-failed' : ''}`}>
                    <p>{pick.body}</p>
                    <div className="bubble-meta">
                      <span>{format(new Date(pick.createdAt), 'MMM d, h:mm a')}</span>
                      <span>
                        {pick.body.length} chars · {smsSegments(pick.body)} SMS
                      </span>
                    </div>
                  </div>
                  {pick.status === 'failed' && (
                    <button className="btn btn-sm" onClick={() => repo.resendSms(pick.id)}>
                      <RotateCw size={15} /> Resend
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// SETTINGS: account details, password reset, each class's schedule, and previews of the parent texts.
// Schedules and texts are changed by the admin.
// ---------------------------------------------------------------------
export function SettingsPage() {
  const repo = useRepo();
  const [msg, setMsg] = useState(null);
  const { data } = useLive(async (r) => {
    const session = await r.getSession();
    const classes = await Promise.all(session.sectionIds.map((id) => r.getSection(id)));
    return { session, settings: await r.getSettings(), classes };
  });
  if (!data)
    return (
      <div className="page">
        <Skeleton h={300} />
      </div>
    );
  const { session, settings, classes } = data;
  const sample = { count: 3, absent: 2, late: 1 };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Your account and class rules</p>
        </div>
      </div>
      <div className="grid-2">
        <Card title="Account">
          <dl className="dl">
            <dt>Name</dt>
            <dd>{session.name}</dd>
            <dt>Email</dt>
            <dd>{session.email}</dd>
            <dt>{classes.length > 1 ? 'Classes' : 'Class'}</dt>
            <dd>{classes.length ? classes.map((c) => c.name).join(', ') : 'Not assigned'}</dd>
          </dl>
          <button
            className="btn"
            onClick={async () => {
              try {
                await repo.sendPasswordReset(session.email);
                setMsg(`A password reset link was sent to ${session.email}.`);
              } catch (e) {
                setMsg(e.message);
              }
            }}
          >
            <KeyRound size={16} /> Change password
          </button>
          {msg && <p className="muted small">{msg}</p>}
        </Card>
        {classes.map(({ id, name, schedule: s }) => (
          <Card key={id} title={classes.length > 1 ? `${name} schedule (set by admin)` : 'Class schedule (set by admin)'}>
            <dl className="dl">
              <dt>Class time</dt>
              <dd>
                {to12h(s.startTime)} to {to12h(s.endTime)}
              </dd>
              <dt>Scanning opens</dt>
              <dd>{to12h(fromMinutes(toMinutes(s.startTime) - s.scanWindowMins))}</dd>
              <dt>Late after</dt>
              <dd>{to12h(fromMinutes(toMinutes(s.startTime) + s.lateCutoffMins))}</dd>
              <dt>Auto-confirm</dt>
              <dd>{to12h(autoFinalizeTime(s))}</dd>
              <dt>Parents texted after</dt>
              <dd>{settings.streakDays} school days absent or late in a row</dd>
              <dt>Arrival SMS</dt>
              <dd>{settings.arrivalSmsEnabled ? 'On' : 'Off'}</dd>
            </dl>
          </Card>
        ))}
      </div>
      <Card title="SMS messages parents receive">
        <div className="templates">
          {['en', 'fil'].map((lang) => (
            <div key={lang}>
              <h3>{lang === 'en' ? 'English' : 'Filipino'}</h3>
              {['arrival', 'late', 'streak'].map((k) => {
                const text = renderTemplate(settings.templates[lang][k], {
                  child: 'Juan',
                  time: '7:42 AM',
                  school: settings.schoolName,
                  contact: settings.contactNumber,
                  streak: describeStreak(sample, lang),
                });
                return (
                  <div key={k} className="tpl">
                    <span className={`kind kind-${k}`}>{k === 'streak' ? '3-day alert' : k}</span>
                    <p>{text}</p>
                    <span className={`muted small ${text.length > 160 ? 'over' : ''}`}>
                      {text.length}/160 · {smsSegments(text)} SMS
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="muted small">
          The 3-day alert always says exactly what happened: absent, late, or both (for example "absent 2 days and late 1 day").
        </p>
      </Card>
    </div>
  );
}
