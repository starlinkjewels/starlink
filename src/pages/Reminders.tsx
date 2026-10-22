import { useState } from "react";
import { AlarmClock, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/PageHeader";
import { RemindersManager } from "@/components/autopilot/Reminders";

/** Reminders — your own, set by hand or by Autopilot. An admin can look at everyone's. */
export function RemindersPage() {
  const { user } = useAuth();
  const [creating, setCreating] = useState(false);
  const [everyone, setEveryone] = useState(false);
  const isAdmin = user?.role === "admin";
  return (
    <div className="space-y-5">
      <PageHeader title="Reminders" subtitle={everyone ? "Everyone's" : "Yours"}
        primary={{ label: "Remind me", icon: AlarmClock, onClick: () => setCreating(true) }}
        secondary={isAdmin ? { label: everyone ? "Only mine" : "Everyone's", icon: Users, onClick: () => setEveryone(!everyone) } : null} />
      <RemindersManager everyone={everyone} creating={creating} onCreating={setCreating} />
    </div>
  );
}
