import { Clock } from 'lucide-react';
import { hasSubjectTeachers, isBreak, ordinal, to12h } from '../logic';

// =====================================================================
// PROGRAM TABLE — a class's program: Period | Time | Subject | Teacher, with recess and lunch rows.
// Used by the admin's class details (Sections) and the teacher's My Classes.
//   onEdit    (admin) shows an "Add periods" link when the class has no program yet
//   highlight a teacher id: that teacher's periods are highlighted ("your periods")
// Kindergarten to Grade 3 have one teacher, so there is no Teacher column.
// =====================================================================
export function ProgramTable({ section, teachers, onEdit, highlight }) {
  const rows = [...(section.program ?? [])].sort((a, b) => a.start.localeCompare(b.start));
  const name = (id) => teachers.find((t) => t.id === id)?.name ?? 'No teacher yet';
  const withTeachers = hasSubjectTeachers(section.gradeLevel); // Kindergarten to Grade 3: one teacher, no column
  let n = 0;
  return (
    <>
      <h4 className="form-sub">
        <Clock size={16} /> Class program
      </h4>
      {!rows.length ? (
        <p className="muted">
          No class program yet.{' '}
          {onEdit && (
            <button className="link-btn" onClick={onEdit}>
              Add periods
            </button>
          )}
        </p>
      ) : (
        <div className="table-wrap">
        <table className="program-table">
          <thead>
            <tr>
              <th>Period</th>
              <th>Time</th>
              <th>Subject</th>
              {withTeachers && <th>Teacher</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((p, i) => {
              const brk = isBreak(p);
              if (!brk) n += 1;
              return (
                <tr
                  key={i}
                  className={`${brk ? 'program-break' : ''} ${!brk && highlight && (p.teacherId === highlight || (!p.teacherId && section.teacherId === highlight)) ? 'program-mine' : ''}`}
                >
                  <td>{brk ? '' : ordinal(n)}</td>
                  <td className="nowrap">
                    {to12h(p.start)} – {to12h(p.end)}
                  </td>
                  <td>{p.subject}</td>
                  {withTeachers && <td>{brk ? '' : name(p.teacherId)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </>
  );
}
