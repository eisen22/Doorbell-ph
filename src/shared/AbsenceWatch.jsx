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
// absent several school days in a row (a late or present day ends it), with their attendance calendar.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// ABSENCE WATCH: children absent 2+ school days in a row in every section.
// Filter by section, sort by days/section/name. Numbers instead of dates (hover for dates).
// ---------------------------------------------------------------------
/** Students absent several school days in a row, across all sections. */
// Used by the admin (every section) and by teachers (/absences: only the classes they teach or cover,
// because listAttention only returns the signed-in person's classes). ?student=<id> opens that child's
// calendar right away (the teacher dashboard's "Attention needed" cards link here).
export function AbsenceWatch() {
  const [params, setParams] = useSearchParams();
  const [picked, setOpen] = useState(null); // the learner whose attendance calendar is open
  const [sectionId, setSectionId] = useState('all');
  const [sort, setSort] = useState('days');
  const { data } = useLive(async (r) => {
    const rows = await r.listAttention(2);
    const session = await r.getSession();
    const mine = new Set(rows.map((x) => x.section.id));
    const sections = (await r.listSections()).filter(
      (s) => !s.archived && (session?.role === 'admin' || session?.sectionIds?.includes(s.id) || mine.has(s.id)),
    );
    return { rows, totals: await r.listTotals(), limits: r.limits, sections, settings: await r.getSettings(), today: await r.getToday() };
  });
  const fromLink = params.get('student');
  const open = picked ?? (fromLink ? (data?.rows.find((x) => x.student.id === fromLink) ?? data?.totals.find((x) => x.student.id === fromLink) ?? null) : null);
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
    sectionId === 'all' || r.section.id === sectionId;
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
            <th className="num">Days absent</th>
            <th>Guardian</th>
            <th>Parent SMS</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.student.id}>
              <td>
                {/* Click the name: a calendar of this learner's attendance. */}
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
              <td className="num" title={range(r)}>
                <b className="n-absent">{r.streak.count}</b>
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
      <Card title={`${t} or more school days in a row (${hot.length})`}>
        {hot.length ? table(hot) : <Empty title="No one right now" hint={`Children appear here after ${t} school days absent in a row.`} />}
      </Card>
      <Card title={`Watch list: ${t - 1} days in a row (${watch.length})`}>
        {watch.length ? table(watch) : <Empty title="No one on the watch list" />}
      </Card>
      <Card title={`Totals this month and semester, not in a row (${data.totals.filter(match).length})`}>
        {data.totals.filter(match).length ? (
          <TotalsTable rows={data.totals.filter(match)} onOpen={setOpen} />
        ) : (
          <Empty title="Everyone is within the limits" />
        )}
        <p className="muted small">
          Limits: absent {data.limits.absentMonth.watch} days a month (watch) or {data.limits.absentMonth.alert} (parent texted), {data.limits.absentSemester.watch}{' '}
          a semester (watch), {data.limits.absentSemester.alert} (parent texted) or {data.limits.absentSemester.serious} (parent conference). Late{' '}
          {data.limits.lateMonth.watch} times a month (watch) or {data.limits.lateMonth.alert} (parent texted), {data.limits.lateSemester.alert} a semester
          (parent texted) or {data.limits.lateSemester.serious} (parent conference). Excused days count toward watch only. Change them in Settings.
        </p>
      </Card>
      <p className="muted small">
        Click a name to see that learner's attendance on a calendar. Hover over the number to see the dates. Only absences count: a day present
        or late ends the streak. Excused days, weekends, holidays, breaks and suspensions are skipped.
      </p>
      {open && <StudentAttendanceModal student={open.student} section={open.section} onClose={close} />}
    </div>
  );
}

// The Totals table: each child's absences and lates this month and this semester, with the limits reached.
const LEVEL = {
  watch: { cls: 'streak', word: 'Watch' },
  alert: { cls: 'streak streak-hot', word: 'Parent texted' },
  serious: { cls: 'streak streak-hot', word: 'Parent conference' },
};
const WHAT = { absentMonth: 'absent this month', absentSemester: 'absent this semester', lateMonth: 'late this month', lateSemester: 'late this semester' };
function TotalsTable({ rows, onOpen }) {
  return (
    <div className="table-wrap">
      <table className="table watch-table">
        <thead>
          <tr>
            <th>Learner</th>
            <th>Section</th>
            <th>This month</th>
            <th>This semester</th>
            <th>Limits reached</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const t = r.totals;
            const n = { absentMonth: t.month.absent, absentSemester: t.semester.absent, lateMonth: t.month.late, lateSemester: t.semester.late };
            return (
              <tr key={r.student.id}>
                <td>
                  <button type="button" className="cell-person name-btn" onClick={() => onOpen(r)} title="Show the attendance calendar">
                    <Avatar first={r.student.firstName} last={r.student.lastName} tone={r.section.color} />
                    <span>
                      <strong>
                        {r.student.lastName}, {r.student.firstName}
                      </strong>
                      {r.guardian && <span className="muted small">{r.guardian.name}</span>}
                    </span>
                  </button>
                </td>
                <td>
                  <span className="tag" style={{ background: r.section.color }}>
                    {r.section.name.replace('Kindergarten', 'Kinder')}
                  </span>
                </td>
                <td className="tot">
                  <span className={t.month.absent ? 'tot-absent' : ''}>{t.month.absent} absent</span>
                  {t.month.excused ? <span className="muted"> +{t.month.excused} excused</span> : null}
                  <span className={`block ${t.month.late ? 'tot-late' : ''}`}>{t.month.late} late</span>
                </td>
                <td className="tot">
                  <span className={t.semester.absent ? 'tot-absent' : ''}>{t.semester.absent} absent</span>
                  {t.semester.excused ? <span className="muted"> +{t.semester.excused} excused</span> : null}
                  <span className={`block ${t.semester.late ? 'tot-late' : ''}`}>{t.semester.late} late</span>
                </td>
                <td>
                  <span className="chips-inline">
                    {Object.entries(t.levels)
                      .filter(([, l]) => l)
                      .map(([k, l]) => (
                        <span key={k} className={LEVEL[l].cls} title={`${n[k]} ${WHAT[k]}`}>
                          {LEVEL[l].word}: {n[k]} {WHAT[k]}
                        </span>
                      ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
