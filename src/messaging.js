// =====================================================================
// messaging.js — THE BUILT-IN MESSAGES (pure helpers, no database)
// ---------------------------------------------------------------------
// Parents, teachers and the school office talk in conversations ("threads"). One thread can hold
// all three at once (3-way): e.g. a parent, the class adviser and the school office.
// Every person in a thread is a "key":
//   'office'          the school office (every admin account reads and answers for it)
//   't:<teacherId>'   one teacher
//   'p:<09XXXXXXXXX>' one parent (their mobile number, the same key as parentKeys/{number})
// Firestore:
//   threads/{id}  = { members: [keys], parent, parentName, studentId, studentName, sectionId, teacherId,
//                     office, names: { key: name }, createdBy, createdAt, lastAt, lastText, lastFrom,
//                     lastName, readAt: { key: time } }
//   messages/{id} = { threadId, members (copied from the thread, for the security rules), from, fromName,
//                     text, at, system?, files?: [{ id, name, type, size }] }
//   attachments/{id} = { id, threadId | excuseId, from, name, type, size, data (base64), at }: one photo or PDF, read only
//                     when someone opens it (src/shared/Attachments.jsx). Kept in Firestore, not Firebase Storage,
//                     because Storage needs the paid Blaze plan; so a file must fit in one document (about 700 KB).
// Used by the engine (staff and demo mode) and by parent/parentCloud.js (the parent portal).
// =====================================================================

export const OFFICE = 'office';
export const MAX_MESSAGE = 1000; // characters in one message (firestore.rules checks it too)
export const MAX_FILES = 3; // attachments in one message (firestore.rules checks it too)
export const teacherKey = (teacherId) => `t:${teacherId}`;
export const parentMsgKey = (mobileKey) => `p:${mobileKey}`;
export const keyKind = (key) => (key === OFFICE ? 'office' : key?.startsWith('t:') ? 'teacher' : key?.startsWith('p:') ? 'parent' : 'other');
export const OFFICE_NAME = 'School office';

// The short line shown in the inbox under a conversation's name.
export const previewOf = (text, files = []) =>
  String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || (files.length ? `Sent ${files.length === 1 ? files[0].name : `${files.length} files`}` : '');

// A new id for a thread or a message, e.g. 'th-lq2x9k0a1b'.
let n = 0;
export const msgId = (prefix) => `${prefix}-${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Checks a message before it is sent. Returns the cleaned text or throws.
// withFiles: a message with attachments may have no text.
export function cleanMessage(text, withFiles = false) {
  const t = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!t && !withFiles) throw new Error('Type a message first.');
  if (t.length > MAX_MESSAGE) throw new Error(`Keep a message under ${MAX_MESSAGE} characters (this one has ${t.length}).`);
  return t;
}

// True when `key` has not read the newest message of the thread (and did not write it).
export const isUnread = (thread, key) => !!thread?.lastAt && thread.lastFrom !== key && !((thread.readAt?.[key] ?? '') >= thread.lastAt);

// The members in a fixed order: parent first, then teachers, then the office.
export function orderMembers(keys) {
  const rank = (k) => ({ parent: 0, teacher: 1, office: 2 }[keyKind(k)] ?? 3);
  return [...new Set(keys.filter(Boolean))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * A new thread document.
 * from: { key, name }; others: [{ key, name }]; about: { mobile, parentName, studentId, studentName, sectionId } (a parent thread) or null.
 */
export function buildThread({ from, others, about, text, files = [], at = new Date().toISOString(), id = msgId('th') }) {
  const people = [from, ...others];
  const members = orderMembers(people.map((p) => p.key));
  const firstTeacher = members.find((k) => keyKind(k) === 'teacher');
  return {
    id,
    members,
    parent: about?.mobile ?? '',
    parentName: about?.parentName ?? '',
    studentId: about?.studentId ?? '',
    studentName: about?.studentName ?? '',
    sectionId: about?.sectionId ?? '',
    teacherId: firstTeacher ? firstTeacher.slice(2) : '',
    office: members.includes(OFFICE),
    names: Object.fromEntries(people.map((p) => [p.key, p.name])),
    createdBy: from.key,
    createdAt: at,
    lastAt: at,
    lastText: previewOf(text, files),
    lastFrom: from.key,
    lastName: from.name,
    readAt: { [from.key]: at },
  };
}

/** A new message document for a thread. */
// files: the attachments' details ({ id, name, type, size }); the files themselves are buildAttachment documents.
export function buildMessage({ thread, from, text, files = [], at = new Date().toISOString(), system = false, id = msgId('msg') }) {
  return {
    id,
    threadId: thread.id,
    members: [...thread.members],
    from: from.key,
    fromName: from.name,
    text,
    at,
    ...(files.length ? { files: files.map(({ id: fid, name, type, size }) => ({ id: fid, name, type, size })) } : {}),
    ...(system ? { system: true } : {}),
  };
}
/** One prepared file ({ name, type, size, data }) as an attachments/{id} document: of a message (thread) or of a
 *  parent's excuse request (excuseId, e.g. a photo of the medical certificate). */
export const buildAttachment = ({ thread, excuseId, from, file, at = new Date().toISOString(), id = msgId('att') }) => ({
  id,
  ...(excuseId ? { excuseId } : { threadId: thread.id }),
  from: from.key,
  name: String(file.name).slice(0, 120),
  type: file.type,
  size: file.size,
  data: file.data,
  at,
});

/** The thread after a new message: newest text, who wrote it, and the writer has read it. */
export const afterMessage = (thread, msg) => ({
  ...thread,
  lastAt: msg.at,
  lastText: previewOf(msg.text, msg.files),
  lastFrom: msg.from,
  lastName: msg.fromName,
  readAt: { ...(thread.readAt ?? {}), [msg.from]: msg.at },
});

// How a person is called in a thread: 'School office', a teacher's name, or the parent's name.
export const nameIn = (thread, key) => (key === OFFICE ? OFFICE_NAME : thread?.names?.[key] ?? (keyKind(key) === 'parent' ? thread?.parentName || 'Parent' : 'Teacher'));

// The thread's title for the person reading it: everyone else in it.
export const titleFor = (thread, myKey) =>
  thread.members
    .filter((k) => k !== myKey)
    .map((k) => (keyKind(k) === 'parent' && thread.studentName ? `${nameIn(thread, k)} (parent of ${thread.studentName.split(' ')[0]})` : nameIn(thread, k)))
    .join(', ') || 'Only you';

// Inbox time: '7:42 AM' today, 'Yesterday', 'Nov 18' this year, else '11/18/25'.
export function inboxTime(iso, now = new Date()) {
  const d = new Date(iso);
  const day = (x) => x.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  if (day(d) === day(now)) return d.toLocaleTimeString('en-US', { timeZone: 'Asia/Manila', hour: 'numeric', minute: '2-digit' });
  if (day(d) === day(new Date(now.getTime() - 864e5))) return 'Yesterday';
  return d.toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: '2-digit' } : {}) });
}
// Above a message: 'Fri, Nov 20, 7:42 AM'.
export const messageTime = (iso) =>
  new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Manila', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------------------------------------------------------------------
// EMAIL ALERTS FOR STAFF (the Cloudflare Worker sends them, worker/src/index.js sendMessageEmails)
// When someone writes in a conversation, every teacher and the school office in it (not the writer, never a
// parent) gets a mailQueue/{threadId}_{key} document. If it is still there a few minutes later (they have not
// opened the conversation), the Worker emails them "X sent you a message in Doorbell" (no message text) and
// deletes it. Opening or answering the conversation deletes it first, so no email is sent.
// ---------------------------------------------------------------------
export const mailQueueId = (threadId, key) => `${threadId}_${key}`;
/** The mailQueue documents for a new message: one per staff member in the thread, except the writer. */
export function mailQueueDocs(thread, msg) {
  if (msg.system) return [];
  return thread.members
    .filter((k) => k !== msg.from && (k === OFFICE || keyKind(k) === 'teacher'))
    .map((to) => ({
      id: mailQueueId(thread.id, to),
      threadId: thread.id,
      to,
      at: msg.at,
      fromName: String(msg.fromName ?? '').slice(0, 80),
      studentName: String(thread.studentName ?? '').slice(0, 80),
    }));
}
