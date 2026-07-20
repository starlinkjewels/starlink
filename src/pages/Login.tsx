import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function LoginPage() {
  const { user, login } = useAuth();
  const nav = useNavigate();
  const [username, setUsername] = useState(localStorage.getItem("starlink_remember_user") || "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(!!localStorage.getItem("starlink_remember_user"));
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (user) nav("/", { replace: true }); }, [user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const u = await login(username.trim(), password);
    setLoading(false);
    if (!u) { toast.error("Invalid credentials"); return; }
    if (remember) localStorage.setItem("starlink_remember_user", username); else localStorage.removeItem("starlink_remember_user");
    toast.success(`Welcome, ${u.name}`);
    nav("/", { replace: true });
  };

  return (
    <div className="min-h-screen relative flex items-center justify-center p-4 overflow-hidden"
      style={{ background: "radial-gradient(circle at 20% 20%, oklch(0.34 0.12 265) 0%, oklch(0.18 0.06 265) 60%, oklch(0.12 0.04 265) 100%)" }}>
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(circle at 30% 40%, rgba(255,255,255,0.15), transparent 40%), radial-gradient(circle at 70% 60%, rgba(94,135,212,0.3), transparent 50%)" }} />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="relative w-full max-w-md">
        <div className="bg-white/95 backdrop-blur-xl rounded-3xl shadow-luxe p-8 md:p-10">
          <div className="flex flex-col items-center text-center mb-8">
            <img src="/starlink-logo.png" alt="Starlink Jewels" className="h-20 w-auto object-contain mb-6" />
            <h1 className="font-display text-3xl text-brand-dark">Welcome Back</h1>
            <p className="text-sm text-muted-foreground mt-1">Sign in to the Starlink Jewels client portal</p>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="u">Username</Label>
              <Input id="u" value={username} onChange={e => setUsername(e.target.value)} placeholder="admin" required autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p">Password</Label>
              <Input id="p" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" required />
            </div>
            <div className="flex items-center justify-between text-sm">
              <label className="flex items-center gap-2 cursor-pointer">
                <Checkbox checked={remember} onCheckedChange={v => setRemember(!!v)} />
                <span>Remember me</span>
              </label>
              <button type="button" onClick={() => toast.info("Contact your account manager to reset your password.")} className="text-primary hover:underline">Forgot?</button>
            </div>
            <Button type="submit" disabled={loading} className="w-full h-12 btn-hero text-base font-semibold rounded-xl">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign In"}
            </Button>
          </form>
        </div>
        <p className="text-center text-white/60 text-xs mt-6">© {new Date().getFullYear()} Starlink Jewels — Fine Diamond Jewelry, USA</p>
      </motion.div>
    </div>
  );
}