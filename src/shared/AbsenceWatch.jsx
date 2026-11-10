import { useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Phone, MessageSquareText, MessageSquareOff, ArrowDownUp } from 'lucide-react';
import {
  useLive,
  Card,
  Skeleton,
  Avatar,
  Empty,
  StreakChip,
  StudentAttendanceModal,
} from '../ui';
import { useState } from 'react';
import { displayPhMobile } from '../logic';

// =====================================================================
// ABSENCE WATCH (/admin/absences for the admin, /absences for teachers): children absent or
// late several school days in a row, with their attendance calendar.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// ABSENCE WATCH: children absent or late 2+ school days in a row in every section.
// Filter by section and kind, sort by days/section/name. Numbers instead of dates (hover for dates).
// ---------------------------------------------------------------------
/** Students absent or late several school days in a row, across all sections. */
// Used by the admin (every section) and by teachers (/absences: only the classes they teach or cover,
// because listAttention only returns the signed-in person's classes). ?student=<id> opens that child's
// calendar right away (the teacher dashboard's "Attention needed" cards link here).
export function AbsenceWatch() {
  const [params, setParams] = useSearchParams();
  const [picked, setOpen] = useState(null); // the learner whose attendance calendar is open
  const [kind, setKind] = useState('all');
  const [sectionId, setSectionId] = useState('all');
  const [sort, setSort] = useState('days');
  const { data } = useLive(async (r) => {
    const rows = await r.listAttention(2);
    const session = await r.getSession();
    const mine = new Set(rows.map((x) => x.section.id));
    const sections = (await r.listSections()).filter(
      (s) => !s.archived && (session?.role === 'admin' || session?.sectionIds?.includes(s.id) || mine.has(s.id)),
    );
    return { rows, sections, settings: await r.getSettings(), today: await r.getToday() };
  });
  const fromLink = params.get('student');
  const open = picked ?? (fromLink ? (data?.rows.find((x) => x.student.id === fromLink) ?? null) : null);
  const close = () => {
    setOpen(null);
    if (fromLink) setParams({}, { replace: true });
  };
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
                {/* Click the name: a calendar of this learner's absent and late days. */}
                <button type="button" className="cell-person name-btn" onClick={() => setOpen(r)} title="Show the attendance calendar">
                  <Avatar first={r.student.firstName} last={r.student.lastName} tone={r.section.color} />
                  <span>
                    <strong>
                      {r.student.lastName}, {r.student.firstName}
                    </strong>
                    <StreakChip s={r.streak} threshold={t} />
                  </span>
                </button>
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
      {data.sections.length > 1 && (
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
      )}
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
        Click a name to see that learner's absent and late days on a calendar. Hover over "Days in a row" to see the dates. Excused days, weekends,
        holidays and suspensions do not count; a day present ends the streak.
      </p>
      {open && <StudentAttendanceModal student={open.student} section={open.section} onClose={close} />}
    </div>
  );
}
