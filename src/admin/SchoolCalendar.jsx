import { format, parseISO } from 'date-fns';
import {
  CloudRain,
  RotateCcw,
  Pencil,
  Trash2,
  Flag,
} from 'lucide-react';
import {
  useLive,
  Card,
  Skeleton,
  useRepo,
  Modal,
  Toast,
  CalendarLegend,
  YearCalendar,
  DatePicker,
} from '../ui';
import { useState } from 'react';
import {
  DAY_KIND_META,
  DEPED_SY_2026_2027,
  countClassDays,
  dayKind,
  eachDate,
  addDays,
  isoWeekday,
} from '../logic';

// =====================================================================
// SCHOOL CALENDAR (/admin/calendar): holidays, suspensions, exams and make-up days.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// SCHOOL CALENDAR: click any day to change it (holiday, suspension, exam, ...).
// Every change alerts all teachers (engine.saveCalendarDays -> notifyCalendar).
// ---------------------------------------------------------------------
// The Friday of a date's week (for the "Through Friday" quick button).
const fridayOf = (d) => addDays(d, Math.max(0, 5 - isoWeekday(d)));
// The choices in the day editor. To add a new kind of day, also add it to DAY_KIND_META in logic.js and give it a color (.k-...) in style.css.
const TYPE_OPTIONS = [
  { value: 'class', hint: 'Normal class day (removes any special entry)' },
  { value: 'event', hint: 'Classes continue, with a school event' },
  { value: 'exam', hint: 'Classes continue: summative test or term exam' },
  { value: 'halfday', hint: 'Classes for half the day' },
  { value: 'holiday', hint: 'No classes, regular or special holiday' },
  { value: 'suspension', hint: 'No classes, e.g. weather or emergency' },
  { value: 'break', hint: 'No classes, e.g. wellness or year-end break' },
  { value: 'makeup', hint: 'Class on a day that is normally off, e.g. Saturday' },
];
export function AdminCalendar() {
  const repo = useRepo();
  const [draft, setDraft] = useState(null);
  const [suspend, setSuspend] = useState(null);
  const [resetOpen, setResetOpen] = useState(false);
  const [yearDraft, setYearDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const { data } = useLive(async (r) => ({
    year: await r.getSchoolYear(),
    calendar: await r.getCalendar(),
    today: await r.getToday(),
  }));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={500} />
      </div>
    );
  const { year, calendar, today } = data;
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const open = (date) => {
    const entry = calendar.find((c) => c.date === date);
    setDraft({
      from: date,
      to: date,
      type: entry?.type ?? 'class',
      label: entry?.label ?? '',
      scope: entry?.scope ?? 'national',
      weekdaysOnly: true,
    });
  };
  // Saves the edited day(s). Choosing "Class day" removes the special entry instead.
  const save = async () => {
    if (!draft) return;
    const dates = eachDate(draft.from, draft.to < draft.from ? draft.from : draft.to).filter(
      (d) => !draft.weekdaysOnly || draft.type === 'makeup' || draft.from === draft.to || isoWeekday(d) <= 5,
    );
    if (draft.type === 'class') {
      await repo.removeCalendarDays(dates);
    } else {
      const label = draft.label.trim() || DAY_KIND_META[draft.type].label;
      await repo.saveCalendarDays(
        dates.map((date) => ({
          date,
          type: draft.type,
          label,
          ...(draft.type === 'holiday' ? { scope: draft.scope } : {}),
        })),
      );
    }
    flash(`${dates.length} day${dates.length > 1 ? 's' : ''} updated. Teachers were notified, and attendance and streaks follow the new calendar.`);
    setDraft(null);
  };
  const upcoming = calendar.filter((c) => c.date >= today.date && c.type !== 'event').slice(0, 10);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>School Calendar</h1>
          <p className="page-sub">
            {year.name} · {countClassDays(year, calendar)} class days
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" onClick={() => setResetOpen(true)}>
            <RotateCcw size={17} /> Reset to DepEd template
          </button>
          <button className="btn btn-danger" onClick={() => setSuspend({ date: today.date, label: 'Class suspension: weather' })}>
            <CloudRain size={17} /> Declare suspension
          </button>
        </div>
      </div>
      <Card title="First and last day of classes" action={<Flag size={18} />}>
        <div className="form-row year-row">
          <div className="field">
            <span>First day of classes</span>
            <DatePicker
              value={yearDraft?.start ?? year.start}
              calendar={calendar}
              onChange={(d) => setYearDraft({ start: d, end: yearDraft?.end ?? year.end })}
              ariaLabel="First day of classes"
              quick={[['DepEd: June 8, 2026', '2026-06-08']]}
            />
          </div>
          <div className="field">
            <span>Last day of classes (end of classes)</span>
            <DatePicker
              value={yearDraft?.end ?? year.end}
              min={yearDraft?.start ?? year.start}
              calendar={calendar}
              onChange={(d) => setYearDraft({ start: yearDraft?.start ?? year.start, end: d })}
              ariaLabel="Last day of classes"
              quick={[['DepEd: April 8, 2027', '2027-04-08']]}
            />
          </div>
          <button
            className="btn btn-ink align-end"
            disabled={!yearDraft || yearDraft.end <= yearDraft.start}
            onClick={async () => {
              await repo.updateSchoolYear(yearDraft);
              setYearDraft(null);
              flash('School year dates saved');
            }}
          >
            Save dates
          </button>
        </div>
        <p className="muted small">
          DepEd SY 2026-2027: classes June 8, 2026 to April 8, 2027. Days outside these dates show as no class, and no attendance is taken.
        </p>
      </Card>
      <Card>
        <p className="hint">Click any day to change it. To mark several days at once, set an end date in the editor.</p>
        <CalendarLegend />
        <YearCalendar
          year={year}
          calendar={calendar}
          today={today.date}
          selection={draft ? { from: draft.from, to: draft.to } : null}
          onDayClick={open}
        />
      </Card>
      <Card title="Upcoming no-class days and changes">
        <ul className="cal-list editable">
          {upcoming.map((c) => (
            <li key={c.date}>
              <span className={`swatch k-${c.type} ${c.scope === 'local' ? 'is-local' : ''}`} />
              <time>{format(parseISO(c.date), 'EEE, MMM d')}</time>
              <span>{c.label}</span>
              <button className="icon-btn sm" onClick={() => open(c.date)} aria-label={`Edit ${c.date}`}>
                <Pencil size={15} />
              </button>
              <button
                className="icon-btn sm"
                onClick={async () => {
                  await repo.removeCalendarDays([c.date]);
                  flash('Back to a normal day');
                }}
                aria-label={`Clear ${c.date}`}
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {draft && (
        <Modal
          title={draft.from === draft.to ? format(parseISO(draft.from), 'EEEE, MMMM d, yyyy') : 'Edit days'}
          onClose={() => setDraft(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDraft(null)}>
                Cancel
              </button>
              <button className="btn btn-ink" onClick={save}>
                Save
              </button>
            </>
          }
        >
          <p className="muted small">Now: {DAY_KIND_META[dayKind(draft.from, year, calendar)].label}</p>
          <div className="type-pick" role="radiogroup" aria-label="Day type">
            {TYPE_OPTIONS.map((o) => (
              <label key={o.value} className={`type-opt ${draft.type === o.value ? 'on' : ''}`}>
                <input type="radio" name="type" checked={draft.type === o.value} onChange={() => setDraft({ ...draft, type: o.value })} />
                <span className={`swatch k-${o.value}`} />
                <span>
                  <b>{DAY_KIND_META[o.value].label}</b>
                  <small>{o.hint}</small>
                </span>
              </label>
            ))}
          </div>
          {draft.type !== 'class' && (
            <label className="field">
              <span>Label shown to teachers</span>
              <input
                className="input"
                value={draft.label}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder={DAY_KIND_META[draft.type].label}
              />
            </label>
          )}
          {draft.type === 'holiday' && (
            <div className="chips">
              {['national', 'local'].map((s) => (
                <button key={s} className={`fchip ${draft.scope === s ? 'fchip-on' : ''}`} onClick={() => setDraft({ ...draft, scope: s })}>
                  {s === 'national' ? 'National' : 'Local (Baguio)'}
                </button>
              ))}
            </div>
          )}
          <div className="form-row">
            <div className="field">
              <span>From</span>
              <DatePicker
                value={draft.from}
                min={year.start.slice(0, 7) + '-01'}
                calendar={calendar}
                onChange={(d) => setDraft({ ...draft, from: d, to: draft.to < d ? d : draft.to })}
                ariaLabel="From"
              />
            </div>
            <div className="field">
              <span>To (optional)</span>
              <DatePicker
                value={draft.to}
                min={draft.from}
                calendar={calendar}
                onChange={(d) => setDraft({ ...draft, to: d })}
                ariaLabel="To"
                quick={[
                  ['Same day', draft.from],
                  ['Through Friday', fridayOf(draft.from)],
                ]}
              />
            </div>
          </div>
          {draft.to > draft.from && draft.type !== 'makeup' && (
            <label className="check">
              <input type="checkbox" checked={draft.weekdaysOnly} onChange={(e) => setDraft({ ...draft, weekdaysOnly: e.target.checked })} /> Skip
              Saturdays and Sundays
            </label>
          )}
        </Modal>
      )}

      {suspend && (
        <Modal
          title="Declare a class suspension"
          onClose={() => setSuspend(null)}
          footer={
            <>
              <button className="btn" onClick={() => setSuspend(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await repo.declareSuspension(suspend.date, suspend.label);
                  setSuspend(null);
                  flash('Suspension saved and teachers notified. No absences or streak SMS for that day.');
                }}
              >
                Declare suspension
              </button>
            </>
          }
        >
          <p>
            On a suspended day, children are not marked absent, it does not count toward 3-day streaks, and no absence SMS is sent. Every teacher sees
            an alert about it right away.
          </p>
          <div className="field">
            <span>Date</span>
            <DatePicker
              value={suspend.date}
              min={year.start}
              max={year.end}
              calendar={calendar}
              onChange={(d) => setSuspend({ ...suspend, date: d })}
              ariaLabel="Suspension date"
              quick={[
                ['Today', today.actualDate],
                ['Tomorrow', addDays(today.actualDate, 1)],
              ]}
            />
          </div>
          <label className="field">
            <span>Reason</span>
            <input className="input" value={suspend.label} onChange={(e) => setSuspend({ ...suspend, label: e.target.value })} />
          </label>
        </Modal>
      )}

      {resetOpen && (
        <Modal
          title="Reset to the DepEd template?"
          onClose={() => setResetOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setResetOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-ink"
                onClick={async () => {
                  await repo.resetCalendar(DEPED_SY_2026_2027);
                  setResetOpen(false);
                  flash('Calendar reset to DepEd SY 2026-2027');
                }}
              >
                Reset calendar
              </button>
            </>
          }
        >
          <p>
            This replaces every entry with DepEd Order No. 009, s. 2026 plus Baguio Charter Day. Suspensions and school events you added will be
            removed.
          </p>
        </Modal>
      )}
      <Toast message={toast} />
    </div>
  );
}
