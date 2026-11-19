import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  ArrowUpRight,
  UserPlus,
  Users,
  Shapes,
  MessageSquareWarning,
  PhoneOff,
  UserX,
  Save,
  ShieldAlert,
} from 'lucide-react';
import {
  useLive,
  Card,
  CountUp,
  Skeleton,
  useRepo,
  LevelChips,
  countByGrade,
} from '../ui';
import { LEVEL_BANDS, bandOf } from './Sections';
import { autoFinalizeTime, isSchoolDay } from '../logic';
import { useState } from 'react';
import { SAMPLE_TEACHER_PASSWORD } from '../firebase';

// =====================================================================
// ADMIN OVERVIEW (/admin): today across every class, urgent "in school but not in class"
// children, and the "Load sample school" card for an empty school.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
/**
 * "Load sample school" card (cloud mode, empty school only).
 * Calls engine.loadSampleSchool() in firebase.js, which creates 4 teacher accounts
 * and about 1,000 documents: sections, children, guardians and attendance history.
 */
function SampleSchool() {
  const repo = useRepo();
  const [status, setStatus] = useState(null); // progress text while loading
  const [result, setResult] = useState(null); // summary when finished
  if (!repo.loadSampleSchool) return null; // demo mode already has sample data
  const run = async () => {
    if (
      !confirm(
        'Load the sample school? This adds Kindergarten to Grade 6 (3 sections each, 20 pupils per section), 23 teachers and the last 3 weeks of attendance (about 2,700 records).',
      )
    )
      return;
    try {
      setResult(await repo.loadSampleSchool(setStatus));
    } catch (e) {
      setStatus(`Stopped: ${e.message}`);
    }
  };
  return (
    <Card title="Start with sample data?">
      {result ? (
        <>
          <p>
            Done: {result.documents} records saved. Sample teachers can sign in with password <code>{SAMPLE_TEACHER_PASSWORD}</code>:
          </p>
          <ul>
            {result.teachers.map((t) => (
              <li key={t}>
                <code>{t}</code>
              </li>
            ))}
          </ul>
          {result.problems.length > 0 && <p className="error">{result.problems.join('; ')}</p>}
          <p className="muted small">Last step: let the parents' view catch up (about 860 records).</p>
          <button
            className="btn"
            disabled={!!status && status !== 'done'}
            onClick={async () => {
              setStatus('Updating the parent portal…');
              const r = await repo.syncParentPortal();
              setStatus('done');
              alert(`Parent portal updated: ${r.parents} parents, ${r.months} months.`);
            }}
          >
            Update parent portal
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            The school is empty. Load a sample school (Sunnyside Elementary School, Kindergarten to Grade 6) to try every feature, or add your own sections, teachers and students.
          </p>
          <button className="btn btn-ink" onClick={run} disabled={!!status}>
            <Save size={16} /> {status ?? 'Load sample school'}
          </button>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// OVERVIEW: school-wide numbers, each section's arrivals today, what needs fixing, upcoming calendar.
// ---------------------------------------------------------------------
export function AdminDashboard() {
  const [level, setLevel] = useState('all'); // "Today by section": one grade level or all
  const { data } = useLive(async (r) => {
    const today = await r.getToday();
    const sections = (await r.listSections()).filter((s) => !s.archived);
    const rows = await r.listStudentRows();
    const teachers = await r.listTeachers();
    const calendar = await r.getCalendar();
    const sms = await r.listSms(1000);
    const perSection = await Promise.all(
      sections.map(async (s) => {
        const roster = await r.getRoster(s.id, today.date);
        return {
          section: s,
          total: roster.length,
          arrived: roster.filter((x) => x.record?.scannedAt).length,
          left: roster.filter((x) => x.record?.scannedAt && x.record?.scannedOut).length,
          // Has class today (not a holiday, suspension or cancelled class): only these count at the gate.
          hasClass: isSchoolDay(today.actualDate, s.schedule, calendar),
          confirmation: await r.getConfirmation(s.id, today.date),
          away: s.schedule.teacherAway?.[today.date] ?? null,
        };
      }),
    );
    // Children scanned at the gate but marked absent in class (urgent), newest first.
    const missing = (await r.listNotifications()).filter((n) => n.kind === 'missing' && !n.read);
    return { today, sections, rows, teachers, calendar, sms, perSection, missing, session: await r.getSession() };
  });
  const repo = useRepo();
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const { today, rows, teachers, calendar, sms, perSection, session } = data;
  const enrolled = rows.filter((r) => r.enrollment?.status === 'active').length;
  const unassigned = rows.filter((r) => !r.enrollment || r.enrollment.status !== 'active').filter((r) => !r.enrollment).length;
  const smsToday = sms.filter((m) => m.createdAt.startsWith(today.date));
  const failed = sms.filter((m) => m.status === 'failed');
  const fixNumbers = rows.filter((r) => r.guardian?.numberStatus === 'failed');
  const upcoming = calendar.filter((c) => c.date > today.date && c.type !== 'event').slice(0, 5);
  const noTeacher = data.sections.filter((s) => !s.teacherId);
  const teacherName = (id) => teachers.find((t) => t.id === id)?.name ?? 'a teacher';
  // A class nobody confirmed today (closed automatically) with no teacher away planned: the teacher may be absent.
  const unconfirmedByTeacher = perSection.filter(
    (p) =>
      !p.away &&
      ((p.confirmation?.auto && p.confirmation.date === today.date) ||
        // no teacher has confirmed yet and first period is over
        (!p.confirmation && today.isSchoolDay && today.date === today.actualDate && p.total > 0 && today.time >= autoFinalizeTime(p.section.schedule))),
  );
  // What the "Today by section" line says under each class.
  const statusOf = ({ confirmation, away }) => {
    if (away?.kind === 'noclass') return 'No class today (teacher absent)';
    const sub = away?.kind === 'substitute' ? `Substitute: ${teacherName(away.teacherId)} · ` : '';
    if (!confirmation) return `${sub}Not yet confirmed`;
    return `${sub}${confirmation.auto ? 'Not confirmed by a teacher (closed automatically, no texts)' : `Confirmed by ${confirmation.confirmedBy}`}`;
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>School overview</h1>
          <p className="page-sub">Good day, {session?.name.split(' ')[0] ?? ''}</p>
        </div>
        <p className="muted">
          {format(parseISO(today.actualDate ?? today.date), 'EEEE, MMMM d, yyyy')}
          {today.actualDate && today.date !== today.actualDate && <span className="block small">Showing {format(parseISO(today.date), 'EEE, MMM d')}, the last class day</span>}
        </p>
      </div>
      {/* URGENT: the gate saw these children, but their teacher marked them absent in class. */}
      {data.missing.length > 0 && (
        <div className="urgent">
          <div className="urgent-head">
            <ShieldAlert size={20} />
            <strong>
              {data.missing.length === 1 ? '1 child is' : `${data.missing.length} children are`} in school but not in class
            </strong>
          </div>
          <ul>
            {data.missing.map((n) => (
              <li key={n.id}>
                <div>
                  <b>{n.title}</b>
                  <span>{n.body}</span>
                  <span className="small">{format(new Date(n.createdAt), 'EEE, MMM d · h:mm a')}</span>
                </div>
                <button className="btn btn-sm" onClick={() => repo.markNotificationsRead([n.id])}>
                  Found, checked
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* A brand-new cloud school has no sections: offer to fill it with sample data. */}
      {data.sections.length === 0 && <SampleSchool />}
      {/* At the gate today: updates the moment a child scans (the admin page listens to attendance live). */}
      {today.date === today.actualDate && (
        <div className="gate-live" aria-live="polite">
          <span className="live-dot" aria-hidden="true" />
          <b>At the gate today</b>
          <span>
            <strong>{perSection.reduce((n, p) => n + p.arrived, 0)}</strong> of {perSection.filter((p) => p.hasClass).reduce((n, p) => n + p.total, 0)}{' '}
            scanned in
          </span>
          <span>
            <strong>{perSection.reduce((n, p) => n + p.left, 0)}</strong> scanned out
          </span>
          <span>
            <strong>{perSection.reduce((n, p) => n + p.arrived - p.left, 0)}</strong> still at school
          </span>
          <span className="muted small">Live: updates as each child scans</span>
        </div>
      )}
      <div className="kpis">
        <div className="kpi tile-lime">
          <Users size={20} />
          <strong>
            <CountUp value={enrolled} />
          </strong>
          <span>learners enrolled</span>
        </div>
        <Link to="/admin/students?filter=unassigned" className="kpi tile-peach">
          <UserPlus size={20} />
          <strong>
            <CountUp value={unassigned} />
          </strong>
          <span>not yet in a section</span>
        </Link>
        <div className="kpi tile-lavender">
          <Shapes size={20} />
          <strong>
            <CountUp value={data.sections.length} />
          </strong>
          <span>sections · {teachers.filter((t) => t.active !== false).length} teachers</span>
        </div>
        <div className="kpi tile-sky">
          <MessageSquareWarning size={20} />
          <strong>
            <CountUp value={smsToday.length} />
          </strong>
          <span>SMS today · {failed.length} failed</span>
        </div>
      </div>

      <div className="grid-2">
        <Card
          title="Today by section"
          action={
            <Link className="link" to="/admin/sections">
              Sections <ArrowUpRight size={15} />
            </Link>
          }
        >
          {/* Grouped by level: Kindergarten, Grades 1 to 3, Grades 4 to 6. */}
          <LevelChips value={level} onChange={setLevel} counts={countByGrade(perSection, (p) => p.section.gradeLevel ?? 'K')} />
          {LEVEL_BANDS.filter((band) => level === 'all' || band.id === level).map((band) => {
            const items = perSection.filter((p) => bandOf(p.section.gradeLevel) === band.id);
            if (!items.length) return null;
            return (
              <div key={band.id}>
                <h3 className="band-sub">{band.label}</h3>
          <ul className="sec-today">
            {items.map((p) => {
              const { section, total, arrived } = p;
              return (
              <li key={section.id}>
                <span className="sec-dot" style={{ background: section.color }} />
                <div>
                  <strong>{section.name}</strong>
                  <span className="muted small">{statusOf(p)}</span>
                </div>
                <div className="mini-bar">
                  <div style={{ width: `${total ? (arrived / total) * 100 : 0}%`, background: section.color }} />
                </div>
                <b>
                  {arrived}/{total}
                </b>
              </li>
              );
            })}
          </ul>
              </div>
            );
          })}
        </Card>
        <Card title="Needs your attention">
          <ul className="todo">
            {unassigned > 0 && (
              <li>
                <UserPlus size={18} />
                <span>{unassigned} learners are not in a section.</span>
                <Link className="link" to="/admin/students?filter=unassigned">
                  Auto-assign
                </Link>
              </li>
            )}
            {noTeacher.map((s) => (
              <li key={s.id}>
                <Shapes size={18} />
                <span>{s.name} has no teacher.</span>
                <Link className="link" to="/admin/sections">
                  Assign
                </Link>
              </li>
            ))}
            {fixNumbers.map((r) => (
              <li key={r.student.id}>
                <PhoneOff size={18} />
                <span>
                  SMS to {r.student.firstName} {r.student.lastName}'s guardian failed. Update the number.
                </span>
                <Link className="link" to={`/admin/students?q=${encodeURIComponent(r.student.lastName)}`}>
                  Open
                </Link>
              </li>
            ))}
            {unconfirmedByTeacher.map(({ section }) => (
              <li key={`auto-${section.id}`}>
                <UserX size={18} />
                <span>No teacher confirmed {section.name} today. Is the teacher absent?</span>
                <Link className="link" to="/admin/sections">
                  Teacher absent
                </Link>
              </li>
            ))}
            {unassigned === 0 && noTeacher.length === 0 && fixNumbers.length === 0 && unconfirmedByTeacher.length === 0 && (
              <li>
                <span>All clear.</span>
              </li>
            )}
          </ul>
        </Card>
      </div>

      <Card
        title="Coming up on the calendar"
        action={
          <Link className="link" to="/admin/calendar">
            Edit calendar <ArrowUpRight size={15} />
          </Link>
        }
      >
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
    </div>
  );
}
