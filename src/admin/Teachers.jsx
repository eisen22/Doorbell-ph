import {
  Pencil,
  Plus,
  UserX,
  UserCheck,
  Info,
} from 'lucide-react';
import {
  useLive,
  Card,
  Skeleton,
  Avatar,
  useRepo,
  Modal,
  Toast,
  LevelChips,
  countByGrade,
  SectionChips,
} from '../ui';
import { useState } from 'react';
import { displayPhMobile, to12h, normalizePhMobile, GRADE_LEVELS, gradeName, gradeRank, SUBJECTS, hasSubjectTeachers } from '../logic';

// =====================================================================
// TEACHERS (/admin/teachers): teacher accounts and the classes they handle.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// TEACHERS: click a name to edit; tick the classes they handle. Adding a teacher creates their
// sign-in account and shows a temporary password once.
// ---------------------------------------------------------------------
export const toTeacherInput = (t) => ({
  id: t.id,
  name: t.name,
  email: t.email,
  mobile: t.mobile ? displayPhMobile(t.mobile) : '',
  subjects: t.subjects ?? [],
  gradeLevel: t.gradeLevel ?? null,
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
  // The grade they teach: picked here, or (for older records) the grade of the class they advise.
  const grade = edit.gradeLevel ?? live.find((s) => input.id && s.teacherId === input.id)?.gradeLevel ?? '';
  // Only that grade's classes are listed (plus any class already ticked).
  const shownClasses = live.filter((s) => !grade || (s.gradeLevel ?? 'K') === grade || classes.has(s.id));
  const upper = !grade || hasSubjectTeachers(grade);
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
      const res = await repo.saveTeacher({ ...edit, gradeLevel: grade || null, name: edit.name.trim(), email: edit.email.trim(), mobile });
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
          gradeLevel: s.gradeLevel,
          subjectTeacherIds: s.subjectTeacherIds ?? [],
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
      {/* The grade they teach: only that grade's classes are listed below. */}
      <label className="field">
        <span>Grade level</span>
        <select className="input" value={grade} onChange={(e) => setEdit({ ...edit, gradeLevel: e.target.value || null })}>
          <option value="">Any grade (show all classes)</option>
          {GRADE_LEVELS.map((g) => (
            <option key={g} value={g}>
              {gradeName(g)} teacher
            </option>
          ))}
        </select>
      </label>
      {/* Subjects: Grades 4 to 6 may have a teacher per subject. Used to sort ("Mathematics teachers"). */}
      {upper && (
      <fieldset className="checks subject-checks">
        <legend>Subjects taught (Grades 4 to 6, optional)</legend>
        {SUBJECTS.map((sub) => {
          const on = (edit.subjects ?? []).includes(sub);
          return (
            <label key={sub}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => setEdit({ ...edit, subjects: on ? edit.subjects.filter((x) => x !== sub) : [...(edit.subjects ?? []), sub] })}
              />{' '}
              {sub}
            </label>
          );
        })}
      </fieldset>
      )}
      <fieldset className="checks class-checks">
        <legend>{grade ? `${gradeName(grade)} classes handled (as adviser)` : 'Classes handled (as adviser)'}</legend>
        {shownClasses.length === 0 && (
          <p className="muted small">{live.length ? `No ${gradeName(grade)} sections yet. Add one on the Sections page.` : 'No sections yet. Add one on the Sections page.'}</p>
        )}
        {shownClasses.map((s) => {
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
          A teacher can handle several classes as long as the class times do not overlap, for example a morning and an afternoon class.
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
  const [level, setLevel] = useState('all');
  const [secId, setSecId] = useState('all'); // one section of the chosen grade level, or all of them
  const [sortBy, setSortBy] = useState('grade');
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
  const live = data.sections.filter((x) => !x.archived);
  const adviserOf = (t) => live.filter((x) => x.teacherId === t.id);
  const subjectOf = (t) => live.filter((x) => (x.subjectTeacherIds ?? []).includes(t.id));
  // The grade levels a teacher teaches (as adviser or subject teacher).
  const levelsOf = (t) => [...[...adviserOf(t), ...subjectOf(t)].map((x) => x.gradeLevel ?? 'K'), ...(t.gradeLevel ? [t.gradeLevel] : [])];
  const firstLevel = (t) => Math.min(99, ...adviserOf(t).map((x) => gradeRank(x.gradeLevel)), ...(t.gradeLevel && !subjectOf(t).length ? [gradeRank(t.gradeLevel)] : []));
  // Teaches this section (as adviser or subject teacher).
  const teaches = (t, id) => [...adviserOf(t), ...subjectOf(t)].some((x) => x.id === id);
  const sec = level !== 'all' && secId !== 'all' ? live.find((x) => x.id === secId) : null;
  const shown = data.teachers.filter((t) => (level === 'all' || levelsOf(t).includes(level)) && (!sec || teaches(t, sec.id)));
  const byName = (a, b) => a.name.localeCompare(b.name);
  // Advises a class in the picked grade, or was added as that grade's teacher and has no class yet.
  const isAdv = (t) =>
    sec
      ? sec.teacherId === t.id
      : adviserOf(t).some((x) => (x.gradeLevel ?? 'K') === level) || (t.gradeLevel === level && !adviserOf(t).length && !subjectOf(t).length);
  // Groups: by the grade they advise (subject teachers with no class of their own after Grade 6),
  // by subject (teachers of Grades 4 to 6), or one list by name.
  const groups =
    sortBy === 'name'
      ? [{ key: 'all', label: 'All teachers', items: [...shown].sort(byName) }]
      : sortBy === 'subject'
        ? [
            ...SUBJECTS.map((sub) => ({
              key: sub,
              label: `${sub} teachers`,
              items: shown.filter((t) => (t.subjects ?? []).includes(sub) && levelsOf(t).some((g) => Number(g) >= 4)).sort(byName),
            })),
            {
              key: 'none',
              label: 'No subject set (Kindergarten to Grade 3, or not filled in)',
              items: shown.filter((t) => !(t.subjects ?? []).length || !levelsOf(t).some((g) => Number(g) >= 4)).sort(byName),
            },
          ].filter((g) => g.items.length)
        : level !== 'all'
          ? // One grade picked: its advisers, then the teachers who only teach a subject in that grade
            // (advisers of other grades included, e.g. a Grade 5 adviser who teaches Filipino in Grade 4).
            [
              {
                key: 'adv',
                label: sec ? `Adviser of ${sec.name}` : `${gradeName(level)} advisers`,
                items: shown.filter((t) => isAdv(t)).sort(byName),
              },
              {
                key: 'sub',
                label: sec ? `Subject teachers of ${sec.name}` : `Subject teachers in ${gradeName(level)}`,
                items: shown.filter((t) => !isAdv(t)).sort(byName),
              },
            ].filter((g) => g.items.length)
          : [
            ...GRADE_LEVELS.map((g) => ({
              key: g,
              label: `${gradeName(g)} advisers`,
              items: shown.filter((t) => firstLevel(t) === gradeRank(g)).sort(byName),
            })),
            {
              key: 'subject',
              label: 'Subject teachers (no class of their own)',
              items: shown.filter((t) => firstLevel(t) === 99 && subjectOf(t).length).sort(byName),
            },
            { key: 'none', label: 'No class', items: shown.filter((t) => firstLevel(t) === 99 && !subjectOf(t).length).sort(byName) },
          ].filter((g) => g.items.length);
  const row = (t) => {
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
                      {secs.length || subjectOf(t).length ? (
                        <div className="tag-stack">
                          {secs.map((sec) => (
                            <span key={sec.id} className="tag" style={{ background: sec.color }}>
                              {sec.name} · {to12h(sec.schedule.startTime)}
                            </span>
                          ))}
                          {subjectOf(t).length > 0 && (
                            <span className="muted small">
                              {(t.subjects ?? []).length ? `${t.subjects.join(', ')} in ` : 'Subject teacher in '}
                              {subjectOf(t)
                                .map((x) => x.name.replace(/^Grade /, 'G'))
                                .join(', ')}
                            </span>
                          )}
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
      <LevelChips
        value={level}
        onChange={(v) => {
          setLevel(v);
          setSecId('all');
        }}
        counts={countByGrade(data.teachers.flatMap((t) => [...new Set(levelsOf(t))].map((g) => ({ g }))), (x) => x.g)}
      />
      <SectionChips
        level={level}
        sections={live}
        value={secId}
        onChange={setSecId}
        counts={Object.fromEntries(live.map((x) => [x.id, data.teachers.filter((t) => teaches(t, x.id)).length]))}
      />
      <div className="chips">
        <select className="input auto" value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Group teachers">
          <option value="grade">Group: by grade (Kindergarten to Grade 6)</option>
          <option value="subject">Group: by subject (Grades 4 to 6)</option>
          <option value="name">Sort: by name</option>
        </select>
      </div>
      {groups.map((grp) => (
        <Card key={grp.key} title={`${grp.label} (${grp.items.length})`}>
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
              <tbody>{grp.items.map((t) => row(t))}</tbody>
            </table>
          </div>
        </Card>
      ))}
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
