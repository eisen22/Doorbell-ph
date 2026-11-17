import { useState } from 'react';
import { Armchair, Pencil, Shuffle, Eraser, Save, X } from 'lucide-react';
import { Modal } from '../ui';
import { to12h } from '../logic';

// =====================================================================
// SEATING CHART (Attendance -> Seating chart): the class drawn as the teacher sees it from the front
// (the back row on top, the row nearest the board at the bottom).
// Tap a seat to mark that child Present, Late, Absent or Excused (the same as the list).
// "Arrange seats" sets how many rows and columns, an aisle every few columns, how far apart the
// seats are, and who sits where. It is saved for the class, so every teacher of the class sees it.
// Children without a seat are listed under the chart, so nobody is missed.
// =====================================================================

const OPTIONS = ['present', 'late', 'absent', 'excused'];
const WORD = { present: 'Present', late: 'Late', absent: 'Absent', excused: 'Excused' };
const GAP = { close: 4, normal: 10, wide: 18 }; // px between seats
const AISLE = { close: 18, normal: 28, wide: 40 }; // px of an aisle

// A new chart: 6 rows of 6 seats, an aisle every 2 columns.
const blank = { rows: 6, cols: 6, aisleEvery: 2, spacing: 'normal', seats: {} };

export function SeatingChart({ section, roster, layout, canEdit, onChoose, onSave }) {
  const [draft, setDraft] = useState(null); // arranging: a copy of the layout being changed
  const [open, setOpen] = useState(null); // the child whose status window is open (a roster row)
  const [pick, setPick] = useState(null); // arranging: the seat being filled ('row-col')
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const shown = draft ?? layout;
  const byId = new Map(roster.map((r) => [r.student.id, r]));
  const seated = new Set(Object.values(shown?.seats ?? {}));
  const unseated = roster.filter((r) => !seated.has(r.student.id));

  if (!shown)
    return (
      <div className="seat-empty">
        <Armchair size={28} aria-hidden="true" />
        <p>
          <b>No seating chart for {section.name} yet.</b> Set how many rows and columns of chairs the room has and who sits where, then take
          attendance by tapping each seat.
        </p>
        {canEdit ? (
          <button className="btn btn-ink" onClick={() => setDraft(structuredClone(blank))}>
            <Pencil size={16} /> Set up the seating chart
          </button>
        ) : (
          <p className="muted small">The adviser or a subject teacher of this class can set it up.</p>
        )}
      </div>
    );

  const set = (patch) => setDraft({ ...draft, ...patch });
  // Fill the seats A to Z by last name, from the front row, left to right (skips children already seated).
  const fillAtoZ = () => {
    const seats = {};
    let i = 0;
    for (let r = 1; r <= draft.rows; r++)
      for (let c = 1; c <= draft.cols; c++) {
        if (i < roster.length) seats[`${r}-${c}`] = roster[i++].student.id;
      }
    set({ seats });
  };
  // Put a child in a seat; if the child already had a seat, the two seats swap.
  const seatChild = (key, id) => {
    const seats = { ...draft.seats };
    const from = Object.keys(seats).find((k) => seats[k] === id);
    const was = seats[key];
    if (from) delete seats[from];
    if (id) seats[key] = id;
    else delete seats[key];
    if (from && was && was !== id) seats[from] = was;
    set({ seats });
    setPick(null);
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await onSave(draft);
      setDraft(null);
    } catch (e) {
      setError(e.code === 'permission-denied' ? 'Only the adviser, a subject teacher of this class or the admin can change the seating chart.' : e.message);
    }
    setBusy(false);
  };

  // Column widths: one per seat, plus an aisle after every N columns.
  const template = [];
  for (let c = 1; c <= shown.cols; c++) {
    template.push('minmax(64px, 1fr)');
    if (shown.aisleEvery && c % shown.aisleEvery === 0 && c < shown.cols) template.push(`${AISLE[shown.spacing]}px`);
  }

  return (
    <div className="seating">
      <div className="seat-toolbar">
        {draft ? (
          <>
            <label className="field seat-num">
              <span>Rows</span>
              <input className="input" type="number" min={1} max={12} value={draft.rows} onChange={(e) => set({ rows: Number(e.target.value) })} />
            </label>
            <label className="field seat-num">
              <span>Columns</span>
              <input className="input" type="number" min={1} max={12} value={draft.cols} onChange={(e) => set({ cols: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>Aisle</span>
              <select className="input" value={draft.aisleEvery} onChange={(e) => set({ aisleEvery: Number(e.target.value) })}>
                <option value={0}>No aisle</option>
                {[1, 2, 3, 4]
                  .filter((n) => n < draft.cols)
                  .map((n) => (
                    <option key={n} value={n}>
                      After every {n === 1 ? 'column' : `${n} columns`}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Spacing</span>
              <select className="input" value={draft.spacing} onChange={(e) => set({ spacing: e.target.value })}>
                <option value="close">Close</option>
                <option value="normal">Normal</option>
                <option value="wide">Wide</option>
              </select>
            </label>
            <div className="seat-actions">
              <button className="btn" onClick={fillAtoZ}>
                <Shuffle size={15} /> Fill A to Z
              </button>
              <button className="btn" onClick={() => set({ seats: {} })}>
                <Eraser size={15} /> Empty all seats
              </button>
              <button className="btn" onClick={() => setDraft(null)}>
                <X size={15} /> Cancel
              </button>
              <button className="btn btn-ink" onClick={save} disabled={busy}>
                <Save size={15} /> Save seating chart
              </button>
            </div>
            {draft.rows * draft.cols < roster.length && (
              <p className="seat-warn">
                {draft.rows * draft.cols} seats for {roster.length} children: add rows or columns.
              </p>
            )}
            <p className="muted small seat-help">Tap a seat to choose who sits there. Choosing a child who already has a seat swaps the two.</p>
            {error && <p className="error">{error}</p>}
          </>
        ) : (
          <>
            <p className="muted small seat-help-inline">Tap a seat to mark that child. Gate scans fill in Present and Late, like the list.</p>
            {canEdit && (
              <button className="btn" onClick={() => setDraft(structuredClone({ ...blank, ...layout }))}>
                <Pencil size={15} /> Arrange seats
              </button>
            )}
          </>
        )}
      </div>

      <div className="table-wrap">
        <div className="seat-room" style={{ minWidth: shown.cols * 70 }}>
          {/* Drawn as the teacher sees the class from the board: the back row on top, the front row at the bottom. */}
          <div className="seat-back">Back of the room</div>
          <div className="seat-grid" style={{ gridTemplateColumns: template.join(' '), gap: `${GAP[shown.spacing]}px` }}>
            {Array.from({ length: shown.rows }, (_, i) => shown.rows - i).flatMap((r) =>
              Array.from({ length: shown.cols }, (_, j) => j + 1).flatMap((c) => {
                const key = `${r}-${c}`;
                const row = byId.get(shown.seats[key]);
                const st = row?.record?.status;
                const cells = [
                  <button
                    key={key}
                    type="button"
                    className={`seat ${row ? `st-${st ?? 'none'}` : 'seat-free'} ${row?.record?.needsCheck ? 'seat-check' : ''} ${draft && pick === key ? 'seat-picking' : ''}`}
                    onClick={() => (draft ? setPick(key) : row && setOpen(row))}
                    disabled={!draft && !row}
                    aria-label={
                      row
                        ? `Row ${r}, seat ${c}: ${row.student.firstName} ${row.student.lastName}, ${st ? WORD[st] : 'not yet marked'}`
                        : `Row ${r}, seat ${c}: empty`
                    }
                  >
                    {row ? (
                      <>
                        <b>{row.student.lastName}</b>
                        <span>{row.student.firstName}</span>
                        {!draft && <i>{st ? WORD[st] : row.record?.scannedAt ? `In ${to12h(row.record.scannedAt)}` : '—'}</i>}
                      </>
                    ) : (
                      <span className="muted">{draft ? '+ Seat' : ''}</span>
                    )}
                  </button>,
                ];
                if (shown.aisleEvery && c % shown.aisleEvery === 0 && c < shown.cols) cells.push(<span key={`a${key}`} className="seat-aisle" aria-hidden="true" />);
                return cells;
              }),
            )}
          </div>
          <div className="seat-front">Front of the room (board and teacher's table)</div>
        </div>
      </div>

      {unseated.length > 0 && (
        <div className="seat-unseated">
          <b>Without a seat ({unseated.length}):</b>{' '}
          {unseated.map((row, i) => (
            <span key={row.student.id}>
              {i > 0 && ', '}
              {draft ? (
                `${row.student.firstName} ${row.student.lastName}`
              ) : (
                <button className="link-btn" onClick={() => setOpen(row)}>
                  {row.student.firstName} {row.student.lastName}
                  {row.record?.status ? ` (${WORD[row.record.status]})` : ''}
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Taking attendance: one child's status. */}
      {open && (
        <Modal title={`${open.student.firstName} ${open.student.lastName}`} onClose={() => setOpen(null)}>
          <p className="muted small">
            {open.record?.scannedAt ? `Scanned at the gate ${to12h(open.record.scannedAt)}` : 'Not scanned at the gate'}
            {open.record?.status ? ` · now ${WORD[open.record.status]}` : ''}
          </p>
          <div className="seat-status">
            {OPTIONS.map((o) => (
              <button
                key={o}
                className={`seg-btn seg-${o} ${open.record?.status === o ? 'on' : ''}`}
                onClick={() => {
                  onChoose(open, o);
                  setOpen(null);
                }}
              >
                {WORD[o]}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Arranging: who sits in this seat. */}
      {draft && pick && (
        <Modal title={`Row ${pick.split('-')[0]}, seat ${pick.split('-')[1]}`} onClose={() => setPick(null)}>
          <div className="seat-pick-list">
            <button className="btn" onClick={() => seatChild(pick, null)}>
              Empty seat
            </button>
            {[...roster]
              .sort((a, b) => Number(seated.has(a.student.id)) - Number(seated.has(b.student.id)))
              .map((row) => {
                const where = Object.keys(draft.seats).find((k) => draft.seats[k] === row.student.id);
                return (
                  <button key={row.student.id} className={`btn ${draft.seats[pick] === row.student.id ? 'btn-ink' : ''}`} onClick={() => seatChild(pick, row.student.id)}>
                    {row.student.lastName}, {row.student.firstName}
                    <span className="muted small">{where ? ` · row ${where.split('-')[0]}, seat ${where.split('-')[1]}` : ' · no seat yet'}</span>
                  </button>
                );
              })}
          </div>
        </Modal>
      )}
    </div>
  );
}
