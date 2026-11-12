import {
  RefreshCw,
  Trash2,
  Plus,
  QrCode,
  Save,
  Send,
} from 'lucide-react';
import {
  useLive,
  Card,
  Skeleton,
  useRepo,
  Toast,
} from '../ui';
import { useState, useEffect } from 'react';
import {
  normalizePhMobile,
  describeStreak,
  describeTotal,
  DEFAULT_LIMITS,
  renderTemplate,
  smsSegments,
  isGsmPlain,
} from '../logic';
import { TEMPLATE_KINDS } from '../engine';

// What each parent text is for (shown above each message).
const KIND_LABELS = {
  arrival: 'In class (teacher confirmed)',
  late: 'Late, in class (teacher confirmed)',
  arrivalAuto: 'Arrived (auto-confirmed, no teacher check)',
  lateAuto: 'Late (auto-confirmed or after confirming)',
  streak: '3-day alert',
  total: 'Monthly / semester total',
  missing: 'In school but not in class (if on for the section)',
};

// =====================================================================
// SETTINGS & SMS (/admin/settings): school details, how texts are sent, message templates
// and the gate phone account.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// SETTINGS & SMS: school name and contact number, arrival texts on/off, streak days,
// the parent text templates (English and Filipino) with a live preview, and a test SMS.
// ---------------------------------------------------------------------
export function AdminSettings() {
  const repo = useRepo();
  const { data } = useLive((r) => r.getSettings());
  const [s, setS] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (data && !s) setS(structuredClone(data));
  }, [data, s]);
  if (!s)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  const flash = (m) => {
    setToast(m);
    setTimeout(() => setToast(null), 2600);
  };
  const varsFor = (lang) => ({
    child: 'Juan',
    time: '7:42 AM',
    school: s.schoolName,
    contact: s.contactNumber,
    streak: describeStreak({ count: 3, absent: 3, late: 0 }, lang),
    summary: describeTotal('absentMonth', 5, lang),
  });
  const setTpl = (lang, k, v) => setS({ ...s, templates: { ...s.templates, [lang]: { ...s.templates[lang], [k]: v } } });
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings &amp; SMS</h1>
          <p className="page-sub">School-wide</p>
        </div>
        <button
          className="btn btn-ink"
          onClick={async () => {
            await repo.updateSettings(s);
            flash('Settings saved');
          }}
        >
          <Save size={17} /> Save changes
        </button>
      </div>
      <div className="grid-2">
        <Card title="School">
          <label className="field">
            <span>School name (appears in every SMS)</span>
            <input className="input" value={s.schoolName} onChange={(e) => setS({ ...s, schoolName: e.target.value })} />
          </label>
          <label className="field">
            <span>Contact number for parents</span>
            <input className="input" value={s.contactNumber} onChange={(e) => setS({ ...s, contactNumber: e.target.value })} />
          </label>
        </Card>
        <Card title="When parents get a text">
          <label className="check">
            <input type="checkbox" checked={s.arrivalSmsEnabled} onChange={(e) => setS({ ...s, arrivalSmsEnabled: e.target.checked })} /> Text parents
            when their child arrives (and when late)
          </label>
          <label className="field">
            <span>Text parents after this many school days absent in a row</span>
            <input
              type="number"
              className="input"
              min={2}
              max={10}
              value={s.streakDays}
              onChange={(e) => setS({ ...s, streakDays: Number(e.target.value) })}
            />
          </label>
          <div className="form-row">
            <label className="field">
              <span>Send a test SMS to</span>
              <input className="input" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="0917 123 4567" />
            </label>
            <button
              className="btn align-end"
              onClick={async () => {
                const n = normalizePhMobile(testTo);
                if (!n) return flash('Enter a valid mobile number');
                await repo.sendTestSms(n);
                flash(s.smsProvider === 'simulated' || !s.smsProvider ? 'Test SMS saved (simulated, see SMS Messages)' : 'Test SMS queued: check the phone and the SMS Messages page');
              }}
            >
              <Send size={16} /> Send test
            </button>
          </div>
          <p className="muted small">
            {repo.mode === 'demo' ? (
              <>Demo mode: texts are simulated.</>
            ) : s.smsProvider === 'semaphore' ? (
              <>Real texts: the free Cloudflare Worker sends each one through Semaphore within a minute (see worker/README.md). Save changes, then send a test.</>
            ) : s.smsProvider === 'phone' ? (
              <>Real texts from the gate phone's SIM. Save changes, open Doorbell Gate on the phone, then send a test.</>
            ) : (
              <>Simulated: texts are only recorded in the SMS Messages page. Choose Semaphore below for real texts.</>
            )}
          </p>
        </Card>
        <Card title="How texts are sent">
          <label className="field">
            <span>SMS service</span>
            <select className="input" value={s.smsProvider ?? 'simulated'} onChange={(e) => setS({ ...s, smsProvider: e.target.value })}>
              <option value="simulated">Simulated (for demos: nothing is sent)</option>
              <option value="phone">Gate phone's SIM (the Doorbell Gate app sends them)</option>
              <option value="semaphore">Semaphore (real SMS with a sender name, sent by the Cloudflare Worker)</option>
            </select>
          </label>
          {s.smsProvider === 'phone' && (
            <p className="hint">
              Texts go out from the gate phone's own number while the Doorbell Gate app is open. Keep load on that SIM (an unlimited-texts promo
              is cheapest). If the app is closed, texts wait and go out when it opens; texts older than 12 hours are not sent (press Resend).
            </p>
          )}
          {s.smsProvider === 'semaphore' && (
          <label className="field">
            <span>Sender name (as approved in Semaphore; leave empty for your account's default)</span>
            <input
              className="input"
              value={s.senderName ?? ''}
              maxLength={11}
              placeholder="e.g. SUNNYSIDE"
              onChange={(e) => setS({ ...s, senderName: e.target.value.trim() })}
            />
          </label>
          )}
          {s.smsProvider === 'semaphore' && (
            <p className="muted small">
              Semaphore needs the free Cloudflare Worker set up once (worker/README.md; the API key is saved in Cloudflare, never here). Until then, texts stay "Sending".
            </p>
          )}
        </Card>
      </div>
      <LimitsCard s={s} setS={setS} />
      <Card title="Message templates">
        <p className="muted small">
          Parents are texted when the teacher confirms the class, not at the gate scan, so "in class" is only said once the teacher has
          seen the child. If nobody confirms, the auto-confirm text only says "arrived at school". Variables: {'{child}'} first name, {'{time}'}, {'{school}'}, {'{contact}'}, and in the 3-day alert {'{streak}'}, which becomes the exact
          pattern, e.g. "absent for 3 school days in a row" (only absences count; a late day ends it). Keep each under 160 plain characters (no emoji or curly
          quotes) so it costs one SMS.
        </p>
        <div className="templates">
          {['en', 'fil'].map((lang) => (
            <div key={lang}>
              <h3>{lang === 'en' ? 'English' : 'Filipino'}</h3>
              {TEMPLATE_KINDS.map((k) => {
                const preview = renderTemplate(s.templates[lang][k], varsFor(lang));
                const plain = isGsmPlain(preview);
                return (
                  <label key={k} className="tpl">
                    <span className={`kind kind-${k.replace('Auto', '')}`}>{KIND_LABELS[k]}</span>
                    <textarea rows={3} value={s.templates[lang][k]} onChange={(e) => setTpl(lang, k, e.target.value)} />
                    <span className="muted small">Preview: {preview}</span>
                    <span className={`small ${preview.length > 160 || !plain ? 'over' : 'muted'}`}>
                      {preview.length}/160 · {smsSegments(preview)} SMS{!plain ? ' · special characters make it cost more' : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </Card>
      <GateAccountCard flash={flash} />
      <ParentPortalCard flash={flash} />
      <Toast message={toast} />
    </div>
  );
}

// The account the gate phone signs in with (Doorbell Gate app, see gate-app/README.md).
// Children scan their ID at the school gate; the teacher still confirms attendance in the classroom.
function GateAccountCard({ flash }) {
  const repo = useRepo();
  const { data: accounts } = useLive((r) => r.gateAccounts());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const create = async (e) => {
    e.preventDefault(); // stop the page from reloading
    setError('');
    setBusy(true);
    try {
      await repo.createGateAccount(email, password);
      flash('Gate account created. Sign in with it on the gate phone.');
      setEmail('');
      setPassword('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Gate scanner phone">
      <p className="muted small">
        Children scan their ID card on a phone at the school gate (the Doorbell Gate app). Parents get the arrival text right away, and each teacher
        confirms attendance once the class is inside. The phone signs in with this account; it cannot open this website.
      </p>
      {accounts?.length ? (
        <ul className="cal-list">
          {accounts.map((a) => (
            <li key={a.uid}>
              <QrCode size={16} aria-hidden="true" />
              <span>{a.email}</span>
              <button
                className="btn btn-sm"
                onClick={async () => {
                  await repo.removeGateAccount(a.uid);
                  flash('Gate account removed. That phone can no longer scan.');
                }}
              >
                <Trash2 size={15} /> Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="form-row" onSubmit={create}>
        <label className="field">
          <span>Email for the gate phone</span>
          <input className="input" type="email" placeholder="gate@yourschool.edu.ph" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password (at least 8 characters)</span>
          <input className="input" type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <button className="btn btn-ink align-end" disabled={busy || !email || !password}>
          <Plus size={17} /> Create gate account
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </Card>
  );
}

// ---------------------------------------------------------------------
// PARENT PORTAL: what parents use to sign in, the "Update parent portal" button (rebuilds every
// parent's key and every month; also needed once after "Load sample school"), and how to reset
// a parent's password.
// ---------------------------------------------------------------------
function ParentPortalCard({ flash }) {
  const repo = useRepo();
  const { data: missing } = useLive(async (r) => r.parentsWithoutPassword());
  const [busy, setBusy] = useState(false);
  const url = `${window.location.origin}${import.meta.env.BASE_URL}parent`;
  return (
    <Card title="Parent portal">
      <p className="muted small">
        Parents open <a href={url}>{url.replace(/^https?:\/\//, '')}</a> and sign in with the mobile number on file. The default password is the
        child's initials (first, middle, last) and birthday as MMDDYY, e.g. Alice Pati Garcia, born Aug 13, 2021 = <code>apg081321</code> (the eldest
        child's, for siblings). Parents are reminded to change it, but are not forced to. Announce the portal at the parent orientation: Doorbell
        texts never contain links.
      </p>
      <button
        className="btn"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const res = await repo.syncParentPortal();
            flash(`Parent portal updated: ${res.parents} parents, ${res.months} months.`);
          } finally {
            setBusy(false);
          }
        }}
      >
        <RefreshCw size={16} aria-hidden="true" /> {busy ? 'Updating…' : 'Update parent portal'}
      </button>
      <p className="muted small">Press this once after loading the sample school or adding many students. Normal changes update the portal by themselves.</p>
      {missing?.length > 0 && (
        <p className="error small">
          {missing.length} parent{missing.length > 1 ? 's' : ''} cannot sign in yet because no child has a birthday on file:{' '}
          {missing
            .slice(0, 5)
            .map((g) => g.name)
            .join(', ')}
          {missing.length > 5 ? '…' : ''}. Add the birthday in Students.
        </p>
      )}
      <p className="muted small">
        <b>Forgot password:</b> open Firebase console → Authentication → Users, search the parent's number (e.g. p09171234567), and delete that
        user. The parent can then sign in again with the default password.
      </p>
    </Card>
  );
}

// Attendance limits that are NOT in a row: per month and per semester (see DEFAULT_LIMITS in logic.js).
// watch = shows in Absence Watch, alert = the parent is texted, serious = parent conference.
const LIMIT_ROWS = [
  ['absentMonth', 'Absences in a month', ['watch', 'alert']],
  ['absentSemester', 'Absences in a semester', ['watch', 'alert', 'serious']],
  ['lateMonth', 'Lates in a month', ['watch', 'alert']],
  ['lateSemester', 'Lates in a semester', ['alert', 'serious']],
];
const LEVEL_WORD = { watch: 'Watch', alert: 'Text parent', serious: 'Conference' };
function LimitsCard({ s, setS }) {
  const lim = (k) => ({ ...DEFAULT_LIMITS[k], ...(s.limits?.[k] ?? {}) });
  const set = (k, level, v) => setS({ ...s, limits: { ...s.limits, [k]: { ...lim(k), [level]: Number(v) } } });
  return (
    <Card title="Attendance limits (not in a row)">
      <p className="muted small">
        Totals for the month and the semester. Watch shows the child in Absence Watch (excused days count here), Text parent sends one SMS per
        period, Conference tells the teacher and admin to meet the parent. DepEd may drop a learner absent more than 20% of school days.
      </p>
      <div className="limits">
        {LIMIT_ROWS.map(([k, label, levels]) => (
          <div key={k} className="limit-row">
            <span>{label}</span>
            {levels.map((level) => (
              <label key={level} className="field">
                <span className="small muted">{LEVEL_WORD[level]}</span>
                <input type="number" className="input" min={1} max={60} value={lim(k)[level]} onChange={(e) => set(k, level, e.target.value)} />
              </label>
            ))}
          </div>
        ))}
      </div>
      <label className="field">
        <span>Second semester starts (empty = halfway through the school year)</span>
        <input type="date" className="input" value={s.semester2Start ?? ''} onChange={(e) => setS({ ...s, semester2Start: e.target.value })} />
      </label>
    </Card>
  );
}
