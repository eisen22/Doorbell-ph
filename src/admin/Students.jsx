import { useSearchParams } from 'react-router-dom';
import {
  Users,
  Pencil,
  Plus,
  LogOut,
  Wand2,
  Undo2,
  QrCode,
  AlertTriangle,
} from 'lucide-react';
import {
  useLive,
  Card,
  Skeleton,
  Avatar,
  Empty,
  useRepo,
  Modal,
  Toast,
  DatePicker,
} from '../ui';
import { useState, useMemo } from 'react';
import {
  displayPhMobile,
  normalizePhMobile,
  ASSIGN_METHODS,
  autoAssign,
  manilaToday,
} from '../logic';

// =====================================================================
// STUDENTS (/admin/students): children, guardians, class placement, leaving the school.
// StudentModal and LeaveModal are also used from Sections.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
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
