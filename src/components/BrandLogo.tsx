import { useBrand, brandName, BUILTIN } from "@/lib/brand";

/**
 * The company's logo — its own from Brand Studio, or this build's. With a
 * logo for dark backgrounds, each theme shows its own; without one the light
 * logo serves both.
 */
export function BrandLogo({ className = "", alt, wide = false }: { className?: string; alt?: string; wide?: boolean }) {
  const b = useBrand();
  const name = alt ?? brandName(b);
  // `wide`: the menu, header and galleries, where a build may keep a wider logo of its own.
  const light = b.logo || (wide && BUILTIN.wide) || BUILTIN.logo;
  if (!b.logoDark) return <img src={light} alt={name} className={className} />;
  return (
    <>
      <img src={light} alt={name} className={`${className} dark:hidden`} />
      <img src={b.logoDark} alt={name} className={`${className} hidden dark:inline-block`} />
    </>
  );
}

/** The square icon (narrow sidebar): the brand's own, or null when there is none. */
export function useBrandMark(): string | null {
  const b = useBrand();
  return b.mark || BUILTIN.mark || null;
}
