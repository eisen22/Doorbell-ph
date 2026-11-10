import { useSearchParams } from 'react-router-dom';
import {
  MessageSquareOff,
  MessageSquare,
  AlertTriangle,
  BadgeCheck,
  HelpCircle,
} from 'lucide-react';
import { displayPhMobile } from '../logic';
import {
  useLive,
  loadMyClasses,
  useClassParam,
  Avatar,
  Card,
  Empty,
  Skeleton,
  StatusChip,
  StreakChip,
  ClassSwitch,
} from '../ui';

// =====================================================================
// MY STUDENTS (/students): the children in my classes and their guardians' numbers.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// MY STUDENTS: the class list with guardian, mobile number status, SMS consent, streak and ID card.
// Teachers can only view; the admin edits student details.
// ---------------------------------------------------------------------
export function Students() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').toLowerCase();
  const [classId, setClass] = useClassParam();
  const { data } = useLive(
    async (r) => {
      const { today, classes, section } = await loadMyClasses(r, classId);
      return { today, classes, section, roster: await r.getRoster(section.id, today.date) };
    },
    [classId],
  );
  if (!data)
    return (
      <div className="page">
        <Skeleton h={44} w={240} />
        <div className="card">
          <Skeleton h={400} />
        </div>
      </div>
    );
  const rows = data.roster.filter((r) => !q || `${r.student.firstName} ${r.student.lastName} ${r.guardian?.name ?? ''}`.toLowerCase().includes(q));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My Students</h1>
          <p className="page-sub">
            {data.section.name} · {data.roster.length} learners
          </p>
        </div>
        <input
          className="input"
          placeholder="Filter by child or guardian"
          value={params.get('q') ?? ''}
          onChange={(e) => {
            const p = new URLSearchParams(params);
            if (e.target.value) p.set('q', e.target.value);
            else p.delete('q');
            setParams(p);
          }}
          aria-label="Filter students"
        />
      </div>
      <ClassSwitch classes={data.classes} value={data.section.id} onChange={setClass} time={data.today.time} date={data.today.actualDate} />
      <Card>
        {rows.length === 0 ? (
          <Empty title="No match" hint="Try another name." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Today</th>
                  <th>Guardian</th>
                  <th>Mobile</th>
                  <th>SMS</th>
                  <th>Streak</th>
                  <th>ID card</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ student, guardian, record, streak }) => (
                  <tr key={student.id}>
                    <td>
                      <div className="cell-person">
                        <Avatar first={student.firstName} last={student.lastName} tone={data.section.color} />
                        <span>
                          <strong>
                            {student.lastName}, {student.firstName}
                          </strong>
                          <span className="muted small">
                            {student.sex === 'M' ? 'Boy' : 'Girl'} · born {student.birthdate}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <StatusChip status={record?.status ?? 'waiting'} />
                    </td>
                    <td>
                      {guardian ? (
                        <>
                          <strong>{guardian.name}</strong>
                          <span className="muted small block">
                            {guardian.relationship}
                            {guardian.studentIds.length > 1 ? ` · ${guardian.studentIds.length} children` : ''}
                          </span>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {guardian ? <span className="mono">{displayPhMobile(guardian.mobile)}</span> : '—'}
                      {guardian && <NumberStatus status={guardian.numberStatus} />}
                    </td>
                    <td>
                      {guardian?.smsConsent ? (
                        <span className="tag tag-ok">
                          <MessageSquare size={13} /> {guardian.preferredLanguage === 'fil' ? 'Filipino' : 'English'}
                        </span>
                      ) : (
                        <span className="tag tag-off">
                          <MessageSquareOff size={13} /> No consent
                        </span>
                      )}
                    </td>
                    <td>{streak.count >= 2 ? <StreakChip s={streak} /> : <span className="muted">-</span>}</td>
                    <td>
                      <span className={`tag ${student.qrStatus === 'active' ? 'tag-ok' : 'tag-bad'}`}>
                        {student.qrStatus === 'active' ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="muted small">
        Student records, guardians and ID cards are managed by the school admin. Contact them to fix a number or reissue a lost card.
      </p>
    </div>
  );
}
// Shows if a guardian's number is verified, unverified, or failed (texts did not go through).
function NumberStatus({ status }) {
  if (status === 'verified')
    return (
      <span className="num-status ok" title="Verified">
        <BadgeCheck size={14} /> Verified
      </span>
    );
  if (status === 'failed')
    return (
      <span className="num-status bad" title="SMS failed">
        <AlertTriangle size={14} /> Needs update
      </span>
    );
  return (
    <span className="num-status" title="Not yet confirmed">
      <HelpCircle size={14} /> Unverified
    </span>
  );
}
