/**
 * A person's round picture — their own photo (My Profile), else their
 * initials. `className` sets the size, shape and the initials' colours, as each
 * screen had them; the photo fills the same box.
 */
export function UserAvatar({ photo, name, className = "h-10 w-10 rounded-full text-sm", initials = 1 }: {
  photo?: string;
  name?: string;
  className?: string;
  /** How many letters stand in for a missing photo: 1 ("R") or 2 ("RS"). */
  initials?: 1 | 2;
}) {
  const letters = initials === 2
    ? (name ?? "").split(" ").filter(Boolean).map(w => w[0]).join("").slice(0, 2).toUpperCase()
    : (name ?? "").trim().charAt(0).toUpperCase();
  return (
    <div className={`${className} overflow-hidden shrink-0 grid place-items-center ${photo ? "bg-white" : "bg-gradient-to-br from-primary to-brand-dark text-white"}`}>
      {photo ? <img src={photo} alt={name ? `${name}` : ""} className="h-full w-full object-cover" draggable={false} /> : letters || "?"}
    </div>
  );
}
