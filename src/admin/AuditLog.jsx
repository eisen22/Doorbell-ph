import { format, parseISO } from 'date-fns';
import { X } from 'lucide-react';
import { useLive, Card, Skeleton, Empty, DatePicker } from '../ui';
import { useState } from 'react';
import { bySectionGrade, manilaToday, addDays } from '../logic';

// =====================================================================
// AUDIT LOG (/admin/audit): who changed what. Entries can never be edited or deleted.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// AUDIT LOG: who changed what and when (read-only, cannot be edited or deleted).
// Filters: one date, class, student, teacher (who did it, or who it was about), and any words.
// Entries are plain text, so class, student and teacher match by name in the entry.
// ---------------------------------------------------------------------

export function AuditLog() {
  const [q, setQ] = useState('');
  const [date, setDate] = useState(''); // one day, or '' = the newest entries
  const [sectionId, setSectionId] = useState('');
  const [teacher, setTeacher] = useState('');
  const [student, setStudent] = useState('');
  const { data } = useLive(
    async (r) => ({
      // A date: every entry of that day (fetched if older); otherwise the newest.
      audit: date ? await r.listAuditOn(date) : await r.listAudit(300),
      sections: (await r.listSections()).filter((x) => !x.archived).sort(bySectionGrade),
      teachers: await r.listTeachers().catch(() => []),
      students: await r.listStudentRows().catch(() => []),
    }),
    [date],
  );
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const { audit, sections, teachers, students } = data;
  // Everyone who did something, plus every teacher (an entry can be about a teacher, e.g. "teacher.update").
  const people = [...new Set([...audit.map((a) => a.actor), ...teachers.map((t) => t.name)])].filter(Boolean).sort();
  const section = sections.find((x) => x.id === sectionId);
  const text = (a) => `${a.actor} ${a.action} ${a.target ?? ''} ${a.detail ?? ''}`.toLowerCase();
  const has = (a, words) => text(a).includes(words.toLowerCase());
  const list = audit.filter((a) => {
    if (section && !has(a, section.name)) return false;
    if (teacher && a.actor !== teacher && !has(a, teacher)) return false;
    if (student.trim() && !student.trim().toLowerCase().split(/\s+/).every((w) => text(a).includes(w))) return false;
    if (q.trim() && !q.trim().toLowerCase().split(/\s+/).every((w) => text(a).includes(w))) return false;
    return true;
  });
  const filtered = date || sectionId || teacher || student || q;
  const clear = () => {
    setDate('');
    setSectionId('');
    setTeacher('');
    setStudent('');
    setQ('');
  };
  const today = manilaToday();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit Log</h1>
          <p className="page-sub">Every change is recorded and cannot be edited</p>
        </div>
      </div>
      <Card>
        <div className="audit-filters">
          <div className="field">
            <span>
              Date
              {date && (
                <button className="link-btn small-link" onClick={() => setDate('')}>
                  Any date
                </button>
              )}
            </span>
            <DatePicker
              value={date}
              max={today}
              onChange={setDate}
              placeholder="Any date"
              ariaLabel="Date"
              anyDay
              quick={[
                ['Today', today],
                ['Yesterday', addDays(today, -1)],
              ]}
            />
          </div>
          <label className="field">
            <span>Class</span>
            <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)}>
              <option value="">All classes</option>
              {sections.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Teacher or staff</span>
            <select className="input" value={teacher} onChange={(e) => setTeacher(e.target.value)}>
              <option value="">Everyone</option>
              {people.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Student</span>
            <StudentSearch value={student} onChange={setStudent} students={students} />
          </div>
          <label className="field">
            <span>Words</span>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. suspension, resend" aria-label="Filter by words" />
          </label>
        </div>
        <p className="muted small audit-count">
          {filtered ? `${list.length} of ${audit.length} ${audit.length === 1 ? 'entry' : 'entries'}` : `${audit.length} ${audit.length === 1 ? 'entry' : 'entries'}`}
          {filtered && (
            <>
              {' '}
              ·{' '}
              <button className="link-btn" onClick={clear}>
                <X size={14} /> Clear filters
              </button>
            </>
          )}
        </p>
      </Card>
      <Card>
        {list.length === 0 ? (
          filtered ? (
            <Empty title="Nothing matches these filters" hint="Try a wider date range, or clear a filter." />
          ) : (
            <Empty title="No entries yet" hint="Edits, imports, exports, suspensions and SMS resends appear here." />
          )
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
                    <td>{readableDates(a.target)}</td>
                    <td className="muted">{readableDates(a.detail)}</td>
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

// Dates saved as 2026-11-18 inside an entry are shown as Nov 18, 2026 (month first, like the rest of the app).
function readableDates(text) {
  return typeof text === 'string' ? text.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => format(parseISO(m), 'MMM d, yyyy')) : text;
}

// Student box: type a few letters, then pick from the matching names (at most 8, A to Z by last name).
function StudentSearch({ value, onChange, students }) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const matches = q
    ? students
        .filter(({ student: st }) => `${st.firstName} ${st.lastName}`.toLowerCase().includes(q) || `${st.lastName} ${st.firstName}`.toLowerCase().includes(q))
        .sort((a, b) => a.student.lastName.localeCompare(b.student.lastName) || a.student.firstName.localeCompare(b.student.firstName))
        .slice(0, 8)
    : [];
  return (
    <div className="suggest">
      <input
        className="input"
        value={value}
        placeholder="Type a name"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        aria-label="Student"
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <ul className="suggest-list" role="listbox">
          {matches.map(({ student: st, section }) => (
            <li key={st.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(`${st.firstName} ${st.lastName}`);
                  setOpen(false);
                }}
              >
                {st.lastName}, {st.firstName}
                {/* the class tells two children with the same name apart */}
                {section && <span className="muted small"> · {section.name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
