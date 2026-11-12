import { useState } from 'react';
import { format } from 'date-fns';
import { Check, FileText, X } from 'lucide-react';
import { useLive, useRepo, Card, Empty, Skeleton, Avatar, Toast } from '../ui';

// =====================================================================
// EXCUSE REQUESTS (/excuses for teachers, /admin/excuses for the admin)
// Parents send these from the parent portal (/parent). The class teacher approves or declines:
//   Approve -> the days that already happened become Excused (unless the child came to school);
//              later days are excused automatically when the class is confirmed.
//   Decline -> nothing changes; the parent sees "Declined" (with the teacher's note, if any).
// =====================================================================
const shortDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

export function ExcuseRequests() {
  const repo = useRepo();
  const [tab, setTab] = useState('pending');
  const [toast, setToast] = useState(null);
  const [notes, setNotes] = useState({});
  const [busy, setBusy] = useState(null);
  const { data } = useLive((r) => r.listExcuses());
  if (!data)
    return (
      <div className="page">
        <Skeleton h={300} />
      </div>
    );
  const pending = data.filter((x) => x.status === 'pending');
  const list = tab === 'pending' ? pending : data.filter((x) => x.status !== 'pending');
  const decide = async (x, decision) => {
    setBusy(x.id);
    try {
      await repo.decideExcuse(x.id, decision, notes[x.id]);
      setToast({ message: decision === 'approved' ? `Approved. ${x.studentName ?? 'The child'} is excused.` : 'Declined.' });
    } catch (e) {
      setToast({ message: e.message });
    } finally {
      setBusy(null);
      setTimeout(() => setToast(null), 3000);
    }
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Excuse requests</h1>
          <p className="page-sub">Sent by parents from the parent portal. Approved days become Excused and don't count toward alerts.</p>
        </div>
      </div>
      <div className="chips">
        <button className={`fchip ${tab === 'pending' ? 'fchip-on' : ''}`} onClick={() => setTab('pending')}>
          Waiting {pending.length}
        </button>
        <button className={`fchip ${tab === 'done' ? 'fchip-on' : ''}`} onClick={() => setTab('done')}>
          Answered {data.length - pending.length}
        </button>
      </div>
      <Card>
        {!list.length ? (
          <Empty title={tab === 'pending' ? 'No requests waiting' : 'Nothing answered yet'} hint="Parents send excuse requests from the parent portal." />
        ) : (
          <ul className="excuse-list">
            {list.map((x) => (
              <li key={x.id} className="excuse-item">
                <div className="excuse-top">
                  {x.student ? <Avatar first={x.student.firstName} last={x.student.lastName} tone={x.section?.color} /> : <FileText size={20} aria-hidden="true" />}
                  <div className="excuse-who">
                    <strong>{x.student ? `${x.student.firstName} ${x.student.lastName}` : x.studentName}</strong>
                    <span className="muted small">
                      {x.section?.name ?? ''} · from {x.guardianName || 'parent'} · {format(new Date(x.createdAt), 'EEE, MMM d · h:mm a')}
                    </span>
                  </div>
                  <span className={`pp-pill pp-pill-${x.status}`}>{x.status === 'pending' ? 'Waiting' : x.status === 'approved' ? 'Approved' : 'Declined'}</span>
                </div>
                <dl className="excuse-facts">
                  <dt>Days</dt>
                  <dd>{x.dates.map(shortDay).join(', ')}</dd>
                  <dt>Reason</dt>
                  <dd>{x.reason}</dd>
                  {x.note && (
                    <>
                      <dt>Message</dt>
                      <dd>{x.note}</dd>
                    </>
                  )}
                  {x.status !== 'pending' && (
                    <>
                      <dt>Answered</dt>
                      <dd>
                        {x.decidedBy} · {format(new Date(x.decidedAt), 'MMM d, h:mm a')}
                        {x.teacherNote ? ` · "${x.teacherNote}"` : ''}
                      </dd>
                    </>
                  )}
                </dl>
                {x.status === 'pending' && (
                  <div className="excuse-actions">
                    <input
                      className="input"
                      placeholder="Note to the parent (optional)"
                      maxLength={200}
                      value={notes[x.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [x.id]: e.target.value }))}
                      aria-label="Note to the parent"
                    />
                    <button className="btn btn-ink" disabled={busy === x.id} onClick={() => decide(x, 'approved')}>
                      <Check size={16} aria-hidden="true" /> Approve
                    </button>
                    <button className="btn" disabled={busy === x.id} onClick={() => decide(x, 'declined')}>
                      <X size={16} aria-hidden="true" /> Decline
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {toast && <Toast message={toast.message} tone={toast.tone} />}
    </div>
  );
}
