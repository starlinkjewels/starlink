import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useCan } from "@/hooks/useCan";
import { useDb } from "@/hooks/useDb";
import { companiesOf } from "@/lib/companies";
import { SelectItem, SelectSeparator } from "@/components/ui/select";
import { ClientCreateDialog } from "./ClientCreateDialog";
import { SupplierCreateDialog } from "./SupplierCreateDialog";
import { BrokerCreateDialog } from "./BrokerCreateDialog";
import { DesignerCreateDialog } from "./DesignerCreateDialog";
import { FactoryCreateDialog } from "./FactoryCreateDialog";
import { LockerCreateDialog } from "./LockerCreateDialog";
import { EmployeeCreateDialog } from "./EmployeeCreateDialog";
import { CompanyEditor } from "@/components/CompaniesSettings";
import { MaterialEditor } from "@/components/MaterialsSettings";

/**
 * "+ Add new …" inside a dropdown — the standard way to add the thing you are
 * looking for without leaving the form you are filling in.
 *
 * It opens the very same form as that thing's own page (Clients, Suppliers,
 * Factories, Locker, Employees, Settings → Companies), so a client added from
 * New Order is exactly the client the Clients page would have made — login,
 * company, account manager and all. Once saved it is chosen in the dropdown.
 *
 * Offered only to people who may create one on its own page.
 */
export type QuickKind = "client" | "supplier" | "broker" | "designer" | "factory" | "locker" | "employee" | "company" | "material";

/** The value of the "+ Add new" entry — never a real record's id. */
export const ADD_NEW = "__add_new__";

const LABEL: Record<QuickKind, string> = {
  client: "client", supplier: "supplier", broker: "broker", designer: "designer", factory: "factory",
  locker: "bank / cash account", employee: "employee", company: "company", material: "material",
};

type Ctx = { open: (kind: QuickKind, onCreated: (id: string) => void) => void };
const QuickCreateContext = createContext<Ctx | null>(null);

/**
 * Mounted once around the app's pages. Forms stack: "+ Add new company" from
 * inside a client being added opens on top, and closing it returns to the
 * client form with the company chosen.
 */
export function QuickCreateProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [stack, setStack] = useState<{ key: number; kind: QuickKind }[]>([]);
  const callbacks = useRef(new Map<number, (id: string) => void>());
  const seq = useRef(0);
  const open = useCallback((kind: QuickKind, onCreated: (id: string) => void) => {
    const key = ++seq.current;
    callbacks.current.set(key, onCreated);
    setStack(s => [...s, { key, kind }]);
  }, []);
  // A form closes itself before it says what it made, so closing only takes it
  // off the stack — what to do with the new record is kept until it arrives.
  const drop = (key: number) => setStack(s => s.filter(x => x.key !== key));
  const created = (key: number) => (id: string) => {
    const cb = callbacks.current.get(key);
    callbacks.current.delete(key);
    drop(key);
    // After the form closes, so the dropdown re-renders with the new entry first.
    if (cb) setTimeout(() => cb(id), 0);
  };
  const close = (key: number) => (v: boolean) => { if (!v) drop(key); };
  return (
    <QuickCreateContext.Provider value={{ open }}>
      {children}
      {stack.map(({ key, kind }) => {
        const props = { open: true, onOpenChange: close(key), onCreated: created(key) };
        switch (kind) {
          case "client": return <ClientCreateDialog key={key} {...props} />;
          case "supplier": return <SupplierCreateDialog key={key} {...props} />;
          case "broker": return <BrokerCreateDialog key={key} {...props} />;
          case "designer": return <DesignerCreateDialog key={key} {...props} />;
          case "factory": return <FactoryCreateDialog key={key} {...props} />;
          case "locker": return <LockerCreateDialog key={key} {...props} />;
          case "employee": return <EmployeeCreateDialog key={key} {...props} />;
          case "company": return (
            <CompanyEditor key={key}
              company={{ id: "", name: "", invoicePrefix: "", legalSuffix: "", active: true, createdAt: "" }}
              all={companiesOf(db.settings)} invoices={0}
              onClose={() => drop(key)} onSaved={created(key)}
            />
          );
          case "material": return <MaterialEditor key={key} onClose={() => drop(key)} onSaved={created(key)} />;
        }
      })}
    </QuickCreateContext.Provider>
  );
}

/** Whether this person may create one — the same rule as its own page's button. */
export function useMayCreate(kind: QuickKind): boolean {
  const { user } = useAuth();
  const can = useCan();
  if (!user || user.role === "client") return false;
  switch (kind) {
    case "client": return can("clients", "add");
    case "locker": return can("locker", "add");
    default: return user.role === "admin"; // suppliers, factories, employees, companies
  }
}

/**
 * The dropdown's change handler: a real choice is passed on as it always was;
 * "+ Add new" opens the form instead and passes on the new record once saved.
 */
export function useAddNew() {
  const ctx = useContext(QuickCreateContext);
  return useCallback(
    (kind: QuickKind, set: (id: string) => void) => (v: string) => {
      if (v !== ADD_NEW) { set(v); return; }
      if (ctx) ctx.open(kind, set);
    },
    [ctx],
  );
}

/** The "+ Add new …" entry, last in the list. Renders nothing for someone who may not create one. */
export function AddNewItem({ kind }: { kind: QuickKind }) {
  const may = useMayCreate(kind);
  const ctx = useContext(QuickCreateContext);
  if (!may || !ctx) return null;
  return (
    <>
      <SelectSeparator />
      <SelectItem value={ADD_NEW} alwaysShown className="text-primary font-semibold focus:text-primary">
        <span className="inline-flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />Add new {LABEL[kind]}</span>
      </SelectItem>
    </>
  );
}
