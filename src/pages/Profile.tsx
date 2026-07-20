import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { updateDb } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";

export function ProfilePage() {
  const { user, logout, refresh } = useAuth();
  const nav = useNavigate();
  const [f, setF] = useState({ name: user!.name, email: user!.email, phone: user!.phone || "", password: "" });
  const save = () => { updateDb(d => { const u = d.users.find(u => u.id === user!.id)!; u.name = f.name; u.email = f.email; u.phone = f.phone; if (f.password) u.password = f.password; }); refresh(); toast.success("Profile updated"); };

  return (
    <div className="max-w-xl mx-auto space-y-4">
      <h1 className="font-display text-2xl md:text-3xl text-brand-dark">My Profile</h1>
      <div className="card-luxe p-6 text-center">
        <div className="h-24 w-24 mx-auto rounded-full bg-gradient-to-br from-primary to-brand-dark text-white text-4xl font-semibold grid place-items-center shadow-luxe">{user!.name.charAt(0)}</div>
        <p className="font-display text-2xl mt-3 text-brand-dark">{user!.name}</p>
        <p className="text-sm text-muted-foreground capitalize">{user!.role}{user!.department ? ` - ${user!.department}` : ""}</p>
      </div>
      <div className="card-luxe p-6 space-y-3">
        {(["name","email","phone"] as const).map(k => <div key={k}><Label className="text-xs capitalize">{k}</Label><Input value={(f as any)[k]} onChange={e => setF({ ...f, [k]: e.target.value })} className="rounded-xl mt-1" /></div>)}
        <div><Label className="text-xs">New Password (leave blank to keep)</Label><Input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} className="rounded-xl mt-1" /></div>
        <Button onClick={save} className="btn-hero rounded-xl w-full">Save Changes</Button>
      </div>
      <Button variant="outline" onClick={() => { logout(); nav("/login"); }} className="rounded-xl w-full text-destructive"><LogOut className="h-4 w-4 mr-2" />Sign Out</Button>
    </div>
  );
}
