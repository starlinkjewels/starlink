// Human-readable messages for Firebase Auth error codes.
export function authErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  switch (code) {
    case "auth/email-already-in-use": return "That email already has an account.";
    case "auth/invalid-email":        return "That email address is not valid.";
    case "auth/weak-password":        return "Password is too weak (use at least 6 characters).";
    case "auth/requires-recent-login":return "Please sign out and back in, then try again.";
    case "auth/network-request-failed":return "Network error — check your connection.";
    case "auth/too-many-requests":    return "Too many attempts. Try again later.";
    default: return "Something went wrong. Please try again.";
  }
}
