import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function InstallPrompt() {
  const [evt, setEvt] = useState<any>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const h = (e: any) => {
      e.preventDefault();
      setEvt(e);
      if (!localStorage.getItem("starlink_install_dismissed")) setShow(true);
    };
    window.addEventListener("beforeinstallprompt", h);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  const install = async () => {
    if (!evt) return;
    await evt.prompt();
    setShow(false);
  };
  const dismiss = () => { setShow(false); localStorage.setItem("starlink_install_dismissed", "1"); };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 100, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 100, opacity: 0 }}
          className="fixed bottom-24 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-96 z-50 card-luxe p-4 flex items-center gap-3">
          <img src="/logo.png" alt="" className="h-10 w-10 rounded-xl" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-sm">Install Starlink Jewels</p>
            <p className="text-xs text-muted-foreground">Add to home screen for the full app experience.</p>
          </div>
          <Button size="sm" onClick={install} className="btn-hero"><Download className="h-4 w-4 mr-1" />Install</Button>
          <button onClick={dismiss} className="p-1 text-muted-foreground"><X className="h-4 w-4" /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}