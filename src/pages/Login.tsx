import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { auth } from "@/lib/firebase";
import { sendPasswordResetEmail } from "firebase/auth";
import { authErrorMessage } from "@/lib/authErrors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { ArrowRight, Eye, EyeOff, Gem, Loader2, Lock, Mail, ReceiptText, Workflow } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useBrand, brandName, BUILTIN } from "@/lib/brand";
import { Facets } from "@/components/Facets";

/** The logo on the dark brand panel: a light version when there is one, else the logo on a light plate. */
function PanelLogo() {
  const b = useBrand();
  const onDark = b.logoDark || (!b.logo ? BUILTIN.white : undefined);
  if (onDark) return <img src={onDark} alt={brandName(b)} className="h-14 w-auto max-w-[16rem] object-contain" />;
  return (
    <span className="inline-flex rounded-2xl bg-white/95 px-4 py-2.5 shadow-lg shadow-black/20">
      <BrandLogo className="h-11 w-auto max-w-[14rem] object-contain" />
    </span>
  );
}

export function LoginPage() {
  const { user, login } = useAuth();
  const brand = useBrand();
  const name = brandName(brand);
  const nav = useNavigate();
  const [email, setEmail] = useState(localStorage.getItem("starlink_remember_user") || "");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(!!localStorage.getItem("starlink_remember_user"));
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const [caps, setCaps] = useState(false);

  useEffect(() => { if (user) nav("/", { replace: true }); }, [user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const u = await login(email.trim(), password);
    setLoading(false);
    if (!u) { toast.error("Invalid credentials"); return; }
    if (remember) localStorage.setItem("starlink_remember_user", email); else localStorage.removeItem("starlink_remember_user");
    toast.success(`Welcome, ${u.name}`);
    nav("/", { replace: true });
  };

  const forgot = async () => {
    if (!email.trim()) { toast.info("Enter your email above first, then tap Forgot."); return; }
    try { await sendPasswordResetEmail(auth, email.trim()); toast.success("Password reset email sent — check your inbox."); }
    catch (err) { toast.error(authErrorMessage(err)); }
  };
  const capsCheck = (e: React.KeyboardEvent) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  const year = new Date().getFullYear();

  return (
    <div className="min-h-screen grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] bg-background">
      {/* ── The brand panel (laptop and up) ── */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden p-10 xl:p-14 text-white" style={{ background: "var(--login-bg)" }}>
        <div className="absolute inset-0 opacity-40" style={{ backgroundImage: "var(--login-glow)" }} />
        <Facets className="absolute -right-24 -bottom-24 w-[34rem] h-[34rem] text-white/[0.09]" />
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="relative">
          <PanelLogo />
        </motion.div>
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.05 }} className="relative max-w-lg">
          <h2 className="brand-serif font-display text-[2.6rem] xl:text-5xl leading-[1.08] tracking-tight">Every order, every stone — in one place.</h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/70">Orders and production, diamond and gold stock, bills and payments — for the whole of {name}.</p>
          <ul className="mt-8 grid gap-3 text-sm text-white/85">
            {([[Workflow, "Orders from request to delivery"], [Gem, "Bags, certified stones and gold, counted"], [ReceiptText, "Bills, payments and what is due"]] as const).map(([Icon, t]) => (
              <li key={t} className="flex items-center gap-3">
                <span className="grid place-items-center h-8 w-8 rounded-lg bg-white/10 ring-1 ring-white/15"><Icon className="h-4 w-4" /></span>{t}
              </li>
            ))}
          </ul>
        </motion.div>
        <p className="relative text-xs text-white/50">{brand.name ? `© ${year} ${brand.name}` : `© ${year} ${BUILTIN.name}`}</p>
      </aside>

      {/* ── Signing in ── */}
      <main className="relative flex items-center justify-center px-5 py-10 sm:px-8">
        {/* On a phone, a thin band of the brand colour across the top. */}
        <div className="lg:hidden absolute inset-x-0 top-0 h-1.5" style={{ background: "var(--login-bg)" }} />
        <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45 }} className="w-full max-w-[24rem]">
          <div className="lg:hidden mb-8 flex justify-center"><BrandLogo className="h-16 w-auto max-w-full object-contain" /></div>
          <h1 className="brand-serif font-display text-[2rem] leading-tight text-foreground">Welcome back</h1>
          <p className="text-sm text-muted-foreground mt-1.5">Sign in to {name}</p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="u">Email</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="u" type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus
                  className="h-11 rounded-xl pl-10" />
              </div>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="p">Password</Label>
                <button type="button" onClick={forgot} className="text-xs font-medium text-primary hover:underline">Forgot password?</button>
              </div>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input id="p" type={show ? "text" : "password"} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
                  onKeyDown={capsCheck} onKeyUp={capsCheck} placeholder="Your password" required className="h-11 rounded-xl pl-10 pr-11" />
                <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 w-8 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary">
                  {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {caps && <p className="text-xs text-amber-700 dark:text-amber-400">Caps Lock is on</p>}
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer w-fit">
              <Checkbox checked={remember} onCheckedChange={v => setRemember(!!v)} />
              <span>Remember me</span>
            </label>
            <Button type="submit" disabled={loading} className="w-full h-11 rounded-xl text-[15px] font-semibold gap-2">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Sign In <ArrowRight className="h-4 w-4" /></>}
            </Button>
          </form>

          <p className="mt-8 flex items-center gap-1.5 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />Private and secure — for the team and clients of {name}.</p>
          <p className="lg:hidden mt-6 text-xs text-muted-foreground">{brand.name ? `© ${year} ${brand.name}` : `© ${year} ${BUILTIN.name}`}</p>
        </motion.div>
      </main>
    </div>
  );
}
