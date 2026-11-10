import { format } from 'date-fns';
import { useLive, Card, Skeleton, Empty } from '../ui';
import { useState } from 'react';

// =====================================================================
// AUDIT LOG (/admin/audit): who changed what. Entries can never be edited or deleted.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// AUDIT LOG: who changed what and when (read-only, cannot be edited or deleted).
// ---------------------------------------------------------------------
export function AuditLog() {
  const [q, setQ] = useState('');
  const { data } = useLive((r) => r.listAudit(500));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const list = data.filter((a) => !q || `${a.actor} ${a.action} ${a.target} ${a.detail ?? ''}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit Log</h1>
          <p className="page-sub">Every change is recorded and cannot be edited</p>
        </div>
        <input
          className="input"
          placeholder="Filter by person, action or student"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Filter audit log"
        />
      </div>
      <Card>
        {list.length === 0 ? (
          <Empty title="No entries yet" hint="Edits, imports, exports, suspensions and SMS resends appear here." />
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
