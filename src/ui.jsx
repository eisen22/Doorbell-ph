import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react';
import { manilaToday, addDays, isoWeekday, DAY_KIND_META, dayKind, classNow, classPhase, shortClassName, sortByStart, to12h } from './logic';
import { DemoClock, Engine, noopPersistence, buildDemoState, demoAuth } from './engine';
import { cloudConfigured, createCloudEngine } from './firebase';
import { CheckCircle2, Clock3, XCircle, FileCheck2, CircleDashed, X, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useSearchParams } from 'react-router-dom';

// =====================================================================
// ui.jsx — SHARED PIECES OF THE SCREENS
// ---------------------------------------------------------------------
// 1. The engine for the whole app (RepoProvider, useRepo, useLive)
// 2. Small building blocks: Card, Modal, StatusChip, Avatar, Toast...
// 3. DatePicker   4. YearCalendar   5. Class switch for teachers with several classes
// =====================================================================
// =====================================================================
// 1. THE ENGINE FOR THE WHOLE APP
// React "context" shares one Engine with every screen. Screens get it with useRepo().
// =====================================================================
const RepoCtx = createContext(null);
// In demo mode, the signed-in account is remembered in this tab (sessionStorage) so a page reload keeps you signed in.
const DEMO_KEY = 'doorbell-demo-user';
// Creates the Engine once when the app starts: cloud (firebase.js) or demo (sample data, nothing saved). MODE in firebase.js decides.
function createRepository() {
  if (cloudConfigured()) return createCloudEngine();
  const clock = new DemoClock();
  let engine;
  const auth = demoAuth(() => engine);
  engine = new Engine(
    'demo',
    buildDemoState(manilaToday(), clock),
    noopPersistence,
    {
      ...auth,
      async signIn(email, password) {
        const acc = await auth.signIn(email, password);
        try {
          sessionStorage.setItem(DEMO_KEY, acc.uid);
        } catch {
          /* storage blocked */
        }
        setTimeout(() => engine.catchUp(), 0);
        return acc;
      },
      async signOut() {
        try {
          sessionStorage.removeItem(DEMO_KEY);
        } catch {
          /* ignore */
        }
      },
    },
    clock,
  );
  // Stay signed in across page reloads in the same tab.
  try {
    const uid = sessionStorage.getItem(DEMO_KEY);
    const acc = uid ? engine.s.users.get(uid) : undefined;
    if (acc) engine.setSession(acc);
  } catch {
    /* ignore */
  }
  return engine;
}
// Wraps the whole app (see main.jsx). window.doorbell lets you inspect the data in the browser console: window.doorbell.s
export function RepoProvider({ children }) {
  const [repo] = useState(createRepository);
  window.doorbell = repo; // for debugging in the console only
  return <RepoCtx.Provider value={repo}>{children}</RepoCtx.Provider>;
}
// Any screen: const repo = useRepo(); then repo.getRoster(...), repo.setStatus(...), etc.
export function useRepo() {
  const r = useContext(RepoCtx);
  if (!r) throw new Error('RepoProvider missing');
  return r;
}
/** Loads data and reloads it whenever the repository reports a change. */
// The pattern every screen uses to show data:
//   const { data } = useLive(async (r) => ({ students: await r.listStudentRows() }));
// It runs `load` once, then again whenever the engine reports a change, so screens stay up to date.
// `deps`: values (like a chosen date) that should also trigger a reload when they change.
// If `load` throws, the error is printed in the console as "useLive load skipped".
export function useLive(load, deps = []) {
  const repo = useRepo();
  const [data, setData] = useState(undefined);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const reload = useCallback(async () => {
    try {
      const value = await loadRef.current(repo);
      setData(value);
    } catch (e) {
      console.debug('useLive load skipped:', e.message);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, ...deps]);
  useEffect(() => {
    setLoading(true);
    reload();
    return repo.subscribe(() => {
      reload();
    });
  }, [repo, reload]);
  return { data, loading, reload };
}
// 'Juan', 'Dela Cruz' -> 'JD' (shown in the round avatars).
export function initials(first, last) {
  return `${first[0] ?? ''}${last[0] ?? ''}`.toUpperCase();
}
/** Readable text color (ink or white) for any background hex. */
// Black or white text, whichever is easier to read on a background color (for section colors).
export function textOn(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#111111' : '#ffffff';
}

// =====================================================================
// 2. SMALL BUILDING BLOCKS used on many screens
// =====================================================================
export function Logo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="2" y="2" width="36" height="36" rx="11" fill="#D8F5A2" />
      {/* bell */}
      <path d="M20 9.5c-4.6 0-7.6 3.3-7.6 7.8v4.9l-2.3 3.6c-.4.6 0 1.4.8 1.4h18.2c.8 0 1.2-.8.8-1.4l-2.3-3.6v-4.9c0-4.5-3-7.8-7.6-7.8z" fill="#111" />
      <path d="M16.6 29.4a3.5 3.5 0 0 0 6.8 0" fill="none" stroke="#111" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="28.6" cy="11.4" r="3.6" fill="#FFB65C" stroke="#D8F5A2" strokeWidth="1.6" />
    </svg>
  );
}
// Label and icon for each attendance status. Colors are in style.css (.chip-present, .chip-late, ...).
const STATUS_META = {
  present: { label: 'Present', Icon: CheckCircle2 },
  late: { label: 'Late', Icon: Clock3 },
  absent: { label: 'Absent', Icon: XCircle },
  excused: { label: 'Excused', Icon: FileCheck2 },
  waiting: { label: 'Not yet', Icon: CircleDashed },
};
/** Status is always icon + word, never color alone. */
export function StatusChip({ status }) {
  const { label, Icon } = STATUS_META[status];
  return (
    <span className={`chip chip-${status}`}>
      <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
      {label}
    </span>
  );
}
// Round circle with initials. `tone` = background color (usually the section's color).
export function Avatar({ first, last, tone }) {
  return (
    <span className="avatar" style={tone ? { background: tone } : undefined} aria-hidden="true">
      {initials(first, last)}
    </span>
  );
}
// White rounded box with an optional title and a button/link on the right (`action`).
export function Card({ title, action, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
// Friendly "nothing here" message with a small drawing.
export function Empty({ title, hint }) {
  return (
    <div className="empty">
      <svg width="88" height="60" viewBox="0 0 88 60" aria-hidden="true">
        <rect x="6" y="14" width="44" height="40" rx="10" fill="#CDE8F7" />
        <circle cx="62" cy="24" r="16" fill="#D8F5A2" />
        <rect x="30" y="6" width="30" height="20" rx="8" fill="#FFD9A8" />
      </svg>
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}
// Grey placeholder shown while data loads.
export function Skeleton({ h = 18, w = '100%' }) {
  return <span className="skeleton" style={{ height: h, width: w }} />;
}
/** Number that counts up when it first appears. */
// A number that counts up from 0 when it appears (dashboard numbers).
export function CountUp({ value, suffix = '' }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const start = performance.now();
    let frame = 0;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / 600);
      setShown(Math.round(value * (1 - (1 - p) ** 3)));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <>
      {shown}
      {suffix}
    </>
  );
}
// Pop-up window. Closes with Escape or by clicking outside. `footer` = the buttons at the bottom.
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  );
}
/** Short streak label, always specific: "Absent 3 days", "Late 3 days", "Absent 2 · Late 1". */
// Short streak label for chips: 'Absent 3 days', 'Late 3 days', 'Absent 2 · Late 1'.
export function streakShort(s) {
  if (s.late === 0) return `Absent ${s.count} day${s.count === 1 ? '' : 's'}`;
  if (s.absent === 0) return `Late ${s.count} day${s.count === 1 ? '' : 's'}`;
  return `Absent ${s.absent} · Late ${s.late}`;
}
// Red/orange chip with the streak (hidden below 2 days; red from `threshold`).
export function StreakChip({ s, threshold = 3 }) {
  if (s.count < 2) return null;
  return <span className={`streak ${s.count >= threshold ? 'streak-hot' : ''}`}>{streakShort(s)}</span>;
}
// Short message at the bottom of the screen (e.g. "Student updated").
export function Toast({ message, tone = 'ok' }) {
  if (!message) return null;
  return (
    <div className={`toast toast-${tone}`} role="status">
      {message}
    </div>
  );
}

// An easier date picker than the browser's: big tap targets, month and year dropdowns,
// quick buttons, and the school calendar's no-class days marked right in the grid.
// =====================================================================
// 3. DATE PICKER (used instead of the browser's own date box)
// Big day buttons, month and year menus, quick buttons ("Today"), and the
// school calendar's no-class days marked with a red dot, exams/events with a blue dot.
// =====================================================================
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
/** "Thu, Oct 29, 2026" */
// '2026-10-29' -> 'Thu, Oct 29, 2026'.
export function longDate(d) {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
// Today in the Philippines as 'YYYY-MM-DD'.
function todayIso() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const NO_CLASS = new Set(['holiday', 'suspension', 'break']);
// Props:
//   value / onChange  the chosen date ('YYYY-MM-DD') and what to do when it changes
//   min / max         earliest and latest date allowed
//   calendar          school calendar entries to mark in the grid
//   quick             quick buttons, e.g. [['Today', '2026-10-29']]
//   birthdate         shows older years in the year menu
export function DatePicker({
  value,
  onChange,
  min,
  max,
  calendar,
  quick,
  placeholder = 'Pick a date',
  ariaLabel,
  birthdate,
  className = '',
  compact,
}) {
  const [open, setOpen] = useState(false);
  const start = value || (max && todayIso() > max ? max : todayIso());
  const [view, setView] = useState({ y: Number(start.slice(0, 4)), m: Number(start.slice(5, 7)) - 1 });
  const [focus, setFocus] = useState(start);
  const box = useRef(null);
  const trigger = useRef(null);
  const pop = useRef(null);
  const grid = useRef(null);
  const [pos, setPos] = useState(null);
  const marks = useMemo(() => new Map((calendar ?? []).map((c) => [c.date, c])), [calendar]);
  useEffect(() => {
    if (!open) return;
    const s = value || start;
    setView({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)) - 1 });
    setFocus(s);
    const close = (e) => {
      if (box.current && !box.current.contains(e.target)) setOpen(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    // Fixed position so the calendar is never cut off inside dialogs or scrolling cards.
    const place = () => {
      const r = trigger.current?.getBoundingClientRect();
      if (!r) return;
      const w = 316;
      const h = pop.current?.offsetHeight ?? 400;
      const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
      const below = r.bottom + 6;
      const top = below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : Math.min(below, Math.max(8, window.innerHeight - h - 8));
      setPos({ top, left });
    };
    place();
    const raf = requestAnimationFrame(place);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open) return;
    grid.current?.querySelector(`[data-date="${focus}"]`)?.focus();
  }, [focus, open, view]);
  const allowed = (d) => (!min || d >= min) && (!max || d <= max);
  const pick = (d) => {
    if (!allowed(d)) return;
    onChange(d);
    setOpen(false);
  };
  const moveMonth = (delta) =>
    setView((v) => {
      const m = v.m + delta;
      return { y: v.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  const first = iso(view.y, view.m, 1);
  const lead = isoWeekday(first) % 7; // Sunday first
  const daysIn = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: daysIn }, (_, i) => iso(view.y, view.m, i + 1))];
  while (cells.length % 7) cells.push(null);
  const thisYear = Number(todayIso().slice(0, 4));
  const minY = min ? Number(min.slice(0, 4)) : birthdate ? thisYear - 15 : thisYear - 5;
  const maxY = max ? Number(max.slice(0, 4)) : thisYear + 2;
  const years = Array.from({ length: Math.max(1, maxY - minY + 1) }, (_, i) => minY + i);
  if (!years.includes(view.y)) years.push(view.y);
  years.sort((a, b) => a - b);
  const onKey = (e) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (e.key in step) {
      e.preventDefault();
      const next = addDays(focus, step[e.key]);
      setFocus(next);
      setView({ y: Number(next.slice(0, 4)), m: Number(next.slice(5, 7)) - 1 });
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(focus);
    }
  };
  const quickList = quick ?? (allowed(todayIso()) ? [['Today', todayIso()]] : []);
  const mark = (d) => marks.get(d);
  return (
    <div className={`dp ${className}`} ref={box}>
      <button
        type="button"
        ref={trigger}
        className={`dp-trigger ${compact ? 'dp-compact' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel ? `${ariaLabel}: ${value ? longDate(value) : 'not set'}` : undefined}
      >
        <CalendarDays size={17} aria-hidden="true" />
        <span className={value ? '' : 'dp-placeholder'}>{value ? longDate(value) : placeholder}</span>
      </button>
      {open && (
        <div
          className="dp-pop"
          ref={pop}
          role="dialog"
          aria-label={ariaLabel ?? 'Choose a date'}
          style={pos ? { position: 'fixed', top: pos.top, left: pos.left } : { visibility: 'hidden' }}
        >
          <div className="dp-head">
            <button type="button" className="icon-btn sm" onClick={() => moveMonth(-1)} aria-label="Previous month">
              <ChevronLeft size={18} />
            </button>
            <select value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })} aria-label="Month">
              {MONTHS.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
            <select value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })} aria-label="Year">
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
            <button type="button" className="icon-btn sm" onClick={() => moveMonth(1)} aria-label="Next month">
              <ChevronRight size={18} />
            </button>
            <button type="button" className="icon-btn sm dp-close" onClick={() => setOpen(false)} aria-label="Close">
              <X size={16} />
            </button>
          </div>
          <div className="dp-week" aria-hidden="true">
            {WEEK.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="dp-grid" role="grid" ref={grid} onKeyDown={onKey}>
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} />;
              const m = mark(d);
              const wd = isoWeekday(d);
              const cls = [
                'dp-day',
                d === value ? 'on' : '',
                d === todayIso() ? 'today' : '',
                wd >= 6 ? 'weekend' : '',
                m && NO_CLASS.has(m.type) ? 'noclass' : '',
              ].join(' ');
              return (
                <button
                  key={d}
                  type="button"
                  data-date={d}
                  className={cls}
                  disabled={!allowed(d)}
                  tabIndex={d === focus ? 0 : -1}
                  onClick={() => pick(d)}
                  title={m ? m.label : undefined}
                  aria-label={`${longDate(d)}${m ? `, ${m.label}` : ''}`}
                  aria-selected={d === value}
                >
                  {Number(d.slice(8))}
                  {m && <i className={`dp-dot k-${m.type}`} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
          {calendar && (
            <p className="dp-legend">
              <i className="dp-dot k-holiday" /> No class <i className="dp-dot k-exam" /> Exam or event
            </p>
          )}
          {quickList.length > 0 && (
            <div className="dp-foot">
              {quickList.map(([label, d]) => (
                <button key={label} type="button" className="fchip sm" disabled={!allowed(d)} onClick={() => pick(d)}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 4. YEAR CALENDAR (Calendar pages): 10 small months, each day colored by its kind
// =====================================================================
export const LEGEND = ['class', 'exam', 'event', 'halfday', 'holiday', 'suspension', 'break', 'makeup'];
/** Twelve-month view of the school year, color-coded by day type. */
// onDayClick is given only on the admin page, where clicking a day edits it.
export function YearCalendar({ year, calendar, today, selection, onDayClick }) {
  const months = [];
  for (let m = `${year.start.slice(0, 7)}-01`; m <= year.end; ) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  }
  const byDate = new Map(calendar.map((c) => [c.date, c]));
  return (
    <div className="year-grid">
      {months.map((first) => {
        const lead = isoWeekday(first) % 7; // Sunday-first grid
        const days = [];
        for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) days.push(d);
        return (
          <section key={first} className="month">
            <h3>{format(parseISO(first), 'MMMM yyyy')}</h3>
            <div className="month-grid" role="grid" aria-label={format(parseISO(first), 'MMMM yyyy')}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((w, i) => (
                <span key={i} className="wd" aria-hidden="true">
                  {w}
                </span>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <span key={`pad${i}`} />
              ))}
              {days.map((d) => {
                const kind = dayKind(d, year, calendar);
                const entry = byDate.get(d);
                const selected = selection && d >= selection.from && d <= selection.to;
                const label = `${format(parseISO(d), 'EEE, MMM d')}: ${DAY_KIND_META[kind].label}${entry ? ` - ${entry.label}` : ''}`;
                const cls = `cal-day k-${kind} ${d === today ? 'is-today' : ''} ${selected ? 'is-selected' : ''} ${entry?.scope === 'local' ? 'is-local' : ''}`;
                return onDayClick ? (
                  <button key={d} className={cls} title={label} aria-label={label} onClick={() => onDayClick(d)}>
                    {Number(d.slice(8))}
                  </button>
                ) : (
                  <span key={d} className={cls} title={label} aria-label={label} role="gridcell">
                    {Number(d.slice(8))}
                  </span>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
// The color key under the calendar.
export function CalendarLegend({ counts }) {
  return (
    <ul className="legend">
      {LEGEND.map((k) => (
        <li key={k}>
          <span className={`swatch k-${k}`} aria-hidden="true" />
          {DAY_KIND_META[k].label}
          {counts?.[k] !== undefined && <b>{counts[k]}</b>}
        </li>
      ))}
      <li>
        <span className="swatch k-holiday is-local" aria-hidden="true" />
        Local holiday (Baguio)
      </li>
    </ul>
  );
}

// Teachers can handle several classes. Pages show one class at a time: the one picked in the
// switcher (?class=...), or else the class in session right now.
// =====================================================================
// 5. TEACHERS WITH SEVERAL CLASSES
// =====================================================================
export async function loadMyClasses(r, requested) {
  const session = await r.getSession();
  const today = await r.getToday();
  const classes = sortByStart(await Promise.all(session.sectionIds.map((id) => r.getSection(id))));
  const current = classNow(classes, today.time, today.actualDate);
  const section = classes.find((c) => c.id === requested) ?? current ?? classes[0];
  return { session, today, classes, current, section };
}
// The chosen class lives in the address bar (?class=<id>) so it survives reloads and can be linked to.
export function useClassParam() {
  const [params, setParams] = useSearchParams();
  const set = (id) => {
    const p = new URLSearchParams(params);
    p.set('class', id);
    setParams(p, { replace: true });
  };
  return [params.get('class'), set];
}
const PHASE_LABEL = { now: 'Now', next: 'Later', done: 'Done', off: 'No class' };
/** Pill buttons to switch between a teacher's classes. Hidden when there is only one. */
// Pill buttons to switch class (hidden when the teacher has only one). "Now" marks the class in session.
export function ClassSwitch({ classes, value, onChange, time, date }) {
  if (classes.length < 2) return null;
  return (
    <div className="class-switch" role="tablist" aria-label="Choose a class">
      {classes.map((c) => {
        const phase = time ? classPhase(c, time, date) : null;
        return (
          <button
            key={c.id}
            role="tab"
            aria-selected={c.id === value}
            className={`class-pill ${c.id === value ? 'on' : ''}`}
            onClick={() => onChange(c.id)}
          >
            <span className="sec-dot" style={{ background: c.color }} aria-hidden="true" />
            <span className="class-pill-name">{shortClassName(c.name)}</span>
            <span className="class-pill-time">{to12h(c.schedule.startTime)}</span>
            {phase === 'now' && <span className="now-tag">{PHASE_LABEL.now}</span>}
          </button>
        );
      })}
    </div>
  );
}
