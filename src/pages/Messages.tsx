import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { loadDb, updateDb, uid } from "@/lib/db";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Send, ArrowLeft } from "lucide-react";

export function MessagesPage() {
  const { user } = useAuth();
  const [db, setDb] = useState(loadDb());
  useEffect(() => { const h = () => setDb(loadDb()); window.addEventListener("starlink-db-updated", h); return () => window.removeEventListener("starlink-db-updated", h); }, []);

  // Client: only Admin(s) + the employee assigned to their account (if any).
  // Employee: only Admin(s) + the clients assigned to them.
  // Admin: everyone.
  const myClient = user!.role === "client" ? db.clients.find(c => c.id === user!.clientId) : undefined;

  const contacts = user!.role === "admin"
    ? [...db.users.filter(u => u.id !== user!.id)]
    : user!.role === "client"
    ? db.users.filter(u => u.role === "admin" || (u.role === "employee" && u.id === myClient?.accountManagerId))
    : db.users.filter(u => u.role === "admin" || (u.role === "client" && db.clients.find(c => c.id === u.clientId)?.accountManagerId === user!.id));

  const [selected, setSelected] = useState<string | null>(contacts[0]?.id || null);
  const [text, setText] = useState("");
  const [mobileView, setMobileView] = useState<"contacts" | "chat">("contacts");
  const endRef = useRef<HTMLDivElement>(null);
  const thread = db.messages.filter(m => (m.fromUserId === user!.id && m.toUserId === selected) || (m.fromUserId === selected && m.toUserId === user!.id)).sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [thread.length]);

  const send = () => {
    if (!text.trim() || !selected) return;
    updateDb(d => { d.messages.push({ id: uid("m_"), fromUserId: user!.id, toUserId: selected, text: text.trim(), createdAt: new Date().toISOString(), read: false }); });
    setText("");
  };

  const selectedContact = contacts.find(c => c.id === selected);

  const handleSelectContact = (id: string) => {
    setSelected(id);
    setMobileView("chat");
  };

  const unreadCount = (contactId: string) =>
    db.messages.filter(m => m.fromUserId === contactId && m.toUserId === user!.id && !m.read).length;

  return (
    <div className="max-w-6xl mx-auto h-[calc(100vh-10rem)]">
      {/* ── Desktop layout: side-by-side ── */}
      <div className="hidden md:grid md:grid-cols-[280px_1fr] gap-4 h-full">
        {/* Contact list */}
        <div className="card-luxe p-3 overflow-y-auto">
          <h2 className="font-display text-xl text-brand-dark px-2 mb-2">Messages</h2>
          {contacts.map(c => {
            const unread = unreadCount(c.id);
            return (
              <button key={c.id} onClick={() => setSelected(c.id)} className={`w-full flex items-center gap-3 p-2.5 rounded-xl transition ${selected === c.id ? "bg-primary/10" : "hover:bg-secondary"}`}>
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-sm grid place-items-center shrink-0">{c.name.charAt(0)}</div>
                <div className="min-w-0 text-left flex-1">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground capitalize">{c.role}</p>
                </div>
                {unread > 0 && (
                  <span className="h-5 min-w-[20px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center shrink-0">{unread}</span>
                )}
              </button>
            );
          })}
        </div>
        {/* Chat panel */}
        <div className="card-luxe flex flex-col overflow-hidden">
          {selectedContact && (
            <div className="px-4 py-3 border-b border-border/60 flex items-center gap-3">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-xs grid place-items-center shrink-0">{selectedContact.name.charAt(0)}</div>
              <div>
                <p className="text-sm font-semibold">{selectedContact.name}</p>
                <p className="text-xs text-muted-foreground capitalize">{selectedContact.role}</p>
              </div>
            </div>
          )}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {thread.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">No messages yet — say hello.</p>}
            {thread.map(m => {
              const mine = m.fromUserId === user!.id;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${mine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-secondary rounded-bl-md"}`}>
                    <p>{m.text}</p>
                    <p className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-muted-foreground"}`}>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          <div className="p-3 border-t flex gap-2">
            <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Type a message..." className="rounded-xl h-11" />
            <Button onClick={send} className="btn-hero rounded-xl h-11 w-11 p-0"><Send className="h-4 w-4" /></Button>
          </div>
        </div>
      </div>

      {/* ── Mobile layout: toggle between contacts and chat ── */}
      <div className="md:hidden flex flex-col h-full">
        {mobileView === "contacts" ? (
          /* Contact list full screen */
          <div className="card-luxe p-3 flex-1 overflow-y-auto">
            <h2 className="font-display text-xl text-brand-dark px-2 mb-3">Messages</h2>
            {contacts.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-10">No contacts available.</p>
            )}
            {contacts.map(c => {
              const unread = unreadCount(c.id);
              const lastMsg = db.messages
                .filter(m => (m.fromUserId === c.id && m.toUserId === user!.id) || (m.fromUserId === user!.id && m.toUserId === c.id))
                .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
              return (
                <button key={c.id} onClick={() => handleSelectContact(c.id)} className="w-full flex items-center gap-3 p-3 rounded-xl transition hover:bg-secondary active:bg-secondary/70 text-left">
                  <div className="relative">
                    <div className="h-12 w-12 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-base grid place-items-center shrink-0 font-semibold">{c.name.charAt(0)}</div>
                    {unread > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 h-5 min-w-[20px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold grid place-items-center">{unread}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{c.name}</p>
                      {lastMsg && <p className="text-[10px] text-muted-foreground shrink-0">{new Date(lastMsg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>}
                    </div>
                    <p className="text-xs text-muted-foreground capitalize">{c.role}</p>
                    {lastMsg && <p className="text-xs text-muted-foreground truncate mt-0.5">{lastMsg.fromUserId === user!.id ? "You: " : ""}{lastMsg.text}</p>}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          /* Chat view full screen */
          <div className="card-luxe flex flex-col flex-1 overflow-hidden">
            {/* Chat header with back button */}
            <div className="px-3 py-3 border-b border-border/60 flex items-center gap-3 shrink-0">
              <button onClick={() => setMobileView("contacts")} className="h-9 w-9 rounded-xl hover:bg-secondary flex items-center justify-center shrink-0 transition-colors">
                <ArrowLeft className="h-4 w-4" />
              </button>
              {selectedContact && (
                <>
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-sm grid place-items-center shrink-0">{selectedContact.name.charAt(0)}</div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{selectedContact.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{selectedContact.role}</p>
                  </div>
                </>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {thread.length === 0 && <p className="text-center text-sm text-muted-foreground py-10">No messages yet — say hello.</p>}
              {thread.map(m => {
                const mine = m.fromUserId === user!.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm ${mine ? "bg-primary text-primary-foreground rounded-br-md" : "bg-secondary rounded-bl-md"}`}>
                      <p>{m.text}</p>
                      <p className={`text-[10px] mt-1 ${mine ? "text-white/70" : "text-muted-foreground"}`}>{new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>
            <div className="p-3 border-t flex gap-2 shrink-0">
              <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} placeholder="Type a message..." className="rounded-xl h-11" />
              <Button onClick={send} className="btn-hero rounded-xl h-11 w-11 p-0"><Send className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
