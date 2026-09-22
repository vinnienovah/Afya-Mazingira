/** "; Secure" in production, where the app is only served over HTTPS. */
export function secureAttribute(): string {
  return process.env.NODE_ENV === "production" ? "; Secure" : "";
}
