import type { Database, Tables } from "@/types/database";
export type Timer = Tables<"running_timers">;
export type TimerState = { message?: string; pendingFinalization?: boolean };

// Display only. Neither this value nor browser time is sent to the database.
export function elapsedTimer(start: string, end: string | null, now: number) {
  const seconds = Math.max(0, Math.floor(((end ? Date.parse(end) : now) - Date.parse(start)) / 1000));
  if (!Number.isFinite(seconds)) return "—";
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, "0")).join(":");
}
export function timerDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

// The generated RPC return is Json; validate its discriminant and scope at runtime.
// Do not maintain a second handwritten RPC return type.
export function stopStatus(value: Database["public"]["Functions"]["stop_time_timer"]["Returns"], id: string) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.timer_id !== id
    || typeof value.stop_requested_at !== "string" || !Number.isFinite(Date.parse(value.stop_requested_at))
    || !Array.isArray(value.entries)) return null;
  if (value.status === "completed" && value.entries.length > 0) return "completed";
  if (value.status === "pending_finalization" && value.entries.length === 0) return "pending_finalization";
  return null;
}
export function timerError(code?: string) {
  if (code === "23505") return "Another timer is already active or awaiting finalization. Refresh to view it.";
  if (code === "P0002") return "This timer is no longer running. Refresh to see the latest entries.";
  if (code === "55000") return "This timer has already been stopped and is awaiting finalization. Retry finalization instead of canceling.";
  if (code === "22023") return "Check the hourly rate and try again. Refresh to see the saved timer state.";
  if (code === "42501") return "Unable to access this timer. Sign in again and try again.";
  return "Unable to confirm the timer operation. Refresh to check its saved state before trying again.";
}
