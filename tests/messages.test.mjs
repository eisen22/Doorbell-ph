// Messages: parents, teachers and the school office (src/messaging.js, engine/messages.js).
import { world, check } from './helpers.mjs';
import { OFFICE, teacherKey, parentMsgKey, isUnread } from '../src/messaging.js';
import { parentKeyOf } from '../src/logic.js';
const SEC = 'sec-k-sampaguita', SEC2 = 'sec-2-narra';
{
  const w = world();
  check('S0 the sample school has conversations', w.state.threads.size >= 3 && w.state.messages.size >= 8);
  const sec = w.state.sections.get(SEC), sec2 = w.state.sections.get(SEC2);
  const adviser = [...w.state.users.values()].find((u) => u.teacherId === sec.teacherId);
  const [a] = w.roster(SEC); const [b] = w.roster(SEC2);
  const gA = w.eng.guardianOf(a.id); const pA = parentMsgKey(parentKeyOf(gA.mobile));
  // Teacher -> parent of a child in their class, with the office included (3-way)
  w.as(adviser.uid);
  const id = await w.eng.startThread({ to: [pA, OFFICE], studentId: a.id, text: '  Hello po, quick question about the field trip.  ' });
  const t = w.state.threads.get(id);
  check('M1 teacher starts a 3-way conversation', t.members.join() === [pA, teacherKey(sec.teacherId), OFFICE].join(), t.members.join());
  check('M1 message saved and trimmed', [...w.state.messages.values()].some((m) => m.threadId === id && m.text === 'Hello po, quick question about the field trip.'));
  check('M1 thread and message are saved to the cloud', w.log.some((l) => l[1] === 'threads' && l[2] === id) && w.log.some((l) => l[1] === 'messages' && l[3].threadId === id));
  check('M1 rules fields: parent, section, office', t.parent === parentKeyOf(gA.mobile) && t.sectionId === SEC && t.office === true && t.studentId === a.id);
  // Same people again: same conversation
  const again = await w.eng.startThread({ to: [OFFICE, pA], studentId: a.id, text: 'One more thing.' });
  check('M1 same people + child continue the same conversation', again === id);
  // Teacher cannot message a parent of another class
  let err = ''; try { await w.eng.startThread({ to: [parentMsgKey(parentKeyOf(w.eng.guardianOf(b.id).mobile))], studentId: b.id, text: 'hi' }); } catch (e) { err = e.message; }
  check('M2 teacher cannot message a parent outside their classes', /your classes/.test(err) || sec2.teacherId === sec.teacherId, err);
  err = ''; try { await w.eng.startThread({ to: [OFFICE], text: '   ' }); } catch (e) { err = e.message; }
  check('M2 empty message refused', /Type a message/.test(err));
  err = ''; try { await w.eng.startThread({ to: [OFFICE], text: 'x'.repeat(1001) }); } catch (e) { err = e.message; }
  check('M2 over 1000 characters refused', /1000/.test(err));
  // Office sees it unread, reads it, answers
  w.as('u-admin');
  let list = await w.eng.listThreads();
  const mine = list.find((x) => x.id === id);
  check('M3 office sees the conversation as unread', mine?.unread === true && (await w.eng.unreadMessageCount()) >= 1);
  await w.eng.markThreadRead(id);
  check('M3 opening marks it read', !isUnread(w.state.threads.get(id), OFFICE));
  await w.eng.sendMessage(id, 'Noted, thank you.');
  w.as(adviser.uid);
  check('M3 the teacher sees the office reply as unread', (await w.eng.listThreads()).find((x) => x.id === id).unread);
  // Parent side (demo): parent replies; teacher sees it
  const mob = parentKeyOf(gA.mobile);
  w.eng.demoParentSend({ mobile: mob, parentName: gA.name, threadId: id, text: 'Yes po, she will join.' });
  const view = w.eng.demoParentMessages(mob);
  check('M4 the parent sees their conversation and its messages', view.threads.some((x) => x.id === id) && view.messages.filter((m) => m.threadId === id).length === 4);
  // Parent starts a new one with a subject-less class: adviser only
  const nid = w.eng.demoParentSend({ mobile: mob, parentName: gA.name, studentId: a.id, to: [teacherKey(sec.teacherId)], text: 'Good morning, Teacher.' });
  const nt = w.state.threads.get(nid);
  check('M4 parent starts a conversation with the adviser', nt.members.join() === [parentMsgKey(mob), teacherKey(sec.teacherId)].join() && nt.teacherId === sec.teacherId && nt.office === false);
  // Add the office later (3-way): older messages get the new member
  await w.eng.addToThread(nid, OFFICE);
  const grown = w.state.threads.get(nid);
  const msgs = [...w.state.messages.values()].filter((m) => m.threadId === nid);
  check('M5 adding the office: everyone in, older messages readable', grown.members.includes(OFFICE) && msgs.every((m) => m.members.includes(OFFICE)) && msgs.some((m) => m.system));
  err = ''; try { await w.eng.addToThread(nid, 't-nobody'); } catch (e) { err = e.message; }
  check('M5 cannot add someone who is not a teacher of the class', /cannot be added/.test(err));
  // Contacts: a teacher sees only parents of their classes; the portal lists the class teachers
  const c = await w.eng.messageContacts();
  check('M6 teacher contacts are their own classes only', c.parents.every((p) => w.state.sections.get(p.sectionId) && (p.sectionId === SEC || w.eng.session.sectionIds.includes(p.sectionId))) && c.office === true);
  const doc = w.eng.parentMonthDoc(a.id, w.clock.d.slice(0, 7));
  check('M6 parent portal month lists the class adviser', doc.contacts[0]?.key === teacherKey(sec.teacherId) && doc.contacts[0].role === 'Class adviser');
  await w.eng.syncParentKey(gA);
  const key = w.log.filter((l) => l[1] === 'parentKeys' && l[2] === mob).pop();
  check('M6 parent key lists the children’s classes (for the rules)', key?.[3].sectionIds?.includes(SEC));
}
// ---- oversight: the admin reviews a conversation the office is not in (logged) ----
{
  const w = world();
  const sec = w.state.sections.get(SEC);
  const adviser = [...w.state.users.values()].find((u) => u.teacherId === sec.teacherId);
  const [a] = w.roster(SEC); const gA = w.eng.guardianOf(a.id); const pA = parentMsgKey(parentKeyOf(gA.mobile));
  w.as(adviser.uid);
  const id = await w.eng.startThread({ to: [pA], studentId: a.id, text: 'Private note to the parent.' });
  w.as('u-admin');
  check('R1 not in the office inbox', !(await w.eng.listThreads()).some((t) => t.id === id));
  const row = (await w.eng.listAllThreads()).find((t) => t.id === id);
  check('R1 listed for review without the message text', row && !('lastText' in row) && row.people.length === 2 && row.reviews === 0);
  let err = ''; try { await w.eng.reviewThread(id, 'Child safety concern', 'short'); } catch (e) { err = e.message; }
  check('R2 a review needs an explanation', /10 characters/.test(err));
  err = ''; try { await w.eng.reviewThread(id, 'Curious', 'just looking around today'); } catch (e) { err = e.message; }
  check('R2 a review needs one of the reasons', /reason/.test(err));
  const r = await w.eng.reviewThread(id, 'Complaint from a parent', 'Parent called about a message on Nov 18.');
  const log = [...w.state.audit.values()].find((x) => x.action === 'messages.review' && x.threadId === id);
  check('R3 review is written to the audit log with the reason', log && /Complaint from a parent/.test(log.detail) && log.actor === 'Rosario Dizon');
  check('R3 the admin then sees the messages', r.messages.some((m) => m.text === 'Private note to the parent.'));
  check('R3 the people in it are not notified (no system message)', ![...w.state.messages.values()].some((m) => m.threadId === id && m.system));
  check('R3 review count shows', (await w.eng.listAllThreads()).find((t) => t.id === id).reviews === 1);
  w.as(adviser.uid);
  err = ''; try { await w.eng.reviewThread(id, 'Other', 'teacher trying to review'); } catch (e) { err = e.message; }
  check('R4 a teacher cannot review', /Only the school admin/.test(err) && (await w.eng.listAllThreads()).length === 0);
}
// ---- attachments ----
{
  const w = world();
  const sec = w.state.sections.get(SEC);
  const adviser = [...w.state.users.values()].find((u) => u.teacherId === sec.teacherId);
  const [a] = w.roster(SEC); const gA = w.eng.guardianOf(a.id); const mob = parentKeyOf(gA.mobile);
  const photo = { name: 'medcert.jpg', type: 'image/jpeg', size: 1234, data: 'QUJD' };
  // Parent sends only a photo (no text) to the adviser
  const tid = w.eng.demoParentSend({ mobile: mob, parentName: gA.name, studentId: a.id, to: [teacherKey(sec.teacherId)], text: '', files: [photo] });
  const msg = [...w.state.messages.values()].find((m) => m.threadId === tid);
  check('A1 a message can be only a photo', msg.text === '' && msg.files?.length === 1 && msg.files[0].name === 'medcert.jpg');
  check('A1 the message holds only the file details (not the file)', !('data' in msg.files[0]));
  check('A1 the inbox line says a file was sent', w.state.threads.get(tid).lastText === 'Sent medcert.jpg');
  const att = await w.eng.fetchAttachment(msg.files[0].id);
  check('A1 the file itself is its own document', att?.data === 'QUJD' && att.threadId === tid && att.from === parentMsgKey(mob));
  // Teacher replies with two files and text; saved to the cloud as attachments
  w.as(adviser.uid); w.log.length = 0;
  await w.eng.sendMessage(tid, 'Received, thank you.', [photo, { name: 'note.pdf', type: 'application/pdf', size: 99, data: 'JVBE' }]);
  check('A2 teacher attachments saved to the cloud', w.log.filter((l) => l[1] === 'attachments').length === 2);
  let err = ''; try { await w.eng.sendMessage(tid, 'x', [photo, photo, photo, photo]); } catch (e) { err = e.message; }
  check('A2 at most 3 files', /Up to 3/.test(err));
  err = ''; try { await w.eng.sendMessage(tid, '   ', []); } catch (e) { err = e.message; }
  check('A2 no text and no file is refused', /Type a message/.test(err));
}
