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
} from '../ui';
import { useState } from 'react';
import { displayPhMobile, to12h, normalizePhMobile } from '../logic';

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
