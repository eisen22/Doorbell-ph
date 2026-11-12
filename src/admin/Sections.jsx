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
} from '../ui';
import { useState } from 'react';
import { displayPhMobile, fromMinutes, to12h, toMinutes } from '../logic';
import { toStudentInput, StudentModal, LeaveModal } from './Students';
import { toTeacherInput, TeacherModal } from './Teachers';

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
// Grade levels the school can have: Kindergarten to Grade 10 (Junior High School).
export const GRADE_LEVELS = ['K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
export const gradeName = (g) => (g === 'K' || !g ? 'Kindergarten' : `Grade ${g}`);
// Default values for a new section (a morning class).
const blank = () => ({
  name: '',
  gradeLevel: 'K',
  // Older learners: text the parent when the child entered the gate but is not in class (may be cutting class).
  textParentIfMissing: false,
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
            <span>Grade level</span>
            <select
              className="input"
              value={edit.gradeLevel ?? 'K'}
              onChange={(e) => {
                const g = e.target.value;
                // New section, Grade 4 and up: suggest texting the parent (older learners may cut class).
                setEdit({ ...edit, gradeLevel: g, textParentIfMissing: edit.id ? edit.textParentIfMissing : g !== 'K' && Number(g) >= 4 });
              }}
            >
              {GRADE_LEVELS.map((g) => (
                <option key={g} value={g}>
                  {gradeName(g)}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={!!edit.textParentIfMissing} onChange={(e) => setEdit({ ...edit, textParentIfMissing: e.target.checked })} />
            <span>
              Text the parent if a learner was scanned at the gate but is not in class
              <span className="muted small block">
                Suggested for Grade 4 and up, where learners may cut class. For younger learners, leave it off: only the teacher and admin are
                alerted, so the school can find the child first.
              </span>
            </span>
          </label>
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
