/** Non-billable demo / free accounts — hidden from admin billing and skip paywall. */
export const DEMO_EMAILS = [
  "isabel@gmail.com",
  "renard.sankersingh@gmail.com",
  "demo1@posprott.com",
  "demo2@posprott.com",
] as const;

export function isDemoEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return (DEMO_EMAILS as readonly string[]).includes(email.toLowerCase());
}
