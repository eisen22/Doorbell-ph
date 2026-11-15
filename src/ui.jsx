import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react';
import { GRADE_LEVELS, gradeName, bySectionGrade, levelsLabel, manilaToday, addDays, isoWeekday, DAY_KIND_META, dayKind, classNow, classPhase, shortClassName, sortByStart, to12h, isSchoolDay } from './logic';
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
    // The Doorbell mark (Nov 2026): a ringing bell, white on the green tile. Master files: design/logo/
    // (doorbell-app-icon.svg is this exact drawing). The bell is drawn on its own large grid and
    // scaled into the 256 x 256 tile by the transform.
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" className="logo">
      <rect width="256" height="256" rx="60" fill="#779931" />
      <g transform="translate(24.07 43.43) scale(0.05816)" fill="#FFFFFF">
        <path d="M 1454.83 780.715 C 1454.61 759.478 1454.84 738.237 1454.93 717 C 1455.05 690.005 1454.27 662.984 1454.6 636 C 1454.87 613.491 1458.39 590.952 1466.85 570.002 C 1481.16 534.565 1501.68 509.705 1533.5 489.019 C 1615.83 435.485 1733.92 461.232 1781.13 549.004 C 1795.12 575.012 1802.83 600.525 1803.42 630 C 1803.91 654.486 1803.6 679.011 1803.61 703.5 C 1803.62 732.098 1802.36 760.901 1804 789.458 C 1805.33 789.642 1806.67 789.816 1807.99 790.057 C 1823.64 792.904 1839.33 795.237 1855 797.98 C 1874.84 801.455 1894.42 806.294 1914 811.056 C 1947.89 819.302 1981.63 828.439 2014.45 840.246 C 2045.25 851.325 2076.78 862.239 2106.46 876.142 C 2172.92 907.273 2238.45 941.109 2298.23 983.685 C 2330.98 1007.01 2366.71 1033.48 2396.46 1060.54 C 2459.12 1117.54 2515.61 1178.24 2563.42 1248.27 C 2588.6 1285.15 2617.09 1330.79 2637.42 1370.28 C 2652.02 1398.63 2672.66 1444.6 2683.31 1473.99 C 2708.49 1543.53 2728.59 1615.17 2738.22 1688.5 C 2741.37 1712.45 2744.83 1736.39 2746.17 1760.5 C 2747.61 1786.19 2748.53 1811.91 2748.89 1837.64 C 2790.26 1837.8 2831.69 1836.31 2873 1838.64 C 2920.77 1841.34 2960.59 1862.08 2988.75 1901.16 C 3010.25 1931 3015.62 1961.04 3014.05 1997 C 3012.04 2042.95 2981.03 2086.27 2942.38 2109.62 C 2914.35 2126.55 2888.61 2129.77 2856.5 2130.24 C 2828.17 2130.66 2799.83 2130.87 2771.5 2130.9 C 2709.34 2130.96 2647.16 2130.94 2585 2130.86 C 2415.67 2130.64 2246.33 2131.02 2077 2130.87 C 1977 2130.77 1876.99 2131.19 1777 2130.82 C 1701.01 2130.53 1624.99 2131.45 1549 2130.83 C 1502.48 2130.45 1456.02 2130.65 1409.5 2130.63 C 1291 2130.58 1172.5 2130.92 1054 2130.84 C 908.836 2130.74 763.662 2131.14 618.5 2130.82 C 527.52 2130.62 436.467 2131.83 345.5 2130.62 C 311.194 2130.17 283.966 2124.24 253.491 2104.03 C 233.225 2090.59 218.723 2072.58 207.83 2051 C 184.939 2005.64 187.812 1942.97 218.286 1901.61 C 250.565 1857.79 292.361 1839.09 346 1837.86 C 370.748 1837.29 395.508 1837.66 420.261 1837.86 C 420.501 1822.07 420.686 1806.28 421.258 1790.5 C 426.942 1633.58 472.741 1481.39 547.676 1343.82 C 571.863 1299.42 603.318 1249.39 634.952 1209 C 654.407 1184.17 674.147 1158.76 696.075 1136.06 C 717.117 1114.27 738.208 1091.99 760.687 1071.66 C 801.679 1034.6 845.807 1001.11 891.53 970.062 C 920.65 950.292 957.709 928.439 989.068 912.271 C 1037 887.557 1086.15 865.038 1137 847.09 C 1170.94 835.112 1205.52 823.582 1240.5 815.072 C 1277.78 806.003 1315.93 797.201 1354 792.208 C 1387.54 787.808 1421.11 783.472 1454.83 780.715 z M 1516.5 1016.78 C 1467.87 1016.81 1419.3 1021.9 1371.49 1030.81 C 1264.92 1050.69 1178.05 1084.08 1085.54 1137.05 C 1036.66 1165.04 985.833 1202.62 944.071 1240.13 C 922.647 1259.37 902.277 1280.32 882.612 1301.36 C 862.789 1322.57 843.668 1348.22 826.307 1371.61 C 785.355 1426.77 753.591 1487.33 728.106 1551 C 717.536 1577.41 712.562 1598.27 720.083 1626.5 C 731.272 1668.49 771.609 1697.78 814.5 1698.92 C 815.833 1698.96 817.166 1698.98 818.5 1698.97 C 859.379 1698.78 899.712 1673.1 916.89 1636 C 924.92 1618.66 931.441 1600.7 939.612 1583.38 C 948.658 1564.21 958.536 1545.42 969.682 1527.39 C 1021.64 1443.33 1096.58 1371.35 1181.69 1321.42 C 1273.57 1267.52 1376.17 1232.5 1483 1226.69 C 1534.43 1223.89 1567.86 1230.48 1604.12 1190.54 C 1625.78 1166.68 1629.69 1139.93 1627 1108.5 C 1624.19 1075.52 1602.01 1043 1572.48 1028.09 C 1554.38 1018.95 1536.58 1016.76 1516.5 1016.78 Z" />
        <path d="M 1615.5 2179.96 C 1762.8 2180.14 1881.96 2299.9 1881.4 2447.2 C 1880.84 2594.5 1760.78 2713.35 1613.48 2712.41 C 1466.72 2711.48 1348.39 2591.94 1348.95 2445.18 C 1349.5 2298.41 1468.73 2179.78 1615.5 2179.96 z" />
        <path d="M 2983.5 490.744 C 3032.84 490.541 3077.12 519.045 3099.53 562.77 C 3107.97 579.247 3115.05 607.547 3112.92 625.999 C 3108.33 665.816 3096.88 687.021 3068.92 715.477 C 3041.15 743.747 3012.4 771.048 2984.6 799.303 C 2958.09 826.245 2930.84 852.412 2904.3 879.312 C 2876.69 907.3 2848.69 934.772 2820.76 962.423 C 2802.85 980.148 2785.91 998.872 2767.93 1016.48 C 2767.92 1016.49 2765.9 1018.45 2765.89 1018.45 C 2742.57 1040.73 2711.53 1051.1 2679.5 1051.35 C 2602.92 1051.94 2536.48 983.128 2550.96 905.503 C 2562.03 846.187 2587.96 830.562 2631.19 787.187 C 2668.04 750.209 2704.56 712.912 2741.51 676.019 C 2764.9 652.655 2787.91 628.906 2811.36 605.61 C 2834.88 582.253 2857.9 558.334 2881.55 535.126 C 2910.11 507.1 2942.41 490.913 2983.5 490.744 z" />
        <path d="M 2938.5 1136.94 C 2994.5 1136.91 3050.5 1137.02 3106.5 1137.05 C 3156.8 1137.08 3207.21 1136.36 3257.5 1137.21 C 3263.01 1137.3 3268.5 1137.47 3274 1137.79 C 3328.55 1140.9 3370.68 1180.87 3385.47 1232.19 C 3400.46 1284.22 3378.2 1343.65 3332.45 1372.88 C 3299.26 1394.08 3276.35 1394.2 3238 1394.53 C 3146.18 1395.32 3054.32 1394.8 2962.5 1394.83 C 2945.5 1394.84 2928.49 1395.06 2911.5 1394.56 C 2862.69 1393.11 2820.45 1368.86 2797.37 1325.4 C 2787.86 1307.48 2782.59 1282.21 2783.19 1262 C 2784.19 1228.29 2797.44 1194.95 2821.92 1171.48 C 2857.86 1137.01 2891.43 1136.97 2938.5 1136.94 z" />
        <path d="M 2340.5 195.393 C 2380.6 195.237 2420.23 216.301 2443.52 248.786 C 2466.1 280.281 2466.54 303.822 2466.88 340.5 C 2467.57 414.976 2467.19 489.52 2467.12 564 C 2467.09 599.306 2467.5 634.703 2466.98 670 C 2466.98 670.008 2466.9 674.493 2466.9 674.5 C 2465.98 714.286 2455.11 741.021 2425.55 768.13 C 2402.03 789.705 2371.58 801.914 2339.5 801.897 C 2307 801.88 2275.03 790.293 2250.76 768.558 C 2219.91 740.921 2211.16 709.757 2210.67 669.5 C 2210.67 669.493 2210.62 664.008 2210.62 664 C 2210.3 609.007 2210.65 553.996 2210.49 499 C 2210.33 440.707 2209.65 382.291 2210.51 323.999 C 2210.55 321.499 2210.6 318.999 2210.69 316.499 C 2213.18 243.815 2269.2 195.672 2340.5 195.393 z" />
      </g>
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
  // The page behind does not scroll while a window is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
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
                const label = `${format(parseISO(d), 'EEE, MMM d')}: ${DAY_KIND_META[kind].label}${entry ? ` - ${entry.label}${entry.levels?.length ? ` (${levelsLabel(entry.levels)})` : ''}` : ''}`;
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
// ---------------------------------------------------------------------
// STUDENT ATTENDANCE CALENDAR (a pop-up window)
// Opened by clicking a learner's name in Absence Watch (admin) or in "Attention needed" (teacher).
// Shows every month of the school year up to today, newest first. Each class day is colored
// by the learner's status: red absent, amber late, purple excused, green present.
// Days of the current absence streak get a dark outline.
// ---------------------------------------------------------------------
const STATUS_CLASS = { absent: 's-absent', late: 's-late', excused: 's-excused', present: 's-present' };
export function StudentAttendanceModal({ student, section, onClose }) {
  const { data } = useLive((r) => r.getStudentAttendance(student.id, section.id), [student.id, section.id]);
  const name = `${student.firstName} ${student.lastName}`;
  if (!data)
    return (
      <Modal title={name} onClose={onClose} wide>
        <p className="muted">Loading...</p>
      </Modal>
    );
  const { days, today, year, calendar, schedule, streak } = data;
  const last = today < year.end ? today : year.end;
  // Months from the start of the school year to this month, newest first.
  const months = [];
  for (let m = `${year.start.slice(0, 7)}-01`; m <= last; ) {
    months.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, '0')}-01`;
  }
  months.reverse();
  const inStreak = new Set(streak?.dates ?? []);
  const counts = { present: 0, late: 0, absent: 0, excused: 0 };
  Object.values(days).forEach((d) => (counts[d.status] = (counts[d.status] ?? 0) + 1));
  // What one day looks like.
  const look = (d) => {
    if (d < year.start || d > last) return { cls: 'sd-out', text: 'Outside the school days so far' };
    // No class that day (weekend, holiday, suspension, break): shown as No class even if an old record exists.
    if (!schedule || !isSchoolDay(d, schedule, calendar)) return { cls: 'sd-off', text: 'No class' };
    const rec = days[d];
    if (rec) {
      const meta = STATUS_META[rec.status];
      return { cls: STATUS_CLASS[rec.status] ?? '', text: `${meta?.label ?? rec.status}${rec.scannedAt ? ` · scanned ${to12h(rec.scannedAt)}` : ''}` };
    }
    return { cls: 'sd-none', text: 'No record' };
  };
  return (
    <Modal title={`${name}: attendance`} onClose={onClose} wide>
      <p className="muted small">
        {section.name} · {format(parseISO(year.start), 'MMM d, yyyy')} to {format(parseISO(last), 'MMM d, yyyy')}
        {streak?.count ? ` · now ${streak.count} school day${streak.count === 1 ? '' : 's'} absent in a row (outlined)` : ''}
      </p>
      <div className="sa-counts">
        {['absent', 'late', 'excused', 'present'].map((k) => (
          <span key={k} className={`sa-count ${STATUS_CLASS[k]}`}>
            <b>{counts[k] ?? 0}</b> {STATUS_META[k].label}
          </span>
        ))}
      </div>
      <div className="sa-months">
        {months.map((first) => {
          const lead = isoWeekday(first) % 7; // Sunday-first grid
          const list = [];
          for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) list.push(d);
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
                {list.map((d) => {
                  const { cls, text } = look(d);
                  const label = `${format(parseISO(d), 'EEE, MMM d')}: ${text}`;
                  return (
                    <span
                      key={d}
                      role="gridcell"
                      title={label}
                      aria-label={label}
                      className={`cal-day sa-day ${cls} ${inStreak.has(d) ? 'sa-streak' : ''} ${d === today ? 'is-today' : ''}`}
                    >
                      {Number(d.slice(8))}
                    </span>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <div className="sa-key">
        <span><i className="cal-day sa-day s-absent" /> Absent</span>
        <span><i className="cal-day sa-day s-late" /> Late</span>
        <span><i className="cal-day sa-day s-excused" /> Excused</span>
        <span><i className="cal-day sa-day s-present" /> Present</span>
        <span><i className="cal-day sa-day sd-none" /> No record</span>
        <span><i className="cal-day sa-day sd-off" /> No class</span>
        <span><i className="cal-day sa-day s-absent sa-streak" /> Days in a row now</span>
      </div>
    </Modal>
  );
}

// The color key under the calendar.
export function CalendarLegend({ counts }) {
  // The legend is split into what the colors MEAN: days with class, days without class, and marks
  // drawn around a day. Each group is a column; the number on the right counts those days this school year.
  const groups = [
    { title: 'Class days', kinds: ['class', 'exam', 'event', 'halfday', 'makeup'] },
    { title: 'No classes', kinds: ['holiday', 'suspension', 'break'] },
  ];
  return (
    <div className="legend">
      {groups.map((g) => (
        <div className="legend-group" key={g.title}>
          <h3>{g.title}</h3>
          <ul>
            {g.kinds.map((k) => (
              <li key={k}>
                <span className={`swatch k-${k}`} aria-hidden="true" />
                <span className="legend-label">{DAY_KIND_META[k].label}</span>
                {counts?.[k] !== undefined && <b>{counts[k]}</b>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="legend-group">
        <h3>Marks on a day</h3>
        <ul>
          <li>
            <span className="swatch k-holiday is-local" aria-hidden="true" />
            <span className="legend-label">Local holiday (Baguio)</span>
          </li>
          <li>
            <span className="swatch swatch-today" aria-hidden="true" />
            <span className="legend-label">Today</span>
          </li>
        </ul>
      </div>
    </div>
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
  // A teacher's few classes in time order; many classes (the admin, a subject teacher) Kindergarten to Grade 6.
  // A class removed a moment ago is skipped (the class list catches up right after).
  const all = (await Promise.all(session.sectionIds.map((id) => r.getSection(id).catch(() => null)))).filter(Boolean);
  const classes = all.length > 6 ? [...all].sort(bySectionGrade) : sortByStart(all);
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
  // Many classes: one drop-down list, grouped Kindergarten, Grade 1 ... Grade 6.
  if (classes.length > 6)
    return (
      <label className="class-select">
        <span className="muted small">Class</span>
        <select className="input auto" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Choose a class">
          {GRADE_LEVELS.filter((g) => classes.some((c) => (c.gradeLevel ?? 'K') === g)).map((g) => (
            <optgroup key={g} label={gradeName(g)}>
              {classes
                .filter((c) => (c.gradeLevel ?? 'K') === g)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {to12h(c.schedule.startTime)}
                    {time && classPhase(c, time, date) === 'now' ? ' · now' : ''}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>
    );
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

// =====================================================================
// GRADE LEVEL FILTER: All · Kindergarten · Grade 1 ... Grade 6 (used on every list page).
// value: 'all' or a grade ('K', '1' ... '6'). counts (optional): { K: 20, '1': 60, ... }.
// Grades with nothing in them are hidden, except the one selected.
// =====================================================================
export function LevelChips({ value, onChange, counts }) {
  const shown = GRADE_LEVELS.filter((g) => !counts || counts[g] || value === g);
  if (counts && shown.length <= 1 && value === 'all') return null;
  return (
    <div className="chips level-chips" role="group" aria-label="Grade level">
      <button type="button" className={`fchip ${value === 'all' ? 'fchip-on' : ''}`} aria-pressed={value === 'all'} onClick={() => onChange('all')}>
        All levels
      </button>
      {shown.map((g) => (
        <button key={g} type="button" className={`fchip ${value === g ? 'fchip-on' : ''}`} aria-pressed={value === g} onClick={() => onChange(g)}>
          {gradeName(g)}
          {counts && <b className="count">{counts[g] ?? 0}</b>}
        </button>
      ))}
    </div>
  );
}
/** Counts items per grade: countByGrade(rows, (r) => r.section?.gradeLevel). */
export const countByGrade = (items, gradeOf) => {
  const out = {};
  for (const it of items) {
    const g = gradeOf(it);
    if (g) out[g] = (out[g] ?? 0) + 1;
  }
  return out;
};
