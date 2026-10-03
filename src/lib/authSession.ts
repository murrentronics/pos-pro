import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/lib/auth";

const SESSION_BACKUP_KEY = "pospro-session-backup";
const PROFILE_BACKUP_KEY = "pospro-profile-backup";

function persistExtra(key: string, value: string | null) {
  try {
    if (value == null) {
      localStorage.removeItem(key);
      window.electronAPI?.persistRemove?.(key);
    } else {
      localStorage.setItem(key, value);
      window.electronAPI?.persistSet?.(key, value);
    }
  } catch {
    /* private mode / quota */
  }
}

export function rememberSession(session: Session) {
  persistExtra(SESSION_BACKUP_KEY, JSON.stringify(session));
}

export function readRememberedSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.refresh_token || !parsed?.access_token || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function forgetRememberedSession() {
  persistExtra(SESSION_BACKUP_KEY, null);
}

export function rememberProfile(profile: Profile) {
  persistExtra(PROFILE_BACKUP_KEY, JSON.stringify(profile));
}

export function readRememberedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Profile;
    if (!parsed?.id || !parsed?.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function forgetRememberedProfile() {
  persistExtra(PROFILE_BACKUP_KEY, null);
}

/** Server rejected this refresh token. Another device signed in, or the user signed out. */
export function isSessionRevoked(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  const blob = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return (
    blob.includes("refresh_token_not_found") ||
    blob.includes("invalid refresh token") ||
    blob.includes("invalid_refresh_token") ||
    blob.includes("refresh_token_already_used") ||
    blob.includes("already used") ||
    blob.includes("session_not_found") ||
    blob.includes("session not found") ||
    blob.includes("user_not_found") ||
    blob.includes("user not found") ||
    blob.includes("invalid_grant") ||
    blob.includes("invalid grant")
  );
}

/**
 * This device just signed in with a password. Drop every other device's session
 * so a login elsewhere is the only way an open register gets signed out.
 */
export async function claimThisDevice() {
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) console.warn("Could not sign out other devices", error);
}
