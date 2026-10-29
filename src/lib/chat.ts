// Messages, the way WhatsApp does them: one-to-one and group conversations,
// photos, files and voice notes, replies, reactions, ✓ sent / blue ✓✓ read,
// edit and delete for everyone, forwarding, an order shared as a card.
//
// Nothing here writes on its own in the background — no "typing…", no
// "delivered" marks, no faster heartbeat: each would be a steady stream of
// database writes (the bill). Only what someone does is written.
//
// A new message is written like any record (updateDb). What changes on a
// message afterwards — its ticks, a reaction, an edit, a delete — is written
// to those fields only, never the whole message: two phones touching the same
// message at once (one reading it, one editing it) must not undo each other.
import { deleteField, doc, writeBatch } from "firebase/firestore";
import { db as fsdb } from "./firebase";
import { loadDb, updateDb, uid, type ChatAttachment, type ChatGroup, type Message, type User } from "./db";
import { notifyUsers } from "./notify";
import { uploadDataUrl, uploadFile } from "./storage";
import { compressImage } from "./images";

/** A conversation: with one person, or a group. */
export type Convo =
  | { kind: "person"; id: string; user: User }
  | { kind: "group"; id: string; group: ChatGroup };

export const GROUP_PREFIX = "g_";
export const isGroupId = (id: string) => id.startsWith(GROUP_PREFIX);

/** Whether a message belongs to the conversation `convoId` as `me` sees it. */
export function inConvo(m: Message, me: string, convoId: string): boolean {
  if (m.chatId) return m.chatId === convoId;
  return (m.fromUserId === me && m.toUserId === convoId) || (m.fromUserId === convoId && m.toUserId === me);
}

/** The conversation a message is in, as `me` sees it: the group, or the other person. */
export function convoIdOf(m: Message, me: string): string {
  return m.chatId ?? (m.fromUserId === me ? m.toUserId : m.fromUserId);
}

/** Not yet read by `me`. */
export function isUnread(m: Message, me: string): boolean {
  if (m.fromUserId === me || m.deletedAt) return false;
  if (m.chatId) return !m.readBy?.[me] && (m.members ?? []).includes(me);
  return m.toUserId === me && !m.read;
}

/** ✓ sent · blue ✓✓ read (in a group: read by everyone in it). */
export function tickOf(m: Message): "sent" | "read" {
  if (m.chatId) {
    const others = (m.members ?? []).filter(x => x !== m.fromUserId);
    return others.length && others.every(x => m.readBy?.[x]) ? "read" : "sent";
  }
  return m.read || m.readAt ? "read" : "sent";
}

/** A message in a line: its words, or what it carries. */
export function previewOf(m: Pick<Message, "text" | "attachments" | "orderCard" | "deletedAt">): string {
  if (m.deletedAt) return "This message was deleted";
  const a = m.attachments?.[0];
  const what = a ? (a.kind === "image" ? `📷 ${m.attachments!.length > 1 ? `${m.attachments!.length} photos` : "Photo"}` : a.kind === "voice" ? "🎤 Voice message" : `📄 ${a.name || "File"}`)
    : m.orderCard ? `📦 Order ${m.orderCard.orderNumber}` : "";
  // Never trusted to be words: one written some other way must not break the page.
  const text = String(m.text ?? "").trim();
  return what && text ? `${what} · ${text}` : what || text;
}

/** How long after sending a message can still be edited (as WhatsApp). */
export const EDIT_WINDOW_MS = 15 * 60 * 1000;
export const canEditMessage = (m: Message, me: string) =>
  m.fromUserId === me && !m.deletedAt && !!String(m.text ?? "").trim() && Date.now() - new Date(m.createdAt).getTime() < EDIT_WINDOW_MS;

/** Delete for everyone: your own; staff may take down anyone's (as before). */
export const canDeleteForAll = (m: Message, me: User) => !m.deletedAt && (m.fromUserId === me.id || me.role !== "client");

/* ── Sending ── */

export interface Draft {
  text: string;
  attachments?: ChatAttachment[];
  replyTo?: Message;
  orderCard?: Message["orderCard"];
  forwarded?: boolean;
}

/** Sent; throws (nothing written) when the conversation can't take it. */
export function sendMessage(convoId: string, me: Pick<User, "id" | "name">, draft: Draft): void {
  const text = draft.text.trim();
  if (!text && !draft.attachments?.length && !draft.orderCard) return;
  updateDb(d => {
    const group = isGroupId(convoId) ? d.chats.find(g => g.id === convoId) : undefined;
    if (isGroupId(convoId) && !group) throw new Error("This group is not there any more");
    if (group && !group.memberIds.includes(me.id)) throw new Error("You are no longer in this group");
    const members = group ? [...group.memberIds] : [me.id, convoId];
    const m: Message = {
      id: uid("m_"), fromUserId: me.id, toUserId: convoId, text, createdAt: new Date().toISOString(), read: false, members,
    };
    if (group) m.chatId = group.id;
    if (draft.attachments?.length) m.attachments = draft.attachments;
    if (draft.orderCard) m.orderCard = draft.orderCard;
    if (draft.forwarded) m.forwarded = true;
    if (draft.replyTo) {
      const r = draft.replyTo;
      m.replyTo = { id: r.id, fromUserId: r.fromUserId, text: previewOf(r).slice(0, 160) };
      if (r.attachments?.[0]) m.replyTo.kind = r.attachments[0].kind;
    }
    d.messages.push(m);
    // The others hear of it in Alerts (and on their phone), not only when they next open Messages.
    const preview = previewOf(m);
    const short = preview.length > 140 ? `${preview.slice(0, 140)}…` : preview;
    notifyUsers(d, members, {
      title: alertTitleOf(group ? group.name : undefined, me.name),
      body: group ? `${me.name}: ${short}` : short,
      type: "message",
    }, me.id);
  });
}

/** The title of the alert a message makes — the same one Messages marks read as the conversation is opened. */
export function alertTitleOf(groupName: string | undefined, fromName: string): string {
  return groupName ? `Message in ${groupName}` : `Message from ${fromName}`;
}

/** Where a conversation's files go in Storage. */
const folderOf = (convoId: string, me: string) => `messages/${isGroupId(convoId) ? convoId : [me, convoId].sort().join("__")}`;

/** A file up to this size can be sent. */
export const MAX_FILE_MB = 25;

/** A picked file, uploaded: a photo at chat size (as WhatsApp sends it), anything else as it is. */
export async function uploadAttachment(file: File, convoId: string, me: string, onProgress?: (pct: number) => void): Promise<ChatAttachment> {
  if (file.size > MAX_FILE_MB * 1024 * 1024) throw new Error(`${file.name} is over ${MAX_FILE_MB} MB`);
  const folder = folderOf(convoId, me);
  if (file.type.startsWith("image/") && !/gif|svg/.test(file.type)) {
    const url = await uploadDataUrl(await compressImage(file, 1600, 0.85), folder);
    return { kind: "image", url, name: file.name, mime: "image/jpeg" };
  }
  const url = await uploadFile(file, folder, onProgress);
  return { kind: file.type.startsWith("image/") ? "image" : "file", url, name: file.name, size: file.size, mime: file.type || undefined };
}

/** A recorded voice note, uploaded. */
export async function uploadVoice(blob: Blob, seconds: number, convoId: string, me: string): Promise<ChatAttachment> {
  const mime = blob.type || "audio/webm";
  const ext = mime.includes("mp4") || mime.includes("aac") ? "m4a" : mime.includes("ogg") ? "ogg" : "webm";
  const file = new File([blob], `voice-${Date.now()}.${ext}`, { type: mime });
  const url = await uploadFile(file, folderOf(convoId, me));
  return { kind: "voice", url, mime, seconds: Math.max(1, Math.round(seconds)), size: blob.size };
}

/* ── After sending: fields only (see the top of this file) ── */

async function patchMessages(updates: { id: string; data: Record<string, unknown> }[]): Promise<void> {
  for (let i = 0; i < updates.length; i += 400) {
    const b = writeBatch(fsdb);
    for (const u of updates.slice(i, i + 400)) b.update(doc(fsdb, "messages", u.id), u.data);
    await b.commit();
  }
}

/** Read now (an open conversation, on screen): blue ✓✓ for their senders. */
export async function markRead(messages: Message[], me: string): Promise<void> {
  const at = new Date().toISOString();
  const ups = messages
    .filter(m => isUnread(m, me))
    .map(m => ({ id: m.id, data: m.chatId ? { [`readBy.${me}`]: at } : { read: true, readAt: at } }));
  if (ups.length) await patchMessages(ups);
}

/** 👍 under a message — or taken off (null, or the same one again). */
export async function react(m: Message, me: string, emoji: string | null): Promise<void> {
  const same = m.reactions?.[me] === emoji;
  await patchMessages([{ id: m.id, data: { [`reactions.${me}`]: emoji && !same ? emoji : deleteField() } }]);
}

export async function editMessage(m: Message, me: string, text: string): Promise<void> {
  const t = text.trim();
  if (!t) throw new Error("Type the message — or delete it for everyone");
  if (!canEditMessage(m, me)) throw new Error("A message can be edited for 15 minutes after it is sent");
  await patchMessages([{ id: m.id, data: { text: t, editedAt: new Date().toISOString() } }]);
}

/** Gone for everyone: "This message was deleted" stays in its place. (The files stay in
 *  Storage — a forwarded copy may still show them.) */
export async function deleteForEveryone(m: Message): Promise<void> {
  await patchMessages([{ id: m.id, data: { deletedAt: new Date().toISOString(), text: "", attachments: deleteField(), orderCard: deleteField(), reactions: deleteField() } }]);
}

/** A message sent on to other conversations, marked forwarded. */
export function forwardMessage(m: Message, toConvoIds: string[], me: Pick<User, "id" | "name">): number {
  let n = 0;
  for (const id of toConvoIds) {
    sendMessage(id, me, { text: m.text, attachments: m.attachments, orderCard: m.orderCard, forwarded: true });
    n++;
  }
  return n;
}

/* ── Online / last seen — from the heartbeat the app already sends (no extra writes) ── */

/** The heartbeat comes every 5 minutes (lib/presence.ts): seen within this is "online". */
const CHAT_ONLINE_MS = 6 * 60 * 1000;
export function presenceOf(u: Pick<User, "lastActiveAt"> | undefined): { online: boolean; text: string } {
  const at = u?.lastActiveAt;
  if (!at) return { online: false, text: "" };
  const t = new Date(at);
  if (Date.now() - t.getTime() < CHAT_ONLINE_MS) return { online: true, text: "online" };
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const time = t.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (sameDay(t, now)) return { online: false, text: `last seen today at ${time}` };
  if (sameDay(t, yest)) return { online: false, text: `last seen yesterday at ${time}` };
  return { online: false, text: `last seen ${t.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` };
}

/* ── Groups ── */

/** Staff make groups; the people in it are picked from those they may write to. */
export function createGroup(name: string, memberIds: string[], me: Pick<User, "id">): string {
  const n = name.trim();
  if (!n) throw new Error("Give the group a name");
  const members = [...new Set([me.id, ...memberIds])];
  if (members.length < 3) throw new Error("A group needs at least two other people");
  const id = uid(GROUP_PREFIX);
  updateDb(d => {
    d.chats.push({ id, name: n, memberIds: members, createdBy: me.id, createdAt: new Date().toISOString() });
  });
  return id;
}

/** Rename, add or take people off. The messages already sent stay with those who had them. */
export function updateGroup(id: string, change: { name?: string; memberIds?: string[] }): void {
  updateDb(d => {
    const g = d.chats.find(x => x.id === id);
    if (!g) throw new Error("This group is not there any more");
    if (change.name !== undefined) {
      const n = change.name.trim();
      if (!n) throw new Error("Give the group a name");
      g.name = n;
    }
    if (change.memberIds) g.memberIds = [...new Set(change.memberIds)];
    g.updatedAt = new Date().toISOString();
  });
}

export function leaveGroup(id: string, me: string): void {
  const g = loadDb().chats.find(x => x.id === id);
  if (!g) return;
  updateGroup(id, { memberIds: g.memberIds.filter(x => x !== me) });
}

/* ── The conversation open on screen (Messages sets it), for the alerts ── */

let openId: string | null = null;
export const openConvo = () => openId;
export const setOpenConvo = (id: string | null) => { openId = id; };
