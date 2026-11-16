import { format } from 'date-fns';
import { X } from 'lucide-react';
import { useLive, Card, Skeleton, Empty } from '../ui';
import { useState } from 'react';
import { bySectionGrade, manilaToday } from '../logic';

// =====================================================================
// AUDIT LOG (/admin/audit): who changed what. Entries can never be edited or deleted.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// AUDIT LOG: who changed what and when (read-only, cannot be edited or deleted).
// Filters: dates (from / to), class, student, teacher (who did it, or who it was about), and any words.
// Entries are plain text, so class, student and teacher match by name in the entry.
// ---------------------------------------------------------------------
// The date of an entry in the Philippines ('YYYY-MM-DD').
const dayOf = (iso) => manilaToday(new Date(iso));

export function AuditLog() {
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [teacher, setTeacher] = useState('');
  const [student, setStudent] = useState('');
  const { data } = useLive(
    async (r) => ({
      // With a "From" date, every entry since then (older ones are fetched); otherwise the newest.
      audit: from ? await r.listAuditFrom(from) : await r.listAudit(300),
      sections: (await r.listSections()).filter((x) => !x.archived).sort(bySectionGrade),
      teachers: await r.listTeachers().catch(() => []),
      students: await r.listStudentRows().catch(() => []),
    }),
    [from],
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
    const d = dayOf(a.at);
    if (from && d < from) return false;
    if (to && d > to) return false;
    if (section && !has(a, section.name)) return false;
    if (teacher && a.actor !== teacher && !has(a, teacher)) return false;
    if (student.trim() && !student.trim().toLowerCase().split(/\s+/).every((w) => text(a).includes(w))) return false;
    if (q.trim() && !q.trim().toLowerCase().split(/\s+/).every((w) => text(a).includes(w))) return false;
    return true;
  });
  const filtered = from || to || sectionId || teacher || student || q;
  const clear = () => {
    setFrom('');
    setTo('');
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
          <label className="field">
            <span>From</span>
            <input className="input" type="date" value={from} max={to || today} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="field">
            <span>To</span>
            <input className="input" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </label>
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
          <label className="field">
            <span>Student</span>
            <input className="input" list="audit-students" value={student} onChange={(e) => setStudent(e.target.value)} placeholder="Name" />
            <datalist id="audit-students">
              {students.map((x) => (
                <option key={x.student.id} value={`${x.student.firstName} ${x.student.lastName}`} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Words</span>
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. suspension, resend" aria-label="Filter by words" />
          </label>
        </div>
        <p className="muted small audit-count">
          {filtered ? `${list.length} of ${audit.length} entries` : `${audit.length} entries`}
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

