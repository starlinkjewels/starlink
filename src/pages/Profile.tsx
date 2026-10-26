import { useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { updateDb } from "@/lib/db";
import { auth } from "@/lib/firebase";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { avatarFromFile } from "@/lib/images";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { useDb } from "@/hooks/useDb";
import { UserAvatar } from "@/components/UserAvatar";
import { Camera, KeyRound, LogOut, Trash2 } from "lucide-react";

export function ProfilePage() {
  const { user, logout, refresh } = useAuth();
  const nav = useNavigate();
  // The record itself, followed live: the store is edited in place, so the
  // signed-in copy alone would not redraw when the photo changes.
  const db = useDb();
  const me = db.users.find(u => u.id === user!.id) ?? user!;
  const [f, setF] = useState({ name: user!.name, email: user!.email, phone: user!.phone || "" });
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [pwSaving, setPwSaving] = useState(false);

  const save = () => {
    setSaving(true);
    updateDb(d => {
      const u = d.users.find(u => u.id === user!.id)!;
      u.name = f.name; u.email = f.email; u.phone = f.phone;
    });
    refresh();
    setSaving(false);
    toast.success("Profile updated");
  };

  // The photo sits on the person's own record — shown beside their name in
  // Messages, the top bar and the staff lists.
  const setPhoto = (photo: string | undefined) => {
    updateDb(d => {
      const u = d.users.find(u => u.id === user!.id);
      if (!u) return;
      if (photo) u.photo = photo; else delete u.photo;
    });
    refresh();
  };
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Choose a picture (JPG, PNG or HEIC)."); return; }
    try {
      setPhoto(await avatarFromFile(file));
      toast.success("Photo updated");
    } catch {
      toast.error("That picture could not be read — try another one.");
    }
  };

  // Passwords live in Firebase Auth, never in the database. The current one is
  // asked for first: Auth refuses a change on a session that is not fresh, and
  // it keeps someone at an unlocked screen from changing it.
  const changePassword = async () => {
    if (!pw.current) { toast.error("Enter your current password."); return; }
    if (pw.next.length < 6) { toast.error("The new password needs at least 6 characters."); return; }
    if (pw.next !== pw.again) { toast.error("The two new passwords are not the same."); return; }
    if (pw.next === pw.current) { toast.error("The new password is the same as the current one."); return; }
    const cur = auth.currentUser;
    if (!cur?.email) { toast.error("Please sign out and back in, then try again."); return; }
    setPwSaving(true);
    try {
      await reauthenticateWithCredential(cur, EmailAuthProvider.credential(cur.email, pw.current));
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code ?? "";
      toast.error(code === "auth/wrong-password" || code === "auth/invalid-credential" || code === "auth/invalid-login-credentials"
        ? "The current password is not right." : authErrorMessage(err));
      setPwSaving(false);
      return;
    }
    try {
      await updatePassword(cur, pw.next);
      setPw({ current: "", next: "", again: "" });
      toast.success("Password changed — use the new one next time you sign in");
    } catch (err: unknown) {
      toast.error(authErrorMessage(err));
    }
    setPwSaving(false);
  };

  return (
    <div className="space-y-4">
      <PageHeader title="My Profile" />
      {/* The whole width: who you are on the left, your details beside it. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] items-start">
        <div className="space-y-4">
          <div className="card-luxe p-6 text-center">
            <div className="relative h-24 w-24 mx-auto">
              <UserAvatar photo={me.photo} name={me.name} className="h-24 w-24 rounded-full text-4xl font-semibold shadow-luxe" />
              <button type="button" onClick={() => fileRef.current?.click()} aria-label={me.photo ? "Change photo" : "Add a photo"} title={me.photo ? "Change photo" : "Add a photo"}
                className="absolute -bottom-1 -right-1 h-9 w-9 rounded-full bg-white border border-border shadow-sm grid place-items-center text-primary hover:bg-primary/10">
                <Camera className="h-4 w-4" />
              </button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden"
              onChange={e => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} />
            <p className="font-display text-2xl mt-3 text-brand-dark">{me.name}</p>
            <p className="text-sm text-muted-foreground capitalize">{user!.role}{user!.department ? ` - ${user!.department}` : ""}</p>
            <div className="mt-3 flex justify-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} className="rounded-xl gap-1.5">
                <Camera className="h-3.5 w-3.5" /> {me.photo ? "Change photo" : "Add photo"}
              </Button>
              {me.photo && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setPhoto(undefined); toast.success("Photo removed"); }} className="rounded-xl gap-1.5 text-muted-foreground">
                  <Trash2 className="h-3.5 w-3.5" /> Remove
                </Button>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={() => { logout(); nav("/login"); }} className="rounded-xl w-full text-destructive max-lg:hidden"><LogOut className="h-4 w-4 mr-2" />Sign Out</Button>
        </div>
        <div className="space-y-4 min-w-0">
          <div className="card-luxe p-6 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {(["name","email","phone"] as const).map(k => <div key={k}><Label className="text-xs capitalize">{k}</Label><Input value={f[k]} onChange={e => setF({ ...f, [k]: e.target.value })} className="rounded-xl mt-1" /></div>)}
            </div>
            <div className="flex justify-end">
              <Button onClick={save} disabled={saving} className="btn-hero rounded-xl max-sm:w-full sm:px-8">{saving ? "Saving…" : "Save Changes"}</Button>
            </div>
          </div>

          <form className="card-luxe p-6 space-y-4" noValidate onSubmit={e => { e.preventDefault(); void changePassword(); }}>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" />
              <p className="font-semibold text-brand-dark">Change password</p>
            </div>
            {/* The browser's own password manager fills these in, so the names say which is which. */}
            <input type="email" name="username" autoComplete="username" value={auth.currentUser?.email ?? user!.email} readOnly hidden />
            <div className="grid gap-4 sm:grid-cols-3">
              <div><Label className="text-xs">Current password</Label><Input type="password" autoComplete="current-password" value={pw.current} onChange={e => setPw({ ...pw, current: e.target.value })} className="rounded-xl mt-1" /></div>
              <div><Label className="text-xs">New password</Label><Input type="password" autoComplete="new-password" value={pw.next} onChange={e => setPw({ ...pw, next: e.target.value })} className="rounded-xl mt-1" placeholder="at least 6 characters" /></div>
              <div><Label className="text-xs">New password again</Label><Input type="password" autoComplete="new-password" value={pw.again} onChange={e => setPw({ ...pw, again: e.target.value })} className="rounded-xl mt-1" /></div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" variant="outline" disabled={pwSaving || !pw.current || !pw.next} className="rounded-xl max-sm:w-full sm:px-6">{pwSaving ? "Changing…" : "Change password"}</Button>
            </div>
          </form>
        </div>
      </div>
      <Button variant="outline" onClick={() => { logout(); nav("/login"); }} className="rounded-xl w-full text-destructive lg:hidden"><LogOut className="h-4 w-4 mr-2" />Sign Out</Button>
    </div>
  );
}
