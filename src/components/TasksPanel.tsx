import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { loadDb, updateDb, uid, type Task, type User } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckCircle2, Circle, ChevronDown, ChevronRight, X, ListTodo } from "lucide-react";
import { toast } from "sonner";

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
  const [tick, setTick] = useState(0); // force re-render after DB writes

  const reload = () => setTick(t => t + 1);

  const db = loadDb();
  // Re-reads on every render (tick forces it)
  const allTasks = (db.tasks ?? []).filter(t => t.assignedTo === userId);
  const pending   = allTasks.filter(t => !t.completed).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const completed = allTasks.filter(t =>  t.completed).sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));

  const assignedByUser = (t: Task): User | undefined =>
    db.users.find(u => u.id === t.assignedBy);

  const addTask = () => {
    const title = newTitle.trim();
    if (!title) return;
    const admin = db.users.find(u => u.role === "admin");
    updateDb(d => {
      if (!d.tasks) d.tasks = [];
      d.tasks.push({
        id: uid("task_"),
        title,
        assignedTo: userId,
        assignedBy: admin?.id ?? userId,
        completed: false,
        createdAt: new Date().toISOString(),
      });
      // notify the employee
      const emp = d.users.find(u => u.id === userId);
      if (emp && asAdmin) {
        d.notifications.unshift({
          id: uid("n_"), userId: emp.id,
          title: "New Task Assigned",
          body: title,
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
    });
    reload();
  };

  const deleteTask = (taskId: string) => {
    updateDb(d => { d.tasks = (d.tasks ?? []).filter(x => x.id !== taskId); });
    reload();
    toast.success("Task removed");
  };

  const empName = db.users.find(u => u.id === userId)?.name ?? "Employee";

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
                <p className="font-display text-lg text-brand-dark leading-tight">My Tasks</p>
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
                <Button
                  size="sm"
                  onClick={addTask}
                  disabled={!newTitle.trim()}
                  className="btn-hero rounded-xl h-10 px-4 shrink-0"
                >
                  Add
                </Button>
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
                    onToggle={done => toggleTask(task.id, done)}
                    onDelete={() => deleteTask(task.id)}
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
                            onToggle={done => toggleTask(task.id, done)}
                            onDelete={() => deleteTask(task.id)}
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
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function TaskRow({
  task,
  assigner,
  onToggle,
  onDelete,
}: {
  task: Task;
  assigner?: User;
  onToggle: (done: boolean) => void;
  onDelete: () => void;
}) {
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
        <p className={`text-sm leading-snug ${task.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
          {task.title}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {task.completed
            ? `Completed: ${fmtCompleted(task.completedAt)}`
            : assigner ? `Assigned by ${assigner.name}` : ""}
        </p>
      </div>

      {/* Delete */}
      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 h-5 w-5 rounded grid place-items-center text-muted-foreground hover:text-destructive"
      >
        <X className="h-3 w-3" />
      </button>
    </motion.div>
  );
}
