import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Number fields: the forms store a number, and most turn an emptied box back
 * into 0 at once — so the 0 could never be deleted, and typing "2" gave "02".
 * While someone types, the box shows exactly what they typed (an empty box
 * stays empty) as long as it means the number the form holds; when the form
 * holds something else (it changed the value itself), or on leaving the box,
 * the form's value shows again.
 */
function useTypedNumber(type: string | undefined, props: React.ComponentProps<"input">) {
  const [typed, setTyped] = React.useState<string | null>(null);
  const controlled = type === "number" && props.value !== undefined;
  if (!controlled) return {};
  const held = props.value === "" || props.value === null ? 0 : Number(props.value);
  const means = typed === null ? NaN : typed.trim() === "" || typed === "-" ? 0 : Number(typed);
  const value = typed !== null && means === held ? typed : props.value;
  return {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => { setTyped(e.target.value); props.onChange?.(e); },
    onBlur: (e: React.FocusEvent<HTMLInputElement>) => { setTyped(null); props.onBlur?.(e); },
  };
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    const typedNumber = useTypedNumber(type, props);
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className,
        )}
        ref={ref}
        {...props}
        {...typedNumber}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
