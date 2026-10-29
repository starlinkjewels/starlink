import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { useDb } from "@/hooks/useDb";
import { useDataFresh } from "@/hooks/useDataFresh";
import { collectionsFresh } from "@/lib/db";
import { convoIdOf, isUnread, openConvo, previewOf } from "@/lib/chat";
import { playInChat, playIncoming } from "@/lib/chatSound";

/**
 * A message coming in, wherever in the app its person is: a tone, and a pop-up
 * with who wrote and what ("Open" goes to it) — just a quieter tone when that
 * conversation is already open on screen. In another browser tab, or with the
 * app in the background, the alert itself (push) tells them, as before.
 *
 * Only what arrives while the app is open counts: what was already there when
 * it opened is never announced again. Reads what the app already has — no
 * extra reads or writes.
 */
export function useChatAlerts(): void {
  const { user } = useAuth();
  const db = useDb();
  const nav = useNavigate();
  const fresh = useDataFresh();
  // What was already here, for whom — a different person signed in starts again.
  const seen = useRef<{ who: string; ids: Set<string> } | null>(null);
  const me = user?.id;

  useEffect(() => {
    if (!me || !fresh || !collectionsFresh(["messages"])) return;
    const toMe = db.messages.filter(m => m.fromUserId !== me && (m.chatId ? (m.members ?? []).includes(me) : m.toUserId === me));
    if (seen.current?.who !== me) { seen.current = { who: me, ids: new Set(toMe.map(m => m.id)) }; return; }
    const known = seen.current.ids;
    const arrived = toMe.filter(m => !known.has(m.id));
    if (!arrived.length) return;
    for (const m of arrived) known.add(m.id);
    const news = arrived
      .filter(m => isUnread(m, me) && Date.now() - new Date(m.createdAt).getTime() < 5 * 60 * 1000)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const last = news[news.length - 1];
    if (!last) return;
    const convo = convoIdOf(last, me);
    const onScreen = document.visibilityState === "visible";
    if (onScreen && openConvo() === convo) { playInChat(); return; }
    playIncoming();
    if (!onScreen) return;
    const from = db.users.find(u => u.id === last.fromUserId)?.name ?? "Someone";
    const group = last.chatId ? db.chats.find(g => g.id === last.chatId) : undefined;
    const more = news.length > 1 ? ` (+${news.length - 1} more)` : "";
    toast(group ? group.name : from, {
      id: `chat-${convo}`,
      description: `${group ? `${from}: ` : ""}${previewOf(last)}${more}`,
      action: { label: "Open", onClick: () => nav(`/messages?c=${encodeURIComponent(convo)}`) },
    });
  }, [db.messages, db.users, db.chats, me, fresh, nav]);

}
