import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ensureCollections, updateDb, uid, type Task, type User } from "@/lib/db";
import { useDb } from "@/hooks/useDb";
import { useAuth } from "@/lib/auth";
import { AsyncButton } from "@/components/AsyncButton";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, X, ListTodo, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { confirmBox } from "@/lib/confirm";
import { useLocation } from "react-router-dom";

interface Props {
  /** Whose tasks to show. Pass the userId. */
  userId: string;
  open: boolean;
  onClose: () => void;
  /** If provided, admin can add tasks to this user */
  asAdmin?: boolean;
}

export function TasksPanel({ userId, open, onClose, asAdmin }: Props) {
  const [newTitle, setNewTitle] = useState("");
  const [showCompleted, setShowCompleted] = useState(true);
  const { user: me } = useAuth();
  // Live: a task someone assigns (or ticks) shows at once, not when the panel is opened again.
  const db = useDb();
  useEffect(() => { if (open) void ensureCollections(["tasks"]).catch(() => {}); }, [open]);
  // Closes like every other panel: Esc, or going to another page.
  const { pathname } = useLocation();
  const openedAt = useRef(pathname);
  useEffect(() => { if (open) openedAt.current = pathname; }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && pathname !== openedAt.current) onClose(); }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, onClose]);
  const reload = () => { /* the live data re-renders the panel */ };

  const allTasks = (db.tasks ?? []).filter(t => t.assignedTo === userId);
  const pending   = allTasks.filter(t => !t.completed).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const completed = allTasks.filter(t =>  t.completed).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  const assignedByUser = (t: Task): User | undefined =>
    db.users.find(u => u.id === t.assignedBy);
  const empName = db.users.find(u => u.id === userId)?.name ?? "Employee";

  const addTask = () => {
    const title = newTitle.trim();
    if (!title || !me) return;
    // Whoever adds it is who assigned it — not "the first admin on the list".
    const by = me.id;
    updateDb(d => {
      if (!d.tasks) d.tasks = [];
      d.tasks.push({
        id: uid("task_"),
        title,
        assignedTo: userId,
        assignedBy: by,
        ...(by !== userId ? { tellWhenDone: true } : {}),
        completed: false,
        createdAt: new Date().toISOString(),
      });
      // Someone else's task: they are told.
      const emp = d.users.find(u => u.id === userId);
      if (emp && by !== userId) {
        d.notifications.unshift({
          id: uid("n_"), userId: emp.id,
          title: "New task for you",
          body: `${title} — from ${me.name}`,
          type: "info", read: false, createdAt: new Date().toISOString(),
        });
      }
    });
    setNewTitle("");
    reload();
    toast.success("Task added");
  };

  const toggleTask = (taskId: string, done: boolean) => {
    updateDb(d => {
      const t = (d.tasks ?? []).find(x => x.id === taskId);
      if (!t) return;
      t.completed = done;
      t.completedAt = done ? new Date().toISOString() : undefined;
      // Done by the one it was given to: whoever gave it is told.
      if (done && t.tellWhenDone && t.assignedBy !== me?.id && d.users.some(u => u.id === t.assignedBy)) {
        t.tellWhenDone = false; // told once
        d.notifications.unshift({
          id: uid("n_"), userId: t.assignedBy,
          title: "Task done",
          body: `${t.title} — ${d.users.find(u => u.id === t.assignedTo)?.name ?? "done"}`,
          type: "info", read: false, createdAt: new Date().toISOString(),
        });
      }
    });
    reload();
  };

  // Gone for whoever it was assigned to as well, so it asks first.
  const deleteTask = async (task: Task) => {
    if (!(await confirmBox(`Delete this task?\n\n"${task.title}"${task.completed ? " (done)" : ""} — it goes off ${asAdmin ? `${empName}'s` : "your"} list for good. This cannot be undone.`))) return;
    updateDb(d => { d.tasks = (d.tasks ?? []).filter(x => x.id !== task.id); });
    reload();
    toast.success("Task removed");
  };

  // Correct a task's wording; who it is for and whether it is done stay as they are.
  const renameTask = (taskId: string, title: string) => {
    const t = title.trim();
    if (!t) { toast.error("A task needs some words"); return false; }
    updateDb(d => { const x = (d.tasks ?? []).find(y => y.id === taskId); if (x) x.title = t; });
    reload();
    return true;
  };


  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-white shadow-2xl flex flex-col border-l border-border"
          >
            {/* Header */}
            <div className="flex items-center gap-3 px-5 pt-5 pb-4 border-b border-border/60">
              <div className="h-9 w-9 rounded-xl bg-primary/10 grid place-items-center shrink-0">
                <ListTodo className="h-4.5 w-4.5 h-[18px] w-[18px] text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-display text-lg text-brand-dark leading-tight">{asAdmin && userId !== me?.id ? "Tasks" : "My Tasks"}</p>
                {asAdmin && (
                  <p className="text-xs text-muted-foreground truncate">{empName}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="h-8 w-8 rounded-lg hover:bg-secondary grid place-items-center transition-colors text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Add task input */}
            <div className="px-4 py-3 border-b border-border/40">
              <div className="flex gap-2">
                <Input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") addTask(); }}
                  placeholder="Add a task…"
                  className="rounded-xl h-10 text-sm flex-1"
                  autoFocus={open}
                />
                <AsyncButton
                  size="sm"
                  onClick={addTask}
                  disabled={!newTitle.trim()}
                  className="btn-hero rounded-xl h-10 px-4 shrink-0"
                >
                  Add
                </AsyncButton>
              </div>
            </div>

            {/* Task list */}
            <div className="flex-1 overflow-y-auto">
              {/* Pending */}
              <div className="py-2">
                {pending.length === 0 && completed.length === 0 && (
                  <div className="py-12 text-center text-muted-foreground">
                    <ListTodo className="h-10 w-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm">No tasks yet</p>
                    <p className="text-xs mt-0.5 opacity-70">Add a task above to get started</p>
                  </div>
                )}
                {pending.map(task => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    assigner={assignedByUser(task)}
                    own={task.assignedBy === task.assignedTo}
                    onToggle={done => toggleTask(task.id, done)}
                    onDelete={() => deleteTask(task)}
                    onRename={title => renameTask(task.id, title)}
                  />
                ))}
              </div>

              {/* Completed */}
              {completed.length > 0 && (
                <div>
                  <button
                    onClick={() => setShowCompleted(v => !v)}
                    className="flex items-center gap-2 w-full px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors border-t border-border/40"
                  >
                    {showCompleted
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                    Completed ({completed.length})
                  </button>

                  <AnimatePresence>
                    {showCompleted && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        {completed.map(task => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            assigner={assignedByUser(task)}
                            own={task.assignedBy === task.assignedTo}
                            onToggle={done => toggleTask(task.id, done)}
                            onDelete={() => deleteTask(task)}
                            onRename={title => renameTask(task.id, title)}
                          />
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Footer summary */}
            <div className="px-5 py-3 border-t border-border/40 bg-secondary/30">
              <p className="text-xs text-muted-foreground text-center">
                {pending.length} pending · {completed.length} completed
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

function fmtCompleted(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short", month: "short", day: "numeric" }).replace(/\bSept\b/, "Sep");
}

function TaskRow({
  task,
  assigner,
  own,
  onToggle,
  onDelete,
  onRename,
}: {
  task: Task;
  assigner?: User;
  /** Added by the person it is for — no "assigned by". */
  own?: boolean;
  onToggle: (done: boolean) => void;
  onDelete: () => void;
  /** Saves new wording; false keeps the row open (nothing to save). */
  onRename: (title: string) => boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = () => { if (editing !== null && (editing.trim() === task.title || onRename(editing))) setEditing(null); };
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="group flex items-start gap-3 px-5 py-3 hover:bg-secondary/40 transition-colors"
    >
      {/* Checkbox */}
      <button
        onClick={() => onToggle(!task.completed)}
        aria-label={task.completed ? "Mark not done" : "Mark done"}
        className={`mt-0.5 shrink-0 h-5 w-5 rounded-full border-2 grid place-items-center transition-colors
          ${task.completed
            ? "border-primary bg-primary text-white"
            : "border-muted-foreground/40 hover:border-primary"}`}
      >
        {task.completed
          ? <CheckCircle2 className="h-3 w-3" />
          : <Circle className="h-2.5 w-2.5 opacity-0 group-hover:opacity-30" />}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {editing !== null ? (
          <div className="flex items-center gap-1.5">
            <Input value={editing} autoFocus aria-label="Task" onChange={e => setEditing(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(null); }}
              className="h-8 rounded-lg text-sm" />
            <button onClick={save} aria-label="Save the task" className="h-7 w-7 shrink-0 rounded-lg grid place-items-center text-success hover:bg-success/10"><Check className="h-3.5 w-3.5" /></button>
            <button onClick={() => setEditing(null)} aria-label="Keep it as it was" className="h-7 w-7 shrink-0 rounded-lg grid place-items-center text-muted-foreground hover:bg-secondary"><X className="h-3.5 w-3.5" /></button>
          </div>
        ) : (
          <p className={`text-sm leading-snug ${task.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
            {task.title}
          </p>
        )}
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {task.completed
            ? `Completed: ${fmtCompleted(task.completedAt)}`
            : own ? `Added ${fmtCompleted(task.createdAt)}` : assigner ? `Assigned by ${assigner.name} · ${fmtCompleted(task.createdAt)}` : task.assignedBy === "autopilot" ? "From Autopilot" : ""}
        </p>
      </div>

      {/* Edit · Delete — always visible on a phone, on hover on a computer */}
      {editing === null && (
        <div className="flex items-center gap-0.5 mt-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <button onClick={() => setEditing(task.title)} aria-label="Edit task" title="Edit"
            className="h-5 w-5 rounded grid place-items-center text-muted-foreground hover:text-primary">
            <Pencil className="h-3 w-3" />
          </button>
          <button onClick={onDelete} aria-label="Delete task" title="Delete"
            className="h-5 w-5 rounded grid place-items-center text-muted-foreground hover:text-destructive">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
