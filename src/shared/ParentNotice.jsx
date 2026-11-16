import { useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { CloudRain, Megaphone, Send } from 'lucide-react';
import { addDays, isoWeekday, GRADE_LEVELS, gradeName, levelsLabel, bySectionGrade, smsSegments, to12h, textedNote } from '../logic';
import { useLive, useRepo, Modal, DatePicker } from '../ui';

// =====================================================================
// SUSPENSION OR ANNOUNCEMENT (admin): one window for telling parents something, opened from
// School Calendar and from SMS Messages.
//   - Class suspension: a date or several (from ... to), the whole day or from a time (e.g. 1:00 PM: classes before it go on
//     and attendance is taken), which grade levels, the reason. Saved in the school calendar.
//   - Announcement: any message from the school, to the whole school, some grade levels or one class.
// Both show at the top of the parent portal, alert every teacher, and can be texted (one text per family).
// The School Calendar's day editor opens this same window for "Class suspension" (initial = its days),
// so a suspension is always made the same way, with the same alerts and texts.
// =====================================================================

// "From" times for a suspension during the day (every 30 minutes, 8:00 AM to 4:00 PM).
const FROM_TIMES = Array.from({ length: 17 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);

// initial (optional): { from, to, label, levels, time } to start a suspension with (e.g. the days clicked).
export function ParentNoticeWindow({ start = 'suspension', initial = {}, onClose, onDone }) {
  const repo = useRepo();
  const { data } = useLive(async (r) => ({
    today: await r.getToday(),
    year: await r.getSchoolYear(),
    calendar: await r.getCalendar(),
    settings: await r.getSettings(),
    sections: await r.listSections(),
  }));
  const [kind, setKind] = useState(start); // 'suspension' | 'announcement'
  // Suspension
  const [date, setDate] = useState(initial.from ?? null); // first day
  const [until, setUntil] = useState(initial.to ?? null); // last day (null = the same day)
  const [from, setFrom] = useState(initial.time ?? ''); // '' = the whole day, or 'HH:MM'
  const [label, setLabel] = useState(initial.label || 'Class suspension: weather');
  // Who: 'all' | 'k' (Signal No. 1: Kindergarten only) | 'levels' | 'class' (announcements only)
  const startLevels = initial.levels ?? [];
  const [scope, setScope] = useState(!startLevels.length ? 'all' : startLevels.join() === 'K' ? 'k' : 'levels');
  const [levels, setLevels] = useState(startLevels);
  const [sectionId, setSectionId] = useState('');
  // Announcement
  const [en, setEn] = useState('');
  const [fil, setFil] = useState('');
  const [days, setDays] = useState(3);
  const [textParents, setTextParents] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // How many families get the text, and the exact text (made by the engine, like the real one).
  const [preview, setPreview] = useState(null); // { families, text }
  const levelsNow = scope === 'k' ? ['K'] : scope === 'levels' ? levels : [];
  const dayNow = date ?? data?.today?.actualDate;
  const lastNow = until && dayNow && until > dayNow ? until : dayNow;
  useEffect(() => {
    let live = true;
    if (!dayNow) return undefined;
    const lv = levelsNow.length ? levelsNow : null;
    repo
      .previewNotice(
        kind === 'suspension'
          ? { type: from ? 'partial' : 'suspension', dates: lastNow === dayNow ? [dayNow] : [dayNow, lastNow], levels: lv, from: from || undefined, body: label.trim() }
          : { type: 'announcement', dates: [dayNow], levels: lv, sectionId: scope === 'class' ? sectionId || '-' : null, body: en.trim() },
      )
      .then((p) => live && setPreview(p))
      .catch(() => live && setPreview(null));
    return () => {
      live = false;
    };
  }, [repo, kind, dayNow, lastNow, from, scope, levelsNow.join(), sectionId, label, en]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const { today, year, calendar, settings, sections } = data;
  const day = date ?? today.actualDate ?? today.date;
  const last = until && until > day ? until : day;
  const head = settings?.schoolName ? `${settings.schoolName}: ` : '';
  const chosen = scope === 'all' || scope === 'class' ? [] : scope === 'k' ? ['K'] : levels;
  const ready =
    kind === 'suspension'
      ? label.trim() && (scope !== 'levels' || levels.length)
      : en.trim() && (scope !== 'levels' || levels.length) && (scope !== 'class' || sectionId);
  const parts = preview?.text ? smsSegments(preview.text) : 1;
  const families = preview?.families ?? null;

  const send = async () => {
    setBusy(true);
    setError('');
    try {
      if (kind === 'suspension') {
        const n = await repo.declareSuspension(day, label.trim(), chosen, { textParents, time: from || null, to: last });
        const span = last === day ? format(parseISO(day), 'EEE, MMM d') : `${format(parseISO(day), 'MMM d')} to ${format(parseISO(last), 'MMM d')}`;
        onDone(
          `Suspension saved for ${span}${from ? ` from ${to12h(from)}` : ''}${chosen.length ? ` (${levelsLabel(chosen)})` : ''}. Teachers and the parent portal were notified${textedNote(n)}.`,
        );
      } else {
        const n = await repo.sendAnnouncement({
          message: en,
          messageFil: fil,
          levels: scope === 'levels' ? levels : scope === 'k' ? ['K'] : [],
          sectionId: scope === 'class' ? sectionId : null,
          days,
          textParents,
        });
        onDone(`Announcement posted in the parent portal for ${days === 1 ? 'today' : `${days} days`}${textedNote(n)}. Teachers got an alert too.`);
      }
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Tell parents"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${kind === 'suspension' ? 'btn-danger' : 'btn-ink'}`} onClick={send} disabled={!ready || busy}>
            {kind === 'suspension' ? <CloudRain size={16} /> : <Send size={16} />}{' '}
            {kind === 'suspension' ? 'Declare suspension' : textParents ? 'Send announcement' : 'Post announcement'}
          </button>
        </>
      }
    >
      <div className="kind-tabs" role="tablist" aria-label="What is it?">
        <button role="tab" aria-selected={kind === 'suspension'} className={kind === 'suspension' ? 'on' : ''} onClick={() => setKind('suspension')}>
          <CloudRain size={16} /> Class suspension
        </button>
        <button role="tab" aria-selected={kind === 'announcement'} className={kind === 'announcement' ? 'on' : ''} onClick={() => setKind('announcement')}>
          <Megaphone size={16} /> Announcement
        </button>
      </div>

      {kind === 'suspension' ? (
        <>
          <p className="muted small">
            Suspended classes are not marked absent and do not count toward 3-day streaks. Every teacher sees an alert, and parents see it at the top
            of the parent portal.
          </p>
          <div className="form-row">
            <div className="field">
              <span>From</span>
              <DatePicker
                value={day}
                min={year.start}
                max={year.end}
                calendar={calendar}
                onChange={(d) => {
                  setDate(d);
                  if (until && until < d) setUntil(null);
                }}
                ariaLabel="First day of the suspension"
                quick={[
                  ['Today', today.actualDate],
                  ['Tomorrow', addDays(today.actualDate, 1)],
                ]}
              />
            </div>
            <div className="field">
              <span>To</span>
              <DatePicker
                value={last}
                min={day}
                max={year.end}
                calendar={calendar}
                onChange={setUntil}
                ariaLabel="Last day of the suspension"
                quick={[
                  ['Same day', day],
                  ['Through Friday', addDays(day, Math.max(0, 5 - isoWeekday(day)))],
                ]}
              />
            </div>
          </div>
          {last > day && <p className="muted small">Saturdays and Sundays in between are skipped.</p>}
          <div className="form-row">
            <label className="field">
              <span>Which classes?</span>
              <select className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">The whole day</option>
                {FROM_TIMES.map((t) => (
                  <option key={t} value={t}>
                    From {to12h(t)}{t === '13:00' ? ' (after lunch)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {from && (
            <p className="hint">
              Classes before {to12h(from)} go on and attendance is taken as usual. Parents are asked to fetch their child at {to12h(from)}, and
              teachers get the list of children still at school. Classes that end before {to12h(from)} are not affected.
            </p>
          )}
        </>
      ) : (
        <>
          <label className="field">
            <span>Message (English)</span>
            <textarea
              className="input"
              rows={3}
              maxLength={300}
              value={en}
              onChange={(e) => setEn(e.target.value)}
              placeholder="e.g. Please fetch your children by 11:00 AM today because of the earthquake drill."
            />
            <small className="muted">
              {en.trim().length}/300 characters{en.trim() ? ` · ${smsSegments(head + en.trim())} SMS per family` : ''}
            </small>
          </label>
          <label className="field">
            <span>Message in Filipino (optional, for families who chose Filipino)</span>
            <textarea className="input" rows={2} maxLength={300} value={fil} onChange={(e) => setFil(e.target.value)} />
          </label>
        </>
      )}

      {/* Which levels. DepEd Order 22, s. 2024: Signal No. 1 suspends Kindergarten only; Signal No. 2 and up, all levels. */}
      <fieldset className="checks">
        <legend>Who is it for?</legend>
        <label>
          <input type="radio" name="who" checked={scope === 'all'} onChange={() => setScope('all')} /> The whole school (Kindergarten to Grade 6)
        </label>
        {kind === 'suspension' && (
          <label>
            <input
              type="radio"
              name="who"
              checked={scope === 'k'}
              onChange={() => {
                setScope('k');
                if (label === 'Class suspension: weather') setLabel('Tropical Cyclone Wind Signal No. 1');
              }}
            />{' '}
            Kindergarten only (Signal No. 1)
          </label>
        )}
        <label>
          <input type="radio" name="who" checked={scope === 'levels'} onChange={() => setScope('levels')} /> Some grade levels
        </label>
        {scope === 'levels' && (
          <div className="chips-inline">
            {GRADE_LEVELS.map((g) => {
              const on = levels.includes(g);
              return (
                <label key={g} className="check">
                  <input type="checkbox" checked={on} onChange={() => setLevels(on ? levels.filter((x) => x !== g) : [...levels, g])} /> {gradeName(g)}
                </label>
              );
            })}
          </div>
        )}
        {kind === 'announcement' && (
          <>
            <label>
              <input type="radio" name="who" checked={scope === 'class'} onChange={() => setScope('class')} /> One class
            </label>
            {scope === 'class' && (
              <select className="input" value={sectionId} onChange={(e) => setSectionId(e.target.value)} aria-label="Class">
                <option value="">Pick a class</option>
                {[...sections]
                  .filter((x) => !x.archived)
                  .sort(bySectionGrade)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
              </select>
            )}
          </>
        )}
      </fieldset>

      {kind === 'suspension' ? (
        <label className="field">
          <span>Reason</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      ) : (
        <label className="field">
          <span>Show at the top of the parent portal for</span>
          <select className="input" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Today only</option>
            <option value={3}>3 days</option>
            <option value={7}>7 days</option>
          </select>
        </label>
      )}

      <label className="check">
        <input type="checkbox" checked={textParents} onChange={(e) => setTextParents(e.target.checked)} /> Text the parents now (one text per family,
        only those with SMS consent)
      </label>
      {textParents && families !== null && (
        <p className="send-count">
          Goes to <b>{families}</b> {families === 1 ? 'family' : 'families'}
          {(kind === 'suspension' || en.trim()) && ` · about ${families * parts} SMS (${parts} per family)`}
        </p>
      )}
      {textParents && preview?.text && (kind === 'suspension' || en.trim()) && (
        <p className="muted small">
          The text reads: "{preview.text}"
          {kind === 'suspension' && from ? ` Parents whose child is already at school also get: "Please fetch them at ${to12h(from)}…"` : ''}
          {kind === 'suspension' ? ' Families who chose Filipino get it in Filipino.' : ''}
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}
