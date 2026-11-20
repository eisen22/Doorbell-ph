import { useEffect, useMemo, useRef, useState } from 'react';
import { AttachButton, PendingFiles, MessageFiles } from './Attachments';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, Eye, MessagesSquare, Plus, Search, Send, ShieldCheck, UserPlus, Users } from 'lucide-react';
import { useLive, useRepo, Modal, Skeleton, Toast, Empty } from '../ui';
import { OFFICE, MAX_MESSAGE, keyKind, inboxTime, messageTime } from '../messaging';

// =====================================================================
// MESSAGES (/messages for teachers, /admin/messages for the admin)
// A built-in messaging app shared by the three portals. One conversation can hold a parent, the child's
// teacher(s) and the school office at the same time (3-way): anyone on the staff side can "Add" the
// office or another teacher of the child's class. The admin answers as "School office".
// Parents use the same conversations from the parent portal (parent/ParentMessages.jsx).
// The rules and the documents: src/messaging.js, engine/messages.js, firestore.rules (MESSAGES).
// Links: ?t=<thread id> opens a conversation; ?student=<id> starts a new message to that child's parent.
// PRIVACY (like Canvas and ParentSquare, see engine/messages.js "OVERSIGHT"): a conversation is read by the
// people in it. The admin can review any other one only with a reason, and every review is in the audit log.
// Every Messages page says so (PRIVACY_NOTE).
// =====================================================================
export const PRIVACY_NOTE =
  'Messages are kept by the school and only the people in a conversation can read them. For child safety, the school admin may review a conversation; every review is recorded in the audit log.';
const KIND_LABEL = { parent: 'Parent', teacher: 'Teacher', office: 'Office' };
const avatarText = (name) =>
  name
    .replace(/\(.*?\)/g, '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export function Messages() {
  const [params, setParams] = useSearchParams();
  const selected = params.get('t');
  const [filter, setFilter] = useState('all'); // all | unread | parents | staff
  const [q, setQ] = useState('');
  const [composeFor, setComposeFor] = useState(params.get('student') ? { studentId: params.get('student') } : null);
  const { data: threads } = useLive((r) => r.listThreads());
  const { data: session } = useLive((r) => r.getSession());
  const view = params.get('view') === 'review' ? 'review' : 'inbox'; // the admin's "Review conversations"
  const setView = (v) => {
    const p = new URLSearchParams();
    if (v === 'review') p.set('view', 'review');
    setParams(p);
  };
  const open = (id) => {
    const p = new URLSearchParams(params);
    p.delete('student');
    if (id) p.set('t', id);
    else p.delete('t');
    setParams(p, { replace: !id });
  };
  if (!threads)
    return (
      <div className="page">
        <Skeleton h={420} />
      </div>
    );
  const isAdmin = session?.role === 'admin';
  const words = q.trim().toLowerCase();
  const list = threads.filter(
    (t) =>
      (filter === 'all' || (filter === 'unread' && t.unread) || (filter === 'parents' && t.withParent) || (filter === 'staff' && !t.withParent)) &&
      (!words || `${t.title} ${t.studentName} ${t.section?.name ?? ''} ${t.lastText}`.toLowerCase().includes(words)),
  );
  const unread = threads.filter((t) => t.unread).length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Messages</h1>
          <p className="page-sub">
            {isAdmin
              ? 'Messages to and from the school office. Talk with parents and teachers; add a teacher to a parent’s conversation to talk together.'
              : 'Talk with the parents of your classes, other teachers and the school office. Add the office to a parent’s conversation to talk together.'}
          </p>
        </div>
        {view === 'inbox' && (
          <button className="btn btn-ink" onClick={() => setComposeFor({})}>
            <Plus size={18} /> New message
          </button>
        )}
      </div>
      {isAdmin && (
        <div className="chips" role="tablist" aria-label="Messages view">
          <button role="tab" aria-selected={view === 'inbox'} className={`fchip ${view === 'inbox' ? 'fchip-on' : ''}`} onClick={() => setView('inbox')}>
            School office inbox
          </button>
          <button role="tab" aria-selected={view === 'review'} className={`fchip ${view === 'review' ? 'fchip-on' : ''}`} onClick={() => setView('review')}>
            <ShieldCheck size={15} /> Review conversations
          </button>
        </div>
      )}
      <p className="msg-privacy">
        <ShieldCheck size={15} aria-hidden="true" /> {PRIVACY_NOTE}
      </p>
      {view === 'review' && isAdmin ? (
        <ReviewConversations />
      ) : (
      <div className={`msg-layout ${selected ? 'msg-has-open' : ''}`}>
        <section className="card msg-list" aria-label="Conversations">
          <label className="msg-search">
            <Search size={16} aria-hidden="true" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a name, child or class" aria-label="Search conversations" />
          </label>
          <div className="chips">
            {[
              ['all', 'All', threads.length],
              ['unread', 'Unread', unread],
              ['parents', 'Parents', threads.filter((t) => t.withParent).length],
              ['staff', 'Staff', threads.filter((t) => !t.withParent).length],
            ].map(([k, label, n]) => (
              <button key={k} className={`fchip sm ${filter === k ? 'fchip-on' : ''}`} onClick={() => setFilter(k)}>
                {label} <span className="count">{n}</span>
              </button>
            ))}
          </div>
          {list.length ? (
            <ul className="msg-threads">
              {list.map((t) => (
                <li key={t.id}>
                  <button className={`msg-thread ${t.id === selected ? 'on' : ''} ${t.unread ? 'unread' : ''}`} onClick={() => open(t.id)}>
                    <span className={`msg-avatar ${t.withParent ? 'msg-av-parent' : t.members.includes(OFFICE) && !isAdmin ? 'msg-av-office' : 'msg-av-teacher'}`} aria-hidden="true">
                      {avatarText(t.title)}
                    </span>
                    <span className="msg-thread-text">
                      <span className="msg-thread-top">
                        <b>{t.title}</b>
                        <time>{inboxTime(t.lastAt)}</time>
                      </span>
                      {t.studentName && (
                        <span className="msg-about">
                          About {t.studentName}
                          {t.section ? ` · ${t.section.name}` : ''}
                        </span>
                      )}
                      <span className="msg-preview">
                        {t.lastFrom === (isAdmin ? OFFICE : `t:${session?.teacherId}`) ? 'You: ' : ''}
                        {t.lastText}
                      </span>
                    </span>
                    {t.unread && <span className="msg-dot" aria-label="New message" />}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty
              compact
              title={threads.length ? 'No conversation matches' : 'No messages yet'}
              hint={threads.length ? 'Try another search or filter.' : 'Press “New message” to write to a parent, a teacher or the school office.'}
            />
          )}
        </section>
        <section className="card msg-pane" aria-label="Conversation">
          {selected ? (
            <Conversation id={selected} onBack={() => open(null)} />
          ) : (
            <div className="msg-placeholder">
              <MessagesSquare size={40} strokeWidth={1.5} aria-hidden="true" />
              <p>Pick a conversation, or start a new one.</p>
            </div>
          )}
        </section>
      </div>
      )}
      {composeFor && (
        <NewMessage
          preset={composeFor}
          onClose={() => setComposeFor(null)}
          onStarted={(id) => {
            setComposeFor(null);
            open(id);
          }}
        />
      )}
    </div>
  );
}

// One conversation: the messages, who is in it, "Add" someone, and the reply box.
function Conversation({ id, onBack }) {
  const repo = useRepo();
  const { data } = useLive((r) => r.getThread(id), [id]);
  const loadFile = useMemo(() => (fid) => repo.fetchAttachment(fid), [repo]);
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]); // photos or PDFs to send with the next message
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState(null);
  const endRef = useRef(null);
  const count = data?.messages.length ?? 0;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [count, id]);
  // Opening it marks it read.
  useEffect(() => {
    if (data?.thread) repo.markThreadRead(id);
  }, [repo, id, data?.thread?.lastAt]);
  useEffect(() => {
    setText('');
    setFiles([]);
    setError(null);
    setAdding(false);
  }, [id]);
  if (data === undefined) return <Skeleton h={300} />;
  if (!data)
    return (
      <div className="msg-placeholder">
        <p>This conversation is not available.</p>
        <button className="btn" onClick={onBack}>
          Back
        </button>
      </div>
    );
  const { thread, messages, people, canAdd, me, section } = data;
  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim() && !files.length) return;
    setBusy(true);
    setError(null);
    try {
      await repo.sendMessage(id, text, files);
      setText('');
      setFiles([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const add = async (o) => {
    try {
      await repo.addToThread(id, o.key);
      setAdding(false);
      setToast(`${o.name} was added. They can see the whole conversation.`);
      setTimeout(() => setToast(null), 3000);
    } catch (err) {
      setError(err.message);
    }
  };
  // A new day gets a small date line.
  let lastDay = '';
  return (
    <div className="msg-convo">
      <header className="msg-convo-head">
        <button className="icon-btn msg-back" onClick={onBack} aria-label="Back to conversations">
          <ArrowLeft size={18} />
        </button>
        <div className="msg-convo-title">
          <div className="msg-people">
            {people.map((p) => (
              <span key={p.key} className={`msg-person msg-person-${p.kind}`}>
                {p.kind === 'office' ? <Building2 size={13} aria-hidden="true" /> : null}
                {p.me ? 'You' : p.name}
                <small>{KIND_LABEL[p.kind]}</small>
              </span>
            ))}
          </div>
          {thread.studentName && (
            <p className="muted small">
              About {thread.studentName}
              {section ? ` · ${section.name}` : ''}
            </p>
          )}
        </div>
        {canAdd.length > 0 && (
          <div className="msg-add">
            <button className="btn btn-sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>
              <UserPlus size={16} /> Add
            </button>
            {adding && (
              <div className="menu msg-add-menu" role="menu">
                <p className="menu-note">Add to this conversation. They will see the earlier messages too.</p>
                {canAdd.map((o) => (
                  <button key={o.key} role="menuitem" onClick={() => add(o)}>
                    {o.key === OFFICE ? <Building2 size={16} /> : <Users size={16} />}
                    <span>
                      {o.name}
                      <small className="muted"> · {o.role}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>
      <div className="msg-scroll" aria-live="polite">
        {messages.map((m) => {
          const day = messageTime(m.at).split(',').slice(0, 2).join(',');
          const showDay = day !== lastDay;
          lastDay = day;
          const mine = m.from === me;
          return (
            <div key={m.id}>
              {showDay && <p className="msg-day">{day}</p>}
              {m.system ? (
                <p className="msg-system">{m.text}</p>
              ) : (
                <div className={`msg-bubble-row ${mine ? 'mine' : ''}`}>
                  <div className={`msg-bubble msg-from-${keyKind(m.from)}`}>
                    {!mine && <b className="msg-sender">{m.fromName}</b>}
                    <MessageFiles files={m.files} load={loadFile} />
                    {m.text && <p>{m.text}</p>}
                    <time title={messageTime(m.at)}>{messageTime(m.at).split(', ').pop()}</time>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      <PendingFiles files={files} onChange={setFiles} />
      <form className="msg-compose" onSubmit={send}>
        <AttachButton files={files} onChange={setFiles} onError={setError} disabled={busy} className="btn att-btn" />
        <textarea
          className="input"
          rows={2}
          maxLength={MAX_MESSAGE}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Write a message… (Enter sends, Shift+Enter for a new line)"
          aria-label="Message"
        />
        <button className="btn btn-ink" type="submit" disabled={busy || (!text.trim() && !files.length)} aria-label="Send">
          <Send size={18} />
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {toast && <Toast message={toast} />}
    </div>
  );
}

// NEW MESSAGE: to a parent (pick the child), a teacher, or the school office. A parent's conversation can
// include the office and the child's other teachers from the start (3-way).
function NewMessage({ preset, onClose, onStarted }) {
  const repo = useRepo();
  const { data: contacts } = useLive((r) => r.messageContacts());
  const { data: session } = useLive((r) => r.getSession());
  const [tab, setTab] = useState(preset.studentId ? 'parent' : 'parent'); // parent | teacher | office
  const [q, setQ] = useState('');
  const [child, setChild] = useState(null); // a parents[] row
  const [teacherKeys, setTeacherKeys] = useState([]);
  const [extra, setExtra] = useState([]); // more people for a parent's conversation (office, other teachers)
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (preset.studentId && contacts && !child) setChild(contacts.parents.find((p) => p.studentId === preset.studentId) ?? null);
  }, [contacts, preset.studentId, child]);
  const me = session?.role === 'admin' ? OFFICE : `t:${session?.teacherId}`;
  const words = q.trim().toLowerCase();
  const parentHits = useMemo(
    () =>
      (contacts?.parents ?? [])
        .filter((p) => !words || `${p.studentName} ${p.lastName}, ${p.firstName} ${p.parentName} ${p.sectionName}`.toLowerCase().includes(words))
        .slice(0, 40),
    [contacts, words],
  );
  if (!contacts) return null;
  // Who else can be in a parent's conversation: the office (for a teacher) and the child's other teachers.
  const extraOptions = child
    ? [...(contacts.office ? [{ key: OFFICE, name: 'School office', role: 'Admin' }] : []), ...child.teachers.filter((t) => t.key !== me)]
    : [];
  const toggle = (list, set, key) => set(list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);
  const to = tab === 'parent' ? (child ? [child.key, ...extra] : []) : tab === 'teacher' ? [...teacherKeys, ...extra.filter((k) => k === OFFICE)] : [OFFICE];
  const submit = async () => {
    setError(null);
    if (!to.length) return setError(tab === 'parent' ? 'Choose a child (their parent gets the message).' : 'Choose at least one teacher.');
    setBusy(true);
    try {
      const id = await repo.startThread({ to, studentId: tab === 'parent' ? child.studentId : undefined, text, files });
      onStarted(id);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New message"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-ink" onClick={submit} disabled={busy || (!text.trim() && !files.length)}>
            <Send size={16} /> {busy ? 'Sending…' : 'Send'}
          </button>
        </>
      }
    >
      <div className="chips" role="tablist" aria-label="Send to">
        {[
          ['parent', 'A parent'],
          ['teacher', 'Teachers'],
          ...(contacts.office ? [['office', 'School office']] : []),
        ].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            className={`fchip ${tab === k ? 'fchip-on' : ''}`}
            onClick={() => {
              setTab(k);
              setExtra([]);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'parent' &&
        (child ? (
          <div className="msg-picked">
            <div>
              <b>{child.parentName}</b> {child.relationship && <span className="muted">({child.relationship})</span>}
              <p className="muted small">
                Parent of {child.studentName} · {child.sectionName} · {child.mobile}
              </p>
            </div>
            <button className="btn btn-sm" onClick={() => setChild(null)}>
              Change
            </button>
          </div>
        ) : (
          <>
            <label className="msg-search">
              <Search size={16} aria-hidden="true" />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the child, parent or class" aria-label="Search the child" />
            </label>
            <ul className="msg-pick-list">
              {parentHits.map((p) => (
                <li key={`${p.studentId}-${p.key}`}>
                  <button
                    onClick={() => {
                      setChild(p);
                      setExtra([]);
                    }}
                  >
                    <b>
                      {p.lastName}, {p.firstName}
                    </b>
                    <span className="muted small">
                      {p.sectionName} · {p.parentName}
                    </span>
                  </button>
                </li>
              ))}
              {!parentHits.length && <li className="muted small">No child found{session?.role === 'admin' ? '' : ' in your classes'}.</li>}
            </ul>
          </>
        ))}
      {tab === 'teacher' && (
        <ul className="msg-pick-list msg-pick-multi">
          {contacts.teachers.map((t) => (
            <li key={t.key}>
              <label>
                <input type="checkbox" checked={teacherKeys.includes(t.key)} onChange={() => toggle(teacherKeys, setTeacherKeys, t.key)} />
                <b>{t.name}</b>
                {t.subjects.length > 0 && <span className="muted small"> · {t.subjects.join(', ')}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
      {tab === 'office' && <p className="muted">Your message goes to the school office. Every admin can read and answer it.</p>}
      {/* 3-way: add the office (and the child's other teachers) to a parent's conversation from the start. */}
      {((tab === 'parent' && child && extraOptions.length > 0) || (tab === 'teacher' && contacts.office)) && (
        <fieldset className="msg-extra">
          <legend>Also include (everyone sees every message)</legend>
          {(tab === 'parent' ? extraOptions : [{ key: OFFICE, name: 'School office', role: 'Admin' }]).map((o) => (
            <label key={o.key}>
              <input type="checkbox" checked={extra.includes(o.key)} onChange={() => toggle(extra, setExtra, o.key)} />
              {o.name} <span className="muted small">· {o.role}</span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="field">
        <span>Message</span>
        <textarea className="input" rows={4} maxLength={MAX_MESSAGE} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write your message" />
        <span className="muted small">
          {text.length}/{MAX_MESSAGE}
        </span>
      </label>
      <div className="att-row">
        <AttachButton files={files} onChange={setFiles} onError={setError} disabled={busy} className="btn btn-sm" label />
        <span className="muted small">Photos are made smaller automatically. PDFs up to 700 KB. Up to 3 files.</span>
      </div>
      <PendingFiles files={files} onChange={setFiles} />
      {tab === 'parent' && <p className="muted small">The parent reads and answers it in the Doorbell parent portal (no text message is sent).</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

// REVIEW CONVERSATIONS (admin only). Every conversation in the school: who is in it, which child, when.
// No message text is shown here. "Review" asks for a reason, writes it to the audit log, then shows the
// conversation read-only. Modelled on Canvas (an admin reads someone's inbox only by deliberately acting as
// them, which is recorded) and ParentSquare (administrators can see transcripts for oversight).
function ReviewConversations() {
  const repo = useRepo();
  const loadFile = useMemo(() => (fid) => repo.fetchAttachment(fid), [repo]);
  const { data: all } = useLive((r) => r.listAllThreads());
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(null); // the conversation the admin wants to review
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null); // { thread, people, messages, section }
  if (!all) return <Skeleton h={300} />;
  const words = q.trim().toLowerCase();
  const list = all.filter((t) => !t.office && (!words || `${t.people.map((p) => p.name).join(' ')} ${t.studentName} ${t.section?.name ?? ''}`.toLowerCase().includes(words)));
  const start = (t) => {
    setAsking(t);
    setReason('');
    setDetails('');
    setError(null);
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await repo.reviewThread(asking.id, reason, details);
      setAsking(null);
      setShown(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <div>
        <h2 className="card-title">Conversations the school office is not in</h2>
        <p className="muted small">
          Only who talked and when is shown. Open one only when there is a reason (for example a child-safety concern or a complaint). The people in it
          are not notified, and your review is recorded in the audit log.
        </p>
      </div>
      <label className="msg-search">
        <Search size={16} aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a teacher, parent, child or class" aria-label="Search conversations" />
      </label>
      {list.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>People</th>
                <th>About</th>
                <th>Started</th>
                <th>Last message</th>
                <th>Reviews</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id}>
                  <td>
                    <div className="msg-people">
                      {t.people.map((p) => (
                        <span key={p.key} className={`msg-person msg-person-${p.kind}`}>
                          {p.name}
                          <small>{KIND_LABEL[p.kind]}</small>
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    {t.studentName || <span className="muted">Staff only</span>}
                    {t.section && <div className="muted small">{t.section.name}</div>}
                  </td>
                  <td>{inboxTime(t.createdAt)}</td>
                  <td>{inboxTime(t.lastAt)}</td>
                  <td>{t.reviews || <span className="muted">0</span>}</td>
                  <td className="row-actions">
                    <button className="btn btn-sm" onClick={() => start(t)}>
                      <Eye size={15} /> Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty compact title="No conversations to review" hint="Conversations between teachers and parents appear here." />
      )}
      {asking && (
        <Modal
          title="Why are you reviewing this conversation?"
          onClose={() => setAsking(null)}
          footer={
            <>
              <button className="btn" onClick={() => setAsking(null)}>
                Cancel
              </button>
              <button className="btn btn-ink" onClick={confirm} disabled={busy || !reason || details.trim().length < 10}>
                <Eye size={16} /> {busy ? 'Opening…' : 'Record and open'}
              </button>
            </>
          }
        >
          <p className="muted">
            {asking.people.map((p) => p.name).join(', ')}
            {asking.studentName ? ` · about ${asking.studentName}` : ''}
          </p>
          <div className="chips">
            {repo.REVIEW_REASONS.map((r) => (
              <button key={r} className={`fchip sm ${reason === r ? 'fchip-on' : ''}`} onClick={() => setReason(r)}>
                {r}
              </button>
            ))}
          </div>
          <label className="field">
            <span>What happened? (kept in the audit log)</span>
            <textarea className="input" rows={3} maxLength={300} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="e.g. Parent of Juan reported a message from the teacher on Nov 18." />
          </label>
          <p className="muted small">Your name, the time, this reason and the conversation are recorded. The audit log can't be edited or deleted.</p>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
      {shown && (
        <Modal title="Conversation review (read only)" wide onClose={() => setShown(null)}>
          <div className="msg-people">
            {shown.people.map((p) => (
              <span key={p.key} className={`msg-person msg-person-${p.kind}`}>
                {p.name}
                <small>{KIND_LABEL[p.kind]}</small>
              </span>
            ))}
          </div>
          {shown.thread.studentName && (
            <p className="muted small">
              About {shown.thread.studentName}
              {shown.section ? ` · ${shown.section.name}` : ''}
            </p>
          )}
          <div className="msg-scroll msg-review-scroll">
            {shown.messages.map((m) =>
              m.system ? (
                <p key={m.id} className="msg-system">
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className="msg-bubble-row">
                  <div className={`msg-bubble msg-from-${keyKind(m.from)}`}>
                    <b className="msg-sender">{m.fromName}</b>
                    <MessageFiles files={m.files} load={loadFile} />
                    {m.text && <p>{m.text}</p>}
                    <time>{messageTime(m.at)}</time>
                  </div>
                </div>
              ),
            )}
            {!shown.messages.length && <p className="muted">No messages.</p>}
          </div>
        </Modal>
      )}
    </section>
  );
}
