// =====================================================================
// main.jsx — WHERE THE APP STARTS
// ---------------------------------------------------------------------
// 1. Sign-in page (Login)   2. The frame around every page (Shell)
// 3. The list of pages and their addresses (routes), at the bottom
// =====================================================================
import './style.css'; // all the styling for the whole app
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, Navigate, NavLink, Link, Outlet, useLocation, useSearchParams, BrowserRouter, Route, Routes } from 'react-router-dom';
import {
  LogIn,
  KeyRound,
  Info,
  LayoutGrid,
  ClipboardCheck,
  Users,
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
  FileText,
  FileSpreadsheet,
  MessagesSquare,
} from 'lucide-react';
import { useRepo, Logo, Wordmark, Skeleton, useLive, RepoProvider, PasswordInput, TodayNotice } from './ui';
import { parentKeyOf } from './logic';
// Parents sign in on this same page with their mobile number (parent/parentCloud.js), then /parent opens.
import { signInParent, signInParentWithGoogle, parentSignedIn } from './parent/parentCloud';
import ReactDOM from 'react-dom/client';
// One file per screen: teacher/ (teacher only), admin/ (admin only), shared/ (both portals).
import { Dashboard } from './teacher/Dashboard';
import { MyClasses } from './teacher/MyClasses';
import { CalendarPage } from './teacher/SchoolCalendar';
import { Notifications } from './teacher/Alerts';
import { SettingsPage } from './teacher/Settings';
import { Attendance } from './shared/Attendance';
import { AbsenceWatch } from './shared/AbsenceWatch';
import { SmsMessages } from './shared/SmsMessages';
import { AdminDashboard } from './admin/Overview';
import { AdminCalendar } from './admin/SchoolCalendar';
import { Sections } from './admin/Sections';
import { Teachers } from './admin/Teachers';
import { AdminStudents } from './admin/Students';
import { QrCards } from './admin/IdCards';
import { AdminSettings } from './admin/Settings';
import { AuditLog } from './admin/AuditLog';
import { Reports } from './shared/Reports';
import { ExcuseRequests } from './shared/ExcuseRequests';
import { Messages } from './shared/Messages';
// The parent portal (/parent) has its own sign-in and does not use the staff frame (Shell).
import { ParentPortal } from './parent/ParentPortal';

// Google's "G" for the Sign in with Google button (Google's sign-in branding asks for this mark).
function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [askReset, setAskReset] = useState(null); // 'sms' | 'link': the "Reset your password?" box is open
  const [school, setSchool] = useState(null); // meta/public: school name and office email
  useEffect(() => {
    repo.publicSchoolInfo?.().then(setSchool, () => {});
  }, [repo]);
  const [setup, setSetup] = useState(false); // true = the database has no admin yet: show "First-time setup"
  const [name, setName] = useState('School Admin');
  // Who is signing in: 'parent' (mobile number) or 'staff' (teachers and admins: email or Google).
  // The last choice is remembered on this device.
  const [who, setWhoState] = useState(() => {
    try {
      return localStorage.getItem('doorbell-login-as') === 'staff' ? 'staff' : 'parent';
    } catch {
      return 'parent';
    }
  });
  const setWho = (w) => {
    setWhoState(w);
    setError(null);
    setNotice(null);
    setEmail('');
    setPassword('');
    setRemember(w === 'parent');
    try {
      localStorage.setItem('doorbell-login-as', w);
    } catch {
      /* storage blocked */
    }
  };
  // Remember me: on for parents (their own phone), off for staff (school computers are often shared).
  const [remember, setRemember] = useState(who === 'parent');
  const demo = repo.demoAccounts();
  useEffect(() => {
    // Already signed in? Go straight to the right portal.
    repo.getSession().then((s) => {
      if (s) navigate(s.role === 'admin' ? '/admin' : '/', { replace: true });
      // A parent who ticked "Remember me" goes straight back to the parent portal (only when "Parent" was
      // the last choice here, so a teacher who is also a parent can still sign in as staff).
      else if (who === 'parent')
        parentSignedIn()
          .then((yes) => yes && navigate('/parent', { replace: true }))
          .catch(() => {});
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
    const id = email.trim();
    if (who === 'parent') {
      if (!id || !password) return setError('Enter your mobile number and your password.');
      if (id.includes('@')) return setError('Parents sign in with a mobile number. Teachers and staff: choose "School staff" above.');
      if (!parentKeyOf(id)) return setError('Enter your mobile number, e.g. 0917 123 4567.');
      setBusy(true);
      try {
        await signInParent(id, password, remember);
        navigate('/parent', { replace: true });
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
      return;
    }
    if (!id || !password) return setError('Enter your email and your password, or use Sign in with Google.');
    if (!id.includes('@')) return setError(parentKeyOf(id) ? 'That looks like a mobile number. Parents: choose "Parent" above.' : 'Enter your email address.');
    setBusy(true);
    try {
      const s = await repo.signIn(id, password, remember);
      navigate(s.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  // Google account: teachers and admins (only emails the admin added; see firebase.js), and parents
  // whose Gmail the school saved on their child's record (parentCloud.js).
  const google = async () => {
    setError(null);
    setNotice(null);
    setBusy(true);
    if (who === 'parent') {
      try {
        await signInParentWithGoogle(remember);
        navigate('/parent', { replace: true });
      } catch (err) {
        setError(err.message);
        setBusy(false);
      }
      return;
    }
    try {
      const s = await repo.signInWithGoogle(remember);
      navigate(s.role === 'admin' ? '/admin' : '/', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  // FORGOT PASSWORD. Parents, and staff without a Gmail address: after they accept, the Worker makes a
  // new password and texts it to the number on file (worker/src/passwords.js). Gmail addresses get
  // Firebase's reset link instead, where they type a new password themselves. The page never says
  // whether the number or email has an account.
  const forgot = () => {
    setError(null);
    setNotice(null);
    const id = email.trim();
    if (who === 'parent') {
      if (!parentKeyOf(id)) return setError('Type your mobile number first, then press "Forgot password?".');
      return setAskReset('sms');
    }
    if (!id.includes('@')) return setError('Type your email first, then press "Forgot password?".');
    setAskReset(/@gmail\.com$/i.test(id) ? 'link' : 'sms');
  };
  const confirmReset = async () => {
    const kind = askReset;
    const id = email.trim();
    setAskReset(null);
    setBusy(true);
    try {
      if (kind === 'link') {
        await repo.sendPasswordReset(id);
        // Firebase answers "sent" even for an address that has no account, so don't promise it arrived.
        setNotice(`If ${id} has a Doorbell account, we sent it a link (check Spam too). Open the link and type your new password.`);
      } else {
        await repo.requestNewPassword(who === 'parent' ? 'parent' : 'staff', who === 'parent' ? parentKeyOf(id) : id);
        setNotice(
          who === 'parent'
            ? 'If this number is registered at the school, a new password will be texted to it within a few minutes. Sign in with it.'
            : 'If this account has a mobile number on file, a new password will be texted to it within a few minutes. Sign in with it.',
        );
      }
    } catch (err) {
      setError(err.code === 'auth/invalid-email' ? 'That email address is not valid. Check it and try again.' : err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-wrap">
      <div className="login-card">
        <section className="login-art" aria-hidden="true">
          <div className="login-brand">
            <Logo size={40} />
            <Wordmark height={25} />
          </div>
          <div className="art-bubbles">
            <div className="art-bubble b1">
              <b>Doorbell:</b> Derek arrived at school at 7:42 AM.
            </div>
            <div className="art-bubble b2">
              <b>Doorbell:</b> Nakarating na si Gio sa paaralan ng 7:45 AM.
            </div>
            <div className="art-bubble b3">Attendance confirmed for Grade 2 - Mango</div>
          </div>
          <p>Scanned at the gate. Confirmed in class. Parents are told.</p>
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
                <PasswordInput autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
            {/* Who is signing in: it decides what the box asks for (mobile number or email). */}
            <div className="login-who" role="radiogroup" aria-label="I am signing in as">
              <button type="button" role="radio" aria-checked={who === 'parent'} className={who === 'parent' ? 'on' : ''} onClick={() => setWho('parent')}>
                <Users size={18} aria-hidden="true" />
                <span>
                  <b>Parent</b>
                  <small>Use your mobile number</small>
                </span>
              </button>
              <button type="button" role="radio" aria-checked={who === 'staff'} className={who === 'staff' ? 'on' : ''} onClick={() => setWho('staff')}>
                <GraduationCap size={18} aria-hidden="true" />
                <span>
                  <b>School staff</b>
                  <small>Teachers and admins</small>
                </span>
              </button>
            </div>
            {!demo.length && (
              <>
                <button type="button" className="btn wide google-btn" onClick={google} disabled={busy}>
                  <GoogleG /> Sign in with Google
                </button>
                <p className="login-or">
                  <span>{who === 'parent' ? 'or use your mobile number and password' : 'or use your email and password'}</span>
                </p>
              </>
            )}
            <form onSubmit={submit}>
              <label className="field">
                <span>{who === 'parent' ? 'Mobile number' : 'Email'}</span>
                {who === 'parent' ? (
                  <input
                    className="input"
                    type="tel"
                    inputMode="tel"
                    autoComplete="username"
                    placeholder="0917 123 4567"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                ) : (
                  <input
                    className="input"
                    type="email"
                    inputMode="email"
                    autoComplete="username"
                    placeholder="you@gmail.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoFocus
                  />
                )}
              </label>
              <label className="field">
                <span>Password</span>
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label className="remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>
                  Remember me on this device
                  <small>{who === 'parent' ? 'Untick on a borrowed phone.' : "Don't tick on a shared computer."}</small>
                </span>
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
                <LogIn size={18} /> {busy ? 'Signing in…' : who === 'parent' ? 'Sign in to the parent portal' : 'Sign in'}
              </button>
              <button type="button" className="link-btn center" onClick={forgot}>
                <KeyRound size={14} /> Forgot password?
              </button>
              {askReset && (
                <div className="reset-confirm" role="alertdialog" aria-labelledby="reset-title" aria-describedby="reset-text">
                  <p id="reset-title">
                    <b>Reset your password?</b>
                  </p>
                  <p id="reset-text">
                    {askReset === 'link'
                      ? `We will send a link to ${email.trim()}. Open it and type a new password.`
                      : who === 'parent'
                        ? "If you accept, your account's password will be reset and a new password will be sent to your phone number."
                        : "If you accept, your account's password will be reset and a new password will be sent to the mobile number the school has on file for you."}
                  </p>
                  {askReset === 'sms' && (
                    <p className="muted small">
                      Lost your phone or changed your number? Contact the school admin{' '}
                      {school?.officeEmail ? (
                        <>
                          through the school's email, <a href={`mailto:${school.officeEmail}`}>{school.officeEmail}</a>.
                        </>
                      ) : (
                        'at the school office.'
                      )}
                    </p>
                  )}
                  <div className="reset-actions">
                    <button type="button" className="btn btn-ink" onClick={confirmReset} disabled={busy}>
                      Accept
                    </button>
                    <button type="button" className="btn" onClick={() => setAskReset(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </form>
            {who === 'parent' && (
              <details className="parent-help">
                <summary>Signing in for the first time?</summary>
                <p>
                  When the school registers your mobile number, you get a text with your password. Sign in with that mobile number and the password.
                  No text, or forgot it? Type your number and press "Forgot password?". If you gave the school your Gmail, you can also use
                  "Sign in with Google".
                </p>
              </details>
            )}
            {who === 'staff' && (
              <p className="muted small">
                New teacher? The school admin adds your email first. Then sign in with Google (Gmail), or with the password texted to your mobile
                number or given by the admin.
              </p>
            )}
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
                      setWhoState('staff');
                      setError(null);
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
                <Link className="demo-acc" to="/parent">
                  <strong>Parent portal (sample parent)</strong>
                  <span>See what a parent sees, no sign-in needed</span>
                </Link>
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
// badge: 'alerts' = unread alerts count, 'watch' = children at the streak limit (red), 'messages' = unread conversations.
// ---------------------------------------------------------------------
const TEACHER_NAV = [
  { to: '/', label: 'Dashboard', Icon: LayoutGrid, end: true },
  { to: '/classes', label: 'My Classes', Icon: Users },
  { to: '/attendance', label: 'Attendance', Icon: ClipboardCheck },
  { to: '/absences', label: 'Absence Watch', Icon: UserX, badge: 'watch' },
  { to: '/calendar', label: 'Calendar', Icon: CalendarDays },
  { to: '/notifications', label: 'Alerts', Icon: Bell, badge: 'alerts' },
  { to: '/messages', label: 'Messages', Icon: MessagesSquare, badge: 'messages' },
  { to: '/excuses', label: 'Excuse requests', Icon: FileText, badge: 'excuses' },
  { to: '/sms', label: 'SMS Messages', Icon: MessageSquareText },
  { to: '/reports', label: 'Reports', Icon: FileSpreadsheet },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];
// Pages whose list the top bar's search filters in place (path without /admin) -> the placeholder.
const SEARCH_HERE = {
  '/absences': 'Search a student, class or parent',
  '/excuses': 'Search a student, class or reason',
  '/sms': 'Search a student, number or text',
};
const ADMIN_NAV = [
  { to: '/admin', label: 'Overview', Icon: LayoutGrid, end: true },
  { to: '/admin/absences', label: 'Absence Watch', Icon: UserX, badge: 'watch' },
  // The same Attendance page as teachers, with every class: for a day when a teacher is absent.
  { to: '/admin/attendance', label: 'Attendance', Icon: ClipboardCheck },
  { to: '/admin/messages', label: 'Messages', Icon: MessagesSquare, badge: 'messages' },
  { to: '/admin/excuses', label: 'Excuse requests', Icon: FileText, badge: 'excuses' },
  { to: '/admin/calendar', label: 'School Calendar', Icon: CalendarDays },
  { to: '/admin/sections', label: 'Sections', Icon: Shapes },
  { to: '/admin/teachers', label: 'Teachers', Icon: GraduationCap },
  { to: '/admin/students', label: 'Students', Icon: Users },
  { to: '/admin/cards', label: 'ID Cards', Icon: QrCode },
  { to: '/admin/sms', label: 'SMS Messages', Icon: MessageSquareText },
  { to: '/admin/reports', label: 'Reports', Icon: FileSpreadsheet },
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
  const [params, setParams] = useSearchParams();
  const menuRef = useRef(null);
  const { data: session, loading } = useLive((r) => r.getSession());
  const { data: counts } = useLive(async (r) => {
    const s = await r.getSession();
    if (!s) return { alerts: 0, watch: 0, excuses: 0, messages: 0 };
    const alerts = (await r.listNotifications()).filter((n) => !n.read).length;
    // Red badge on Absence Watch: children at the streak limit (the teacher sees only their own classes).
    const watch = (await r.listAttention((await r.getSettings()).streakDays)).length;
    // Excuse requests from parents that nobody has answered yet.
    const excuses = (await r.listExcuses()).filter((x) => x.status === 'pending').length;
    // Conversations with a message not read yet.
    const messages = await r.unreadMessageCount();
    return { alerts, watch, excuses, messages };
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
  const searchHere = SEARCH_HERE[location.pathname.replace(/^\/admin/, '') || '/'];
  const searchGlobal = location.pathname === '/admin' || location.pathname === '/';
  const needsSection = !isAdmin && !session.sectionIds.length && !['/calendar', '/settings', '/sms', '/messages'].includes(location.pathname);
  return (
    <div className="canvas">
      <div className="frame">
        <aside className={`sidebar ${navOpen ? 'sidebar-open' : ''}`}>
          <div className="brand">
            <Logo />
            <Wordmark height={21} />
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
            {/* The search box: on Absence Watch, Excuse requests and SMS Messages it filters that page as you
                type; on the overview it opens the student list; other pages have their own search or none. */}
            {searchHere ? (
              <form className="search" role="search" onSubmit={(e) => e.preventDefault()}>
                <Search size={17} aria-hidden="true" />
                <input
                  value={params.get('q') ?? ''}
                  onChange={(e) => {
                    const p = new URLSearchParams(params);
                    if (e.target.value) p.set('q', e.target.value);
                    else p.delete('q');
                    setParams(p, { replace: true });
                  }}
                  placeholder={searchHere}
                  aria-label={searchHere}
                />
              </form>
            ) : searchGlobal ? (
              <form
                className="search"
                role="search"
                onSubmit={(e) => {
                  e.preventDefault();
                  navigate(`${isAdmin ? '/admin/students' : '/classes'}?q=${encodeURIComponent(q)}`);
                }}
              >
                <Search size={17} aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students" aria-label="Search students" />
              </form>
            ) : null}
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
            <TodayNotice />
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
// Old /students?q=... links -> /classes?q=... (same search).
function StudentsRedirect() {
  const loc = useLocation();
  return <Navigate to={`/classes${loc.search}`} replace />;
}
// <RepoProvider> gives every page the engine; <Routes> maps each address to a screen.
// basename: on GitHub Pages the site lives under /Doorbell-ph/ (set in vite.config.js).
// ---------------------------------------------------------------------
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <RepoProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Routes>
          <Route path="login" element={<Login />} />
          <Route path="parent" element={<ParentPortal />} />
          <Route element={<Shell />}>
            <Route index element={<Dashboard />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="classes" element={<MyClasses />} />
            {/* "My Students" became part of My Classes (old links keep working). */}
            <Route path="students" element={<StudentsRedirect />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="absences" element={<AbsenceWatch />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="sms" element={<SmsMessages />} />
            <Route path="reports" element={<Reports />} />
            <Route path="excuses" element={<ExcuseRequests />} />
            <Route path="messages" element={<Messages />} />
            <Route path="admin/messages" element={<Messages />} />
            <Route path="admin/excuses" element={<ExcuseRequests />} />
            <Route path="admin/sms" element={<SmsMessages />} />
            <Route path="admin/reports" element={<Reports />} />
            <Route path="admin/absences" element={<AbsenceWatch />} />
            <Route path="admin/attendance" element={<Attendance />} />
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
