import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import {
  Lock,
  ChevronRight,
  ShieldCheck,
  MessageSquareOff,
  ChevronLeft,
} from 'lucide-react';
import {
  addDays,
  autoFinalizeTime,
  emptyCounts,
  isSchoolDay,
  to12h,
  recentSchoolDays,
} from '../logic';
import {
  useLive,
  useRepo,
  loadMyClasses,
  useClassParam,
  Avatar,
  Card,
  Empty,
  Skeleton,
  StatusChip,
  StreakChip,
  Modal,
  Toast,
  DatePicker,
  ClassSwitch,
} from '../ui';

// =====================================================================
// ATTENDANCE (/attendance for teachers, /admin/attendance for the admin): the class list for
// one day with Present / Late / Absent / Excused, and "Confirm attendance".
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// ATTENDANCE: the class list for one day with Present / Late / Absent / Excused buttons,
// and the "Confirm attendance" button. The date and class are kept in the address bar
// (?date=2026-10-29&class=...), so a link can open a specific day.
// ---------------------------------------------------------------------
const OPTIONS = ['present', 'late', 'absent', 'excused'];
export function Attendance() {
  const repo = useRepo();
  const [params, setParams] = useSearchParams();
  const date = params.get('date');
  const statusFilter = params.get('status');
  const setDate = (d) => {
    const p = new URLSearchParams(params);
    p.set('date', d);
    setParams(p);
  };
  const clearFilter = () => {
    const p = new URLSearchParams(params);
    p.delete('status');
    setParams(p);
  };
  // pending = an Excused change waiting for its (optional) note.
  const [pending, setPending] = useState(null);
  const [text, setText] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [error, setError] = useState(null);
  const [classId, setClass] = useClassParam();
  const { data } = useLive(
    async (r) => {
      const { session, today, classes, section } = await loadMyClasses(r, classId);
      const calendar = await r.getCalendar();
      const year = await r.getSchoolYear();
      const day = date ?? today.date;
      const roster = await r.getRoster(section.id, day);
      const confirmation = await r.getConfirmation(section.id, day);
      const teachers = await r.listTeachers(); // for the "covering for ..." banner
      return { session, today, classes, section, calendar, year, day, roster, confirmation, teachers };
    },
    [date, classId],
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
  const { session, today, classes, section, calendar, year, day, roster, confirmation, teachers } = data;
  const schoolDay = isSchoolDay(day, section.schedule, calendar);
  // Teacher absent on this day? (set by the admin: Sections -> a class -> Teacher absent)
  const away = section.schedule.teacherAway?.[day] ?? null;
  const nameOf = (id) => teachers.find((x) => x.id === id)?.name ?? 'another teacher';
  const counts = emptyCounts();
  let waiting = 0;
  // Count each status. Children with no record yet are 'waiting' (not yet scanned).
  roster.forEach((r) => (r.record ? counts[r.record.status]++ : waiting++));
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  // Previous / next arrows jump to the previous or next SCHOOL day (weekends and holidays are skipped).
  const step = (dir) => {
    const next =
      dir === -1
        ? recentSchoolDays(addDays(day, -1), 1, section.schedule, calendar)[0]
        : (() => {
            let d = addDays(day, 1);
            while (d <= today.date && !isSchoolDay(d, section.schedule, calendar)) d = addDays(d, 1);
            return d;
          })();
    if (next && next <= today.date) setDate(next);
  };
  // A status button was pressed. Excused opens a window for an optional note; every other status saves right away
  // (also after the day is confirmed).
  const choose = async (row, status) => {
    if (row.record?.status === status) return;
    if (status === 'excused') {
      setPending({ row, status });
      setText('');
      setError(null);
      return;
    }
    await repo.setStatus({ sectionId: section.id, date: day, studentId: row.student.id, status });
    flash(`${row.student.firstName} marked ${status}`);
  };
  const savePending = async () => {
    if (!pending) return;
    try {
      await repo.setStatus({
        sectionId: section.id,
        date: day,
        studentId: pending.row.student.id,
        status: pending.status,
        note: text,
      });
      setPending(null);
      flash(`${pending.row.student.firstName} updated`);
    } catch (e) {
      setError(e.message);
    }
  };
  // "Confirm and lock": unscanned children become absent, streak alerts and texts are checked (engine.finalize).
  const confirm = async () => {
    await repo.confirmDay(section.id, day);
    setConfirmOpen(false);
    flash('Attendance confirmed and locked');
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Attendance</h1>
          <p className="page-sub">
            {section.name} · {to12h(section.schedule.startTime)} to {to12h(section.schedule.endTime)}
          </p>
        </div>
        <div className="date-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous school day">
            <ChevronLeft size={18} />
          </button>
          <DatePicker
            value={day}
            min={year.start}
            max={today.date}
            calendar={calendar}
            onChange={setDate}
            ariaLabel="Date"
            quick={[['Today', today.date]]}
          />
          <button className="icon-btn" onClick={() => step(1)} disabled={day >= today.date} aria-label="Next school day">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      <ClassSwitch classes={classes} value={section.id} onChange={setClass} time={today.time} date={today.actualDate} />

      {away?.kind === 'substitute' && (
        <p className="cover-note">
          {away.teacherId === session.teacherId
            ? `You are covering this class today for ${nameOf(section.teacherId)}. Take and confirm attendance as usual.`
            : `${nameOf(away.teacherId)} covers this class on this day (substitute).`}
          {away.note ? ` Note: ${away.note}` : ''}
        </p>
      )}

      {/* Totals for the day and the Confirm button (or who confirmed it). */}
      <div className="summary-bar">
        <div className="summary-counts">
          <span>
            <StatusChip status="present" /> {counts.present}
          </span>
          <span>
            <StatusChip status="late" /> {counts.late}
          </span>
          <span>
            <StatusChip status="absent" /> {counts.absent}
          </span>
          <span>
            <StatusChip status="excused" /> {counts.excused}
          </span>
          {!confirmation && (
            <span>
              <StatusChip status="waiting" /> {waiting}
            </span>
          )}
        </div>
        {confirmation ? (
          <div className="locked-note">
            <Lock size={16} />{' '}
            {/* Auto-confirmed days show the class's auto-confirm time. (Days auto-confirmed before this fix were
                stamped with the time the app was opened, e.g. 6:50 PM; this shows them correctly too.) */}
            {confirmation.auto
              ? `Auto-confirmed at ${to12h(autoFinalizeTime(section.schedule))}`
              : `Confirmed by ${confirmation.confirmedBy} at ${format(new Date(confirmation.confirmedAt), 'h:mm a')}`}
            . You can still change a status.
          </div>
        ) : schoolDay ? (
          <button className="btn btn-ink" onClick={() => setConfirmOpen(true)}>
            <ShieldCheck size={18} /> Confirm attendance
          </button>
        ) : null}
      </div>

      {!schoolDay ? (
        <Card>
          {away?.kind === 'noclass' ? (
            <Empty
              title="No class for this section on this day"
              hint={`The teacher is absent and the admin cancelled this class${away.note ? ` (${away.note})` : ''}. Nobody is marked absent.`}
            />
          ) : (
            <Empty title="No class on this day" hint="Weekends, holidays and suspensions are skipped in streaks." />
          )}
        </Card>
      ) : (
        <Card>
          {!confirmation && day === today.date && (
            <p className="hint">
              Auto-confirms at {to12h(autoFinalizeTime(section.schedule))} if you do not confirm. Children not scanned by then are marked absent.
            </p>
          )}
          {/* What a pre-filled Present / Late means: the gate scan, not yet a classroom check. */}
          {!confirmation && (
            <p className="hint">
              <b>Present</b> and <b>Late</b> are filled in from the gate scan: the child has scanned at the gate. Check that each one is in the room. If a
              scanned child is not here, select <b>Absent</b>, and the school is alerted right away.
            </p>
          )}
          {/* One row per child: name, scan time, streak, SMS consent, and the four status buttons. */}
          <ul className="roster">
            {statusFilter && (
              <div className="filter-note">
                <span>
                  Showing <b>{statusFilter === 'waiting' ? 'not yet scanned' : statusFilter}</b> only
                </span>
                <button className="link-btn" onClick={clearFilter}>
                  Show everyone
                </button>
              </div>
            )}
            {roster
              .filter((row) => !statusFilter || (statusFilter === 'waiting' ? !row.record : row.record?.status === statusFilter))
              .map((row) => {
                const st = row.record?.status;
                return (
                  <li key={row.student.id} className="roster-row">
                    <Avatar first={row.student.firstName} last={row.student.lastName} tone={section.color} />
                    <div className="roster-name">
                      <strong>
                        {row.student.lastName}, {row.student.firstName}
                      </strong>
                      <span className="muted small">
                        {row.record?.scannedAt
                          ? `Scanned at the gate ${to12h(row.record.scannedAt)}`
                          : row.record
                            ? row.record.source === 'auto'
                              ? 'Not scanned'
                              : 'Set manually'
                            : 'Not yet scanned'}
                        {row.record?.excusedNote && ` · ${row.record.excusedNote}`}
                        {row.streak.count >= 2 && (
                          <>
                            {' '}
                            <StreakChip s={row.streak} />
                          </>
                        )}
                        {row.guardian && !row.guardian.smsConsent && (
                          <span className="no-sms" title="No SMS consent">
                            <MessageSquareOff size={13} /> No SMS
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="seg" role="radiogroup" aria-label={`Status for ${row.student.firstName}`}>
                      {OPTIONS.map((o) => (
                        <button
                          key={o}
                          role="radio"
                          aria-checked={st === o}
                          className={`seg-btn seg-${o} ${st === o ? 'on' : ''}`}
                          onClick={() => choose(row, o)}
                        >
                          {o[0].toUpperCase() + o.slice(1)}
                        </button>
                      ))}
                    </div>
                  </li>
                );
              })}
          </ul>
        </Card>
      )}

      {/* Window for an excuse note (optional). */}
      {pending && (
        <Modal
          title={`Excuse ${pending.row.student.firstName}`}
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button className="btn btn-ink" onClick={savePending}>
                Save
              </button>
            </>
          }
        >
          <label className="field">
            <span>Note (optional), e.g. "Parent called, fever"</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} autoFocus />
          </label>
          {error && <p className="error">{error}</p>}
        </Modal>
      )}

      {/* "Are you sure?" window before confirming. */}
      {confirmOpen && (
        <Modal
          title="Confirm today's attendance?"
          onClose={() => setConfirmOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmOpen(false)}>
                Not yet
              </button>
              <button className="btn btn-ink" onClick={confirm}>
                <Lock size={16} /> Confirm and lock
              </button>
            </>
          }
        >
          <p>
            {waiting} {waiting === 1 ? 'child has' : 'children have'} not been scanned and will be marked <b>absent</b>. Children who reach a
            3-school-day late or absent streak will trigger an SMS to their guardian.
          </p>
          <p className="muted small">
            Date: {format(parseISO(day), 'EEEE, MMMM d')}. A child who arrives later can still be scanned and will be recorded as late.
          </p>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}
