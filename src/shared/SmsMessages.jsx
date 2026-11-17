import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import {
  CalendarDays,
  RotateCw,
  MessageSquareText,
  Smartphone,
  ArrowDownUp,
  X,
  Megaphone,
} from 'lucide-react';
import { displayPhMobile, manilaToday, smsSegments } from '../logic';
import { ParentNoticeWindow } from './ParentNotice';
import {
  useLive,
  useRepo,
  Card,
  Empty,
  Skeleton,
  LevelChips,
  countByGrade,
  Toast,
  useSearchQuery,
  matchesQuery,
  SearchNote,
  SectionChips,
  countByKey,
} from '../ui';

// =====================================================================
// SMS MESSAGES (/sms for teachers, /admin/sms for the admin): every text to parents and
// whether it was sent, with Resend.
// Pattern: useLive(...) loads data from the engine and reloads on any change; while loading,
// <Skeleton> placeholders show; buttons call repo.something(...). Addresses are set in main.jsx.
// =====================================================================
// ---------------------------------------------------------------------
// SMS MESSAGES: every text sent to parents, grouped by day, with a phone-style preview.
// (Texts are simulated: they are saved, not really sent. See queueSms in engine.js.)
// ---------------------------------------------------------------------
// The filter chips at the top. k = the SMS kind ('failed' filters by status instead).
const KINDS = [
  { k: 'all', label: 'All' },
  { k: 'arrival', label: 'Arrived' },
  { k: 'late', label: 'Arrived late' },
  { k: 'streak', label: '3-day alerts' },
  { k: 'total', label: 'Totals' },
  { k: 'absent', label: 'Absent today' },
  { k: 'missing', label: 'Not in class' },
  { k: 'notice', label: 'School notices' },
  { k: 'departure', label: 'Left school' },
  { k: 'failed', label: 'Failed' },
  { k: 'test', label: 'Tests' },
];
// The day part of a text's time stamp: '2026-10-29T07:45:00+08:00' -> '2026-10-29'.
const dayOf = (m) => m.createdAt.slice(0, 10);
/** Every text Doorbell sent to parents, grouped by day, with a phone-style preview. */
export function SmsMessages() {
  const repo = useRepo();
  const [kind, setKind] = useState('all');
  const [level, setLevel] = useState('all');
  const [day, setDay] = useState(''); // '' = all days
  const q = useSearchQuery(); // the top bar's search
  const [secId, setSecId] = useState('all'); // one class of the chosen grade level, or all of them
  const [newestFirst, setNewestFirst] = useState(true);
  const [selected, setSelected] = useState(null);
  const [announce, setAnnounce] = useState(false); // the "Tell parents" window (admin): suspension or announcement
  const [note, setNote] = useState(null); // what was just sent
  const { data } = useLive(async (r) => ({
    session: await r.getSession(),
    sms: await r.listSms(1000),
    students: await r.listStudentRows().catch(() => []),
    sections: await r.listSections().catch(() => []),
  }));
  if (!data)
    return (
      <div className="page">
        <Skeleton h={400} />
      </div>
    );
  // Grade level of a text = the level of its class (texts with no class, like tests, show under All levels only).
  const gradeOf = new Map(data.sections.map((x) => [x.id, x.gradeLevel]));
  const nameOf = (id) => {
    const st = data.students.find((x) => x.student.id === id)?.student;
    return st ? `${st.firstName} ${st.lastName}` : '';
  };
  const byLevel = data.sms.filter(
    (m) =>
      (level === 'all' || gradeOf.get(m.sectionId) === level) &&
      (level === 'all' || secId === 'all' || m.sectionId === secId) &&
      matchesQuery(q, nameOf(m.studentId), m.to, m.body),
  );
  const byKind = byLevel.filter((m) => kind === 'all' || (kind === 'failed' ? m.status === 'failed' : m.kind === kind));
  const list = byKind
    .filter((m) => !day || dayOf(m) === day)
    .sort((a, b) => (newestFirst ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
  const groups = [];
  for (const m of list) {
    const d = dayOf(m);
    if (groups[groups.length - 1]?.date !== d) groups.push({ date: d, items: [] });
    groups[groups.length - 1].items.push(m);
  }
  const days = [...new Set(byKind.map(dayOf))].sort().reverse();
  const pick = list.find((m) => m.id === selected) ?? list[0];
  const name = (id) => {
    const s = data.students.find((x) => x.student.id === id)?.student;
    return s ? `${s.firstName} ${s.lastName}` : '';
  };
  const today = manilaToday();
  const dayTitle = (d) => (d === today ? `Today, ${format(parseISO(d), 'MMMM d')}` : format(parseISO(d), 'EEEE, MMMM d'));
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>SMS Messages</h1>
          <p className="page-sub">
            {repo.mode === 'demo' ? 'Demo: messages are simulated, nothing is actually sent' : 'Messages sent to parents and guardians'}
          </p>
          <SearchNote q={q} count={byLevel.length} />
        </div>
        <div className="head-actions">
          <label className="sort-pick">
            <CalendarDays size={16} />
            <select className="input" value={day} onChange={(e) => setDay(e.target.value)} aria-label="Day">
              <option value="">All days</option>
              {days.map((d) => (
                <option key={d} value={d}>
                  {dayTitle(d)} ({byKind.filter((m) => dayOf(m) === d).length})
                </option>
              ))}
            </select>
          </label>
          {day && (
            <button className="icon-btn sm" onClick={() => setDay('')} aria-label="Show all days">
              <X size={15} />
            </button>
          )}
          <button className="btn" onClick={() => setNewestFirst((v) => !v)}>
            <ArrowDownUp size={16} /> {newestFirst ? 'Newest day first' : 'Oldest day first'}
          </button>
          {/* The admin: suspension or announcement; a teacher: an announcement to their own classes. */}
          <button className="btn btn-ink" onClick={() => setAnnounce(true)}>
            <Megaphone size={16} /> {data.session?.role === 'admin' ? 'Suspension or announcement' : 'Send announcement'}
          </button>
        </div>
      </div>
      <LevelChips
        value={level}
        onChange={(v) => {
          setLevel(v);
          setSecId('all');
        }}
        counts={countByGrade(data.sms, (m) => gradeOf.get(m.sectionId))}
      />
      {/* A grade level picked: all its sections, or one of them. */}
      <SectionChips level={level} sections={data.sections} value={secId} onChange={setSecId} counts={countByKey(data.sms, (m) => m.sectionId)} />
      <div className="chips">
        {KINDS.map(({ k, label }) => (
          <button key={k} className={`fchip ${kind === k ? 'fchip-on' : ''}`} onClick={() => setKind(k)}>
            {label}
            <b className="count">
              {k === 'all' ? byLevel.length : byLevel.filter((m) => (k === 'failed' ? m.status === 'failed' : m.kind === k)).length}
            </b>
          </button>
        ))}
      </div>
      <div className="sms-layout">
        <Card>
          {list.length === 0 ? (
            <Empty title="No messages here" hint={day ? 'Try another day.' : undefined} />
          ) : (
            <div className="sms-list">
              {groups.map((g) => (
                <section key={g.date} className="sms-day">
                  <h3 className="sms-day-head">
                    <span>{dayTitle(g.date)}</span>
                    <b>
                      {g.items.length} {g.items.length === 1 ? 'text' : 'texts'}
                    </b>
                  </h3>
                  <ul>
                    {g.items.map((m) => (
                      <li key={m.id}>
                        <button
                          className={`sms-row ${pick?.id === m.id ? 'on' : ''} ${m.status === 'failed' ? 'bad' : ''}`}
                          onClick={() => setSelected(m.id)}
                        >
                          <span className={`kind kind-${m.kind}`}>{m.kind === 'streak' ? '3-day' : m.kind === 'notice' ? 'school notice' : m.kind === 'departure' ? 'left school' : m.kind}</span>
                          <span className="sms-to">
                            <strong>{name(m.studentId) || displayPhMobile(m.to)}</strong>
                            <span className="muted small">
                              {displayPhMobile(m.to)} · {format(new Date(m.createdAt), 'h:mm a')}
                            </span>
                          </span>
                          {/* queued/sending = waiting for the Cloudflare Worker (Semaphore) or the gate phone to send it */}
                          <span className={`tag ${m.status === 'failed' ? 'tag-bad' : m.status === 'queued' || m.status === 'sending' ? 'tag-warn' : 'tag-ok'}`}>
                            {m.status === 'failed' ? 'Failed' : m.status === 'queued' || m.status === 'sending' ? 'Sending' : 'Sent'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </Card>
        <div className="phone-col">
          <div className="phone">
            <div className="phone-notch" />
            <div className="phone-screen">
              {!pick ? (
                <p className="sim-empty">
                  <MessageSquareText size={20} /> No message selected
                </p>
              ) : (
                <>
                  <p className="phone-from">
                    <Smartphone size={14} /> {displayPhMobile(pick.to)}
                  </p>
                  <div className={`bubble ${pick.status === 'failed' ? 'bubble-failed' : ''}`}>
                    <p>{pick.body}</p>
                    <div className="bubble-meta">
                      <span>{format(new Date(pick.createdAt), 'MMM d, h:mm a')}</span>
                      <span>
                        {pick.body.length} chars · {smsSegments(pick.body)} SMS
                      </span>
                    </div>
                  </div>
                  {pick.status === 'failed' && pick.error && <p className="error small">Why it failed: {pick.error}</p>}
                  {pick.status === 'failed' && (
                    <button className="btn btn-sm" onClick={() => repo.resendSms(pick.id)}>
                      <RotateCw size={15} /> Resend
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {announce && (
        <ParentNoticeWindow
          start="announcement"
          onClose={() => setAnnounce(false)}
          onDone={(m) => {
            setAnnounce(false);
            setNote(m);
            setTimeout(() => setNote(null), 4000);
          }}
        />
      )}
      <Toast message={note} />
    </div>
  );
}
