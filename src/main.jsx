// =====================================================================
// main.jsx — WHERE THE APP STARTS
// ---------------------------------------------------------------------
// 1. Sign-in page (Login)   2. The frame around every page (Shell)
// 3. The list of pages and their addresses (routes), at the bottom
// =====================================================================
import './style.css'; // all the styling for the whole app
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Navigate, NavLink, Outlet, useLocation, BrowserRouter, Route, Routes } from 'react-router-dom';
import {
  Eye,
  EyeOff,
  LogIn,
  KeyRound,
  Info,
  LayoutGrid,
  ClipboardCheck,
  Users,
  FileSpreadsheet,
  Bell,
  Settings as SettingsIcon,
  Search,
  Menu,
  ChevronDown,
  CalendarDays,
  Shapes,
  GraduationCap,
  QrCode,
  ScrollText,
  LogOut,
  MessageSquareText,
  UserX,
} from 'lucide-react';
import { useRepo, Logo, Skeleton, useLive, RepoProvider } from './ui';
import ReactDOM from 'react-dom/client';
import { Dashboard, Attendance, Students, CalendarPage, Reports, Notifications, SettingsPage, SmsMessages } from './teacher';
import { AdminDashboard, AdminCalendar, Sections, Teachers, AdminStudents, QrCards, AdminSettings, AuditLog, AbsenceWatch } from './admin';

/** One sign-in page for teachers and admins; the account's role decides which portal opens. */
// ---------------------------------------------------------------------
// SIGN-IN PAGE (/login). One page for teachers and the admin: the account's role
// decides which portal opens. On a brand-new database it shows "First-time setup".
// In demo mode it lists the demo accounts.
// ---------------------------------------------------------------------
export function Login() {
  const repo = useRepo();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [setup, setSetup] = useState(false); // true = the database has no admin yet: show "First-time setup"
  const [name, setName] = useState('School Admin');
  const demo = repo.demoAccounts();
  useEffect(() => {
    // Already signed in? Go straight to the right portal.
    repo.getSession().then((s) => {
      if (s) navigate(s.role === 'admin' ? '/admin' : '/', { replace: true });
    });
    // Cloud mode only: is this a brand-new database? (needsSetup is added in firebase.js)
    repo
      .needsSetup?.()
      .then(setSetup)
      .catch((e) =>
        setError(
          e.code === 'permission-denied'
            ? 'The database is locked. Publish firestore.rules in Firebase console -> Firestore Database -> Rules.'
            : `Cannot reach the database: ${e.message}`,
        ),
      );
  }, [repo, navigate]);
  // Creates the very first admin account (only possible once).
  const createAdmin = async (e) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError('Use a password with at least 6 characters.');
    setBusy(true);
    try {
      await repo.createFirstAdmin({ name: name.trim(), email: email.trim(), password });
      navigate('/admin', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e) => {
    e?.preventDefault();
    setError(null);
    setNotice(null);
    if (!email || !password) return setError('Enter your email and password.');
    setBusy(true);
    try {
      const s = await repo.signIn(email, password);
      navigate(s.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const forgot = async () => {
    setError(null);
    setNotice(null);
    if (!email) return setError('Type your email first, then press "Forgot password?".');
    try {
      await repo.sendPasswordReset(email);
      setNotice(`A reset link was sent to ${email}.`);
    } catch (err) {
      setError(err.message);
    }
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <section className="login-art" aria-hidden="true">
          <div className="login-brand">
            <Logo size={40} />
            <span>Doorbell</span>
          </div>
          <div className="art-bubbles">
            <div className="art-bubble b1">
              <b>Doorbell:</b> Juan arrived at school at 7:42 AM.
            </div>
            <div className="art-bubble b2">
              <b>Doorbell:</b> Nakarating na si Bea sa paaralan ng 7:45 AM.
            </div>
            <div className="art-bubble b3">Attendance confirmed for Kinder I - Apple</div>
          </div>
          <p>Scan the ID. Parents know right away.</p>
        </section>
        {setup ? (
          <section className="login-form">
            <h1>First-time setup</h1>
            <p className="muted">This school has no admin yet. Create the admin account. This page only appears once.</p>
            <form onSubmit={createAdmin}>
              <label className="field">
                <span>Admin name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Admin email</span>
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label className="field">
                <span>Password (at least 6 characters)</span>
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              <button className="btn btn-ink wide" disabled={busy} type="submit">
                {busy ? 'Creating…' : 'Create admin account'}
              </button>
            </form>
          </section>
        ) : (
          <section className="login-form">
            <h1>Sign in</h1>
            <p className="muted">For teachers and school admins. Use the account given by your school.</p>
            <form onSubmit={submit}>
              <label className="field">
                <span>Email</span>
                <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </label>
              <label className="field">
                <span>Password</span>
                <div className="pw">
                  <input
                    className="input"
                    type={show ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="icon-btn sm"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? 'Hide password' : 'Show password'}
                  >
                    {show ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {notice && (
                <p className="ok-text" role="status">
                  {notice}
                </p>
              )}
              <button className="btn btn-ink wide" disabled={busy} type="submit">
                <LogIn size={18} /> {busy ? 'Signing in…' : 'Sign in'}
              </button>
              <button type="button" className="link-btn center" onClick={forgot}>
                <KeyRound size={14} /> Forgot password?
              </button>
            </form>
            {demo.length > 0 && (
              <div className="demo-box">
                <p>
                  <Info size={14} /> <b>Demo mode.</b> Sample data that resets when you close the tab (switch MODE in firebase.js to use the cloud).
                  Try an account:
                </p>
                {demo.map((a) => (
                  <button
                    key={a.email}
                    className="demo-acc"
                    onClick={() => {
                      setEmail(a.email);
                      setPassword(a.password);
                    }}
                  >
                    <strong>{a.label}</strong>
                    <span>{a.email}</span>
                  </button>
                ))}
                <p className="muted small">
                  Password for all demo accounts: <code>{demo[0].password}</code>
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// THE FRAME AROUND EVERY PAGE (Shell): left menu, search bar, alerts bell, account menu.
// TEACHER_NAV and ADMIN_NAV are the menu items: to add a page, add a line here AND a <Route> below.
// badge: 'alerts' = unread alerts count, 'watch' = children at the streak limit (red).
// ---------------------------------------------------------------------
const TEACHER_NAV = [
  { to: '/', label: 'Dashboard', Icon: LayoutGrid, end: true },
  { to: '/attendance', label: 'Attendance', Icon: ClipboardCheck },
  { to: '/students', label: 'My Students', Icon: Users },
  { to: '/calendar', label: 'Calendar', Icon: CalendarDays },
  { to: '/reports', label: 'Reports', Icon: FileSpreadsheet },
  { to: '/notifications', label: 'Alerts', Icon: Bell, badge: 'alerts' },
  { to: '/sms', label: 'SMS Messages', Icon: MessageSquareText },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];
const ADMIN_NAV = [
  { to: '/admin', label: 'Overview', Icon: LayoutGrid, end: true },
  { to: '/admin/absences', label: 'Absence Watch', Icon: UserX, badge: 'watch' },
  { to: '/admin/calendar', label: 'School Calendar', Icon: CalendarDays },
  { to: '/admin/sections', label: 'Sections', Icon: Shapes },
  { to: '/admin/teachers', label: 'Teachers', Icon: GraduationCap },
  { to: '/admin/students', label: 'Students', Icon: Users },
  { to: '/admin/cards', label: 'ID Cards', Icon: QrCode },
  { to: '/admin/sms', label: 'SMS Messages', Icon: MessageSquareText },
  { to: '/admin/settings', label: 'Settings', Icon: SettingsIcon },
  { to: '/admin/audit', label: 'Audit Log', Icon: ScrollText },
];
// Also guards the pages: not signed in -> /login; a teacher cannot open /admin pages,
// and the admin is sent to /admin.
export function Shell() {
  const repo = useRepo();
  const navigate = useNavigate();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [q, setQ] = useState('');
  const menuRef = useRef(null);
  const { data: session, loading } = useLive((r) => r.getSession());
  const { data: counts } = useLive(async (r) => {
    const s = await r.getSession();
    if (!s) return { alerts: 0, watch: 0 };
    const alerts = (await r.listNotifications()).filter((n) => !n.read).length;
    const watch = s.role === 'admin' ? (await r.listAttention(3)).length : 0;
    return { alerts, watch };
  });
  const isAdmin = session?.role === 'admin';
  const nav = isAdmin ? ADMIN_NAV : TEACHER_NAV;
  useEffect(() => {
    const close = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  if (loading && !session)
    return (
      <div className="canvas">
        <div className="frame boot">
          <Skeleton h={40} w={200} />
        </div>
      </div>
    );
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  // Keep each role inside its own portal.
  const inAdmin = location.pathname.startsWith('/admin');
  if (isAdmin && !inAdmin) return <Navigate to="/admin" replace />;
  if (!isAdmin && inAdmin) return <Navigate to="/" replace />;
  const needsSection = !isAdmin && !session.sectionIds.length && !['/calendar', '/settings', '/sms'].includes(location.pathname);
  return (
    <div className="canvas">
      <div className="frame">
        <aside className={`sidebar ${navOpen ? 'sidebar-open' : ''}`}>
          <div className="brand">
            <Logo />
            <span>Doorbell</span>
          </div>
          {isAdmin && <span className="portal-tag">Admin portal</span>}
          <nav aria-label="Main">
            {nav.map(({ to, label, Icon, end, badge }) => {
              const n = badge ? (counts?.[badge] ?? 0) : 0;
              return (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setNavOpen(false)}
                >
                  <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
                  <span>{label}</span>
                  {n > 0 && (
                    <span className={`nav-badge ${badge === 'watch' ? 'nav-badge-red' : ''}`} aria-label={`${n}`}>
                      {n}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
          <footer className="sidebar-foot">
            © 2026 Doorbell
            <br />
            {repo.mode === 'demo' ? 'Demo mode (sample data)' : 'Connected to the cloud'}
          </footer>
        </aside>

        <div className="main">
          <header className="topbar">
            <button className="icon-btn only-mobile" onClick={() => setNavOpen((v) => !v)} aria-label="Menu">
              <Menu size={20} />
            </button>
            <form
              className="search"
              onSubmit={(e) => {
                e.preventDefault();
                navigate(`${isAdmin ? '/admin/students' : '/students'}?q=${encodeURIComponent(q)}`);
              }}
            >
              <Search size={17} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students" aria-label="Search students" />
            </form>
            <div className="topbar-right">
              {!isAdmin && (
                <button className="icon-btn bell" onClick={() => navigate('/notifications')} aria-label="Alerts">
                  <Bell size={19} />
                  {!!counts?.alerts && <span className="dot-badge">{counts.alerts}</span>}
                </button>
              )}
              <div className="user-menu" ref={menuRef}>
                <button className="user-chip" onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen}>
                  <span className="avatar avatar-sm" aria-hidden="true">
                    {session.name
                      .split(' ')
                      .map((p) => p[0])
                      .join('')
                      .slice(0, 2)}
                  </span>
                  <span className="hide-sm">{session.name}</span>
                  <ChevronDown size={16} aria-hidden="true" />
                </button>
                {menuOpen && (
                  <div className="menu" role="menu">
                    <p className="menu-note">
                      {session.email}
                      <br />
                      {isAdmin ? 'School admin' : 'Teacher'}
                    </p>
                    <button
                      role="menuitem"
                      onClick={async () => {
                        setMenuOpen(false);
                        await repo.signOut();
                        navigate('/login');
                      }}
                    >
                      <LogOut size={16} /> Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>
          <main className="content">
            {needsSection ? (
              <div className="page">
                <div className="card">
                  <h2 className="card-title">No class assigned yet</h2>
                  <p className="muted">Ask the school admin to assign you to a class. You can still view the calendar and settings.</p>
                </div>
              </div>
            ) : (
              <Outlet />
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// START THE APP: draw everything inside <div id="root"> (index.html).
// <RepoProvider> gives every page the engine; <Routes> maps each address to a screen.
// basename: on GitHub Pages the site lives under /Doorbell-ph/ (set in vite.config.js).
// ---------------------------------------------------------------------
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RepoProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="students" element={<Students />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="reports" element={<Reports />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="sms" element={<SmsMessages />} />
            <Route path="admin/sms" element={<SmsMessages />} />
            <Route path="admin/absences" element={<AbsenceWatch />} />
            <Route path="admin" element={<AdminDashboard />} />
            <Route path="admin/calendar" element={<AdminCalendar />} />
            <Route path="admin/sections" element={<Sections />} />
            <Route path="admin/teachers" element={<Teachers />} />
            <Route path="admin/students" element={<AdminStudents />} />
            <Route path="admin/cards" element={<QrCards />} />
            <Route path="admin/settings" element={<AdminSettings />} />
            <Route path="admin/audit" element={<AuditLog />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </RepoProvider>
  </React.StrictMode>,
);
