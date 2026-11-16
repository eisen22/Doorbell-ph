import {
  ShieldCheck,
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
  Modal,
  DatePicker,
} from '../ui';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  laterPeriod: 'Arrived in a later period (confirmed by a subject teacher)',
  absent: 'Absent today (sent at the end of first period)',
  streak: '3-day alert',
  total: 'Monthly / semester total',
  missing: 'Scanned at the gate but not in class',
  departure: 'Left school (scanned out at the gate)',
  pickedUp: 'Picked up (marked by the school, e.g. no ID card)',
};

// The tabs of the Settings page.
const SETTINGS_TABS = [
  ['school', 'School & attendance'],
  ['texts', 'Texts to parents'],
  ['templates', 'Message templates'],
  ['accounts', 'Admins & gate phone'],
  ['portal', 'Parent portal'],
];

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
  // Which tab is open: ?tab= in the address, so a link can open one (e.g. ?tab=templates).
  const [params, setParams] = useSearchParams();
  const tab = SETTINGS_TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'school';
  const setTab = (k) => setParams(k === 'school' ? {} : { tab: k }, { replace: true });
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
    period: lang === 'fil' ? 'ika-2 na period' : '2nd period',
  });
  const setTpl = (lang, k, v) => setS({ ...s, templates: { ...s.templates, [lang]: { ...s.templates[lang], [k]: v } } });
  const dirty = JSON.stringify(s) !== JSON.stringify(data);
  const save = async () => {
    await repo.updateSettings(s);
    flash('Settings saved');
  };
  // Tabs that edit the settings above share one Save button; Accounts and Parent portal save by themselves.
  const editsSettings = ['school', 'texts', 'templates'].includes(tab);
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">For the whole school</p>
        </div>
        {editsSettings && (
          <button className="btn btn-ink" onClick={save} disabled={!dirty}>
            <Save size={17} /> {dirty ? 'Save changes' : 'Saved'}
          </button>
        )}
      </div>
      <div className="settings-tabs" role="tablist" aria-label="Settings">
        {SETTINGS_TABS.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'school' && (
        <>
          <Card title="School">
            <div className="settings-grid">
              <label className="field">
                <span>School name (appears in every SMS)</span>
                <input className="input" value={s.schoolName} onChange={(e) => setS({ ...s, schoolName: e.target.value })} />
              </label>
              <label className="field">
                <span>Contact number for parents ({'{contact}'} in the texts)</span>
                <input className="input" value={s.contactNumber} onChange={(e) => setS({ ...s, contactNumber: e.target.value })} />
              </label>
              <label className="field">
                <span>School gate opens (scanning starts)</span>
                <input type="time" className="input" value={s.gateOpens ?? '06:00'} onChange={(e) => setS({ ...s, gateOpens: e.target.value || '06:00' })} />
              </label>
              <label className="field">
                <span>First period length (minutes)</span>
                <input
                  type="number"
                  min={20}
                  max={180}
                  className="input"
                  value={s.firstPeriodMins ?? 60}
                  onChange={(e) => setS({ ...s, firstPeriodMins: Number(e.target.value) || 60 })}
                />
              </label>
            </div>
            <p className="muted small">
              The same for every class. DepEd sets no national gate time, so each school sets its own. Absence texts go out when the first period
              ends (class start + this length), for example 8:30 AM for a 7:30 AM class with a 60-minute first period.
            </p>
          </Card>
          <LimitsCard s={s} setS={setS} />
        </>
      )}

      {tab === 'texts' && (
        <>
          <Card title="When parents get a text">
            <div className="check-list">
              <label className="check">
                <input type="checkbox" checked={s.arrivalSmsEnabled} onChange={(e) => setS({ ...s, arrivalSmsEnabled: e.target.checked })} /> When the
                teacher confirms their child is in class (and when late)
              </label>
              <label className="check">
                <input type="checkbox" checked={s.absentSmsEnabled !== false} onChange={(e) => setS({ ...s, absentSmsEnabled: e.target.checked })} /> On the
                day their child is absent (at the end of first period, only for classes a teacher confirmed)
              </label>
              <label className="check">
                <input type="checkbox" checked={s.departureSmsEnabled !== false} onChange={(e) => setS({ ...s, departureSmsEnabled: e.target.checked })} />{' '}
                When their child leaves school (scanned out at the gate, or marked picked up)
              </label>
            </div>
            <label className="field narrow-field">
              <span>3-day alert: text parents after this many school days absent in a row</span>
              <input type="number" className="input" min={2} max={10} value={s.streakDays} onChange={(e) => setS({ ...s, streakDays: Number(e.target.value) })} />
            </label>
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
              <>
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
                <p className="muted small">
                  Semaphore needs the free Cloudflare Worker set up once (worker/README.md; the API key is saved in Cloudflare, never here). Until
                  then, texts stay "Sending".
                </p>
              </>
            )}
            <div className="form-row test-row">
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
                <>Real texts: the free Cloudflare Worker sends each one through Semaphore within a minute. Save changes, then send a test.</>
              ) : s.smsProvider === 'phone' ? (
                <>Real texts from the gate phone's SIM. Save changes, open Doorbell Gate on the phone, then send a test.</>
              ) : (
                <>Simulated: texts are only recorded in the SMS Messages page. Choose Semaphore for real texts.</>
              )}
            </p>
          </Card>
        </>
      )}

      {tab === 'templates' && (
        <Card title="Message templates">
          <p className="muted small">
            Fill-ins: {'{child}'} first name, {'{time}'}, {'{school}'}, {'{contact}'}, {'{period}'}, and in the alerts {'{streak}'} or {'{summary}'}, e.g.
            "absent for 3 school days in a row". Keep each under 160 plain characters (no emoji or curly quotes) so it costs one SMS. Families who
            chose Filipino get the Filipino text.
          </p>
          <div className="tpl-head" aria-hidden="true">
            <span>English</span>
            <span>Filipino</span>
          </div>
          {TEMPLATE_KINDS.map((k) => (
            <section key={k} className="tpl-row">
              <span className={`kind kind-${k === 'laterPeriod' ? 'late' : k === 'absent' ? 'streak' : k === 'pickedUp' ? 'departure' : k}`}>{KIND_LABELS[k]}</span>
              <div className="tpl-pair">
                {['en', 'fil'].map((lang) => {
                  const preview = renderTemplate(s.templates[lang][k], varsFor(lang));
                  const plain = isGsmPlain(preview);
                  return (
                    <label key={lang} className="tpl">
                      <span className="sr-only">{lang === 'en' ? 'English' : 'Filipino'}</span>
                      <textarea className="input" rows={3} value={s.templates[lang][k]} onChange={(e) => setTpl(lang, k, e.target.value)} />
                      <span className="muted small">{preview}</span>
                      <span className={`small ${preview.length > 160 || !plain ? 'over' : 'muted'}`}>
                        {preview.length}/160 · {smsSegments(preview)} SMS{!plain ? ' · special characters make it cost more' : ''}
                      </span>
                    </label>
                  );
                })}
              </div>
            </section>
          ))}
        </Card>
      )}

      {tab === 'accounts' && (
        <>
          <AdminsCard flash={flash} />
          <GateAccountCard flash={flash} />
        </>
      )}

      {tab === 'portal' && (
        <>
          <ParentPortalCard flash={flash} />
          {repo.clearSchoolData && <StartOverCard />}
        </>
      )}
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
// ADMINS: list the school's admins, add one (a sign-in account with a temporary password),
// remove one. You cannot remove yourself or the last admin.
// ---------------------------------------------------------------------
function AdminsCard({ flash }) {
  const repo = useRepo();
  const { data } = useLive(async (r) => ({ list: r.admins(), me: (await r.getSession())?.uid }));
  const admins = data?.list;
  const me = data?.me;
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const add = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await repo.addAdmin({ name, email });
      setCreated({ name: res.account.name, email: res.account.email, password: res.tempPassword });
      setName('');
      setEmail('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    const a = confirm;
    setConfirm(null);
    try {
      await repo.removeAdmin(a.uid);
      flash(`${a.name} is no longer an admin.`);
    } catch (err) {
      setError(err.message);
    }
  };
  const many = (admins?.length ?? 0) > 1;
  return (
    <Card title="Admins">
      <p className="muted small">
        Admins can do everything on this website. Add another admin (for example the principal or the school clerk) so the school is not stuck if one
        person is away. You cannot remove yourself or the last admin.
      </p>
      {admins?.length ? (
        <ul className="cal-list">
          {admins.map((a) => (
            <li key={a.uid}>
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                <b>{a.name}</b> · {a.email}
                {a.uid === me ? ' (you)' : ''}
              </span>
              {a.uid !== me && many && (
                <button className="btn btn-sm" onClick={() => setConfirm(a)}>
                  <Trash2 size={15} aria-hidden="true" /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <form className="form-row" onSubmit={add}>
        <label className="field">
          <span>Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ma. Teresa Cruz" />
        </label>
        <label className="field">
          <span>Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="principal@yourschool.edu.ph" />
        </label>
        <button className="btn btn-ink align-end" disabled={busy || !name.trim() || !email.trim()}>
          <Plus size={17} aria-hidden="true" /> {busy ? 'Adding…' : 'Add admin'}
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {created && (
        <Modal
          title="Admin added"
          onClose={() => setCreated(null)}
          footer={
            <button className="btn btn-ink" onClick={() => setCreated(null)}>
              Done
            </button>
          }
        >
          <p>
            Give these to <b>{created.name}</b> privately. They can change it with "Forgot password?" on the sign-in page, which emails
            them a reset link.
          </p>
          <dl className="dl cred">
            <dt>Email</dt>
            <dd>{created.email}</dd>
            <dt>Temporary password</dt>
            <dd>
              <code>{created.password}</code>
            </dd>
          </dl>
          <p className="muted small">This password is shown only once.</p>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={`Remove ${confirm.name} as admin?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={remove}>
                Remove admin
              </button>
            </>
          }
        >
          <p>
            {confirm.name} ({confirm.email}) will no longer be able to open the website. Their past changes stay in the Audit Log.
          </p>
        </Modal>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------
// START OVER: removes all school data (to load the new sample school, or to start the real school
// year with an empty database). Kept: admin and gate accounts, settings, calendar and audit log.
// ---------------------------------------------------------------------
function StartOverCard() {
  const repo = useRepo();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  return (
    <Card title="Start over">
      <p className="muted small">
        Removes all sections, teachers, students, guardians, attendance, texts, alerts and parent portal data. Kept: admin accounts, the gate
        account, these settings, the calendar and the audit log. Use it to load the new sample school (Overview, then "Load sample school") or
        before the real school year starts.
      </p>
      <button className="btn btn-danger" onClick={() => setOpen(true)}>
        <Trash2 size={16} aria-hidden="true" /> Remove all school data
      </button>
      {open && (
        <Modal
          title="Remove all school data?"
          onClose={() => !status && setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)} disabled={!!status}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={typed !== 'DELETE' || !!status}
                onClick={async () => {
                  setError('');
                  try {
                    const n = await repo.clearSchoolData((m) => setStatus(m));
                    setStatus(`Done: ${n} documents removed. Go to Overview to load the sample school.`);
                  } catch (e) {
                    setError(e.message);
                    setStatus(null);
                  }
                }}
              >
                Remove everything
              </button>
            </>
          }
        >
          <p>This cannot be undone. Teachers will no longer be able to sign in, and parents will lose access to the parent portal.</p>
          <label className="field">
            <span>Type DELETE to confirm</span>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </label>
          {status && <p className="muted">{status}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
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
      <div className="table-wrap">
        <table className="limits-table">
          <thead>
            <tr>
              <th />
              {['watch', 'alert', 'serious'].map((level) => (
                <th key={level}>{LEVEL_WORD[level]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LIMIT_ROWS.map(([k, label, levels]) => (
              <tr key={k}>
                <th scope="row">{label}</th>
                {['watch', 'alert', 'serious'].map((level) => (
                  <td key={level}>
                    {levels.includes(level) ? (
                      <input
                        type="number"
                        className="input"
                        min={1}
                        max={60}
                        value={lim(k)[level]}
                        onChange={(e) => set(k, level, e.target.value)}
                        aria-label={`${label}: ${LEVEL_WORD[level]}`}
                      />
                    ) : (
                      <span className="muted" aria-label="not used">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="field">
        <span>Second semester starts (empty = halfway through the school year)</span>
      </div>
      <div className="form-row sem-row">
        <DatePicker value={s.semester2Start ?? ''} onChange={(d) => setS({ ...s, semester2Start: d })} placeholder="Halfway through the school year" ariaLabel="Second semester starts" />
        {s.semester2Start && (
          <button className="btn" onClick={() => setS({ ...s, semester2Start: '' })}>
            Use halfway
          </button>
        )}
      </div>
    </Card>
  );
}
