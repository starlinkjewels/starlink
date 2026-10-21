import { useState } from "react";
import { toast } from "sonner";
import { httpsCallable } from "firebase/functions";
import { KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDb } from "@/hooks/useDb";
import { createAuthUser, functions } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/authErrors";
import { flush, loadDb, uid, updateDb } from "@/lib/db";

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

/**
 * A client's sign-in, in Edit client (admin only):
 *   • no login yet — give one: their email and a password;
 *   • a login — change its email, or set a new password (they are signed out
 *     everywhere and sign in with the new one).
 * The password is never kept on any record — it lives in the sign-in service only.
 */
export function ClientLoginSection({ clientId }: { clientId: string }) {
  const db = useDb();
  const client = db.clients.find(c => c.id === clientId);
  const login = db.users.find(u => u.clientId === clientId && u.role === "client" && u.authUid);
  const [email, setEmail] = useState(login?.email || client?.email || "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  if (!client) return null;

  const cleanEmail = email.trim().toLowerCase();
  const emailTaken = (e: string) => loadDb().users.some(u => (u.email ?? "").toLowerCase() === e && u.id !== login?.id);

  const giveLogin = async () => {
    if (!EMAIL_RE.test(cleanEmail)) { toast.error("Enter their email — it is what they sign in with"); return; }
    if (password.length < 6) { toast.error("The password needs at least 6 characters"); return; }
    if (emailTaken(cleanEmail)) { toast.error("That email is already used by another login"); return; }
    setBusy(true);
    try {
      const authUid = await createAuthUser(cleanEmail, password);
      updateDb(d => {
        const c = d.clients.find(x => x.id === clientId);
        if (c) { c.email = cleanEmail; c.username = cleanEmail; }
        d.users.push({
          id: uid("u_"), authUid, username: cleanEmail, password: "", role: "client",
          name: client.ownerName || client.companyName, email: cleanEmail, phone: client.phone,
          status: client.status === "inactive" ? "inactive" : "active", clientId, createdAt: new Date().toISOString(),
        });
      });
      // The login's permission record goes up just after — wait for it before saying it works.
      await flush();
      setPassword("");
      toast.success(`${client.companyName} can now sign in with ${cleanEmail}`);
    } catch (e) {
      toast.error(authErrorMessage(e));
    } finally { setBusy(false); }
  };

  const changeLogin = async () => {
    if (!login?.authUid) return;
    const newEmail = cleanEmail !== (login.email ?? "").toLowerCase() ? cleanEmail : "";
    if (!newEmail && !password) { toast.error("Change the email or type a new password"); return; }
    if (newEmail && !EMAIL_RE.test(newEmail)) { toast.error("That email address doesn't look right"); return; }
    if (newEmail && emailTaken(newEmail)) { toast.error("That email is already used by another login"); return; }
    if (password && password.length < 6) { toast.error("The password needs at least 6 characters"); return; }
    setBusy(true);
    try {
      await httpsCallable(functions, "setClientLogin")({ authUid: login.authUid, ...(newEmail ? { email: newEmail } : {}), ...(password ? { password } : {}) });
      if (newEmail) {
        updateDb(d => {
          const u = d.users.find(x => x.id === login.id);
          if (u) { u.email = newEmail; u.username = newEmail; }
          const c = d.clients.find(x => x.id === clientId);
          if (c) { c.email = newEmail; c.username = newEmail; }
        });
      }
      setPassword("");
      toast.success([newEmail && `They now sign in with ${newEmail}`, password && "new password set — they are signed out everywhere"].filter(Boolean).join(" · "));
    } catch (e) {
      toast.error((e as { message?: string }).message || "The login couldn't be changed");
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-4 rounded-xl border border-border/70 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Login</p>
        <span className="text-xs text-muted-foreground">{login ? `signs in as ${login.email}` : "no login yet"}</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label htmlFor="cl-email" className="text-xs">Email (login ID)</Label>
          <Input id="cl-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" className="rounded-xl mt-1" />
        </div>
        <div>
          <Label htmlFor="cl-pass" className="text-xs">{login ? "New password · optional" : "Password"}</Label>
          <Input id="cl-pass" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className="rounded-xl mt-1"
            placeholder={login ? "Leave empty to keep it" : "At least 6 characters"} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="outline" className="rounded-xl gap-2" disabled={busy} onClick={login ? changeLogin : giveLogin}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}{login ? "Save login" : "Give a login"}
        </Button>
      </div>
    </div>
  );
}
