import { useEffect, useState } from "react";
import { toast } from "sonner";
import { httpsCallable } from "firebase/functions";
import { Copy, KeyRound, Loader2, Power } from "lucide-react";
import { ActionSheet } from "@/components/ActionSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDb } from "@/hooks/useDb";
import { createAuthUser, functions } from "@/lib/firebase";
import { authErrorMessage } from "@/lib/authErrors";
import { flush, loadDb, uid, updateDbAs, type Designer } from "@/lib/db";
import { designerLogin } from "@/lib/designers";

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]{2,}$/;

/**
 * A designer's own login (admins): give one — an email and a password — change
 * its email or password, or switch it off and on. With it they sign in to their
 * own screens (pages/designer/): the designs given to them, their files and,
 * for a freelancer, their money — never anything else. The password lives in
 * the sign-in service only, never on a record. An in-house designer's login is
 * a second one, apart from their employee login.
 */
export function DesignerLoginSheet({ designer, open, onOpenChange }: { designer: Designer | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const db = useDb();
  const login = designer ? designerLogin(db, designer.id) : undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !designer) return;
    setEmail(designerLogin(loadDb(), designer.id)?.email || designer.email || "");
    setPassword("");
  }, [open, designer?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!designer) return null;
  const cleanEmail = email.trim().toLowerCase();
  const emailTaken = (e: string) => loadDb().users.some(u => (u.email ?? "").toLowerCase() === e && u.id !== login?.id);
  const on = login?.status !== "inactive";

  const giveLogin = async () => {
    if (!EMAIL_RE.test(cleanEmail)) { toast.error("Enter their email — it is what they sign in with"); return; }
    if (password.length < 6) { toast.error("The password needs at least 6 characters"); return; }
    if (emailTaken(cleanEmail)) { toast.error("That email is already used by another login"); return; }
    if (designerLogin(loadDb(), designer.id)) { toast.error("They already have a login"); return; }
    setBusy(true);
    try {
      const authUid = await createAuthUser(cleanEmail, password);
      updateDbAs({ summary: `Designer ${designer.name}: login given (${cleanEmail})` }, d => {
        d.users.push({
          id: uid("u_"), authUid, username: cleanEmail, password: "", role: "designer", designerId: designer.id,
          name: designer.name, email: cleanEmail, ...(designer.phone ? { phone: designer.phone } : {}),
          status: designer.active === false ? "inactive" : "active", createdAt: new Date().toISOString(),
        });
      });
      // Their sign-in record goes up just after — wait for it before saying it works.
      await flush();
      setPassword("");
      toast.success(`${designer.name} can now sign in with ${cleanEmail}`);
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
        updateDbAs({ summary: `Designer ${designer.name}: login email changed` }, d => {
          const u = d.users.find(x => x.id === login.id);
          if (u) { u.email = newEmail; u.username = newEmail; }
        });
      }
      setPassword("");
      toast.success([newEmail && `They now sign in with ${newEmail}`, password && "new password set — they are signed out everywhere"].filter(Boolean).join(" · "));
    } catch (e) {
      toast.error((e as { message?: string }).message || "The login couldn't be changed");
    } finally { setBusy(false); }
  };

  const switchLogin = () => {
    if (!login) return;
    updateDbAs({ summary: `Designer ${designer.name}: login switched ${on ? "off" : "on"}` }, d => {
      const u = d.users.find(x => x.id === login.id);
      if (u) u.status = on ? "inactive" : "active";
    });
    toast.success(on ? `${designer.name}'s login is off — they are signed out` : `${designer.name} can sign in again`);
  };

  const copyDetails = () => {
    const text = `${typeof window !== "undefined" ? window.location.origin : ""}\nEmail: ${login?.email ?? cleanEmail}`;
    navigator.clipboard?.writeText(text).then(() => toast.success("Copied — send it with the password"), () => toast.error("Couldn't copy"));
  };

  return (
    <ActionSheet open={open} onOpenChange={onOpenChange} title="Designer login" icon={KeyRound}
      description={`${designer.name} — signs in to see only the designs given to them, add their files and hand them in${designer.kind === "freelance" ? ", and their own money" : ""}. Never any client, price or other order.`}
      footer={
        <div className="flex items-center justify-end gap-2 w-full">
          <Button type="button" variant="outline" className="rounded-xl" onClick={() => onOpenChange(false)}>Close</Button>
          <Button type="button" className="rounded-xl gap-2" disabled={busy} onClick={login ? changeLogin : giveLogin}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{login ? "Save login" : "Give a login"}
          </Button>
        </div>
      }>
      <div className="space-y-4">
        <div className="rounded-xl border border-border/70 px-4 py-3 text-sm">
          {login
            ? <p><span className="font-medium text-foreground">{on ? "Signs in" : "Switched off"}</span> <span className="text-muted-foreground">as {login.email}</span></p>
            : <p className="text-muted-foreground">No login yet — give one below.</p>}
          {designer.kind === "inhouse" && <p className="mt-1 text-xs text-muted-foreground">A second login, apart from their employee one — use a different email.</p>}
          {designer.active === false && <p className="mt-1 text-xs text-amber-800">This designer is switched off: they can sign in and look, but can't add files or hand anything in.</p>}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label htmlFor="dl-email" className="text-xs">Email (login ID)</Label>
            <Input id="dl-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" className="rounded-xl mt-1" />
          </div>
          <div>
            <Label htmlFor="dl-pass" className="text-xs">{login ? "New password · optional" : "Password"}</Label>
            <Input id="dl-pass" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" className="rounded-xl mt-1"
              placeholder={login ? "Leave empty to keep it" : "At least 6 characters"} />
          </div>
        </div>
        {login && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" className="rounded-lg gap-1.5" onClick={copyDetails}><Copy className="h-3.5 w-3.5" />Copy app address &amp; email</Button>
            <Button type="button" variant="outline" size="sm" className={`rounded-lg gap-1.5 ${on ? "text-destructive" : ""}`} onClick={switchLogin}><Power className="h-3.5 w-3.5" />{on ? "Switch login off" : "Switch login on"}</Button>
          </div>
        )}
      </div>
    </ActionSheet>
  );
}
