// =====================================================================
// parent/ParentMessages.jsx — MESSAGES IN THE PARENT PORTAL
// ---------------------------------------------------------------------
// The parent's conversations with the child's teachers and the school office (the same conversations
// the staff see on their Messages page, src/shared/Messages.jsx). A new message goes to the class
// adviser, a subject teacher, the school office, or a teacher AND the office together (3-way).
// The data comes from watchParent() (parentCloud.js) or, in demo mode, from the engine.
// =====================================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Building2, ChevronLeft, MessagesSquare, Plus, Send } from 'lucide-react';
import { OFFICE, OFFICE_NAME, MAX_MESSAGE, parentMsgKey, isUnread, titleFor, inboxTime, messageTime, keyKind } from '../messaging';

/** How many conversations have a message the parent hasn't read (for the Home button). */
export const parentUnread = (st) => {
  const me = st.profile?.mobile ? parentMsgKey(st.profile.mobile) : null;
  return me ? (st.threads ?? []).filter((t) => isUnread(t, me)).length : 0;
};

export function ParentMessages({ st, api, onBack }) {
  const me = parentMsgKey(st.profile.mobile);
  const [openId, setOpenId] = useState(null);
  const [composing, setComposing] = useState(false);
  const threads = [...(st.threads ?? [])].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  const open = threads.find((t) => t.id === openId);
  if (composing)
    return (
      <Compose
        st={st}
        api={api}
        onBack={() => setComposing(false)}
        onSent={(id) => {
          setComposing(false);
          setOpenId(id);
        }}
      />
    );
  if (open) return <Thread st={st} api={api} thread={open} me={me} onBack={() => setOpenId(null)} />;
  return (
    <div className="pp-stack">
      <button type="button" className="pp-back" onClick={onBack}>
        <ChevronLeft size={18} aria-hidden="true" /> Back
      </button>
      <h1 className="pp-h1">Messages</h1>
      <p className="pp-muted">Write to your child’s teacher or the school office. You can include both in one conversation.</p>
      <p className="pp-muted pp-small">
        Messages are kept by the school and only the people in a conversation can read them. For child safety, the school admin may review a
        conversation; every review is recorded.
      </p>
      <button type="button" className="btn btn-ink wide pp-big" onClick={() => setComposing(true)}>
        <Plus size={18} aria-hidden="true" /> New message
      </button>
      {threads.length ? (
        <ul className="pp-card pp-msg-list">
          {threads.map((t) => {
            const unread = isUnread(t, me);
            return (
              <li key={t.id}>
                <button type="button" className={unread ? 'unread' : ''} onClick={() => setOpenId(t.id)}>
                  <span className="pp-msg-top">
                    <b>{titleFor(t, me)}</b>
                    <time>{inboxTime(t.lastAt)}</time>
                  </span>
                  {t.studentName && <span className="pp-small pp-muted">About {t.studentName.split(' ')[0]}</span>}
                  <span className="pp-msg-preview">
                    {t.lastFrom === me ? 'You: ' : ''}
                    {t.lastText}
                  </span>
                  {unread && <span className="pp-msg-new">New</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="pp-card pp-muted pp-center">
          <MessagesSquare size={28} aria-hidden="true" />
          <br />
          No messages yet.
        </p>
      )}
    </div>
  );
}

function Thread({ st, api, thread, me, onBack }) {
  const messages = useMemo(
    () => (st.messages ?? []).filter((m) => m.threadId === thread.id).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
    [st.messages, thread.id],
  );
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const endRef = useRef(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);
  useEffect(() => {
    api.markRead(thread).catch?.(() => {});
  }, [thread.lastAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.send({ thread, text });
      setText('');
    } catch (err) {
      setError(err.code === 'permission-denied' ? 'Could not send. Sign out and sign in again, then try again.' : err.message);
    } finally {
      setBusy(false);
    }
  };
  let lastDay = '';
  return (
    <div className="pp-stack">
      <button type="button" className="pp-back" onClick={onBack}>
        <ChevronLeft size={18} aria-hidden="true" /> Messages
      </button>
      <div>
        <h1 className="pp-h2">{titleFor(thread, me)}</h1>
        {thread.studentName && <p className="pp-muted pp-small">About {thread.studentName}</p>}
      </div>
      <section className="pp-card pp-chat" aria-live="polite">
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
                    <p>{m.text}</p>
                    <time>{messageTime(m.at).split(', ').pop()}</time>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </section>
      <form className="pp-msg-compose" onSubmit={send}>
        <textarea className="input" rows={2} maxLength={MAX_MESSAGE} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply" aria-label="Reply" />
        <button className="btn btn-ink" type="submit" disabled={busy || !text.trim()} aria-label="Send">
          <Send size={18} aria-hidden="true" />
        </button>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// NEW MESSAGE: which child, which teacher (the adviser or a subject teacher), and whether the school office
// is included too (3-way). A parent may also write to the school office only.
function Compose({ st, api, onBack, onSent }) {
  const children = st.key?.children ?? [];
  const [childId, setChildId] = useState(children[0]?.id ?? null);
  const docs = (childId && st.months?.[childId]) || [];
  const latest = docs[docs.length - 1];
  const contacts = latest?.contacts ?? [];
  const child = children.find((c) => c.id === childId);
  const [teacher, setTeacher] = useState(null); // a teacher's key, or '' = no teacher (school office only)
  const [office, setOffice] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    // Start with the class adviser; with no teachers listed yet, the school office.
    setTeacher(contacts[0]?.key ?? '');
    setOffice(!contacts.length);
  }, [childId, contacts.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const officeOnly = !teacher;
  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const to = [...(teacher ? [teacher] : []), ...(office || officeOnly ? [OFFICE] : [])];
    const sectionId = child?.sectionId ?? latest?.sectionId;
    if (!sectionId) return setError(`${child?.firstName ?? 'Your child'} is not in a class yet. Please contact the school.`);
    setBusy(true);
    try {
      const id = await api.send({ thread: null, to, contacts, about: { studentId: child.id, studentName: `${child.firstName} ${child.lastName}`, sectionId }, text });
      onSent(id);
    } catch (err) {
      setError(err.code === 'permission-denied' ? 'Could not send. The school may need to update the parent portal first; please try again later.' : err.message);
      setBusy(false);
    }
  };
  const chosen = contacts.find((c) => c.key === teacher);
  return (
    <form onSubmit={submit} className="pp-stack">
      <button type="button" className="pp-back" onClick={onBack}>
        <ChevronLeft size={18} aria-hidden="true" /> Back
      </button>
      <h1 className="pp-h1">New message</h1>
      <section className="pp-card pp-form">
        {children.length > 1 && (
          <fieldset className="pp-fieldset">
            <legend>About which child?</legend>
            <div className="pp-chips">
              {children.map((c) => (
                <button key={c.id} type="button" className={`pp-chip ${c.id === childId ? 'on' : ''}`} aria-pressed={c.id === childId} onClick={() => setChildId(c.id)}>
                  {c.firstName}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="pp-fieldset">
          <legend>Which teacher?</legend>
          {contacts.length ? (
            <div className="pp-msg-to" role="radiogroup" aria-label="Teacher">
              {contacts.map((c) => (
                <button key={c.key} type="button" role="radio" aria-checked={teacher === c.key} className={`pp-period ${teacher === c.key ? 'on' : ''}`} onClick={() => setTeacher(c.key)}>
                  <b>{c.name}</b>
                  <span>{c.role}</span>
                </button>
              ))}
              <button type="button" role="radio" aria-checked={officeOnly} className={`pp-period ${officeOnly ? 'on' : ''}`} onClick={() => setTeacher('')}>
                <b>No teacher</b>
                <span>Send to the school office only</span>
              </button>
            </div>
          ) : (
            <p className="pp-muted pp-small">
              {child?.firstName ?? 'Your child'}’s teachers will be listed here once the school updates the parent portal. For now you can write to the
              school office.
            </p>
          )}
        </fieldset>
        <fieldset className="pp-fieldset">
          <legend>School office</legend>
          {officeOnly ? (
            <p className="pp-muted pp-small">
              <Building2 size={14} aria-hidden="true" /> Your message goes to the school office (the principal and the school staff).
            </p>
          ) : (
            <label className="pp-msg-check">
              <input type="checkbox" checked={office} onChange={(e) => setOffice(e.target.checked)} />
              <span>
                <b>Also include the school office</b>
                <small>{chosen?.name ?? 'The teacher'} and the school office will both see every message.</small>
              </span>
            </label>
          )}
        </fieldset>
        <label className="pp-field">
          <span>Message</span>
          <textarea className="input" rows={4} maxLength={MAX_MESSAGE} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Good morning, Teacher. May I ask about…" />
        </label>
      </section>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-ink wide pp-big" type="submit" disabled={busy || !text.trim()}>
        <Send size={18} aria-hidden="true" /> {busy ? 'Sending…' : `Send to ${officeOnly ? OFFICE_NAME : `${chosen?.name ?? 'the teacher'}${office ? ' and the office' : ''}`}`}
      </button>
    </form>
  );
}
