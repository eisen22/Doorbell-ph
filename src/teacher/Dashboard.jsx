import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  ArrowUpRight,
  Lock,
  ChevronRight,
  BookOpenCheck,
  CalendarClock,
  Check,
} from 'lucide-react';
import {
  autoFinalizeTime,
  describeStreak,
  fromMinutes,
  to12h,
  toMinutes,
  classPhase,
  shortClassName,
} from '../logic';
import {
  useLive,
  useRepo,
  textOn,
  loadMyClasses,
  useClassParam,
  Avatar,
  Card,
  Empty,
  Skeleton,
  StreakChip,
} from '../ui';

// =====================================================================
// TEACHER DASHBOARD (/): my classes today and the children who need attention.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// Words shown on each class card depending on the time (see classPhase in logic.js).
const PHASE = { now: 'In session now', next: 'Later today', done: 'Done for today', off: 'No class today' };
// ---------------------------------------------------------------------
// DASHBOARD
// Order: calendar notices from the admin -> my classes today -> attention needed
// (each child opens Absence Watch with their attendance calendar).
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
      const perClass = await Promise.all(
        classes.map(async (c) => ({
          section: c,
          roster: await r.getRoster(c.id, today.date),
          confirmation: await r.getConfirmation(c.id, today.date),
        })),
      );
      const sms = (await r.listSms(500)).filter((m) => m.createdAt.startsWith(today.date));
      const notes = await r.listNotifications();
      const attention = await r.listAttention(2);
      return { session, today, classes, current, section, calendar, settings, perClass, sms, notes, attention };
    },
    [classId],
  );
  if (!data) return <DashboardSkeleton />;
  const { session, today, classes, section, perClass, calendar, settings, sms, notes, attention } = data;
  const failed = sms.filter((m) => m.status === 'failed').length;
  const unreadStreaks = notes.filter((n) => !n.read && n.kind === 'streak').length;
  const calendarNotes = notes.filter((n) => n.kind === 'calendar' && !n.read).slice(0, 3);
  const hour = Number(today.time.slice(0, 2));
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const todayEntry = calendar.find((c) => c.date === today.date);
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

      {/* One card per class (the class in session is marked). */}
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
          <Link className="link" to="/absences">
            Absence Watch <ArrowUpRight size={15} />
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
                {/* Click a card: Absence Watch opens, showing this learner's attendance calendar. */}
                <Link to={`/absences?student=${r.student.id}`} className="attention-link" title="Open in Absence Watch">
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
    </div>
  );
}
