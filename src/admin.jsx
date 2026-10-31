import { Link, useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  ArrowUpRight,
  UserPlus,
  Users,
  Shapes,
  MessageSquareWarning,
  PhoneOff,
  Phone,
  MessageSquareText,
  MessageSquareOff,
  ArrowDownUp,
  CloudRain,
  RotateCcw,
  Pencil,
  Trash2,
  Flag,
  Plus,
  Archive,
  ArchiveRestore,
  Clock,
  LogOut,
  GraduationCap,
  ChevronRight,
  UserX,
  UserCheck,
  Info,
  Upload,
  Wand2,
  Undo2,
  QrCode,
  FileDown,
  AlertTriangle,
  CheckCircle2,
  Printer,
  Search,
  Save,
  Send,
} from 'lucide-react';
import {
  useLive,
  Card,
  CountUp,
  Skeleton,
  Avatar,
  Empty,
  StreakChip,
  useRepo,
  Modal,
  Toast,
  CalendarLegend,
  YearCalendar,
  DatePicker,
  textOn,
  Logo,
} from './ui';
import { useState, useMemo, useEffect, useRef } from 'react';
import {
  displayPhMobile,
  DAY_KIND_META,
  DEPED_SY_2026_2027,
  countClassDays,
  dayKind,
  eachDate,
  addDays,
  isoWeekday,
  fromMinutes,
  to12h,
  toMinutes,
  normalizePhMobile,
  ASSIGN_METHODS,
  autoAssign,
  manilaToday,
  describeStreak,
  renderTemplate,
  smsSegments,
  isGsmPlain,
} from './logic';
import { downloadTemplate, readRows, validateRows } from './files';
import { SAMPLE_TEACHER_PASSWORD } from './firebase';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';

// =====================================================================
// admin.jsx — EVERY SCREEN OF THE ADMIN PORTAL (addresses start with /admin)
// ---------------------------------------------------------------------
//  Overview        (/admin)            Students       (/admin/students)
//  Absence Watch   (/admin/absences)   ID Cards       (/admin/cards)
//  School Calendar (/admin/calendar)   SMS Messages   (/admin/sms, shared with teachers, in teacher.jsx)
//  Sections        (/admin/sections)   Settings & SMS (/admin/settings)
//  Teachers        (/admin/teachers)   Audit Log      (/admin/audit)
// Same pattern as teacher.jsx: useLive(...) loads data, buttons call repo.something(...).
// Pop-up forms (StudentModal, TeacherModal, LeaveModal...) are shared between screens.
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
    if (!confirm('Load the sample school? This adds 4 teachers, 4 sections, 89 children and attendance since June 8.')) return;
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
        </>
      ) : (
        <>
          <p className="muted">
            The school is empty. Load a sample kindergarten (Sunnyside Kinder) to try every feature, or add your own sections, teachers and students.
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
          confirmed: !!(await r.getConfirmation(s.id, today.date)),
        };
      }),
    );
    return { today, sections, rows, teachers, calendar, sms, perSection, session: await r.getSession() };
  });
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
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>School overview</h1>
          <p className="page-sub">Good day, {session?.name.split(' ')[0] ?? ''}</p>
        </div>
        <p className="muted">{format(parseISO(today.date), 'EEEE, MMMM d, yyyy')}</p>
      </div>
      {/* A brand-new cloud school has no sections: offer to fill it with sample data. */}
      {data.sections.length === 0 && <SampleSchool />}
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
          <ul className="sec-today">
            {perSection.map(({ section, total, arrived, confirmed }) => (
              <li key={section.id}>
                <span className="sec-dot" style={{ background: section.color }} />
                <div>
                  <strong>{section.name}</strong>
                  <span className="muted small">{confirmed ? 'Confirmed' : 'Not yet confirmed'}</span>
                </div>
                <div className="mini-bar">
                  <div style={{ width: `${total ? (arrived / total) * 100 : 0}%`, background: section.color }} />
                </div>
                <b>
                  {arrived}/{total}
                </b>
              </li>
            ))}
          </ul>
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
            {unassigned === 0 && noTeacher.length === 0 && fixNumbers.length === 0 && (
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

// ---------------------------------------------------------------------
// ABSENCE WATCH: children absent or late 2+ school days in a row in every section.
// Filter by section and kind, sort by days/section/name. Numbers instead of dates (hover for dates).
// ---------------------------------------------------------------------
/** Students absent or late several school days in a row, across all sections. */
export function AbsenceWatch() {
  const [kind, setKind] = useState('all');
  const [sectionId, setSectionId] = useState('all');
  const [sort, setSort] = useState('days');
  const { data } = useLive(async (r) => ({
    rows: await r.listAttention(2),
    settings: await r.getSettings(),
    today: await r.getToday(),
    sections: (await r.listSections()).filter((s) => !s.archived),
  }));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const t = data.settings.streakDays;
  const match = (r) =>
    (sectionId === 'all' || r.section.id === sectionId) &&
    (kind === 'all' ||
      (kind === 'absent' ? r.streak.late === 0 : kind === 'late' ? r.streak.absent === 0 : r.streak.absent > 0 && r.streak.late > 0));
  const byName = (a, b) => a.student.lastName.localeCompare(b.student.lastName) || a.student.firstName.localeCompare(b.student.firstName);
  const sorter = (a, b) =>
    sort === 'section'
      ? a.section.name.localeCompare(b.section.name) || b.streak.count - a.streak.count || byName(a, b)
      : sort === 'name'
        ? byName(a, b)
        : b.streak.count - a.streak.count || a.section.name.localeCompare(b.section.name) || byName(a, b);
  const rows = data.rows.filter(match).sort(sorter);
  const hot = rows.filter((r) => r.streak.count >= t);
  const watch = rows.filter((r) => r.streak.count < t);
  const countIn = (id) => data.rows.filter((r) => r.section.id === id && r.streak.count >= t).length;
  /** "Oct 26 to 28" style range, shown on hover so the table stays compact. */
  const range = (r) => {
    const d = [...r.streak.dates].reverse();
    if (!d.length) return '';
    const a = parseISO(d[0]);
    const b = parseISO(d[d.length - 1]);
    return `${d.map((x) => format(parseISO(x), 'MMM d')).join(', ')} (${format(a, 'MMM d')} to ${format(b, 'MMM d')})`;
  };
  const table = (list) => (
    <div className="table-wrap">
      <table className="table watch-table">
        <thead>
          <tr>
            <th>Learner</th>
            <th>Section</th>
            <th className="num">Absent</th>
            <th className="num">Late</th>
            <th className="num">Days in a row</th>
            <th>Guardian</th>
            <th>Parent SMS</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.student.id}>
              <td>
                <Link to={`/admin/students?q=${encodeURIComponent(r.student.lastName)}`} className="cell-person">
                  <Avatar first={r.student.firstName} last={r.student.lastName} tone={r.section.color} />
                  <span>
                    <strong>
                      {r.student.lastName}, {r.student.firstName}
                    </strong>
                    <StreakChip s={r.streak} threshold={t} />
                  </span>
                </Link>
              </td>
              <td>
                <span className="tag" style={{ background: r.section.color }}>
                  {r.section.name.replace('Kindergarten', 'Kinder')}
                </span>
              </td>
              <td className="num">
                <b className={r.streak.absent ? 'n-absent' : 'n-zero'}>{r.streak.absent}</b>
              </td>
              <td className="num">
                <b className={r.streak.late ? 'n-late' : 'n-zero'}>{r.streak.late}</b>
              </td>
              <td className="num" title={range(r)}>
                <b className="n-total">{r.streak.count}</b>
              </td>
              <td>
                {r.guardian ? (
                  <>
                    {r.guardian.name}
                    <a className="link block small" href={`tel:${r.guardian.mobile}`}>
                      <Phone size={13} /> {displayPhMobile(r.guardian.mobile)}
                    </a>
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td>
                {r.smsSent ? (
                  <span className="tag tag-ok">
                    <MessageSquareText size={13} /> Texted
                  </span>
                ) : !r.guardian?.smsConsent ? (
                  <span className="tag tag-bad">
                    <MessageSquareOff size={13} /> No consent: call
                  </span>
                ) : (
                  <span className="tag tag-off">At {t} days</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Absence Watch</h1>
          <p className="page-sub">As of {format(parseISO(data.today.date), 'EEEE, MMMM d')} · school days only</p>
        </div>
        <label className="sort-pick">
          <ArrowDownUp size={16} />
          <select className="input" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort by">
            <option value="days">Sort: most days first</option>
            <option value="section">Sort: by section</option>
            <option value="name">Sort: by name</option>
          </select>
        </label>
      </div>
      <div className="chips">
        <button className={`fchip ${sectionId === 'all' ? 'fchip-on' : ''}`} onClick={() => setSectionId('all')}>
          All sections
        </button>
        {data.sections.map((s) => (
          <button key={s.id} className={`fchip ${sectionId === s.id ? 'fchip-on' : ''}`} onClick={() => setSectionId(s.id)}>
            <span className="sec-dot sm" style={{ background: s.color }} />
            {s.name.replace('Kindergarten', 'Kinder')}
            {countIn(s.id) > 0 && <b className="count">{countIn(s.id)}</b>}
          </button>
        ))}
      </div>
      <div className="chips">
        {[
          ['all', 'Absent or late'],
          ['absent', 'Absent only'],
          ['late', 'Late only'],
          ['mixed', 'Both'],
        ].map(([k, l]) => (
          <button key={k} className={`fchip sm ${kind === k ? 'fchip-on' : ''}`} onClick={() => setKind(k)}>
            {l}
          </button>
        ))}
      </div>
      <Card title={`${t} or more school days in a row (${hot.length})`}>
        {hot.length ? table(hot) : <Empty title="No one right now" hint={`Children appear here after ${t} school days absent or late in a row.`} />}
      </Card>
      <Card title={`Watch list: ${t - 1} days in a row (${watch.length})`}>
        {watch.length ? table(watch) : <Empty title="No one on the watch list" />}
      </Card>
      <p className="muted small">
        Hover over "Days in a row" to see the dates. Excused days, weekends, holidays and suspensions do not count; a day present ends the streak.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------
// SCHOOL CALENDAR: click any day to change it (holiday, suspension, exam, ...).
// Every change alerts all teachers (engine.saveCalendarDays -> notifyCalendar).
// ---------------------------------------------------------------------
// The Friday of a date's week (for the "Through Friday" quick button).
const fridayOf = (d) => addDays(d, Math.max(0, 5 - isoWeekday(d)));
// The choices in the day editor. To add a new kind of day, also add it to DAY_KIND_META in logic.js and give it a color (.k-...) in style.css.
const TYPE_OPTIONS = [
  { value: 'class', hint: 'Normal class day (removes any special entry)' },
  { value: 'event', hint: 'Classes continue, with a school event' },
  { value: 'exam', hint: 'Classes continue: summative test or term exam' },
  { value: 'halfday', hint: 'Classes for half the day' },
  { value: 'holiday', hint: 'No classes, regular or special holiday' },
  { value: 'suspension', hint: 'No classes, e.g. weather or emergency' },
  { value: 'break', hint: 'No classes, e.g. wellness or year-end break' },
  { value: 'makeup', hint: 'Class on a day that is normally off, e.g. Saturday' },
];
export function AdminCalendar() {
  const repo = useRepo();
  const [draft, setDraft] = useState(null);
  const [suspend, setSuspend] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [yearDraft, setYearDraft] = useState(null);
  const [toast, setToast] = useState(null);
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
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const open = (date) => {
    const entry = calendar.find((c) => c.date === date);
    setDraft({
      from: date,
      to: date,
      type: entry?.type ?? 'class',
      label: entry?.label ?? '',
      scope: entry?.scope ?? 'national',
      weekdaysOnly: true,
    });
  };
  // Saves the edited day(s). Choosing "Class day" removes the special entry instead.
  const save = async () => {
    if (!draft) return;
    const dates = eachDate(draft.from, draft.to < draft.from ? draft.from : draft.to).filter(
      (d) => !draft.weekdaysOnly || draft.type === 'makeup' || draft.from === draft.to || isoWeekday(d) <= 5,
    );
    if (draft.type === 'class') {
      await repo.removeCalendarDays(dates);
    } else {
      const label = draft.label.trim() || DAY_KIND_META[draft.type].label;
      await repo.saveCalendarDays(
        dates.map((date) => ({
          date,
          type: draft.type,
          label,
          ...(draft.type === 'holiday' ? { scope: draft.scope } : {}),
        })),
      );
    }
    flash(`${dates.length} day${dates.length > 1 ? 's' : ''} updated. Teachers were notified, and attendance and streaks follow the new calendar.`);
    setDraft(null);
  };
  const upcoming = calendar.filter((c) => c.date >= today.date && c.type !== 'event').slice(0, 10);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>School Calendar</h1>
          <p className="page-sub">
            {year.name} · {countClassDays(year, calendar)} class days
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setResetOpen(true)}>
            <RotateCcw size={17} /> Reset to DepEd template
          </button>
          <button className="btn btn-danger" onClick={() => setSuspend({ date: today.date, label: 'Class suspension: weather' })}>
            <CloudRain size={17} /> Declare suspension
          </button>
        </div>
      </div>
      <Card title="First and last day of classes" action={<Flag size={18} />}>
        <div className="form-row year-row">
          <div className="field">
            <span>First day of classes</span>
            <DatePicker
              value={yearDraft?.start ?? year.start}
              calendar={calendar}
              onChange={(d) => setYearDraft({ start: d, end: yearDraft?.end ?? year.end })}
              ariaLabel="First day of classes"
              quick={[['DepEd: June 8, 2026', '2026-06-08']]}
            />
          </div>
          <div className="field">
            <span>Last day of classes (end of classes)</span>
            <DatePicker
              value={yearDraft?.end ?? year.end}
              min={yearDraft?.start ?? year.start}
              calendar={calendar}
              onChange={(d) => setYearDraft({ start: yearDraft?.start ?? year.start, end: d })}
              ariaLabel="Last day of classes"
              quick={[['DepEd: April 8, 2027', '2027-04-08']]}
            />
          </div>
          <button
            className="btn btn-ink align-end"
            disabled={!yearDraft || yearDraft.end <= yearDraft.start}
            onClick={async () => {
              await repo.updateSchoolYear(yearDraft);
              setYearDraft(null);
              flash('School year dates saved');
            }}
          >
            Save dates
          </button>
        </div>
        <p className="muted small">
          DepEd SY 2026-2027: classes June 8, 2026 to April 8, 2027. Days outside these dates show as no class, and no attendance is taken.
        </p>
      </Card>
      <Card>
        <p className="hint">Click any day to change it. To mark several days at once, set an end date in the editor.</p>
        <CalendarLegend />
        <YearCalendar
          year={year}
          calendar={calendar}
          today={today.date}
          selection={draft ? { from: draft.from, to: draft.to } : null}
          onDayClick={open}
        />
      </Card>
      <Card title="Upcoming no-class days and changes">
        <ul className="cal-list editable">
          {upcoming.map((c) => (
            <li key={c.date}>
              <span className={`swatch k-${c.type} ${c.scope === 'local' ? 'is-local' : ''}`} />
              <time>{format(parseISO(c.date), 'EEE, MMM d')}</time>
              <span>{c.label}</span>
              <button className="icon-btn sm" onClick={() => open(c.date)} aria-label={`Edit ${c.date}`}>
                <Pencil size={15} />
              </button>
              <button
                className="icon-btn sm"
                onClick={async () => {
                  await repo.removeCalendarDays([c.date]);
                  flash('Back to a normal day');
                }}
                aria-label={`Clear ${c.date}`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {draft && (
        <Modal
          title={draft.from === draft.to ? format(parseISO(draft.from), 'EEEE, MMMM d, yyyy') : 'Edit days'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn btn-ink" onClick={save}>
                Save
              </button>
            </>
          }
        >
          <p className="muted small">Now: {DAY_KIND_META[dayKind(draft.from, year, calendar)].label}</p>
          <div className="type-pick" role="radiogroup" aria-label="Day type">
            {TYPE_OPTIONS.map((o) => (
              <label key={o.value} className={`type-opt ${draft.type === o.value ? 'on' : ''}`}>
                <input type="radio" name="type" checked={draft.type === o.value} onChange={() => setDraft({ ...draft, type: o.value })} />
                <span className={`swatch k-${o.value}`} />
                <span>
                  <b>{DAY_KIND_META[o.value].label}</b>
                  <small>{o.hint}</small>
                </span>
              </label>
            ))}
          </div>
          {draft.type !== 'class' && (
            <label className="field">
              <span>Label shown to teachers</span>
              <input
                className="input"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={DAY_KIND_META[draft.type].label}
              />
            </label>
          )}
          {draft.type === 'holiday' && (
            <div className="chips">
              {['national', 'local'].map((s) => (
                <button key={s} className={`fchip ${draft.scope === s ? 'fchip-on' : ''}`} onClick={() => setDraft({ ...draft, scope: s })}>
                  {s === 'national' ? 'National' : 'Local (Baguio)'}
                </button>
              ))}
            </div>
          )}
          <div className="form-row">
            <div className="field">
              <span>From</span>
              <DatePicker
                value={draft.from}
                min={year.start.slice(0, 7) + '-01'}
                calendar={calendar}
                onChange={(d) => setDraft({ ...draft, from: d, to: draft.to < d ? d : draft.to })}
                ariaLabel="From"
              />
            </div>
            <div className="field">
              <span>To (optional)</span>
              <DatePicker
                value={draft.to}
                min={draft.from}
                calendar={calendar}
                onChange={(d) => setDraft({ ...draft, to: d })}
                ariaLabel="To"
                quick={[
                  ['Same day', draft.from],
                  ['Through Friday', fridayOf(draft.from)],
                ]}
              />
            </div>
          </div>
          {draft.to > draft.from && draft.type !== 'makeup' && (
            <label className="check">
              <input type="checkbox" checked={draft.weekdaysOnly} onChange={(e) => setDraft({ ...draft, weekdaysOnly: e.target.checked })} /> Skip
              Saturdays and Sundays
            </label>
          )}
        </Modal>
      )}

      {suspend && (
        <Modal
          title="Declare a class suspension"
          onClose={() => setSuspend(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSuspend(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await repo.declareSuspension(suspend.date, suspend.label);
                  setSuspend(null);
                  flash('Suspension saved and teachers notified. No absences or streak SMS for that day.');
                }}
              >
                Declare suspension
              </button>
            </>
          }
        >
          <p>
            On a suspended day, children are not marked absent, it does not count toward 3-day streaks, and no absence SMS is sent. Every teacher sees
            an alert about it right away.
          </p>
          <div className="field">
            <span>Date</span>
            <DatePicker
              value={suspend.date}
              min={year.start}
              max={year.end}
              calendar={calendar}
              onChange={(d) => setSuspend({ ...suspend, date: d })}
              ariaLabel="Suspension date"
              quick={[
                ['Today', today.actualDate],
                ['Tomorrow', addDays(today.actualDate, 1)],
              ]}
            />
          </div>
          <label className="field">
            <span>Reason</span>
            <input className="input" value={suspend.label} onChange={(e) => setSuspend({ ...suspend, label: e.target.value })} />
          </label>
        </Modal>
      )}

      {resetOpen && (
        <Modal
          title="Reset to the DepEd template?"
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setResetOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-ink"
                onClick={async () => {
                  await repo.resetCalendar(DEPED_SY_2026_2027);
                  setResetOpen(false);
                  flash('Calendar reset to DepEd SY 2026-2027');
                }}
              >
                Reset calendar
              </button>
            </>
          }
        >
          <p>
            This replaces every entry with DepEd Order No. 009, s. 2026 plus Baguio Charter Day. Suspensions and school events you added will be
            removed.
          </p>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------
// SECTIONS: one card per class. Click a card to see its teacher and students (SectionDetail);
// the pencil edits the section's name, color, teacher and times.
// ---------------------------------------------------------------------
// Colors offered for sections. Add any hex color here to offer it.
export const SECTION_COLORS = ['#FFD9A8', '#D8F5A2', '#E4D6FA', '#CDE8F7', '#FBD3E0', '#FFF0A8', '#C9F0E4', '#F2D9C4'];
// Default values for a new section (a morning kindergarten class).
const blank = () => ({
  name: 'Kindergarten I - ',
  color: SECTION_COLORS[3],
  capacity: 25,
  teacherId: null,
  schedule: {
    classDays: [1, 2, 3, 4, 5],
    startTime: '08:00',
    endTime: '11:30',
    scanWindowMins: 30,
    lateCutoffMins: 15,
    autoFinalizeMins: 45,
  },
});
export function Sections() {
  const repo = useRepo();
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [openId, setOpenId] = useState(null);
  const { data } = useLive(async (r) => {
    const [sections, teachers, rows] = await Promise.all([r.listSections(), r.listTeachers(), r.listStudentRows()]);
    const count = (id) => rows.filter((x) => x.enrollment?.sectionId === id && x.enrollment.status === 'active').length;
    return { sections, teachers, rows, count };
  });
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const list = data.sections.filter((s) => showArchived || !s.archived);
  const teacherName = (id) => data.teachers.find((t) => t.id === id)?.name;
  // Checks the form, then saves. The engine refuses a teacher with two classes at the same time.
  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) {
      setError('Give the section a name.');
      return;
    }
    if (edit.schedule.endTime <= edit.schedule.startTime) {
      setError('End of classes must be after the start.');
      return;
    }
    try {
      await repo.saveSection({ ...edit, name: edit.name.trim() });
      setEdit(null);
      flash('Section saved');
    } catch (e) {
      setError(e.message);
    }
  };
  const toggleArchive = async (s) => {
    try {
      await repo.archiveSection(s.id, !s.archived);
      flash(s.archived ? 'Section restored' : 'Section archived');
    } catch (e) {
      flash(e.message);
    }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Sections</h1>
          <p className="page-sub">Click a section to see its teacher and students</p>
        </div>
        <div className="head-actions">
          <label className="check">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived
          </label>
          <button
            className="btn btn-ink"
            onClick={() => {
              setEdit(blank());
              setError(null);
            }}
          >
            <Plus size={17} /> Add section
          </button>
        </div>
      </div>
      <div className="section-grid">
        {list.map((s) => {
          const n = data.count(s.id);
          return (
            <article
              key={s.id}
              className={`section-card clickable ${s.archived ? 'archived' : ''}`}
              style={{ background: s.color, color: textOn(s.color) }}
              onClick={() => setOpenId(s.id)}
              onKeyDown={(e) => {
                if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setOpenId(s.id);
                }
              }}
              tabIndex={0}
              role="button"
              aria-label={`Open ${s.name}`}
            >
              <header>
                <h3>{s.name}</h3>
                <div className="row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="icon-btn sm glass"
                    onClick={() => {
                      setEdit({
                        id: s.id,
                        name: s.name,
                        color: s.color,
                        capacity: s.capacity,
                        teacherId: s.teacherId,
                        schedule: { ...s.schedule },
                      });
                      setError(null);
                    }}
                    aria-label={`Edit ${s.name}`}
                  >
                    <Pencil size={15} />
                  </button>
                  <button className="icon-btn sm glass" onClick={() => toggleArchive(s)} aria-label={s.archived ? 'Restore' : 'Archive'}>
                    {s.archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                  </button>
                </div>
              </header>
              <p className="sec-teacher">{teacherName(s.teacherId) ?? <i>No teacher assigned</i>}</p>
              <div className="sec-meta">
                <span>
                  <Clock size={14} /> {to12h(s.schedule.startTime)} to {to12h(s.schedule.endTime)} · late after{' '}
                  {to12h(fromMinutes(toMinutes(s.schedule.startTime) + s.schedule.lateCutoffMins))}
                </span>
                <span>
                  <Users size={14} /> {n} / {s.capacity} learners
                </span>
              </div>
              <div className="progress">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${Math.min(100, (n / s.capacity) * 100)}%` }} />
                </div>
                <span>{Math.round((n / s.capacity) * 100)}%</span>
              </div>
              {s.archived && <span className="date-chip">Archived</span>}
              <span className="sec-open">
                View teacher and students <ChevronRight size={15} />
              </span>
            </article>
          );
        })}
      </div>

      {openId && data.sections.find((s) => s.id === openId) && (
        <SectionDetail
          section={data.sections.find((s) => s.id === openId)}
          sections={data.sections}
          teachers={data.teachers}
          rows={data.rows}
          onClose={() => setOpenId(null)}
          flash={flash}
          onEditSection={(s) => {
            setOpenId(null);
            setEdit({
              id: s.id,
              name: s.name,
              color: s.color,
              capacity: s.capacity,
              teacherId: s.teacherId,
              schedule: { ...s.schedule },
            });
            setError(null);
          }}
        />
      )}

      {edit && (
        <Modal
          title={edit.id ? 'Edit section' : 'New section'}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEdit(null)}>
                Cancel
              </button>
              <button className="btn btn-ink" onClick={save}>
                Save section
              </button>
            </>
          }
        >
          <label className="field">
            <span>Section name</span>
            <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
          </label>
          <div className="field">
            <span>Color</span>
            <div className="swatches">
              {SECTION_COLORS.map((c) => (
                <button
                  key={c}
                  className={`color-swatch ${edit.color.toLowerCase() === c.toLowerCase() ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setEdit({ ...edit, color: c })}
                  aria-label={`Color ${c}`}
                />
              ))}
              <label className="color-custom" title="Custom color">
                <input type="color" value={edit.color} onChange={(e) => setEdit({ ...edit, color: e.target.value })} aria-label="Custom color" />
              </label>
            </div>
          </div>
          <label className="field">
            <span>Teacher</span>
            <select className="input" value={edit.teacherId ?? ''} onChange={(e) => setEdit({ ...edit, teacherId: e.target.value || null })}>
              <option value="">No teacher yet</option>
              {data.teachers
                .filter((t) => t.active !== false)
                .map((t) => {
                  const other = data.sections.filter((s) => s.teacherId === t.id && s.id !== edit.id && !s.archived);
                  return (
                    <option key={t.id} value={t.id}>
                      {t.name}
                      {other.length ? ` (also ${other.map((o) => o.name.split(' - ').slice(-1)[0]).join(', ')})` : ''}
                    </option>
                  );
                })}
            </select>
          </label>
          <div className="form-row">
            <label className="field">
              <span>Class starts</span>
              <input
                type="time"
                className="input"
                value={edit.schedule.startTime}
                onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, startTime: e.target.value } })}
              />
            </label>
            <label className="field">
              <span>End of classes</span>
              <input
                type="time"
                className="input"
                value={edit.schedule.endTime}
                onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, endTime: e.target.value } })}
              />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Late after (minutes)</span>
              <input
                type="number"
                min={0}
                max={120}
                className="input"
                value={edit.schedule.lateCutoffMins}
                onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, lateCutoffMins: Number(e.target.value) } })}
              />
            </label>
          </div>
          <div className="form-row">
            <label className="field">
              <span>Scanning opens (min before)</span>
              <input
                type="number"
                min={0}
                max={120}
                className="input"
                value={edit.schedule.scanWindowMins}
                onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, scanWindowMins: Number(e.target.value) } })}
              />
            </label>
            <label className="field">
              <span>Auto-confirm (min after start)</span>
              <input
                type="number"
                min={15}
                max={240}
                className="input"
                value={edit.schedule.autoFinalizeMins}
                onChange={(e) => setEdit({ ...edit, schedule: { ...edit.schedule, autoFinalizeMins: Number(e.target.value) } })}
              />
            </label>
          </div>
          <label className="field">
            <span>Capacity</span>
            <input
              type="number"
              min={1}
              max={60}
              className="input"
              value={edit.capacity}
              onChange={(e) => setEdit({ ...edit, capacity: Number(e.target.value) })}
            />
          </label>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}
/** One section: its teacher and class list, with quick edits. */
// The window that opens when a section card is clicked: teacher (click to edit),
// students (click a name to edit, or Transfer / drop). Only one window shows at a time:
// opening a student hides this window and it comes back when the student window closes.
function SectionDetail({ section, sections, teachers, rows, onClose, onEditSection, flash }) {
  const [student, setStudent] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [teacher, setTeacher] = useState(null);
  const [q, setQ] = useState('');
  const t = teachers.find((x) => x.id === section.teacherId);
  const list = rows.filter((r) => r.enrollment?.status === 'active' && r.enrollment.sectionId === section.id);
  const shown = list.filter(
    (r) => !q || `${r.student.firstName} ${r.student.lastName} ${r.guardian?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()),
  );
  const live = sections.filter((s) => !s.archived);
  const also = t ? live.filter((s) => s.teacherId === t.id && s.id !== section.id) : [];
  const busy = !!(student || leaving || teacher);
  return (
    <>
      {!busy && (
        <Modal
          wide
          title={section.name}
          onClose={onClose}
          footer={
            <>
              <button className="btn" onClick={() => onEditSection(section)}>
                <Pencil size={16} /> Edit section
              </button>
              <button className="btn btn-ink" onClick={onClose}>
                Done
              </button>
            </>
          }
        >
          <div className="sd-head" style={{ background: section.color, color: textOn(section.color) }}>
            <span>
              <Clock size={14} /> {to12h(section.schedule.startTime)} to {to12h(section.schedule.endTime)}
            </span>
            <span>
              <Users size={14} /> {list.length} / {section.capacity} learners
            </span>
          </div>

          <h4 className="form-sub">
            <GraduationCap size={16} /> Teacher
          </h4>
          {t ? (
            <div className="sd-teacher">
              <Avatar first={t.name.split(' ')[0]} last={t.name.split(' ').slice(-1)[0]} tone={section.color} />
              <div>
                <button className="name-link" onClick={() => setTeacher(toTeacherInput(t))} title="Edit teacher">
                  {t.name}
                </button>
                <span className="muted small block">
                  {t.email}
                  {t.mobile ? ` · ${displayPhMobile(t.mobile)}` : ''}
                </span>
                {also.length > 0 && <span className="muted small block">Also handles {also.map((s) => s.name).join(', ')}</span>}
              </div>
            </div>
          ) : (
            <p className="muted">
              No teacher yet.{' '}
              <button className="link-btn" onClick={() => onEditSection(section)}>
                Assign one
              </button>
            </p>
          )}

          <div className="sd-students-head">
            <h4 className="form-sub">
              <Users size={16} /> Students
            </h4>
            <input
              className="input"
              placeholder="Find a student"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Find a student in this section"
            />
          </div>
          {shown.length === 0 ? (
            <Empty
              title={list.length ? 'No match' : 'No students yet'}
              hint={list.length ? 'Try another name.' : 'Assign students on the Students page.'}
            />
          ) : (
            <ul className="sd-list">
              {shown.map((r) => (
                <li key={r.student.id}>
                  <Avatar first={r.student.firstName} last={r.student.lastName} tone={section.color} />
                  <div className="sd-name">
                    <button className="name-link" onClick={() => setStudent(toStudentInput(r))} title="Edit student">
                      {r.student.lastName}, {r.student.firstName}
                    </button>
                    <span className="muted small">
                      {r.guardian ? `${r.guardian.relationship}: ${r.guardian.name} · ${displayPhMobile(r.guardian.mobile)}` : 'No guardian on file'}
                    </span>
                  </div>
                  <button className="btn btn-sm" onClick={() => setLeaving(r)}>
                    <LogOut size={15} /> Transfer or drop
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
      {student && (
        <StudentModal
          input={student}
          sections={live}
          onClose={() => setStudent(null)}
          onSaved={(m) => {
            setStudent(null);
            flash(m);
          }}
        />
      )}
      {leaving && (
        <LeaveModal
          row={leaving}
          sections={live}
          onClose={() => setLeaving(null)}
          onDone={(m) => {
            setLeaving(null);
            flash(m);
          }}
        />
      )}
      {teacher && (
        <TeacherModal
          input={teacher}
          sections={sections}
          teachers={teachers}
          onClose={() => setTeacher(null)}
          onSaved={() => {
            setTeacher(null);
            flash('Teacher updated');
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// TEACHERS: click a name to edit; tick the classes they handle. Adding a teacher creates their
// sign-in account and shows a temporary password once.
// ---------------------------------------------------------------------
export const toTeacherInput = (t) => ({
  id: t.id,
  name: t.name,
  email: t.email,
  mobile: t.mobile ? displayPhMobile(t.mobile) : '',
});
/** Add or edit a teacher, including which classes they handle. */
export function TeacherModal({ input, sections, teachers, onClose, onSaved }) {
  const repo = useRepo();
  const [edit, setEdit] = useState(input);
  const live = sections.filter((s) => !s.archived);
  const [classes, setClasses] = useState(new Set(live.filter((s) => input.id && s.teacherId === input.id).map((s) => s.id)));
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const nameOf = (id) => teachers.find((t) => t.id === id)?.name;
  // Saves the teacher, then assigns/unassigns each ticked class (one saveSection per changed class).
  const save = async () => {
    if (!edit.name.trim()) return setError("Enter the teacher's name.");
    if (!/^\S+@\S+\.\S+$/.test(edit.email)) return setError('Enter a valid email address.');
    let mobile = edit.mobile?.trim();
    if (mobile) {
      const n = normalizePhMobile(mobile);
      if (!n) return setError('Mobile must look like 0917 123 4567.');
      mobile = n;
    }
    setBusy(true);
    try {
      const res = await repo.saveTeacher({ ...edit, name: edit.name.trim(), email: edit.email.trim(), mobile });
      const id = res.teacher.id;
      for (const s of live) {
        const want = classes.has(s.id);
        const has = s.teacherId === id;
        if (want === has) continue;
        await repo.saveSection({
          id: s.id,
          name: s.name,
          color: s.color,
          capacity: s.capacity,
          schedule: s.schedule,
          teacherId: want ? id : null,
        });
      }
      onSaved({ name: res.teacher.name, email: res.teacher.email, tempPassword: res.tempPassword });
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  return (
    <Modal
      title={edit.id ? `Edit ${input.name}` : 'Add teacher'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-ink" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Full name</span>
        <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} autoFocus />
      </label>
      <label className="field">
        <span>Email (used to sign in){edit.id ? ' · cannot be changed here' : ''}</span>
        <input type="email" className="input" value={edit.email} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
      </label>
      <label className="field">
        <span>Mobile (optional, for alerts)</span>
        <input className="input" value={edit.mobile} onChange={(e) => setEdit({ ...edit, mobile: e.target.value })} placeholder="0917 123 4567" />
      </label>
      <fieldset className="checks class-checks">
        <legend>Classes handled</legend>
        {live.length === 0 && <p className="muted small">No sections yet. Add one on the Sections page.</p>}
        {live.map((s) => {
          const other = s.teacherId && s.teacherId !== edit.id ? nameOf(s.teacherId) : undefined;
          return (
            <label key={s.id}>
              <input
                type="checkbox"
                checked={classes.has(s.id)}
                onChange={(e) =>
                  setClasses((c) => {
                    const n = new Set(c);
                    if (e.target.checked) n.add(s.id);
                    else n.delete(s.id);
                    return n;
                  })
                }
              />
              <span className="sec-dot sm" style={{ background: s.color }} /> {s.name}
              <span className="muted small">
                {to12h(s.schedule.startTime)} to {to12h(s.schedule.endTime)}
                {other ? ` · now ${other} (will be replaced)` : ''}
              </span>
            </label>
          );
        })}
        <p className="muted small">
          A teacher can handle several classes as long as the class times do not overlap, for example a morning and an afternoon kindergarten class.
        </p>
      </fieldset>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
export function Teachers() {
  const repo = useRepo();
  const [edit, setEdit] = useState(null);
  const [toast, setToast] = useState(null);
  const [created, setCreated] = useState(null);
  const { data } = useLive(async (r) => ({ teachers: await r.listTeachers(), sections: await r.listSections() }));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2800);
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Teachers</h1>
          <p className="page-sub">{data.teachers.filter((t) => t.active !== false).length} active</p>
        </div>
        <button className="btn btn-ink" onClick={() => setEdit({ name: '', email: '', mobile: '' })}>
          <Plus size={17} /> Add teacher
        </button>
      </div>
      <Card>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Teacher</th>
                <th>Email</th>
                <th>Mobile</th>
                <th>Classes</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.teachers.map((t) => {
                const secs = data.sections
                  .filter((s) => s.teacherId === t.id && !s.archived)
                  .sort((a, b) => a.schedule.startTime.localeCompare(b.schedule.startTime));
                const active = t.active !== false;
                return (
                  <tr key={t.id} className={active ? '' : 'dim'}>
                    <td>
                      <div className="cell-person">
                        <Avatar first={t.name.split(' ')[0]} last={t.name.split(' ').slice(-1)[0]} tone={secs[0]?.color} />
                        <button className="name-link" onClick={() => setEdit(toTeacherInput(t))} title="Edit teacher">
                          {t.name}
                        </button>
                      </div>
                    </td>
                    <td>{t.email}</td>
                    <td className="mono">{t.mobile ? displayPhMobile(t.mobile) : '—'}</td>
                    <td>
                      {secs.length ? (
                        <div className="tag-stack">
                          {secs.map((sec) => (
                            <span key={sec.id} className="tag" style={{ background: sec.color }}>
                              {sec.name} · {to12h(sec.schedule.startTime)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="muted">Unassigned</span>
                      )}
                    </td>
                    <td>
                      <span className={`tag ${active ? 'tag-ok' : 'tag-off'}`}>{active ? 'Active' : 'Deactivated'}</span>
                    </td>
                    <td className="row-actions">
                      <button className="icon-btn sm" onClick={() => setEdit(toTeacherInput(t))} aria-label={`Edit ${t.name}`}>
                        <Pencil size={15} />
                      </button>
                      <button
                        className="icon-btn sm"
                        onClick={async () => {
                          await repo.setTeacherActive(t.id, !active);
                          flash(active ? `${t.name} deactivated and removed from their classes` : `${t.name} reactivated`);
                        }}
                        aria-label={active ? 'Deactivate' : 'Reactivate'}
                      >
                        {active ? <UserX size={15} /> : <UserCheck size={15} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="muted small note-row">
        <Info size={14} /> Click a teacher's name to edit their details and classes. Adding a teacher creates their sign-in account with a temporary
        password. They can change it with Forgot password.
      </p>

      {edit && (
        <TeacherModal
          input={edit}
          sections={data.sections}
          teachers={data.teachers}
          onClose={() => setEdit(null)}
          onSaved={(r) => {
            setEdit(null);
            if (r.tempPassword) setCreated({ name: r.name, email: r.email, password: r.tempPassword });
            else flash('Teacher updated');
          }}
        />
      )}
      {created && (
        <Modal
          title={'Account created'}
          onClose={() => setCreated(null)}
          footer={
            <button className="btn btn-ink" onClick={() => setCreated(null)}>
              Done
            </button>
          }
        >
          <p>
            Give these to <b>{created.name}</b> privately. They should change the password after signing in.
          </p>
          <dl className="dl cred">
            <dt>Email</dt>
            <dd>{created.email}</dd>
            <dt>Temporary password</dt>
            <dd>
              <code>{created.password}</code>
            </dd>
          </dl>
          <button
            className="btn btn-sm"
            onClick={() => navigator.clipboard?.writeText(`Doorbell sign-in\nEmail: ${created.email}\nPassword: ${created.password}`)}
          >
            Copy
          </button>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------
// STUDENTS: the full list with filters, bulk move, Excel import, auto-assign, add/edit,
// new ID card (lost card) and transfer/drop. Click a name to edit.
// ---------------------------------------------------------------------
export function AdminStudents() {
  const repo = useRepo();
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').toLowerCase();
  const filter = params.get('filter') ?? 'all';
  const [selected, setSelected] = useState(new Set());
  const [edit, setEdit] = useState(null);
  const [importOpen, setImportOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [leave, setLeave] = useState(null);
  const [toast, setToast] = useState(null);
  const { data } = useLive(async (r) => ({
    rows: await r.listStudentRows(),
    sections: (await r.listSections()).filter((s) => !s.archived),
  }));
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 3000);
  };
  const rows = useMemo(
    () =>
      (data?.rows ?? []).filter((r) => {
        const active = r.enrollment?.status === 'active';
        if (filter === 'unassigned' && active) return false;
        if (filter === 'unassigned' && r.enrollment && r.enrollment.status !== 'active') return false;
        if (filter !== 'all' && filter !== 'unassigned' && !(active && r.enrollment?.sectionId === filter)) return false;
        return !q || `${r.student.firstName} ${r.student.lastName} ${r.guardian?.name ?? ''} ${r.student.lrn ?? ''}`.toLowerCase().includes(q);
      }),
    [data, filter, q],
  );
  if (!data)
    return (
      <div className="page">
        <Skeleton h={500} />
      </div>
    );
  const unassigned = data.rows.filter((r) => !r.enrollment).length;
  const setFilter = (f) => {
    const p = new URLSearchParams(params);
    if (f === 'all') p.delete('filter');
    else p.set('filter', f);
    setParams(p);
    setSelected(new Set());
  };
  const toggle = (id) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  // Moves every ticked student to the chosen section (can be undone).
  const moveSelected = async (sectionId) => {
    const target = sectionId === '__none' ? null : sectionId;
    await repo.assignStudents(Object.fromEntries([...selected].map((id) => [id, target])), `Moved ${selected.size} students`);
    flash(`${selected.size} students moved. You can undo this.`);
    setSelected(new Set());
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Students</h1>
          <p className="page-sub">
            {data.rows.filter((r) => r.enrollment?.status === 'active').length} enrolled · {unassigned} not in a section
          </p>
        </div>
        <div className="head-actions">
          <button
            className="btn"
            onClick={async () => {
              const l = await repo.undoLastAssign();
              flash(l ? `Undid: ${l}` : 'Nothing to undo');
            }}
          >
            <Undo2 size={17} /> Undo last move
          </button>
          <button className="btn" onClick={() => setImportOpen(true)}>
            <Upload size={17} /> Import Excel
          </button>
          <button className="btn" onClick={() => setAssignOpen(true)} disabled={!unassigned}>
            <Wand2 size={17} /> Auto-assign{unassigned ? ` (${unassigned})` : ''}
          </button>
          <button
            className="btn btn-ink"
            onClick={() =>
              setEdit({
                firstName: '',
                lastName: '',
                birthdate: '',
                sex: 'M',
                guardianName: '',
                guardianMobile: '',
                relationship: 'Mother',
                smsConsent: true,
                preferredLanguage: 'en',
                sectionId: null,
              })
            }
          >
            <Plus size={17} /> Add student
          </button>
        </div>
      </div>

      <div className="chips">
        <button className={`fchip ${filter === 'all' ? 'fchip-on' : ''}`} onClick={() => setFilter('all')}>
          All
        </button>
        <button className={`fchip ${filter === 'unassigned' ? 'fchip-on' : ''}`} onClick={() => setFilter('unassigned')}>
          Not in a section <b className="count">{unassigned}</b>
        </button>
        {data.sections.map((s) => (
          <button key={s.id} className={`fchip ${filter === s.id ? 'fchip-on' : ''}`} onClick={() => setFilter(s.id)}>
            <span className="sec-dot sm" style={{ background: s.color }} />
            {s.name}
          </button>
        ))}
        <input
          className="input grow"
          placeholder="Search name, guardian or LRN"
          value={params.get('q') ?? ''}
          onChange={(e) => {
            const p = new URLSearchParams(params);
            if (e.target.value) p.set('q', e.target.value);
            else p.delete('q');
            setParams(p);
          }}
          aria-label="Search"
        />
      </div>

      {selected.size > 0 && (
        <div className="bulk-bar">
          <strong>{selected.size} selected</strong>
          <span>Move to</span>
          <select
            className="input"
            defaultValue=""
            onChange={(e) => e.target.value && moveSelected(e.target.value)}
            aria-label="Move selected to section"
          >
            <option value="" disabled>
              Choose a section
            </option>
            {data.sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="__none">Remove from section</option>
          </select>
          <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      <Card>
        {rows.length === 0 ? (
          <Empty title="No students here" hint="Import an Excel file or add a student." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={rows.every((r) => selected.has(r.student.id))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.student.id)) : new Set())}
                    />
                  </th>
                  <th>Learner</th>
                  <th>Section</th>
                  <th>Guardian</th>
                  <th>Mobile</th>
                  <th>SMS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const left = r.enrollment && r.enrollment.status !== 'active';
                  return (
                    <tr key={r.student.id} className={left ? 'dim' : ''}>
                      <td>
                        <input
                          type="checkbox"
                          checked={selected.has(r.student.id)}
                          onChange={() => toggle(r.student.id)}
                          aria-label={`Select ${r.student.firstName}`}
                        />
                      </td>
                      <td>
                        <div className="cell-person">
                          <Avatar first={r.student.firstName} last={r.student.lastName} tone={r.section?.color} />
                          <span>
                            <button className="name-link" onClick={() => setEdit(toStudentInput(r))} title="Edit student">
                              {r.student.lastName}, {r.student.firstName}
                            </button>
                            <span className="muted small">
                              {r.student.sex === 'M' ? 'Boy' : 'Girl'} · {r.student.birthdate}
                              {r.student.lrn ? ` · LRN ${r.student.lrn}` : ''}
                            </span>
                          </span>
                        </div>
                      </td>
                      <td>
                        {left ? (
                          <span className="tag tag-off">
                            {r.enrollment.status === 'transferred' ? 'Transferred' : 'Dropped'} {r.enrollment.endDate}
                          </span>
                        ) : r.section ? (
                          <span className="tag" style={{ background: r.section.color }}>
                            {r.section.name}
                          </span>
                        ) : (
                          <span className="tag tag-warn">Not in a section</span>
                        )}
                      </td>
                      <td>
                        {r.guardian ? (
                          <>
                            {r.guardian.name}
                            <span className="muted small block">
                              {r.guardian.relationship}
                              {r.guardian.studentIds.length > 1 ? ` · ${r.guardian.studentIds.length} children` : ''}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="mono">
                        {r.guardian ? displayPhMobile(r.guardian.mobile) : '—'}
                        {r.guardian?.numberStatus === 'failed' && (
                          <span className="num-status bad">
                            <AlertTriangle size={13} /> Needs update
                          </span>
                        )}
                      </td>
                      <td>{r.guardian?.smsConsent ? <span className="tag tag-ok">Yes</span> : <span className="tag tag-off">No</span>}</td>
                      <td className="row-actions">
                        <button
                          className="icon-btn sm"
                          onClick={() => setEdit(toStudentInput(r))}
                          aria-label={`Edit ${r.student.firstName}`}
                          title="Edit"
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-btn sm"
                          title="Reissue ID card (lost or damaged)"
                          aria-label="Reissue QR"
                          onClick={async () => {
                            await repo.reissueQr(r.student.id);
                            flash(`New card code for ${r.student.firstName}. The old card is now revoked. Print it on the ID Cards page.`);
                          }}
                        >
                          <QrCode size={15} />
                        </button>
                        {r.enrollment?.status === 'active' && (
                          <button className="icon-btn sm" title="Transfer or drop" aria-label="Transfer or drop" onClick={() => setLeave(r)}>
                            <LogOut size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {edit && (
        <StudentModal
          input={edit}
          sections={data.sections}
          onClose={() => setEdit(null)}
          onSaved={(m) => {
            setEdit(null);
            flash(m);
          }}
        />
      )}
      {importOpen && (
        <ImportModal
          sections={data.sections}
          existing={data.rows}
          onClose={() => setImportOpen(false)}
          onDone={(m) => {
            setImportOpen(false);
            flash(m);
          }}
        />
      )}
      {assignOpen && (
        <AssignModal
          rows={data.rows}
          sections={data.sections}
          onClose={() => setAssignOpen(false)}
          onDone={(m) => {
            setAssignOpen(false);
            flash(m);
          }}
        />
      )}
      {leave && (
        <LeaveModal
          row={leave}
          sections={data.sections}
          onClose={() => setLeave(null)}
          onDone={(m) => {
            setLeave(null);
            flash(m);
          }}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}
export const toStudentInput = (r) => ({
  id: r.student.id,
  lrn: r.student.lrn,
  firstName: r.student.firstName,
  middleName: r.student.middleName,
  lastName: r.student.lastName,
  birthdate: r.student.birthdate,
  sex: r.student.sex,
  guardianName: r.guardian?.name ?? '',
  guardianMobile: r.guardian ? displayPhMobile(r.guardian.mobile).replace(/\s/g, '') : '',
  relationship: r.guardian?.relationship ?? 'Mother',
  smsConsent: r.guardian?.smsConsent ?? false,
  preferredLanguage: r.guardian?.preferredLanguage ?? 'en',
  sectionId: r.enrollment?.status === 'active' ? r.enrollment.sectionId : null,
});
// Add / edit one student and their guardian. Exported so the Sections window can use it too.
export function StudentModal({ input, sections, onClose, onSaved }) {
  const repo = useRepo();
  const [f, setF] = useState(input);
  const [error, setError] = useState(null);
  const set = (patch) => setF({ ...f, ...patch });
  // Checks the form (names, birthdate, PH mobile number) before saving.
  const save = async () => {
    if (!f.firstName.trim() || !f.lastName.trim()) return setError('First and last name are required.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.birthdate)) return setError('Enter the birthdate.');
    const mobile = normalizePhMobile(f.guardianMobile);
    if (!mobile) return setError('Guardian mobile must look like 0917 123 4567.');
    if (!f.guardianName.trim()) return setError("Enter the guardian's name.");
    await repo.saveStudent({ ...f, guardianMobile: mobile, firstName: f.firstName.trim(), lastName: f.lastName.trim() });
    onSaved(f.id ? 'Student updated' : 'Student added. A QR card was created automatically.');
  };
  return (
    <Modal
      title={f.id ? 'Edit student' : 'Add student'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-ink" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form-row">
        <label className="field">
          <span>Last name</span>
          <input className="input" value={f.lastName} onChange={(e) => set({ lastName: e.target.value })} autoFocus />
        </label>
        <label className="field">
          <span>First name</span>
          <input className="input" value={f.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span>Middle name</span>
          <input className="input" value={f.middleName ?? ''} onChange={(e) => set({ middleName: e.target.value })} />
        </label>
        <label className="field">
          <span>LRN (optional)</span>
          <input className="input" value={f.lrn ?? ''} onChange={(e) => set({ lrn: e.target.value || undefined })} />
        </label>
      </div>
      <div className="form-row">
        <div className="field">
          <span>Birthdate</span>
          <DatePicker
            value={f.birthdate}
            onChange={(d) => set({ birthdate: d })}
            max={manilaToday()}
            birthdate
            quick={[]}
            placeholder="Choose birthdate"
            ariaLabel="Birthdate"
          />
        </div>
        <label className="field">
          <span>Sex</span>
          <select className="input" value={f.sex} onChange={(e) => set({ sex: e.target.value })}>
            <option value="M">Male</option>
            <option value="F">Female</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Section</span>
        <select className="input" value={f.sectionId ?? ''} onChange={(e) => set({ sectionId: e.target.value || null })}>
          <option value="">Not yet (auto-assign later)</option>
          {sections.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <h4 className="form-sub">Parent or guardian (receives SMS)</h4>
      <div className="form-row">
        <label className="field">
          <span>Name</span>
          <input className="input" value={f.guardianName} onChange={(e) => set({ guardianName: e.target.value })} />
        </label>
        <label className="field">
          <span>Relationship</span>
          <input className="input" value={f.relationship} onChange={(e) => set({ relationship: e.target.value })} />
        </label>
      </div>
      <div className="form-row">
        <label className="field">
          <span>Mobile</span>
          <input className="input" value={f.guardianMobile} onChange={(e) => set({ guardianMobile: e.target.value })} placeholder="0917 123 4567" />
        </label>
        <label className="field">
          <span>SMS language</span>
          <select className="input" value={f.preferredLanguage} onChange={(e) => set({ preferredLanguage: e.target.value })}>
            <option value="en">English</option>
            <option value="fil">Filipino</option>
          </select>
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={f.smsConsent} onChange={(e) => set({ smsConsent: e.target.checked })} /> Guardian signed the SMS consent form
      </label>
      <p className="muted small">Siblings: use the same mobile number and they will share one guardian record.</p>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
// Excel import: download the template, fill it in, upload. Rows with problems are listed and skipped.
function ImportModal({ sections, existing, onClose, onDone }) {
  const repo = useRepo();
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const ok = parsed?.filter((p) => p.input) ?? [];
  const bad = parsed?.filter((p) => !p.input) ?? [];
  const onFile = async (file) => {
    if (!file) return;
    setError(null);
    try {
      setParsed(validateRows(await readRows(file), sections, existing));
    } catch {
      setError('Could not read that file. Use the template (.xlsx) or a .csv file.');
    }
  };
  const run = async () => {
    setBusy(true);
    const res = await repo.importStudents(ok.map((p) => p.input));
    onDone(
      `Imported ${res.created} students${res.linkedSiblings ? `, ${res.linkedSiblings} linked as siblings` : ''}. QR cards were created automatically.`,
    );
  };
  const errorReport = () => {
    const csv = ['Line,Name,Problems', ...bad.map((b) => `${b.line},"${b.name}","${b.errors.join('; ')}"`)].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'import_errors.csv';
    a.click();
  };
  return (
    <Modal
      title="Import students from Excel"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-ink" disabled={!ok.length || busy} onClick={run}>
            {busy ? 'Importing…' : `Import ${ok.length} students`}
          </button>
        </>
      }
    >
      <ol className="steps-list">
        <li>
          <button className="link-btn" onClick={() => downloadTemplate(sections)}>
            <FileDown size={15} /> Download the template
          </button>{' '}
          and fill one row per child.
        </li>
        <li>Choose the filled file. Nothing is saved until you press Import.</li>
      </ol>
      <label className="dropzone">
        <Upload size={22} />
        <span>Choose .xlsx or .csv</span>
        <input type="file" accept=".xlsx,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {error && <p className="error">{error}</p>}
      {parsed && (
        <>
          <div className="import-summary">
            <span className="tag tag-ok">
              <CheckCircle2 size={14} /> {ok.length} ready
            </span>
            {bad.length > 0 && (
              <span className="tag tag-bad">
                <AlertTriangle size={14} /> {bad.length} with problems (skipped)
              </span>
            )}
            {bad.length > 0 && (
              <button className="link-btn" onClick={errorReport}>
                Download error report
              </button>
            )}
          </div>
          <div className="preview-list">
            {parsed.map((p) => (
              <div key={p.line} className={`preview-row ${p.input ? '' : 'bad'}`}>
                <span className="muted small">Row {p.line}</span>
                <strong>{p.name}</strong>
                <span className="small">
                  {[...p.errors, ...p.warnings].join(' · ') ||
                    (p.input?.sectionId ? sections.find((s) => s.id === p.input.sectionId)?.name : 'Not in a section yet')}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}
// Auto-assign: choose a method, preview how many go to each section, then apply (see autoAssign in logic.js).
function AssignModal({ rows, sections, onClose, onDone }) {
  const repo = useRepo();
  const pool = rows.filter((r) => !r.enrollment);
  const [chosen, setChosen] = useState(new Set(sections.map((s) => s.id)));
  const [method, setMethod] = useState('balanced');
  const [siblings, setSiblings] = useState(true);
  const current = (id) => rows.filter((r) => r.enrollment?.status === 'active' && r.enrollment.sectionId === id).length;
  const targets = sections.filter((s) => chosen.has(s.id));
  const result = autoAssign(
    pool.map((r) => ({
      id: r.student.id,
      firstName: r.student.firstName,
      lastName: r.student.lastName,
      birthdate: r.student.birthdate,
      sex: r.student.sex,
      siblingKey: r.guardian?.mobile,
    })),
    targets.map((s) => ({ id: s.id, capacity: s.capacity, current: current(s.id) })),
    method,
    siblings,
  );
  const added = (id) => Object.values(result.assignments).filter((x) => x === id).length;
  return (
    <Modal
      title={`Auto-assign ${pool.length} students`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-ink"
            disabled={!Object.keys(result.assignments).length}
            onClick={async () => {
              await repo.assignStudents(result.assignments, `Auto-assign (${method})`);
              onDone(`${Object.keys(result.assignments).length} students placed. Use "Undo last move" if it is not right.`);
            }}
          >
            <Wand2 size={16} /> Assign
          </button>
        </>
      }
    >
      <fieldset className="checks">
        <legend>Sections to fill</legend>
        {sections.map((s) => (
          <label key={s.id}>
            <input
              type="checkbox"
              checked={chosen.has(s.id)}
              onChange={(e) => {
                const n = new Set(chosen);
                if (e.target.checked) n.add(s.id);
                else n.delete(s.id);
                setChosen(n);
              }}
            />
            <span className="sec-dot sm" style={{ background: s.color }} /> {s.name}{' '}
            <span className="muted small">
              ({current(s.id)}/{s.capacity})
            </span>
          </label>
        ))}
      </fieldset>
      <label className="field">
        <span>How to split</span>
        <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.keys(ASSIGN_METHODS).map((m) => (
            <option key={m} value={m}>
              {ASSIGN_METHODS[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input type="checkbox" checked={siblings} onChange={(e) => setSiblings(e.target.checked)} /> Keep siblings in the same section
      </label>
      <div className="assign-preview">
        <h4>
          <Users size={15} /> Preview
        </h4>
        {targets.map((s) => (
          <div key={s.id} className="assign-row">
            <span className="sec-dot" style={{ background: s.color }} />
            <span>{s.name}</span>
            <b>
              {current(s.id)} → {current(s.id) + added(s.id)}
            </b>
            <span className="muted small">+{added(s.id)}</span>
          </div>
        ))}
        {result.unplaced.length > 0 && <p className="error">{result.unplaced.length} students do not fit. Add a section or raise a capacity.</p>}
      </div>
    </Modal>
  );
}
// Transfer or drop: move to another section, or mark transferred/dropped from a date. Records are never deleted.
export function LeaveModal({ row, sections = [], onClose, onDone }) {
  const repo = useRepo();
  const others = sections.filter((s) => s.id !== row.enrollment?.sectionId && !s.archived);
  const [status, setStatus] = useState(others.length ? 'move' : 'transferred');
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const [date, setDate] = useState(manilaToday());
  const name = `${row.student.firstName} ${row.student.lastName}`;
  const save = async () => {
    if (status === 'move') {
      const to = others.find((s) => s.id === target);
      if (!to) return;
      await repo.assignStudents({ [row.student.id]: to.id }, `Moved ${name} to ${to.name}`);
      onDone(`${name} moved to ${to.name}. Past attendance stays with the old section.`);
      return;
    }
    await repo.setEnrollmentStatus(row.student.id, status, date);
    onDone(`${name} marked ${status}. History is kept; no more attendance or SMS.`);
  };
  return (
    <Modal
      title={`Transfer or drop ${row.student.firstName}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${status === 'move' ? 'btn-ink' : 'btn-danger'}`} onClick={save} disabled={status === 'move' && !target}>
            {status === 'move' ? 'Move student' : status === 'transferred' ? 'Mark transferred' : 'Mark dropped'}
          </button>
        </>
      }
    >
      <p className="muted small">
        {name}
        {row.section ? ` · now in ${row.section.name}` : ''}
      </p>
      <div className="leave-options" role="radiogroup" aria-label="What is happening">
        {others.length > 0 && (
          <label className={`type-opt ${status === 'move' ? 'on' : ''}`}>
            <input type="radio" name="leave" checked={status === 'move'} onChange={() => setStatus('move')} />
            <span>
              <b>Move to another section</b>
              <small>Stays in this school, changes class.</small>
            </span>
          </label>
        )}
        <label className={`type-opt ${status === 'transferred' ? 'on' : ''}`}>
          <input type="radio" name="leave" checked={status === 'transferred'} onChange={() => setStatus('transferred')} />
          <span>
            <b>Transferred to another school</b>
            <small>Leaves the class list from the effective date.</small>
          </span>
        </label>
        <label className={`type-opt ${status === 'dropped' ? 'on' : ''}`}>
          <input type="radio" name="leave" checked={status === 'dropped'} onChange={() => setStatus('dropped')} />
          <span>
            <b>Dropped out</b>
            <small>Stops attending school.</small>
          </span>
        </label>
      </div>
      {status === 'move' ? (
        <label className="field">
          <span>New section</span>
          <select className="input" value={target} onChange={(e) => setTarget(e.target.value)}>
            {others.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <div className="field">
          <span>Effective date</span>
          <DatePicker value={date} onChange={setDate} ariaLabel="Effective date" />
        </div>
      )}
      <p className="muted small">
        Records are never deleted.{' '}
        {status === 'move'
          ? 'From today the child appears on the new class list.'
          : 'From this date the child is not on the class list and no SMS is sent.'}
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------
// ID CARDS: printable cards or stickers with a QR code or barcode. The code holds only a
// random token (never the child's name). "Print this card" prints one card for a lost card.
// ---------------------------------------------------------------------
/** Printable ID cards / stickers. Codes hold only a random token, never personal data. */
export function QrCards() {
  const repo = useRepo();
  const [sectionId, setSectionId] = useState(null);
  const [layout, setLayout] = useState('card');
  const [format, setFormat] = useState('qr');
  const [printId, setPrintId] = useState(null);
  const [find, setFind] = useState('');
  const { data } = useLive(async (r) => ({
    rows: await r.listStudentRows(),
    sections: (await r.listSections()).filter((s) => !s.archived),
    settings: await r.getSettings(),
  }));
  // Print just one card: mark it, print, then go back to normal.
  useEffect(() => {
    if (!printId) return;
    const done = () => setPrintId(null);
    window.addEventListener('afterprint', done, { once: true });
    const t = setTimeout(() => window.print(), 300); // let the code image render first
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
    };
  }, [printId]);
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const sec = data.sections.find((s) => s.id === (sectionId ?? data.sections[0]?.id));
  const enrolled = data.rows.filter((r) => r.enrollment?.status === 'active');
  const rows = enrolled.filter((r) => r.enrollment.sectionId === sec?.id);
  const matches =
    find.trim().length >= 2
      ? enrolled.filter((r) => `${r.student.firstName} ${r.student.lastName}`.toLowerCase().includes(find.toLowerCase())).slice(0, 6)
      : [];
  const printOne = async (r) => {
    if (r.enrollment && r.enrollment.sectionId !== sec?.id) setSectionId(r.enrollment.sectionId);
    await repo.logAudit('cards.print_one', `${r.student.firstName} ${r.student.lastName}`, layout);
    setFind('');
    setPrintId(r.student.id);
  };
  return (
    <div className="page">
      <div className="page-head no-print">
        <div>
          <h1>ID Cards</h1>
          <p className="page-sub">A code is created automatically for every student</p>
        </div>
        <button
          className="btn btn-ink"
          onClick={async () => {
            await repo.logAudit('cards.print', sec?.name ?? '', `${rows.length} ${layout}s`);
            window.print();
          }}
          disabled={!rows.length}
        >
          <Printer size={17} /> Print all {rows.length}
        </button>
      </div>
      <Card className="no-print">
        <div className="find-one">
          <label className="field">
            <span>Print one student's card (new student, lost or damaged card)</span>
            <div className="search-box">
              <Search size={16} />
              <input className="input" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Type a name" />
            </div>
          </label>
          {matches.length > 0 && (
            <ul className="find-results">
              {matches.map((r) => (
                <li key={r.student.id}>
                  <button onClick={() => printOne(r)}>
                    <strong>
                      {r.student.lastName}, {r.student.firstName}
                    </strong>
                    <span className="muted small">{r.section?.name}</span>
                    <span className="link">
                      <Printer size={14} /> Print
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="chips">
          {data.sections.map((s) => (
            <button key={s.id} className={`fchip ${s.id === sec?.id ? 'fchip-on' : ''}`} onClick={() => setSectionId(s.id)}>
              <span className="sec-dot sm" style={{ background: s.color }} />
              {s.name}
            </button>
          ))}
        </div>
        <div className="form-row">
          <div className="field">
            <span>Layout</span>
            <div className="chips">
              <button className={`fchip ${layout === 'card' ? 'fchip-on' : ''}`} onClick={() => setLayout('card')}>
                ID card (85.6 x 54 mm)
              </button>
              <button className={`fchip ${layout === 'sticker' ? 'fchip-on' : ''}`} onClick={() => setLayout('sticker')}>
                A4 stickers (3 x 8)
              </button>
            </div>
          </div>
          <div className="field">
            <span>Code type</span>
            <div className="chips">
              <button className={`fchip ${format === 'qr' ? 'fchip-on' : ''}`} onClick={() => setFormat('qr')}>
                QR code
              </button>
              <button className={`fchip ${format === 'code128' ? 'fchip-on' : ''}`} onClick={() => setFormat('code128')}>
                Barcode (Code 128)
              </button>
            </div>
          </div>
        </div>
        <p className="muted small note-row">
          <Info size={14} /> Print at 100% scale (not "fit to page"), black on white, matte lamination. A lost card: press "Reissue" on the Students
          page first, then print the new one here.
        </p>
      </Card>
      {rows.length === 0 ? (
        <Card>
          <Empty title="No students in this section" />
        </Card>
      ) : (
        <div className={`print-sheet sheet-${layout} ${printId ? 'print-single' : ''}`}>
          {rows.map((r) => (
            <div key={r.student.id} className={`card-slot ${printId === r.student.id ? 'print-target' : ''}`}>
              <IdCard row={r} layout={layout} format={format} color={sec.color} school={data.settings.schoolName} />
              <button className="btn btn-sm no-print slot-print" onClick={() => printOne(r)}>
                <Printer size={14} /> Print this card
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// One printable card. QR codes are drawn by the 'qrcode' package, barcodes (CODE128) by 'jsbarcode'.
function IdCard({ row, layout, format, color, school }) {
  const [qr, setQr] = useState('');
  const svg = useRef(null);
  const token = row.student.qrToken;
  useEffect(() => {
    if (format === 'qr') QRCode.toDataURL(token, { margin: 1, width: 240, errorCorrectionLevel: 'M' }).then(setQr);
    else if (svg.current) JsBarcode(svg.current, token, { format: 'CODE128', displayValue: false, margin: 4, height: 50, width: 1.6 });
  }, [token, format]);
  const code = format === 'qr' ? <img src={qr} alt="" className="code-qr" /> : <svg ref={svg} className="code-bar" />;
  if (layout === 'sticker') {
    return (
      <div className="sticker" style={{ borderColor: color }}>
        {code}
        <strong>
          {row.student.firstName} {row.student.lastName[0]}.
        </strong>
      </div>
    );
  }
  return (
    <div className="idcard">
      <div className="idcard-band" style={{ background: color, color: textOn(color) }}>
        <Logo size={18} /> {school}
      </div>
      <div className="idcard-body">
        <div className="idcard-text">
          <strong>{row.student.firstName}</strong>
          <span>{row.student.lastName}</span>
          <em style={{ background: color, color: textOn(color) }}>{row.section?.name.replace('Kindergarten', 'Kinder')}</em>
        </div>
        {code}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// SETTINGS & SMS: school name and contact number, arrival texts on/off, streak days,
// the parent text templates (English and Filipino) with a live preview, and a test SMS.
// ---------------------------------------------------------------------
export function AdminSettings() {
  const repo = useRepo();
  const { data } = useLive((r) => r.getSettings());
  const [s, setS] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (data && !s) setS(structuredClone(data));
  }, [data, s]);
  if (!s)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const varsFor = (lang) => ({
    child: 'Juan',
    time: '7:42 AM',
    school: s.schoolName,
    contact: s.contactNumber,
    streak: describeStreak({ count: 3, absent: 2, late: 1 }, lang),
  });
  const setTpl = (lang, k, v) => setS({ ...s, templates: { ...s.templates, [lang]: { ...s.templates[lang], [k]: v } } });
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings &amp; SMS</h1>
          <p className="page-sub">School-wide</p>
        </div>
        <button
          className="btn btn-ink"
          onClick={async () => {
            await repo.updateSettings(s);
            flash('Settings saved');
          }}
        >
          <Save size={17} /> Save changes
        </button>
      </div>
      <div className="grid-2">
        <Card title="School">
          <label className="field">
            <span>School name (appears in every SMS)</span>
            <input className="input" value={s.schoolName} onChange={(e) => setS({ ...s, schoolName: e.target.value })} />
          </label>
          <label className="field">
            <span>Contact number for parents</span>
            <input className="input" value={s.contactNumber} onChange={(e) => setS({ ...s, contactNumber: e.target.value })} />
          </label>
        </Card>
        <Card title="When parents get a text">
          <label className="check">
            <input type="checkbox" checked={s.arrivalSmsEnabled} onChange={(e) => setS({ ...s, arrivalSmsEnabled: e.target.checked })} /> Text parents
            when their child arrives (and when late)
          </label>
          <label className="field">
            <span>Text parents after this many school days late or absent in a row</span>
            <input
              type="number"
              className="input"
              min={2}
              max={10}
              value={s.streakDays}
              onChange={(e) => setS({ ...s, streakDays: Number(e.target.value) })}
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Send a test SMS to</span>
              <input className="input" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="0917 123 4567" />
            </label>
            <button
              className="btn align-end"
              onClick={async () => {
                const n = normalizePhMobile(testTo);
                if (!n) return flash('Enter a valid mobile number');
                await repo.sendTestSms(n);
                flash('Test SMS sent (see the SMS Simulator)');
              }}
            >
              <Send size={16} /> Send test
            </button>
          </div>
          <p className="muted small">
            {repo.mode === 'demo' ? (
              <>Demo mode: texts are simulated.</>
            ) : (
              <>Texts are recorded in the SMS Messages page. A real SMS provider (e.g. Semaphore) plugs in with the SMS sender service.</>
            )}
          </p>
        </Card>
      </div>
      <Card title="Message templates">
        <p className="muted small">
          Variables: {'{child}'} first name, {'{time}'}, {'{school}'}, {'{contact}'}, and in the 3-day alert {'{streak}'}, which becomes the exact
          pattern, e.g. "absent for 3 school days in a row" or "absent 2 days and late 1 day". Keep each under 160 plain characters (no emoji or curly
          quotes) so it costs one SMS.
        </p>
        <div className="templates">
          {['en', 'fil'].map((lang) => (
            <div key={lang}>
              <h3>{lang === 'en' ? 'English' : 'Filipino'}</h3>
              {['arrival', 'late', 'streak'].map((k) => {
                const preview = renderTemplate(s.templates[lang][k], varsFor(lang));
                const plain = isGsmPlain(preview);
                return (
                  <label key={k} className="tpl">
                    <span className={`kind kind-${k}`}>{k}</span>
                    <textarea rows={3} value={s.templates[lang][k]} onChange={(e) => setTpl(lang, k, e.target.value)} />
                    <span className="muted small">Preview: {preview}</span>
                    <span className={`small ${preview.length > 160 || !plain ? 'over' : 'muted'}`}>
                      {preview.length}/160 · {smsSegments(preview)} SMS{!plain ? ' · special characters make it cost more' : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
      <Toast message={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------
// AUDIT LOG: who changed what and when (read-only, cannot be edited or deleted).
// ---------------------------------------------------------------------
export function AuditLog() {
  const [q, setQ] = useState('');
  const { data } = useLive((r) => r.listAudit(500));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const list = data.filter((a) => !q || `${a.actor} ${a.action} ${a.target} ${a.detail ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit Log</h1>
          <p className="page-sub">Every change is recorded and cannot be edited</p>
        </div>
        <input
          className="input"
          placeholder="Filter by person, action or student"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter audit log"
        />
      </div>
      <Card>
        {list.length === 0 ? (
          <Empty title="No entries yet" hint="Edits, imports, exports, suspensions and SMS resends appear here." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{format(new Date(a.at), 'MMM d, h:mm a')}</td>
                    <td>{a.actor}</td>
                    <td>
                      <span className="tag">{a.action}</span>
                    </td>
                    <td>{a.target}</td>
                    <td className="muted">{a.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
