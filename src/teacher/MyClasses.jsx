import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  MessageSquareOff,
  MessageSquare,
  AlertTriangle,
  BadgeCheck,
  HelpCircle,
  CalendarDays,
  ClipboardCheck,
  Clock,
  GraduationCap,
  Users,
} from 'lucide-react';
import { classPeriods, displayPhMobile, gradeName, hasSubjectTeachers, ordinal, to12h } from '../logic';
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
  StudentAttendanceModal,
  textOn,
} from '../ui';
import { ProgramTable } from '../admin/Sections';

// =====================================================================
// MY CLASSES (/classes): my classes and the children in them, on one page.
//   Top: one card per class, grouped: Advisory class, Subject classes (Grades 4 to 6), Covering today.
//   Picking a class (here, or a class on the Dashboard -> /classes?class=<id>) shows its details
//   (adviser, class program) and its class list with guardian, mobile number status, SMS consent,
//   streak, ID card and the attendance History of each child.
// Teachers can only view; the admin edits classes and student details.
// Pattern: useLive(...) loads data from the engine and reloads on any change.
// =====================================================================
export function MyClasses() {
  const [params, setParams] = useSearchParams();
  const q = (params.get('q') ?? '').toLowerCase();
  const [classId, setClass] = useClassParam();
  const [history, setHistory] = useState(null); // the child whose attendance history is open
  const { data } = useLive(
    async (r) => {
      const { session, today, classes, section } = await loadMyClasses(r, classId);
      const teachers = await r.listTeachers();
      const counts = Object.fromEntries(await Promise.all(classes.map(async (c) => [c.id, (await r.getRoster(c.id, today.date)).length])));
      return { session, today, classes, section, teachers, counts, roster: await r.getRoster(section.id, today.date) };
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
  const { session, today, classes, section, teachers, counts } = data;
  const me = session.teacherId;
  const roleOf = (c) => (c.teacherId === me ? 'advisory' : (c.subjectTeacherIds ?? []).includes(me) ? 'subject' : 'covering');
  const myPeriods = (c) =>
    classPeriods(c.program)
      .map((p, i) => ({ ...p, n: i + 1 }))
      .filter((p) => p.teacherId === me || (!p.teacherId && c.teacherId === me && !hasSubjectTeachers(c.gradeLevel)));
  const nameOf = (id) => teachers.find((t) => t.id === id)?.name;
  const groups = [
    { id: 'advisory', title: 'Advisory class' },
    { id: 'subject', title: 'Subject classes' },
    { id: 'covering', title: 'Covering today' },
  ]
    .map((g) => ({ ...g, items: classes.filter((c) => roleOf(c) === g.id) }))
    .filter((g) => g.items.length);
  const adviser = teachers.find((t) => t.id === section.teacherId);
  const role = roleOf(section);
  const tally = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const r of data.roster) if (r.record?.status) tally[r.record.status] += 1;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My Classes</h1>
          <p className="page-sub">
            {classes.length} {classes.length === 1 ? 'class' : 'classes'} · pick a class to see its program and class list
          </p>
        </div>
      </div>

      {/* My classes, grouped. The picked class is outlined. */}
      {classes.length > 1 && (
        <Card>
          {groups.map((g) => (
            <div key={g.id} className="class-group">
              <h3 className="class-group-title">
                {g.title} <span className="muted small">{g.items.length}</span>
              </h3>
              <div className="mc-grid">
                {g.items.map((c) => {
                  const mine = myPeriods(c);
                  return (
                    <button key={c.id} className={`mc-card ${c.id === section.id ? 'mc-on' : ''}`} onClick={() => setClass(c.id)} aria-pressed={c.id === section.id}>
                      <span className="mc-band" style={{ background: c.color, color: textOn(c.color) }}>
                        <strong>{c.name}</strong>
                      </span>
                      <span className="mc-body">
                        <span>
                          <Clock size={13} /> {to12h(c.schedule.startTime)} to {to12h(c.schedule.endTime)} · <Users size={13} /> {counts[c.id] ?? 0}
                        </span>
                        <span>
                          <GraduationCap size={13} /> Adviser: {c.teacherId === me ? 'you' : nameOf(c.teacherId) ?? 'not set'}
                        </span>
                        {roleOf(c) === 'subject' && mine.length > 0 && (
                          <span className="mc-mine">Your periods: {mine.map((p) => `${ordinal(p.n)} ${p.subject}`).join(', ')}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* The picked class: details. */}
      <Card
        title={section.name}
        action={
          <Link className="btn btn-sm" to={`/attendance?class=${section.id}`}>
            <ClipboardCheck size={15} /> Take attendance
          </Link>
        }
      >
        <div className="sd-head" style={{ background: section.color, color: textOn(section.color) }}>
          <span>{gradeName(section.gradeLevel ?? 'K')}</span>
          <span>
            <Clock size={14} /> {to12h(section.schedule.startTime)} to {to12h(section.schedule.endTime)}
          </span>
          <span>
            <Users size={14} /> {data.roster.length} / {section.capacity} learners
          </span>
          <span>{role === 'advisory' ? 'You are the adviser' : role === 'subject' ? 'You teach a subject here' : 'You are covering today'}</span>
        </div>
        <div className="mc-detail">
          <div>
            <h4 className="form-sub">
              <GraduationCap size={16} /> Adviser
            </h4>
            {adviser ? (
              <div className="sd-teacher">
                <Avatar first={adviser.name.split(' ')[0]} last={adviser.name.split(' ').slice(-1)[0]} tone={section.color} />
                <div>
                  <strong>
                    {adviser.name}
                    {adviser.id === me ? ' (you)' : ''}
                  </strong>
                  <span className="muted small block">
                    {adviser.email}
                    {adviser.mobile ? ` · ${displayPhMobile(adviser.mobile)}` : ''}
                  </span>
                </div>
              </div>
            ) : (
              <p className="muted">No adviser yet.</p>
            )}
            <h4 className="form-sub">
              <Users size={16} /> {today.date === today.actualDate ? 'Today' : 'Last class day'}
            </h4>
            <p className="muted small">
              {tally.present} present · {tally.late} late · {tally.absent} absent{tally.excused ? ` · ${tally.excused} excused` : ''} ·{' '}
              {data.roster.length - tally.present - tally.late - tally.absent - tally.excused} not yet
            </p>
          </div>
          <div>
            <ProgramTable section={section} teachers={teachers} highlight={me} />
          </div>
        </div>
      </Card>

      {/* The picked class: the children. */}
      <div className="mc-list-head">
        <h2 className="h2">Class list · {data.roster.length} learners</h2>
        <input
          className="input"
          placeholder="Filter by child or guardian"
          value={params.get('q') ?? ''}
          onChange={(e) => {
            const p = new URLSearchParams(params);
            if (e.target.value) p.set('q', e.target.value);
            else p.delete('q');
            setParams(p, { replace: true });
          }}
          aria-label="Filter students"
        />
      </div>
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
                  <th>Attendance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ student, guardian, record, streak }) => (
                  <tr key={student.id}>
                    <td>
                      <div className="cell-person">
                        <Avatar first={student.firstName} last={student.lastName} tone={section.color} />
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
                    <td>
                      <button type="button" className="btn btn-sm" onClick={() => setHistory(student)}>
                        <CalendarDays size={15} /> History
                      </button>
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
      {history && <StudentAttendanceModal student={history} section={data.section} onClose={() => setHistory(null)} />}
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
