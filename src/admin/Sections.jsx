import { format, parseISO } from 'date-fns';
import {
  Users,
  Pencil,
  Trash2,
  Plus,
  Archive,
  ArchiveRestore,
  Clock,
  LogOut,
  GraduationCap,
  ChevronRight,
  UserX,
  Save,
} from 'lucide-react';
import {
  useLive,
  Skeleton,
  Avatar,
  Empty,
  useRepo,
  Modal,
  Toast,
  DatePicker,
  textOn,
  LevelChips,
  countByGrade,
} from '../ui';
import { useState } from 'react';
import { displayPhMobile, fromMinutes, to12h, toMinutes } from '../logic';
import { toStudentInput, StudentModal, LeaveModal } from './Students';
import { toTeacherInput, TeacherModal } from './Teachers';
import { GRADE_LEVELS, gradeName, BREAKS, isBreak, hasSubjectTeachers, sampleProgramFor, subjectsFor, ordinal } from '../logic';

// =====================================================================
// SECTIONS (/admin/sections): classes, their schedules, teachers and "Teacher absent" days.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// SECTIONS: one card per class. Click a card to see its teacher and students (SectionDetail);
// the pencil edits the section's name, color, teacher and times.
// ---------------------------------------------------------------------
// Colors offered for sections. Add any hex color here to offer it.
export const SECTION_COLORS = ['#FFD9A8', '#D8F5A2', '#E4D6FA', '#CDE8F7', '#FBD3E0', '#FFF0A8', '#C9F0E4', '#F2D9C4'];
// Doorbell covers Kindergarten to Grade 6 (GRADE_LEVELS and gradeName come from logic.js).
export { GRADE_LEVELS, gradeName };
// The admin pages group classes by grade: Kindergarten, Grade 1, Grade 2 ... Grade 6.
export const LEVEL_BANDS = GRADE_LEVELS.map((g) => ({ id: g, label: gradeName(g) }));
export const bandOf = (g) => g || 'K';
// Default values for a new section (a morning class).
const blank = () => ({
  name: '',
  gradeLevel: 'K',
  subjectTeacherIds: [], // Grades 4 to 6: filled in from the class program
  program: [], // periods with subject (Grades 4 to 6: and teacher)
  color: SECTION_COLORS[3],
  capacity: 25,
  teacherId: null,
  schedule: {
    classDays: [1, 2, 3, 4, 5],
    startTime: '08:00',
    endTime: '11:30',
    lateCutoffMins: 15,
  },
});
export function Sections() {
  const repo = useRepo();
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [level, setLevel] = useState('all');
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
      const program = (edit.program ?? []).filter((p) => p.start && p.end && p.subject);
      const bad = programProblem(program);
      if (bad) throw new Error(bad);
      const sorted = [...program].sort((x, y) => x.start.localeCompare(y.start));
      // With a class program, the class starts at the first period and ends at the last one.
      const schedule = sorted.length ? { ...edit.schedule, startTime: sorted[0].start, endTime: sorted[sorted.length - 1].end } : edit.schedule;
      await repo.saveSection({ ...edit, name: edit.name.trim(), program, schedule });
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
      {/* Classes grouped by level: Kindergarten, Grades 1 to 3, Grades 4 to 6. */}
      <LevelChips value={level} onChange={setLevel} counts={countByGrade(list, (s) => s.gradeLevel ?? 'K')} />
      {LEVEL_BANDS.filter((band) => level === 'all' || band.id === level).map((band) => {
        const items = list.filter((s) => bandOf(s.gradeLevel) === band.id);
        if (!items.length) return null;
        return (
          <section key={band.id} className="band">
            <h2 className="band-title">
              {band.label} <span className="muted">{items.length}</span>
            </h2>
      <div className="section-grid">
        {items.map((s) => {
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
                        gradeLevel: s.gradeLevel ?? 'K',
                        subjectTeacherIds: s.subjectTeacherIds ?? [],
                        program: (s.program ?? []).map((p) => ({ ...p })),
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
          </section>
        );
      })}

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
              gradeLevel: s.gradeLevel ?? 'K',
              subjectTeacherIds: s.subjectTeacherIds ?? [],
              program: (s.program ?? []).map((p) => ({ ...p })),
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
            <input
              className="input"
              value={edit.name}
              placeholder="e.g. Kindergarten I - Apple, Grade 5 - Rizal"
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              autoFocus
            />
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

          <label className="field">
            <span>Grade level</span>
            <select
              className="input"
              value={edit.gradeLevel ?? 'K'}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  gradeLevel: e.target.value,
                  // Kindergarten to Grade 3: one teacher all day, so the periods have no teachers and there are no subject teachers.
                  ...(hasSubjectTeachers(e.target.value) ? {} : { program: (edit.program ?? []).map(({ teacherId, ...p }) => p), subjectTeacherIds: [] }),
                })
              }
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g} value={g}>
                  {gradeName(g)}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            The gate opens and the absence texts go out at the same times for every class (Settings: gate opening time and first period
            length). Only a teacher confirms a class.
          </p>
          {/* The class program: periods and subjects (Grades 4 to 6: also the teacher of each subject). */}
          {
            <ProgramEditor
              gradeLevel={edit.gradeLevel ?? 'K'}
              program={edit.program ?? []}
              teachers={data.teachers.filter((t) => t.active !== false)}
              adviserId={edit.teacherId}
              startTime={edit.schedule.startTime}
              onChange={(program) => setEdit({ ...edit, program })}
            />
          }
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
// ---------------------------------------------------------------------
// TEACHER ABSENT: shown inside a section's window. Lists the coming days when the teacher is away
// (substitute or no class) and opens the window to add more. Saved by engine.setTeacherAway().
// ---------------------------------------------------------------------
function TeacherAwayList({ section, onAdd, flash }) {
  const repo = useRepo();
  const { data } = useLive((r) => r.listTeacherAway(section.id), [section.id]);
  return (
    <div className="away-box">
      <div className="away-head">
        <h4 className="form-sub">
          <UserX size={16} /> Teacher absent
        </h4>
        <button className="btn btn-sm" onClick={onAdd}>
          <Plus size={15} /> Teacher absent
        </button>
      </div>
      {!data?.length ? (
        <p className="muted small">No absences planned. Use this when the teacher cannot come: pick a substitute, or cancel class for this section only.</p>
      ) : (
        <ul className="cal-list">
          {data.map((a) => (
            <li key={a.date}>
              <time>{format(parseISO(a.date), 'EEE, MMM d')}</time>
              <span>
                {a.kind === 'substitute' ? `Substitute: ${a.teacherName ?? 'teacher'}` : 'No class for this section'}
                {a.note ? <span className="muted"> · {a.note}</span> : null}
              </span>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await repo.clearTeacherAway(section.id, a.date);
                  flash(`${format(parseISO(a.date), 'MMM d')} is a normal class day again`);
                }}
              >
                <Trash2 size={15} /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The window: dates, substitute or no class, note.
function TeacherAwayModal({ section, teachers, sections, onClose, onSaved }) {
  const repo = useRepo();
  const { data: today } = useLive((r) => r.getToday());
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [kind, setKind] = useState('substitute');
  const [teacherId, setTeacherId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const start = from ?? today?.actualDate ?? today?.date;
  const choices = teachers.filter((t) => t.active !== false && t.id !== section.teacherId);
  // Warn (do not block) when the substitute has their own class at the same time.
  const pick = choices.find((t) => t.id === teacherId);
  const clash = pick
    ? sections.find(
        (s) =>
          s.teacherId === pick.id &&
          s.id !== section.id &&
          toMinutes(s.schedule.startTime) < toMinutes(section.schedule.endTime) &&
          toMinutes(section.schedule.startTime) < toMinutes(s.schedule.endTime),
      )
    : null;
  const save = async () => {
    setError('');
    try {
      const dates = await repo.setTeacherAway(section.id, { from: start, to: to ?? start, kind, teacherId, note });
      onSaved(
        `${kind === 'substitute' ? `${pick?.name} covers` : 'No class for'} ${section.name} on ${dates.length} class day${dates.length === 1 ? '' : 's'}`,
      );
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <Modal
      title={`Teacher absent: ${section.name}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-ink" onClick={save} disabled={!start || (kind === 'substitute' && !teacherId)}>
            <Save size={16} /> Save
          </button>
        </>
      }
    >
      <div className="form-row">
        <div className="field">
          <span>From</span>
          <DatePicker value={start} onChange={setFrom} ariaLabel="First day the teacher is absent" />
        </div>
        <div className="field">
          <span>To (same day if one day)</span>
          <DatePicker value={to ?? start} onChange={setTo} min={start} ariaLabel="Last day the teacher is absent" />
        </div>
      </div>
      <div className="leave-options">
        <label className={`type-opt ${kind === 'substitute' ? 'on' : ''}`}>
          <input type="radio" name="away" checked={kind === 'substitute'} onChange={() => setKind('substitute')} />
          <span className="swatch k-class" />
          <span>
            <b>A substitute takes the class</b>
            <small>The class appears for the substitute on those days only. They take and confirm attendance.</small>
          </span>
        </label>
        <label className={`type-opt ${kind === 'noclass' ? 'on' : ''}`}>
          <input type="radio" name="away" checked={kind === 'noclass'} onChange={() => setKind('noclass')} />
          <span className="swatch k-suspension" />
          <span>
            <b>No class for this section</b>
            <small>Only this section. Children are not marked absent, no 3-day texts, and the gate shows "No class today".</small>
          </span>
        </label>
      </div>
      {kind === 'substitute' && (
        <label className="field">
          <span>Substitute teacher</span>
          <select className="input" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Pick a teacher</option>
            {choices.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {clash && (
        <p className="hint">
          {pick.name} also teaches {clash.name} at the same time ({to12h(clash.schedule.startTime)} to {to12h(clash.schedule.endTime)}). Fine if the two
          classes are combined; otherwise pick someone else.
        </p>
      )}
      <label className="field">
        <span>Note (optional), e.g. "sick leave", "seminar"</span>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <p className="muted small">Weekends, holidays and days already confirmed are skipped. Everything is written in the audit log.</p>
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

function SectionDetail({ section, sections, teachers, rows, onClose, onEditSection, flash }) {
  const [student, setStudent] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [teacher, setTeacher] = useState(null);
  const [away, setAway] = useState(false); // the "Teacher absent" window
  const [q, setQ] = useState('');
  const t = teachers.find((x) => x.id === section.teacherId);
  const list = rows.filter((r) => r.enrollment?.status === 'active' && r.enrollment.sectionId === section.id);
  const shown = list.filter(
    (r) => !q || `${r.student.firstName} ${r.student.lastName} ${r.guardian?.name ?? ''}`.toLowerCase().includes(q.toLowerCase()),
  );
  const live = sections.filter((s) => !s.archived);
  const also = t ? live.filter((s) => s.teacherId === t.id && s.id !== section.id) : [];
  const busy = !!(student || leaving || teacher || away);
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
          <TeacherAwayList section={section} onAdd={() => setAway(true)} flash={flash} />
          <ProgramTable section={section} teachers={teachers} onEdit={() => onEditSection(section)} />

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
      {away && (
        <TeacherAwayModal
          section={section}
          teachers={teachers}
          sections={live}
          onClose={() => setAway(false)}
          onSaved={(m) => {
            setAway(false);
            flash(m);
          }}
        />
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
// CLASS PROGRAM (Grades 4 to 6)
// ---------------------------------------------------------------------
/** Returns a message if two periods overlap or a period ends before it starts, else null. */
export function programProblem(program) {
  const list = [...program].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (p.end <= p.start) return `${p.subject} (${to12h(p.start)}) ends before it starts.`;
    const next = list[i + 1];
    if (next && next.start < p.end) return `${p.subject} (${to12h(p.start)}–${to12h(p.end)}) overlaps ${next.subject} (${to12h(next.start)}).`;
  }
  return null;
}

// The teacher who usually takes a subject: the adviser if they teach it, else a teacher whose subjects include it.
function teacherForSubject(teachers, adviserId, subject) {
  const teachesIt = (t) => (t.subjects ?? []).includes(subject);
  const adviser = teachers.find((t) => t.id === adviserId);
  if (adviser && teachesIt(adviser)) return adviser.id;
  return teachers.find(teachesIt)?.id ?? adviserId ?? null;
}

function ProgramEditor({ gradeLevel, program, teachers, adviserId, startTime, onChange }) {
  const rows = program;
  const withTeachers = hasSubjectTeachers(gradeLevel); // Grades 4 to 6
  const subjects = subjectsFor(gradeLevel);
  const set = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));
  const add = () => {
    const last = [...rows].sort((a, b) => a.start.localeCompare(b.start)).at(-1);
    const start = last?.end ?? startTime ?? '07:30';
    const subject = subjects[0];
    onChange([
      ...rows,
      { start, end: fromMinutes(toMinutes(start) + 50), subject, ...(withTeachers ? { teacherId: teacherForSubject(teachers, adviserId, subject) } : {}) },
    ]);
  };
  const fill = () => onChange(sampleProgramFor(gradeLevel, startTime || '07:30', (sub) => teacherForSubject(teachers, adviserId, sub)));
  const problem = programProblem(rows.filter((p) => p.start && p.end));
  let n = 0;
  return (
    <div className="field">
      <span>Class program</span>
      {rows.length === 0 ? (
        <p className="muted small">No periods yet. Add each period{withTeachers ? ' with its subject and teacher' : ' with its subject'}, or start from a sample program and change it.</p>
      ) : (
        <div className="program-edit">
          {rows.map((r, i) => {
            const brk = isBreak(r);
            if (!brk) n += 1;
            // Keep a subject that is not in this grade's list (e.g. typed in before).
            const options = subjects.includes(r.subject) || BREAKS.includes(r.subject) ? subjects : [r.subject, ...subjects];
            return (
              <div key={i} className={`program-row ${brk ? 'program-break' : ''} ${withTeachers ? '' : 'program-solo'}`}>
                <span className="pr-n program-n">{brk ? '' : ordinal(n)}</span>
                <input type="time" className="input pr-s" value={r.start} onChange={(e) => set(i, { start: e.target.value })} aria-label="Starts" />
                <input type="time" className="input pr-e" value={r.end} onChange={(e) => set(i, { end: e.target.value })} aria-label="Ends" />
                <select
                  className="input pr-sub"
                  value={r.subject}
                  aria-label="Subject"
                  onChange={(e) => {
                    const subject = e.target.value;
                    if (!withTeachers || BREAKS.includes(subject)) return set(i, { subject, teacherId: undefined });
                    set(i, { subject, teacherId: r.teacherId ?? teacherForSubject(teachers, adviserId, subject) });
                  }}
                >
                  <optgroup label={gradeLevel === 'K' ? 'Activities' : 'Subjects'}>
                    {options.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Breaks">
                    {BREAKS.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </optgroup>
                </select>
                {withTeachers &&
                  (brk ? (
                    <span className="muted small program-noteacher pr-t">No class</span>
                  ) : (
                    <select className="input pr-t" value={r.teacherId ?? ''} aria-label="Teacher" onChange={(e) => set(i, { teacherId: e.target.value || null })}>
                      <option value="">No teacher yet</option>
                      {teachers.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                          {t.id === adviserId ? ' (adviser)' : ''}
                        </option>
                      ))}
                    </select>
                  ))}
                <button type="button" className="icon-btn sm pr-x" onClick={() => remove(i)} aria-label="Remove this period">
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="program-actions">
        <button type="button" className="btn btn-sm" onClick={add}>
          <Plus size={14} /> Add period
        </button>
        <button type="button" className="btn btn-sm" onClick={fill}>
          {rows.length ? 'Replace with sample program' : 'Fill sample program'}
        </button>
      </div>
      {problem && <p className="error small">{problem}</p>}
      <span className="muted small">
        {withTeachers
          ? 'The teacher above (the adviser) takes the 1st-period attendance. The teachers in this program see the class list, including who was absent at the 1st period, and can mark a child who arrives during their period.'
          : 'One teacher (above) handles every period.'}{' '}
        The absence texts go out when the 1st period ends. The class times above follow the first and last period when you save.
      </span>
    </div>
  );
}

function ProgramTable({ section, teachers, onEdit }) {
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
          <button className="link-btn" onClick={onEdit}>
            Add periods
          </button>
        </p>
      ) : (
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
                <tr key={i} className={brk ? 'program-break' : ''}>
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
      )}
    </>
  );
}
