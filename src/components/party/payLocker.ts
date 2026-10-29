/**
 * The account a person last paid from, kept on this device so the next payment
 * starts on it — the same key the order page's advance uses (`pay-locker:<user>`).
 * Only a convenience: a private window or cleared storage simply starts empty.
 */
const key = (userId: string) => `pay-locker:${userId}`;

export function lastPayLocker(userId?: string): string {
  if (!userId) return "";
  try { return localStorage.getItem(key(userId)) ?? ""; } catch { return ""; }
}

export function rememberPayLocker(userId: string | undefined, lockerId: string): void {
  if (!userId || !lockerId) return;
  try { localStorage.setItem(key(userId), lockerId); } catch { /* private window */ }
}
