// =====================================================================
// engine/messages.js — THE BUILT-IN MESSAGES (staff side, and the parent side in demo mode)
// Conversations between parents, teachers and the school office; one conversation can hold all three.
// The documents and the keys ('office', 't:<teacherId>', 'p:<mobile>') are explained in src/messaging.js.
// These are methods of the Engine class (engine.js adds them to it), so `this` is the engine.
// Who may talk to whom (firestore.rules checks the same):
//   * the school office (admin): anyone
//   * a teacher: the office, other teachers, and the parents of children in their classes
//   * a parent: their child's class adviser and subject teachers, and the office (parent/parentCloud.js)
// =====================================================================
import { parentKeyOf, classPeriods } from '../logic';
import {
  OFFICE,
  OFFICE_NAME,
  teacherKey,
  parentMsgKey,
  keyKind,
  cleanMessage,
  buildThread,
  buildMessage,
  buildAttachment,
  afterMessage,
  MAX_FILES,
  isUnread,
  titleFor,
  nameIn,
  orderMembers,
  mailQueueDocs,
  mailQueueId,
} from '../messaging';

export const messagesMethods = {
  // The signed-in staff member's key: 'office' for an admin, 't:<id>' for a teacher.
  myMsgKey() {
    const s = this.session;
    if (!s) return null;
    if (s.role === 'admin') return OFFICE;
    return s.teacherId ? teacherKey(s.teacherId) : null;
  },
  // The name on a message: "Rosario Dizon (School office)" or the teacher's name.
  myMsgName() {
    const s = this.session;
    if (!s) return '';
    return s.role === 'admin' ? `${s.name} (${OFFICE_NAME})` : (this.s.teachers.get(s.teacherId)?.name ?? s.name);
  },
  // How a key is shown in lists: the office, a teacher's name, or a parent's name.
  msgPersonName(key, thread) {
    if (key === OFFICE) return OFFICE_NAME;
    if (keyKind(key) === 'teacher') return this.s.teachers.get(key.slice(2))?.name ?? nameIn(thread, key);
    return nameIn(thread, key);
  },
  // The teachers of a class: the adviser first, then the subject teachers (with their subjects).
  classTeachers(section) {
    if (!section) return [];
    const subjects = new Map();
    for (const p of classPeriods(section.program)) if (p.teacherId) subjects.set(p.teacherId, [...new Set([...(subjects.get(p.teacherId) ?? []), p.subject])]);
    // Adviser first, then the subject teachers in class-program order (1st period's teacher first).
    const ids = [...new Set([section.teacherId, ...subjects.keys(), ...(section.subjectTeacherIds ?? [])].filter(Boolean))];
    return ids
      .map((id) => this.s.teachers.get(id))
      .filter((t) => t && t.active !== false)
      .map((t) => ({
        key: teacherKey(t.id),
        teacherId: t.id,
        name: t.name,
        role: t.id === section.teacherId ? 'Class adviser' : `Subject teacher${subjects.get(t.id)?.length ? `: ${subjects.get(t.id).join(', ')}` : ''}`,
        subjects: subjects.get(t.id) ?? [],
      }));
  },
  // The child's class a thread is about (for "who can be added").
  threadSection(thread) {
    return thread.sectionId ? this.s.sections.get(thread.sectionId) : undefined;
  },
  // My conversations, newest first, with the title and unread state for me.
  async listThreads() {
    await this.ready;
    const me = this.myMsgKey();
    if (!me) return [];
    return [...this.s.threads.values()]
      .filter((t) => t.members.includes(me))
      .map((t) => ({
        ...t,
        title: titleFor({ ...t, names: { ...t.names, ...Object.fromEntries(t.members.map((k) => [k, this.msgPersonName(k, t)])) } }, me),
        unread: isUnread(t, me),
        withParent: !!t.parent,
        section: this.threadSection(t),
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  },
  // How many conversations have a message I haven't read (the menu badge).
  async unreadMessageCount() {
    await this.ready;
    const me = this.myMsgKey();
    if (!me) return 0;
    let n = 0;
    for (const t of this.s.threads.values()) if (t.members.includes(me) && isUnread(t, me)) n++;
    return n;
  },
  // One conversation: its messages (oldest first), the people in it, and who else can be added.
  async getThread(id) {
    await this.ready;
    const me = this.myMsgKey();
    const t = this.s.threads.get(id);
    if (!t || !t.members.includes(me)) return null;
    const messages = [...this.s.messages.values()].filter((m) => m.threadId === id).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const people = t.members.map((k) => ({ key: k, kind: keyKind(k), name: this.msgPersonName(k, t), me: k === me }));
    return { thread: t, messages, people, canAdd: this.addableTo(t), me, section: this.threadSection(t) };
  },
  // Who can still be added to a conversation (the 3-way part): the office, and for a parent's
  // conversation the child's other teachers; for a staff conversation any active teacher.
  addableTo(thread) {
    const me = this.myMsgKey();
    if (!me || !thread.members.includes(me)) return [];
    const out = [];
    if (!thread.members.includes(OFFICE)) out.push({ key: OFFICE, name: OFFICE_NAME, role: 'Admin' });
    const teachers = thread.parent
      ? this.classTeachers(this.threadSection(thread))
      : [...this.s.teachers.values()].filter((t) => t.active !== false).map((t) => ({ key: teacherKey(t.id), name: t.name, role: 'Teacher' }));
    for (const t of teachers) if (!thread.members.includes(t.key)) out.push(t);
    return out;
  },
  // Everyone I can start a conversation with.
  //   parents: one row per child (a parent of two children appears twice, once per child)
  //   teachers: other active teachers;  office: false for the office itself
  async messageContacts() {
    await this.ready;
    const me = this.myMsgKey();
    if (!me) return { parents: [], teachers: [], office: false };
    const isAdmin = this.session.role === 'admin';
    // A teacher: the classes they advise or teach a subject in (not a class they only cover today as a
    // substitute: firestore.rules would refuse it).
    const sectionIds = isAdmin
      ? null
      : new Set([...this.classesOf(this.session.teacherId), ...this.subjectClassesOf(this.session.teacherId)].map((c) => c.id));
    const parents = [];
    for (const g of this.s.guardians.values()) {
      const mobile = parentKeyOf(g.mobile);
      if (!mobile) continue;
      for (const sid of g.studentIds) {
        const stu = this.s.students.get(sid);
        const enr = this.activeEnrollment(sid);
        if (!stu || !enr || sid.includes('-old-')) continue;
        if (sectionIds && !sectionIds.has(enr.sectionId)) continue;
        const sec = this.s.sections.get(enr.sectionId);
        parents.push({
          key: parentMsgKey(mobile),
          mobile,
          parentName: g.name,
          relationship: g.relationship ?? '',
          studentId: sid,
          studentName: `${stu.firstName} ${stu.lastName}`,
          firstName: stu.firstName,
          lastName: stu.lastName,
          sectionId: enr.sectionId,
          sectionName: sec?.name ?? '',
          gradeLevel: sec?.gradeLevel ?? '',
          teachers: this.classTeachers(sec),
        });
      }
    }
    parents.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
    const teachers = [...this.s.teachers.values()]
      .filter((t) => t.active !== false && teacherKey(t.id) !== me)
      .map((t) => ({ key: teacherKey(t.id), teacherId: t.id, name: t.name, subjects: t.subjects ?? [] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { parents, teachers, office: me !== OFFICE };
  },
  // Starts a conversation (or adds to the one that already has exactly these people about this child).
  //   to: keys of the others ('office', 't:..', 'p:..');  studentId: required when a parent is in it
  // Returns the thread id.
  // files: prepared attachments [{ name, type, size, data }] (src/shared/Attachments.jsx prepareFile).
  async startThread({ to, studentId, text, files = [] }) {
    await this.ready;
    const me = this.myMsgKey();
    if (!me) throw new Error('Sign in again first.');
    if (files.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} files in one message.`);
    const body = cleanMessage(text, files.length > 0);
    const others = [...new Set((to ?? []).filter((k) => k && k !== me))];
    if (!others.length) throw new Error('Choose who to send it to.');
    const parentKeys = others.filter((k) => keyKind(k) === 'parent');
    if (parentKeys.length > 1) throw new Error('One parent per conversation. Start a separate one for each parent.');
    let about = null;
    if (parentKeys.length) {
      const c = (await this.messageContacts()).parents.find((p) => p.key === parentKeys[0] && p.studentId === studentId);
      if (!c) throw new Error("You can message the parents of children in your classes only.");
      about = { mobile: c.mobile, parentName: c.parentName, studentId: c.studentId, studentName: c.studentName, sectionId: c.sectionId };
    }
    for (const k of others) {
      if (keyKind(k) === 'teacher' && !this.s.teachers.has(k.slice(2))) throw new Error('That teacher was not found.');
    }
    const members = orderMembers([me, ...others]);
    // Same people, same child: continue that conversation instead of starting a second one.
    const same = [...this.s.threads.values()].find((t) => t.members.join() === members.join() && (t.studentId ?? '') === (about?.studentId ?? ''));
    if (same) {
      await this.sendMessage(same.id, body, files);
      return same.id;
    }
    const from = { key: me, name: this.myMsgName() };
    const thread = buildThread({
      from,
      others: others.map((k) => ({ key: k, name: keyKind(k) === 'parent' ? about.parentName : this.msgPersonName(k, null) })),
      about,
      text: body,
      files,
    });
    const msg = buildMessage({ thread, from, text: body, files: this.saveAttachments(thread, from, files), at: thread.lastAt });
    this.s.threads.set(thread.id, thread);
    this.s.messages.set(msg.id, msg);
    this.put('threads', thread.id, thread);
    this.put('messages', msg.id, msg);
    this.queueEmails(thread, msg);
    this.emit();
    return thread.id;
  },
  // Email alerts: a mailQueue document for each teacher / the office in the conversation (src/messaging.js).
  queueEmails(thread, msg) {
    for (const q of mailQueueDocs(thread, msg)) this.put('mailQueue', q.id, q);
  },
  // I opened or answered a conversation: no email alert about it for me.
  cancelMyEmail(threadId) {
    const me = this.myMsgKey();
    if (me) this.persistence.remove('mailQueue', mailQueueId(threadId, me));
  },
  // Sends a message in a conversation I am in.
  async sendMessage(threadId, text, files = []) {
    await this.ready;
    const me = this.myMsgKey();
    const t = this.s.threads.get(threadId);
    if (!t || !t.members.includes(me)) throw new Error('This conversation is not yours.');
    if (files.length > MAX_FILES) throw new Error(`Up to ${MAX_FILES} files in one message.`);
    const from = { key: me, name: this.myMsgName() };
    const msg = buildMessage({ thread: t, from, text: cleanMessage(text, files.length > 0), files: this.saveAttachments(t, from, files) });
    const next = afterMessage(t, msg);
    this.s.threads.set(t.id, next);
    this.s.messages.set(msg.id, msg);
    this.put('threads', t.id, next);
    this.put('messages', msg.id, msg);
    this.queueEmails(next, msg);
    this.cancelMyEmail(t.id);
    this.emit();
    return msg;
  },
  // Saves each prepared file as an attachments/{id} document; returns their details for the message.
  saveAttachments(thread, from, files = []) {
    return files.map((file) => {
      const a = buildAttachment({ thread, from, file });
      this.s.attachments.set(a.id, a);
      this.put('attachments', a.id, a);
      return a;
    });
  },
  // One attachment (to show or download). Demo: from memory. Cloud: firebase.js reads that one document
  // (they are not loaded with the messages, so opening a conversation stays cheap).
  async fetchAttachment(id) {
    return this.s.attachments.get(id) ?? null;
  },
  // Opening a conversation marks it read for me (saved only when something was unread).
  async markThreadRead(threadId) {
    await this.ready;
    const me = this.myMsgKey();
    const t = this.s.threads.get(threadId);
    if (!t || !isUnread(t, me)) return;
    const next = { ...t, readAt: { ...(t.readAt ?? {}), [me]: t.lastAt } };
    this.s.threads.set(t.id, next);
    this.put('threads', t.id, next);
    this.cancelMyEmail(t.id);
    this.emit();
  },
  // Adds someone to a conversation (e.g. a teacher brings in the school office: 3-way). They see the
  // whole conversation, and everyone sees a line saying who added them.
  async addToThread(threadId, key) {
    await this.ready;
    const me = this.myMsgKey();
    const t = this.s.threads.get(threadId);
    if (!t || !t.members.includes(me)) throw new Error('This conversation is not yours.');
    const option = this.addableTo(t).find((o) => o.key === key);
    if (!option) throw new Error('That person cannot be added to this conversation.');
    const members = orderMembers([...t.members, key]);
    const old = [...this.s.messages.values()].filter((m) => m.threadId === threadId);
    // Older messages get the new member too, so the person added can read them (firestore.rules).
    for (const m of old) {
      const nm = { ...m, members };
      this.s.messages.set(m.id, nm);
      this.put('messages', m.id, nm);
    }
    const grown = { ...t, members, office: members.includes(OFFICE), names: { ...t.names, [key]: option.name } };
    const note = buildMessage({ thread: grown, from: { key: me, name: this.myMsgName() }, text: `${this.myMsgName()} added ${option.name} to the conversation.`, system: true });
    const next = afterMessage(grown, note);
    this.s.threads.set(t.id, next);
    this.s.messages.set(note.id, note);
    this.put('threads', t.id, next);
    this.put('messages', note.id, note);
    this.emit();
  },

  // Teacher Settings: "Email me when I get a new message" (teachers/{id}.emailAlerts; on unless turned off).
  async myEmailAlerts() {
    await this.ready;
    const t = this.session?.teacherId ? this.s.teachers.get(this.session.teacherId) : null;
    return t ? { email: t.email, on: t.emailAlerts !== false } : null;
  },
  async setMyEmailAlerts(on) {
    await this.ready;
    const id = this.session?.teacherId;
    const t = id ? this.s.teachers.get(id) : null;
    if (!t) throw new Error('Only teachers have this setting.');
    const next = { ...t, emailAlerts: !!on };
    this.s.teachers.set(id, next);
    this.put('teachers', id, next); // firestore.rules: a teacher may change only this field of their own record
    this.emit();
  },

  /* ---------- OVERSIGHT: the admin reviews a conversation they are not in ----------
     Modelled on how schools run Canvas and ParentSquare:
       * Canvas: conversations are private to the people in them; an admin can read one only by deliberately
         "acting as" a user, and that action is recorded.
       * ParentSquare / district policies: staff-family messages stay on a school-controlled platform, are kept,
         and administrators can see the transcripts for oversight.
     Doorbell: a conversation the office is not in never appears in the admin's inbox. The admin opens
     Messages -> "Review conversations", sees WHO talked (names, child, dates; no message text), and can read
     one only after giving a reason. Each review is written to the audit log (which can't be edited or
     deleted). The people in the conversation are not told (it may be a child-protection case), but every
     Messages page says reviews can happen. */
  REVIEW_REASONS: ['Child safety concern', 'Complaint from a parent', 'Complaint from a teacher', 'Bullying or misconduct', 'Records or legal request', 'Other'],
  // Every conversation in the school (admin only), newest first, without the message text.
  async listAllThreads() {
    await this.ready;
    if (this.session?.role !== 'admin') return [];
    return [...this.s.threads.values()]
      .map((t) => ({
        id: t.id,
        people: t.members.map((k) => ({ key: k, kind: keyKind(k), name: this.msgPersonName(k, t) })),
        office: t.members.includes(OFFICE),
        studentName: t.studentName,
        section: this.threadSection(t),
        createdAt: t.createdAt,
        lastAt: t.lastAt,
        reviews: [...this.s.audit.values()].filter((a) => a.action === 'messages.review' && a.threadId === t.id).length,
      }))
      .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  },
  // The admin reads a conversation for a stated reason. Logged first, then the messages are loaded.
  async reviewThread(id, reason, details = '') {
    await this.ready;
    if (this.session?.role !== 'admin') throw new Error('Only the school admin can review conversations.');
    const t = this.s.threads.get(id);
    if (!t) throw new Error('Conversation not found.');
    if (!this.REVIEW_REASONS.includes(reason)) throw new Error('Choose the reason for the review.');
    const why = String(details ?? '').trim();
    if (why.length < 10) throw new Error('Write a short explanation (at least 10 characters). It is kept in the audit log.');
    const who = t.members.map((k) => this.msgPersonName(k, t)).join(', ');
    await this.logAudit('messages.review', `Conversation: ${who}${t.studentName ? ` (about ${t.studentName})` : ''}`, `${reason}: ${why.slice(0, 300)}`, { threadId: id });
    const messages = await this.fetchThreadMessages(id);
    this.emit();
    return {
      thread: t,
      people: t.members.map((k) => ({ key: k, kind: keyKind(k), name: this.msgPersonName(k, t) })),
      messages: messages.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
      section: this.threadSection(t),
    };
  },
  // The messages of one conversation. Demo: from memory. Cloud: firebase.js replaces this with a one-time read.
  async fetchThreadMessages(id) {
    return [...this.s.messages.values()].filter((m) => m.threadId === id);
  },

  /* ---------- DEMO MODE ONLY: the parent portal's side (the cloud uses parent/parentCloud.js) ---------- */
  // What the portal's Messages page shows for one parent number.
  demoParentMessages(mobile) {
    const me = parentMsgKey(mobile);
    const threads = [...this.s.threads.values()].filter((t) => t.members.includes(me));
    const ids = new Set(threads.map((t) => t.id));
    return { threads, messages: [...this.s.messages.values()].filter((m) => ids.has(m.threadId)) };
  },
  // The parent sends a message (an existing thread) or starts one (to: 't:<id>' and/or 'office').
  demoParentSend({ mobile, parentName, threadId, studentId, to, text, files = [] }) {
    const me = parentMsgKey(mobile);
    const body = cleanMessage(text, files.length > 0);
    const from = { key: me, name: parentName };
    if (threadId) {
      const t = this.s.threads.get(threadId);
      if (!t?.members.includes(me)) throw new Error('This conversation is not yours.');
      const msg = buildMessage({ thread: t, from, text: body, files: this.saveAttachments(t, from, files) });
      this.s.threads.set(t.id, afterMessage(t, msg));
      this.s.messages.set(msg.id, msg);
      this.emit();
      return t.id;
    }
    const stu = this.s.students.get(studentId);
    const sec = this.s.sections.get(this.activeEnrollment(studentId)?.sectionId);
    const teachers = this.classTeachers(sec);
    const others = (to ?? []).map((k) => (k === OFFICE ? { key: OFFICE, name: OFFICE_NAME } : teachers.find((x) => x.key === k))).filter(Boolean);
    if (!others.length) throw new Error('Choose who to send it to.');
    const members = orderMembers([me, ...others.map((o) => o.key)]);
    const same = [...this.s.threads.values()].find((t) => t.members.join() === members.join() && t.studentId === studentId);
    if (same) return this.demoParentSend({ mobile, parentName, threadId: same.id, text: body, files });
    const thread = buildThread({ from, others, about: { mobile, parentName, studentId, studentName: `${stu.firstName} ${stu.lastName}`, sectionId: sec?.id ?? '' }, text: body, files });
    const msg = buildMessage({ thread, from, text: body, files: this.saveAttachments(thread, from, files), at: thread.lastAt });
    this.s.threads.set(thread.id, thread);
    this.s.messages.set(msg.id, msg);
    this.emit();
    return thread.id;
  },
  demoParentRead(mobile, threadId) {
    const me = parentMsgKey(mobile);
    const t = this.s.threads.get(threadId);
    if (!t || !isUnread(t, me)) return;
    this.s.threads.set(t.id, { ...t, readAt: { ...(t.readAt ?? {}), [me]: t.lastAt } });
    this.emit();
  },
};
