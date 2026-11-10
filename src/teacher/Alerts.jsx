import { Link, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import {
  ArrowUpRight,
  CalendarClock,
  ShieldAlert,
  UserX,
  Clock3,
  Shuffle,
  MessageSquareWarning,
  RotateCw,
  CheckCheck,
} from 'lucide-react';
import {
  useLive,
  useRepo,
  Card,
  Empty,
  Skeleton,
  streakShort,
} from '../ui';

// =====================================================================
// ALERTS (/notifications): children not in class, 3-day absences, failed texts, calendar changes.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// ALERTS: streak alerts (always specific: absent / late / both), failed texts, and calendar changes.
// kindOf() decides which tab an alert belongs to.
// ---------------------------------------------------------------------
const kindOf = (n) =>
  n.kind === 'missing'
    ? 'missing'
    : n.kind === 'calendar' || n.kind === 'cover'
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
const ICON = { missing: ShieldAlert, absent: UserX, late: Clock3, mixed: Shuffle, sms: MessageSquareWarning, calendar: CalendarClock, all: UserX };
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
    ['missing', `Not in class ${count('missing')}`],
    ['absent', `Absent ${count('absent')}`],
    ['late', `Late ${count('late')}`],
    ['mixed', `Absent and late ${count('mixed')}`],
    ['sms', `SMS problems ${count('sms')}`],
    ['calendar', `Calendar and substitutes ${count('calendar')}`],
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
