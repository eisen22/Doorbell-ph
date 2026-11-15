import { createContext, useCallback, useContext, useEffect, useRef, useState, useMemo } from 'react';
import { GRADE_LEVELS, gradeName, bySectionGrade, levelsLabel, manilaToday, addDays, isoWeekday, DAY_KIND_META, dayKind, classNow, classPhase, shortClassName, sortByStart, to12h, isSchoolDay, ordinal, periodsLabel } from './logic';
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
// The "Doorbell" name as drawn by the logo designer (Recraft): shapes, not a font, so it looks the
// same everywhere. Master file: design/logo/doorbell-wordmark-color.svg. `height` in px; the color
// follows the text color around it (currentColor).
export function Wordmark({ height = 20, className = '' }) {
  return (
    <svg height={height} viewBox="32.5 32.5 6061.1 1447.1" role="img" aria-label="Doorbell" className={`wordmark ${className}`} fill="currentColor">
      <path d="M 421.032 456.078 C 420.246 473.356 420.288 490.706 420.259 508 C 419.977 679.828 420.499 851.67 420.47 1023.5 C 420.461 1077.67 421.161 1131.92 420.499 1186.08 C 420.273 1204.52 420.354 1228.53 411.958 1245.48 C 392.126 1285.53 349.815 1282.35 311.5 1282.28 C 290.647 1282.23 263.987 1284.27 244.573 1274.72 C 210.026 1257.71 206.581 1226.86 206.107 1192 C 205.936 1179.5 205.955 1167 205.958 1154.5 C 205.988 1045.34 205.686 936.162 205.859 827 C 206.06 699.999 205.833 572.999 206.082 446 C 206.148 412.183 205.42 378.305 205.943 344.499 C 206.228 326.09 208.764 307.285 217.442 290.799 C 238.841 250.147 271.601 240.584 315 240.011 C 315.007 240.011 319.492 239.973 319.5 239.973 C 422.664 239.493 525.835 239.875 629 239.916 C 665.64 239.931 702.366 239.614 739 240.134 C 774.701 240.641 809.616 245.731 844.5 252.967 C 873.436 258.969 897.516 266.958 925.002 277.939 C 957.026 290.733 981.385 304.105 1010.36 322.416 C 1026.99 332.925 1040.56 343.028 1055.89 355.217 C 1104.42 393.802 1139.85 434.743 1172.58 487.356 C 1195.1 523.556 1207.38 553.529 1222.36 592.903 C 1232.24 618.885 1236.44 639.099 1241.37 665.998 C 1252.95 729.189 1252.77 815 1237.57 877.768 C 1235.48 886.365 1233.37 894.953 1231.11 903.504 C 1210.74 980.557 1166.17 1061.17 1110.52 1119.01 C 1101.98 1127.89 1093.75 1137.11 1084.5 1145.24 C 1066.49 1161.06 1053.94 1172.53 1032.33 1188.36 C 991.372 1218.35 941.109 1242.41 893.593 1257.39 C 841.526 1273.81 797.396 1281.26 743 1281.98 C 705.562 1282.48 652.822 1282.61 616 1282.23 C 596.174 1282.02 576.341 1281.5 558.595 1271.66 C 528.658 1255.07 519.413 1229.17 518.854 1196.5 C 518.481 1174.78 517.161 1140.56 523.486 1120.77 C 536.909 1078.8 572.487 1066.57 613 1065.87 C 663.509 1065 714.122 1067.91 764.5 1064.17 C 809.324 1060.83 856.305 1044.35 893.998 1019.92 C 954.302 980.82 987.545 937 1015.37 871.214 C 1034.04 827.053 1040.25 772.464 1034.66 725.002 C 1027.95 667.929 1008.49 622.563 974.652 576.303 C 949.456 541.855 910.881 509.46 872.996 489.812 C 828.869 466.927 783.445 457.016 734 456.4 C 717.833 456.199 701.667 456.504 685.5 456.354 C 631.996 455.855 578.509 455.87 525 455.905 C 490.389 455.928 455.621 455.016 421.032 456.078 z" />
      <path d="M 1697.51 475.451 C 1920.6 472.913 2103.04 652.617 2103.87 875.721 C 2104.7 1098.83 1923.61 1279.89 1700.5 1279.01 C 1479.8 1278.15 1301.11 1099.42 1300.29 878.72 C 1299.46 658.015 1476.81 477.962 1697.51 475.451 z M 1701.5 691.413 C 1598.49 691.429 1515.06 775.089 1515.34 878.102 C 1515.62 981.115 1599.49 1064.33 1702.5 1063.79 C 1805.15 1063.25 1887.99 979.745 1887.72 877.101 C 1887.44 774.456 1804.15 691.396 1701.5 691.413 Z" />
      <path d="M 2546.5 475.657 C 2767.71 475.434 2947.45 654.111 2948.55 875.314 C 2949.65 1096.52 2771.69 1276.97 2550.49 1278.94 C 2328.05 1280.93 2146.36 1101.75 2145.26 879.303 C 2144.15 656.858 2324.05 475.88 2546.5 475.657 z M 2548.5 691.298 C 2481.42 690.696 2419.22 726.264 2385.71 784.38 C 2352.2 842.496 2352.59 914.153 2386.72 971.904 C 2420.85 1029.66 2483.44 1064.55 2550.51 1063.23 C 2652.16 1061.22 2733.37 977.953 2732.82 876.277 C 2732.27 774.601 2650.18 692.21 2548.5 691.298 Z" />
      <path d="M 3586.5 206.063 C 3614.4 206.061 3638.92 207.922 3659.97 228.033 C 3688 254.819 3689.16 286.123 3689.1 322.5 C 3688.95 422.166 3689.06 521.833 3688.92 621.5 C 3688.8 697.986 3687.65 774.52 3688.85 851 C 3688.97 858.858 3689.37 866.659 3689.84 874.501 C 3693.44 934.254 3717.37 980.001 3762.08 1019.47 C 3790.47 1044.55 3830.17 1062.32 3867.5 1068.21 C 3931.94 1078.38 3986.81 1058.95 4036.46 1017.86 C 4080.63 981.303 4107.09 918.152 4102.43 861.001 C 4093.85 755.799 4011.1 678.659 3906.44 673.468 C 3881.56 672.234 3855.65 675.212 3832.5 666.026 C 3804.13 654.77 3787.83 629.386 3786.13 599.501 C 3785.03 580.073 3785.16 559.017 3785.69 539.498 C 3786.68 502.573 3803.7 479.608 3837.87 465.655 C 3861.3 456.09 3904.37 458.729 3929 460.193 C 3961.97 462.151 3984.2 467.207 4015.54 476.706 C 4053.9 488.334 4078.26 499.117 4112.54 519.888 C 4198.39 571.902 4261 648.992 4293.49 744.01 C 4312.31 799.037 4319.45 870.385 4310.86 928.002 C 4306.62 956.446 4299.76 984.495 4290.57 1011.75 C 4280.59 1041.33 4269.07 1061.13 4253.15 1087.56 C 4236 1116.04 4215.05 1141.31 4191.32 1164.61 C 4175.19 1180.45 4153.53 1199.34 4134.51 1211.51 C 4059.3 1259.65 3987.22 1281.83 3896.5 1282.2 C 3879.97 1282.27 3863.07 1281.59 3846.67 1279.47 C 3821.48 1276.21 3791.13 1269.61 3767.07 1261.64 C 3742.7 1253.56 3712 1240.6 3689.68 1227.58 C 3622.41 1188.34 3568.03 1134.53 3530.21 1066.43 C 3495.02 1003.05 3476.82 935.431 3475.9 863 C 3475.21 809.687 3475.42 756.32 3475.44 703 C 3475.48 613.174 3474.89 523.323 3475.38 433.5 C 3475.61 391.677 3474.93 349.812 3475.46 308 C 3475.81 280.914 3478.75 258.684 3497.2 237.583 C 3521.38 209.915 3551.48 206.065 3586.5 206.063 z" />
      <path d="M 4406.49 1016.5 C 4401.3 1003.73 4397.62 989.032 4394.67 975.534 C 4383.1 922.641 4378.27 868.726 4386.66 814.999 C 4397.61 744.858 4414.56 701.003 4452.77 641.421 C 4481.22 597.068 4516.16 561.532 4557.51 530.071 C 4620.88 481.853 4703.54 449.178 4783 442.316 C 4790.49 441.669 4798 441.282 4805.5 440.845 C 4805.51 440.844 4806.99 440.774 4807 440.773 C 4828.84 439.969 4853.67 441.658 4875.4 444.47 C 4949.48 454.056 5015.52 480.043 5076 524.003 C 5105.74 545.616 5126.19 565.463 5151.13 592.458 C 5172.25 615.316 5188.53 642.065 5204.32 668.757 C 5230.65 713.289 5249.94 779.117 5254.45 830.443 C 5256.82 857.399 5260.6 895.078 5243.22 918.141 C 5223.45 944.374 5200.19 946.112 5169.5 946.405 C 5127.84 946.801 5086.16 946.678 5044.5 946.619 C 4964.35 946.505 4884.14 947.461 4804 946.598 C 4798.5 946.538 4792.98 946.376 4787.5 945.877 C 4767.07 944.015 4745.72 933.611 4736.34 914.404 C 4729.7 900.801 4731.43 876.251 4731.44 861.998 C 4731.45 843.823 4730.15 827.163 4742.81 812.85 C 4760.67 792.651 4781.51 787.785 4807.5 787.329 C 4830.98 786.916 4854.51 787.154 4878 787.114 C 4933.57 787.018 4989.41 788.444 5044.93 785.621 C 5044.4 780.818 5043.95 775.976 5042.55 771.352 C 5031.89 736.184 4990.09 694.296 4960.59 673.799 C 4895.88 628.843 4806.14 619.446 4733 648.284 C 4697.22 662.392 4669.89 681.846 4643.26 709.243 C 4605.28 748.313 4583.18 806.732 4578.6 860.501 C 4574.57 907.925 4586.68 957.208 4611.25 997.92 C 4652.92 1066.97 4717.33 1107.01 4797 1116.97 C 4855.71 1124.3 4925.55 1103.76 4970.04 1064.52 C 5004.19 1034.39 5000.37 1031.57 5044.5 1031.36 C 5075.13 1031.21 5105.87 1030.89 5136.5 1031.29 C 5143 1031.38 5149.54 1031.59 5156.01 1032.32 C 5183.37 1035.41 5197.05 1056.23 5193.13 1083 C 5189.72 1106.37 5158.67 1139.13 5143.56 1156.16 C 5108.35 1195.84 5075.95 1220.93 5030.5 1248.04 C 4965.23 1286.99 4881.95 1308.09 4806 1305.17 C 4799.49 1304.92 4792.99 1304.58 4786.5 1304.13 C 4700.7 1298.2 4604.08 1260.64 4538.75 1204.28 C 4493.8 1165.5 4459.94 1124.69 4431.51 1072.5 C 4421.36 1053.87 4414.4 1036 4406.49 1016.5 z" />
      <path d="M 5812.5 205.796 C 5842.73 205.763 5874.45 204.46 5897.42 227.203 C 5916.02 245.626 5918.88 264.979 5919.24 290 C 5919.24 290.007 5919.3 295.992 5919.3 296 C 5919.94 374.646 5919.41 453.349 5919.38 532 C 5919.36 588.803 5918.59 645.702 5919.67 702.5 C 5920.37 739.663 5920.46 776.83 5920.55 814 C 5920.67 861.119 5921.55 908.395 5920.03 955.5 C 5919.2 981.581 5920.05 1007.44 5920.37 1033.5 C 5920.62 1054.34 5919.63 1075.16 5919.46 1096 C 5919.46 1096.01 5919.43 1102.49 5919.43 1102.5 C 5919.33 1128.17 5920.41 1153.83 5920.32 1179.5 C 5920.23 1200.96 5920.21 1228.86 5909.67 1248.41 C 5892.2 1280.8 5861.49 1282.41 5828.5 1282.44 C 5816.17 1282.45 5803.83 1282.39 5791.5 1282.36 C 5772.61 1282.32 5751.98 1283.48 5735.65 1272.4 C 5706.02 1252.29 5706.03 1227.4 5705.47 1194.5 C 5704.97 1164.85 5705.56 1135.16 5705.55 1105.5 C 5705.44 871.668 5705.44 637.833 5705.31 404 C 5705.29 367.867 5704.67 331.627 5705.11 295.5 C 5705.31 279.438 5705.86 262.251 5712.91 247.487 C 5727.87 216.134 5756.97 206.788 5789.5 206.003 C 5797.16 205.818 5804.83 205.804 5812.5 205.796 z" />
      <path d="M 5426.5 205.584 C 5449.53 205.591 5472.61 205.685 5495.5 208.209 C 5507.65 209.547 5518.58 212.617 5528.55 219.868 C 5558.82 241.898 5557.3 276.438 5557.36 310 C 5557.76 536.163 5557.08 762.335 5557.22 988.5 C 5557.26 1057.32 5557.88 1126.19 5557.35 1195 C 5557.29 1203 5557.12 1211.02 5556.54 1219 C 5554.78 1242.9 5541.82 1264.94 5520 1275.83 C 5501.55 1285.04 5466.61 1282.62 5447.5 1282.62 C 5426.06 1282.63 5401.41 1285.01 5381.41 1275.28 C 5349.44 1259.72 5344.36 1232.7 5343.97 1200 C 5343.81 1186.33 5343.72 1172.67 5343.75 1159 C 5344.28 905.667 5343.39 652.333 5343.8 399 C 5343.86 364.182 5343.52 329.311 5343.85 294.5 C 5344.1 268.076 5346.32 246.168 5366.56 227.194 C 5385.35 209.586 5401.49 205.577 5426.5 205.584 z" />
      <path d="M 3339.5 458.958 C 3358.33 458.862 3376.29 464.654 3391.07 476.502 C 3415.83 496.357 3417.16 515.734 3417.36 545.498 C 3417.49 565.412 3418.04 585.606 3416.85 605.501 C 3414.75 640.957 3392.43 663.687 3358.5 671.823 C 3350.21 673.811 3341.78 675.177 3333.5 677.213 C 3305.09 684.198 3273.28 700.674 3252.97 721.969 C 3215.72 761.022 3203.88 806.733 3203.05 859.5 C 3203.05 859.507 3203 863.492 3203 863.5 C 3202.46 925.65 3203.17 987.845 3203.01 1050 C 3202.88 1099.31 3203.39 1148.7 3202.63 1198 C 3202.42 1211.62 3201.95 1225.96 3195.67 1238.4 C 3176.31 1276.76 3140.45 1276.23 3102.5 1276.26 C 3084.15 1276.28 3065.75 1276.19 3047.5 1274.21 C 3004.74 1269.57 2990.21 1240.45 2989.49 1200.41 C 2989.31 1190.27 2989.51 1180.13 2989.78 1170 C 2990.71 1134.3 2989.24 1098.7 2989.38 1063 C 2989.57 1015.5 2988.93 967.994 2989.34 920.5 C 2989.34 920.493 2989.41 913.508 2989.41 913.5 C 2989.55 904.33 2989.78 895.166 2990.06 886 C 2990.6 868.328 2990.21 850.655 2990.71 833 C 2991.55 802.739 2995.23 772.1 3002.47 742.692 C 3015.38 690.307 3045.17 629.476 3081.16 589.102 C 3123.26 541.872 3159.94 514.833 3217 488.243 C 3251.01 472.391 3302.21 459.149 3339.5 458.958 z" />
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
// One day of a child's attendance history, as a short timeline (clicked on the calendar below it):
// gate scan in, the class confirmation, a later-period arrival, the texts to the parent, gate scan out.
const TEXT_LABEL = {
  arrival: 'In-class text',
  late: 'Late text',
  laterPeriod: 'Arrived-later text',
  absent: 'Absence text',
  missing: '"Not in class" text',
  streak: 'Days-in-a-row text',
  total: 'Absence total text',
};
function DayDetail({ date, rec, look, picked }) {
  if (!date) return <p className="muted small sa-hint">Click a day to see its times.</p>;
  const when = format(parseISO(date), 'EEEE, MMMM d, yyyy');
  if (!rec) {
    const { text } = look(date);
    return (
      <div className="sa-detail">
        <div className="sa-detail-head">
          <strong>{when}</strong>
          <span className="muted small">{text}</span>
        </div>
        {!picked && <p className="muted small">Click any day on the calendar to see its times.</p>}
      </div>
    );
  }
  const inClass = rec.status === 'present' || rec.status === 'late';
  const events = [];
  if (rec.scannedAt) events.push({ at: rec.scannedAt, text: 'Scanned in at the gate' });
  // Who confirmed: the teacher who marked this child (a later period, or a correction), otherwise the
  // teacher who confirmed the class.
  const cc = rec.classConfirmed && !rec.classConfirmed.auto ? rec.classConfirmed : null;
  const who = rec.markedBy ?? cc?.by;
  const by = (name) => (name ? ` by ${name}` : '');
  const joined = rec.joinedPeriod ? ` · joined at the ${ordinal(rec.joinedPeriod)} period${rec.joinedSubject ? ` (${rec.joinedSubject})` : ''}` : '';
  const sameMoment = cc && (!rec.confirmedAt || rec.confirmedAt === cc.at) && !rec.joinedPeriod && !rec.markedBy;
  if (rec.classConfirmed?.auto && rec.classConfirmed.at) events.push({ at: rec.classConfirmed.at, text: 'Class closed without a teacher confirming' });
  if (inClass) {
    if (sameMoment && cc.at) events.push({ at: cc.at, text: `Confirmed in class${rec.status === 'late' ? ' (late)' : ''}${by(cc.by)}`, strong: true });
    else {
      // Confirmed later than the class (arrived in a later period, or the teacher corrected it): both moments.
      if (cc?.at) events.push({ at: cc.at, text: `Class attendance confirmed${by(cc.by)} (not in class yet)` });
      if (rec.confirmedAt) events.push({ at: rec.confirmedAt, text: `Confirmed in class${rec.status === 'late' ? ' (late)' : ''}${joined}${by(who)}`, strong: true });
    }
  } else if (cc?.at) {
    events.push({ at: cc.at, text: `Class attendance confirmed${by(cc.by)}: ${rec.status === 'excused' ? 'excused' : 'not in class'}`, strong: rec.status !== 'excused' });
  }
  for (const t of rec.texts ?? []) events.push({ at: t.at, text: `${TEXT_LABEL[t.kind] ?? 'Text'} to the parent${t.status === 'failed' ? ' (not delivered)' : ''}`, sms: true });
  if (rec.scannedOut) events.push({ at: rec.scannedOut, text: 'Scanned out at the gate' });
  events.sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="sa-detail">
      <div className="sa-detail-head">
        <strong>{when}</strong>
        <StatusChip status={rec.status} />
        {rec.sectionName && <span className="muted small">{rec.sectionName}</span>}
      </div>
      {events.length ? (
        <ol className="sa-timeline">
          {events.map((e, i) => (
            <li key={i} className={`${e.strong ? 'sa-ev-strong' : ''} ${e.sms ? 'sa-ev-sms' : ''}`}>
              <span className="sa-ev-time">{to12h(e.at)}</span>
              <span>{e.text}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">No times recorded for this day.</p>
      )}
      <p className="muted small sa-notes">
        {!rec.scannedAt && (inClass ? 'Did not scan in at the gate (marked by the teacher). ' : 'No gate scan. ')}
        {inClass && !rec.scannedOut && 'Did not scan out. '}
        {rec.status === 'absent' && rec.scannedAt && 'Scanned in at the gate but was not found in class. '}
        {rec.excusedPeriods?.length > 0 && `Excused for the ${periodsLabel(rec.excusedPeriods)} only. `}
        {rec.excusedNote && `Excuse: ${rec.excusedNote}. `}
        {rec.editedReason && rec.status !== 'excused' && `Note: ${rec.editedReason}.`}
      </p>
    </div>
  );
}
export function StudentAttendanceModal({ student, section, onClose }) {
  const { data } = useLive((r) => r.getStudentAttendance(student.id, section.id), [student.id, section.id]);
  const [picked, setPicked] = useState(null); // the clicked day: its details show above the calendar
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
      <DayDetail date={picked ?? (days[today] ? today : Object.keys(days).sort().at(-1))} rec={days[picked ?? (days[today] ? today : Object.keys(days).sort().at(-1))]} look={look} picked={!!picked} />
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
                    <button
                      type="button"
                      key={d}
                      role="gridcell"
                      title={label}
                      aria-label={label}
                      aria-pressed={d === picked}
                      onClick={() => setPicked(d)}
                      disabled={cls === 'sd-out'}
                      className={`cal-day sa-day ${cls} ${inStreak.has(d) ? 'sa-streak' : ''} ${d === today ? 'is-today' : ''} ${d === picked ? 'sa-picked' : ''}`}
                    >
                      {Number(d.slice(8))}
                    </button>
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
