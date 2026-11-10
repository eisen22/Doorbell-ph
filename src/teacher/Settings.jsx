import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import {
  autoFinalizeTime,
  describeStreak,
  fromMinutes,
  to12h,
  toMinutes,
  smsSegments,
  renderTemplate,
} from '../logic';
import { useLive, useRepo, Card, Skeleton } from '../ui';

// =====================================================================
// SETTINGS (/settings): my account and password, my class schedule, and the texts parents receive.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// SETTINGS: account details, password reset, each class's schedule, and previews of the parent texts.
// Schedules and texts are changed by the admin.
// ---------------------------------------------------------------------
export function SettingsPage() {
  const repo = useRepo();
  const [msg, setMsg] = useState(null);
  const { data } = useLive(async (r) => {
    const session = await r.getSession();
    const classes = await Promise.all(session.sectionIds.map((id) => r.getSection(id)));
    return { session, settings: await r.getSettings(), classes };
  });
  if (!data)
    return (
      <div className="page">
        <Skeleton h={300} />
      </div>
    );
  const { session, settings, classes } = data;
  const sample = { count: 3, absent: 2, late: 1 };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="page-sub">Your account and class rules</p>
        </div>
      </div>
      <div className="grid-2">
        <Card title="Account">
          <dl className="dl">
            <dt>Name</dt>
            <dd>{session.name}</dd>
            <dt>Email</dt>
            <dd>{session.email}</dd>
            <dt>{classes.length > 1 ? 'Classes' : 'Class'}</dt>
            <dd>{classes.length ? classes.map((c) => c.name).join(', ') : 'Not assigned'}</dd>
          </dl>
          <button
            className="btn"
            onClick={async () => {
              try {
                await repo.sendPasswordReset(session.email);
                setMsg(`A password reset link was sent to ${session.email}.`);
              } catch (e) {
                setMsg(e.message);
              }
            }}
          >
            <KeyRound size={16} /> Change password
          </button>
          {msg && <p className="muted small">{msg}</p>}
        </Card>
        {classes.map(({ id, name, schedule: s }) => (
          <Card key={id} title={classes.length > 1 ? `${name} schedule (set by admin)` : 'Class schedule (set by admin)'}>
            <dl className="dl">
              <dt>Class time</dt>
              <dd>
                {to12h(s.startTime)} to {to12h(s.endTime)}
              </dd>
              <dt>Scanning opens</dt>
              <dd>{to12h(fromMinutes(toMinutes(s.startTime) - s.scanWindowMins))}</dd>
              <dt>Late after</dt>
              <dd>{to12h(fromMinutes(toMinutes(s.startTime) + s.lateCutoffMins))}</dd>
              <dt>Auto-confirm</dt>
              <dd>{to12h(autoFinalizeTime(s))}</dd>
              <dt>Parents texted after</dt>
              <dd>{settings.streakDays} school days absent or late in a row</dd>
              <dt>Arrival SMS</dt>
              <dd>{settings.arrivalSmsEnabled ? 'On' : 'Off'}</dd>
            </dl>
          </Card>
        ))}
      </div>
      <Card title="SMS messages parents receive">
        <div className="templates">
          {['en', 'fil'].map((lang) => (
            <div key={lang}>
              <h3>{lang === 'en' ? 'English' : 'Filipino'}</h3>
              {['arrival', 'late', 'streak'].map((k) => {
                const text = renderTemplate(settings.templates[lang][k], {
                  child: 'Juan',
                  time: '7:42 AM',
                  school: settings.schoolName,
                  contact: settings.contactNumber,
                  streak: describeStreak(sample, lang),
                });
                return (
                  <div key={k} className="tpl">
                    <span className={`kind kind-${k}`}>{k === 'streak' ? '3-day alert' : k}</span>
                    <p>{text}</p>
                    <span className={`muted small ${text.length > 160 ? 'over' : ''}`}>
                      {text.length}/160 · {smsSegments(text)} SMS
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <p className="muted small">
          The 3-day alert always says exactly what happened: absent, late, or both (for example "absent 2 days and late 1 day").
        </p>
      </Card>
    </div>
  );
}
