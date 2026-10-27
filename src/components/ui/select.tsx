"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp, Search } from "lucide-react";

import { cn } from "@/lib/utils";

/*
 * Every dropdown in the app is this one. A long list gets a search box at its
 * top: type any part of an option — several words narrow it further ("round
 * 1.3 vs") — and Enter takes the first match. Short lists (priority, yes/no)
 * stay as they are. Options are found by the words they show, so no screen
 * has to say anything for its list to be searchable.
 */
const SEARCH_FROM = 8; // options at which the search box appears

interface Filter {
  query: string;
  setQuery: (q: string) => void;
  /** Each option's words, kept by the option itself. */
  items: Map<symbol, string>;
}
const FilterCtx = React.createContext<Filter | null>(null);

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();
const matches = (text: string, query: string) => {
  const q = norm(query);
  if (!q) return true;
  const t = norm(text);
  return q.split(" ").every(w => t.includes(w));
};

/**
 * The list's hidden form <select> reports "" when a value arrives before that
 * option has (a form filled in as the page opens — Duplicate, Sell from a Ready
 * Stock piece), and the choice was wiped. No option can be "", so "" is never a
 * choice anyone made: it is not passed on.
 */
function Select({ onValueChange, ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} onValueChange={onValueChange && (v => { if (v !== "") onValueChange(v); })} />;
}

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

const SelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background cursor-pointer data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

const SelectScrollUpButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

const SelectScrollDownButton = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn("flex cursor-default items-center justify-center py-1", className)}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = SelectPrimitive.ScrollDownButton.displayName;

/** The search box at the top of a long list. Typing narrows it; ↓ goes into it; Enter takes the first match. */
function SelectSearch({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const f = React.useContext(FilterCtx)!;
  // Counted once, as the list opens: every option has put its words in by then.
  const [show] = React.useState(() => f.items.size >= SEARCH_FROM);
  React.useEffect(() => {
    // Not on a touch screen: the keyboard would cover the list it is meant to search.
    if (!show || !window.matchMedia?.("(pointer: fine)").matches) return;
    // After the list has put the focus on the chosen option.
    const ts = [0, 80].map(ms => window.setTimeout(() => inputRef.current?.focus({ preventScroll: true }), ms));
    return () => ts.forEach(t => window.clearTimeout(t));
  }, [show, inputRef]);
  // A shorter list: back to its top, and the ⌃ ⌄ scroll arrows worked out again.
  React.useEffect(() => {
    const vp = inputRef.current?.closest("[role=listbox]")?.querySelector<HTMLElement>("[data-radix-select-viewport]");
    if (!vp) return;
    vp.scrollTop = 0;
    vp.dispatchEvent(new Event("scroll"));
  }, [f.query, inputRef]);
  if (!show) return null;
  const firstOption = () => inputRef.current?.closest("[role=listbox]")?.querySelector<HTMLElement>("[role=option]:not([data-disabled])") ?? null;
  const none = !!f.query && ![...f.items.values()].some(t => matches(t, f.query));
  return (
    <div className="sticky top-0 z-10 p-1 pb-0 shrink-0 bg-popover">
      <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2.5 h-9">
        <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <input ref={inputRef} value={f.query} onChange={e => f.setQuery(e.target.value)} placeholder="Search…" aria-label="Search the list"
          className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onKeyDown={e => {
            if (e.key === "Escape" || e.key === "Tab") return; // the list's own: close, stay
            e.stopPropagation(); // typed letters are the search, not a jump in the list
            if (e.key === "ArrowDown") { e.preventDefault(); firstOption()?.focus(); }
            if (e.key === "Enter") {
              e.preventDefault();
              const el = firstOption();
              if (el) { el.focus(); el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
            }
          }} />
      </div>
      {none && <p className="px-2 py-3 text-sm text-muted-foreground text-center">Nothing matches “{f.query.trim()}”</p>}
    </div>
  );
}

const SelectContent = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", onCloseAutoFocus, onKeyDownCapture, ...props }, ref) => {
  const [query, setQuery] = React.useState("");
  const items = React.useRef(new Map<symbol, string>()).current;
  const filter = React.useMemo<Filter>(() => ({ query, setQuery, items }), [query, items]);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  return (
    <FilterCtx.Provider value={filter}>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          ref={ref}
          className={cn(
            "relative z-50 max-h-[min(var(--radix-select-content-available-height),22rem)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-(--radix-select-content-transform-origin)",
            position === "popper" &&
              "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
            className,
          )}
          position={position}
          // A fresh search each time the list opens.
          onCloseAutoFocus={e => { setQuery(""); onCloseAutoFocus?.(e); }}
          // Typing while the pointer rests on an option (which takes the focus) still searches.
          onKeyDownCapture={e => {
            onKeyDownCapture?.(e);
            const input = inputRef.current;
            if (!input || e.target === input || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.key.length === 1 || e.key === "Backspace") { input.focus({ preventScroll: true }); e.stopPropagation(); }
          }}
          {...props}
        >
          <SelectSearch inputRef={inputRef} />
          <SelectScrollUpButton />
          <SelectPrimitive.Viewport
            className={cn(
              "p-1",
              position === "popper" &&
                "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
            )}
          >
            {children}
          </SelectPrimitive.Viewport>
          <SelectScrollDownButton />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </FilterCtx.Provider>
  );
});
SelectContent.displayName = SelectPrimitive.Content.displayName;

const SelectLabel = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => {
  // While searching, the matches are one list — no group headings.
  const searching = !!React.useContext(FilterCtx)?.query;
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn("px-2 py-1.5 text-sm font-semibold", searching && "hidden", className)}
      {...props}
    />
  );
});
SelectLabel.displayName = SelectPrimitive.Label.displayName;

const SelectItem = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item> & {
    /** Shown whatever is searched — "+ Add new …", needed most when nothing matches. */
    alwaysShown?: boolean;
  }
>(({ className, children, disabled, textValue, alwaysShown, ...props }, ref) => {
  const f = React.useContext(FilterCtx);
  const key = React.useRef(Symbol("option")).current;
  const node = React.useRef<HTMLDivElement | null>(null);
  const setRef = React.useCallback((el: HTMLDivElement | null) => {
    node.current = el;
    if (typeof ref === "function") ref(el); else if (ref) ref.current = el;
  }, [ref]);
  // The words this option shows, for the search — kept current as it changes.
  // An always-shown entry is not one of the list's options: it never counts as a match.
  React.useLayoutEffect(() => { if (!alwaysShown) f?.items.set(key, textValue ?? node.current?.textContent ?? ""); });
  React.useLayoutEffect(() => () => { f?.items.delete(key); }, [f?.items, key]);
  const filteredOut = !alwaysShown && !!f?.query && !matches(f.items.get(key) ?? textValue ?? "", f.query);
  return (
    <SelectPrimitive.Item
      ref={setRef}
      disabled={disabled || filteredOut}
      textValue={textValue}
      className={cn(
        // The option under the pointer or keys: a light tint, so what it says (a bag number in the
        // brand colour, a grey note) stays readable.
        "relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-primary/10 focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        filteredOut && "hidden",
        className,
      )}
      {...props}
    >
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});
SelectItem.displayName = SelectPrimitive.Item.displayName;

const SelectSeparator = React.forwardRef<
  React.ElementRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => {
  const searching = !!React.useContext(FilterCtx)?.query;
  return (
    <SelectPrimitive.Separator
      ref={ref}
      className={cn("-mx-1 my-1 h-px bg-muted", searching && "hidden", className)}
      {...props}
    />
  );
});
SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
