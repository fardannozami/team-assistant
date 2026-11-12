/**
 * Typed HTTP client for the Team Assistant API.
 *
 * Uses fetch with an absolute base URL (VITE_API_URL, default http://localhost:4000).
 * The JWT is read from localStorage and sent as a Bearer header on every request.
 * A 401 response clears the token and notifies the shell so the user is returned
 * to the login page.
 */

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:4000";

const TOKEN_KEY = "ta_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Storage unavailable; ignore.
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly body?: unknown;

  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type UnauthHandler = () => void;
const unauthHandlers = new Set<UnauthHandler>();

/** Register a handler (typically the shell) that runs when a request returns 401. */
export function onUnauthorized(handler: UnauthHandler): () => void {
  unauthHandlers.add(handler);
  return () => unauthHandlers.delete(handler);
}

function triggerUnauthorized(): void {
  for (const handler of unauthHandlers) handler();
}

/** Toast bus shared between views and the shell. */
export interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

let nextToastId = 0;
const toastListeners = new Set<(toast: Toast) => void>();

export function addToastListener(listener: (toast: Toast) => void): () => void {
  toastListeners.add(listener);
  return () => toastListeners.delete(listener);
}

export function showToast(
  message: string,
  type: Toast["type"] = "info"
): number {
  const id = (nextToastId += 1);
  const toast: Toast = { id, message, type };
  for (const listener of toastListeners) listener(toast);
  return id;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.headers) {
    const extra = init.headers as Record<string, string>;
    for (const [key, value] of Object.entries(extra)) {
      headers[key] = value;
    }
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (err) {
    throw new ApiError(
      0,
      `Couldn't reach the API at ${API_BASE}. Make sure the backend is running.`,
      err
    );
  }

  let body: unknown = null;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = await res.json();
    } catch {
      body = null;
    }
  } else {
    body = await res.text();
  }

  if (res.status === 401) {
    setToken(null);
    triggerUnauthorized();
  }

  if (!res.ok) {
    const message =
      (body as { error?: string } | null)?.error ??
      `The request failed (${res.status}). Please try again.`;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

/* ------------------------------------------------------------------ */
/* Domain types                                                       */
/* ------------------------------------------------------------------ */

export interface Employee {
  id: string;
  name: string;
  phone: string;
  teamId: string | null;
  teamName: string | null;
  roleId: string | null;
  roleName: string | null;
  isActive: boolean;
  userId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Role {
  id: string;
  name: string;
}

export interface WhatsAppStatus {
  connected: boolean;
  registered: boolean;
  pairingCode: string | null;
  phone: string | null;
}

export type EmployeeFilter = "all" | true | false;

export interface EmployeeFilters {
  active?: boolean | null;
  teamId?: string | null;
  roleId?: string | null;
  search?: string | null;
}

export interface NewEmployee {
  name: string;
  phone: string;
  teamId?: string | null;
  roleId?: string | null;
}

export interface Schedule {
  id: string;
  name: string;
  timeOfDay: string;
  weekdays: number[];
  timezone: string;
  reminderMinutes: number | null;
  reminderRepeatMinutes: number | null;
  closeTime: string | null;
  summaryTime: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleInput {
  name: string;
  timeOfDay: string;
  weekdays: number[];
  timezone?: string | null;
  reminderMinutes?: number | null;
  reminderRepeatMinutes?: number | null;
  closeTime?: string | null;
  summaryTime?: string | null;
  isActive?: boolean;
}

export type CheckinKind = "checkout" | "icebreaker";

export interface CheckinQuestion {
  key: string;
  text: string;
  type: "text" | "mood";
}

export interface CheckinConfig {
  id: string | null;
  kind: CheckinKind;
  weekdays: number[];
  timeOfDay: string;
  timezone: string;
  reminderMinutes: number | null;
  closeTime: string | null;
  questions: CheckinQuestion[];
  isActive: boolean;
}

export type CheckinConfigInput = Omit<CheckinConfig, "id" | "kind">;

export interface CheckinRunResult {
  sent: number;
  skipped?: number;
  failed: number;
  whatsappConnected?: boolean;
  excluded?: boolean;
  reason?: string;
}

export interface CheckinResponses {
  kind: CheckinKind;
  date: string | null;
  dates: string[];
  questions: CheckinQuestion[];
  averageMood: number | null;
  rows: {
    employeeId: string;
    employeeName: string;
    teamName: string | null;
    status: string;
    answers: Record<string, string>;
    mood: number | null;
    motivation: string | null;
  }[];
}

export interface GithubInstallation {
  id: string;
  installationId: string;
  accountLogin: string | null;
  accountType: string | null;
  repositorySelection: string | null;
  isActive: boolean;
}

export interface GithubRepository {
  id: string;
  githubRepoId: string;
  fullName: string;
  isPrivate: boolean;
  isActive: boolean;
}

export interface GithubStatus {
  configured: boolean;
  appSlug: string | null;
  installations: GithubInstallation[];
  repositories: GithubRepository[];
}

export interface GithubMember {
  employeeId: string;
  name: string;
  isActive: boolean;
  login: string | null;
}

export interface GithubActivity {
  id: string;
  type: string;
  actorLogin: string | null;
  employeeId: string | null;
  employeeName: string | null;
  repository: string | null;
  title: string | null;
  url: string | null;
  occurredAt: string;
}

export interface GithubSummary {
  employeeId: string;
  employeeName: string;
  counts: Record<string, number>;
}

export interface Holiday {
  id: string;
  date: string;
  name: string;
  type: string;
  source: string;
}

export interface CalendarSettings {
  id: string;
  country: string;
  timezone: string;
  skipWeekends: boolean;
  skipNationalHolidays: boolean;
  skipJointHolidays: boolean;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarException {
  id: string;
  date: string;
  reason: string | null;
  skip: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StandupSession {
  sessionId: string;
  status: string;
  employeeId: string;
  employeeName: string;
  employeePhone: string;
  teamName: string | null;
  standupId: string | null;
  answers: Record<string, string>;
}

export interface DailyReportSubmission {
  id: string;
  name: string;
  answers: Record<string, string>;
}

export interface DailyReportBlocker {
  name: string;
  blocker: string;
}

export interface DailyReport {
  date: string;
  total: number;
  submittedCount: number;
  notSubmittedCount: number;
  submitted: DailyReportSubmission[];
  notSubmitted: string[];
  blockers: DailyReportBlocker[];
  text: string;
}

export interface WeeklyReportDay {
  date: string;
  submitted: number;
  total: number;
}

export interface WeeklyReportBlocker {
  blocker: string;
  count: number;
}

export interface WeeklyReport {
  start: string;
  end: string;
  days: WeeklyReportDay[];
  repeatedBlockers: WeeklyReportBlocker[];
  text: string;
}

/* ------------------------------------------------------------------ */
/* API                                                                */
/* ------------------------------------------------------------------ */

export const authApi = {
  logout: () => setToken(null),

  providers: () =>
    request<{ google: boolean }>("/auth/providers").catch(() => ({ google: false })),

  googleLoginUrl: `${API_BASE}/auth/google`,

  me: () => request<Me>("/auth/me"),
};

export interface Me {
  user: { name: string; email: string; role: string | null };
  workspace: { id: string; name: string };
}

const OAUTH_ERRORS: Record<string, string> = {
  not_registered: "Akun Google ini belum terdaftar atau sudah dinonaktifkan. Pendaftaran baru sedang ditutup.",
  unverified_email: "Email Google Anda belum terverifikasi.",
  cancelled: "Login dengan Google dibatalkan.",
  invalid_state: "Sesi login kedaluwarsa. Silakan coba lagi.",
  google_error: "Google tidak merespons. Silakan coba lagi.",
};

/** Reads the token or error the Google OAuth callback put in the URL hash. */
export function consumeOAuthRedirect(): string {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  const error = params.get("auth_error");
  if (!token && !error) return "";
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (token) setToken(token);
  return error ? (OAUTH_ERRORS[error] ?? "Login dengan Google gagal.") : "";
}

export const employeesApi = {
  list: (filters?: EmployeeFilters) => {
    const params = new URLSearchParams();
    if (filters?.search) params.set("search", filters.search);
    if (filters?.active !== undefined) params.set("active", String(filters.active));
    if (filters?.teamId) params.set("teamId", filters.teamId);
    if (filters?.roleId) params.set("roleId", filters.roleId);
    return request<{ employees: Employee[] }>(`/employees?${params.toString()}`).then(
      (r) => r.employees
    );
  },

  create: (input: NewEmployee) =>
    request<Employee>("/employees", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deactivate: (id: string) =>
    request<Employee>(`/employees/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: false }),
    }),

  updatePhone: (id: string, phone: string) =>
    request<Employee>(`/employees/${id}/phone`, {
      method: "PATCH",
      body: JSON.stringify({ phone }),
    }),

  updateRole: (id: string, roleId: string | null) =>
    request<Employee>(`/employees/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ roleId }),
    }),
};

export const schedulesApi = {
  list: () =>
    request<{ schedules: Schedule[] }>("/schedules").then((r) => r.schedules),

  create: (input: ScheduleInput) =>
    request<Schedule>("/schedules", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  update: (id: string, input: ScheduleInput) =>
    request<Schedule>(`/schedules/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),

  delete: (id: string) =>
    request<{ deleted: boolean }>(`/schedules/${id}`, {
      method: "DELETE",
    }),

  trigger: (id: string) =>
    request<{ queued: boolean; scheduleId: string }>(`/schedules/${id}/trigger`, {
      method: "POST",
    }),
};

export const checkinsApi = {
  configs: () =>
    request<{ configs: CheckinConfig[] }>("/checkins/config").then((r) => r.configs),

  save: (kind: CheckinKind, input: CheckinConfigInput) =>
    request<CheckinConfig>(`/checkins/config/${kind}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  trigger: (kind: CheckinKind) =>
    request<CheckinRunResult>("/checkins/trigger", {
      method: "POST",
      body: JSON.stringify({ kind, resend: true }),
    }),

  responses: (kind: CheckinKind, date?: string) =>
    request<CheckinResponses>(`/checkins/${kind}/responses${date ? `?date=${date}` : ""}`),
};

export const githubApi = {
  status: () => request<GithubStatus>("/github/status"),
  install: () => request<{ url: string }>("/github/install", { method: "POST" }),
  sync: (id: string) => request<{ repositories: number }>(`/github/installations/${id}/sync`, { method: "POST" }),
  unlink: (id: string) => request<{ deleted: boolean }>(`/github/installations/${id}`, { method: "DELETE" }),
  track: (id: string, isActive: boolean) =>
    request<GithubRepository>(`/github/repositories/${id}`, { method: "PATCH", body: JSON.stringify({ isActive }) }),
  members: () => request<{ members: GithubMember[] }>("/github/members").then((r) => r.members),
  setLogin: (employeeId: string, login: string | null) =>
    request<{ employeeId: string; login: string | null }>(`/github/members/${employeeId}`, {
      method: "PUT",
      body: JSON.stringify({ login }),
    }),
  activity: (params: { employeeId?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.employeeId) q.set("employeeId", params.employeeId);
    if (params.limit) q.set("limit", String(params.limit));
    return request<{ activity: GithubActivity[] }>(`/github/activity?${q}`).then((r) => r.activity);
  },
  summary: (days = 7) => request<{ days: number; summary: GithubSummary[] }>(`/github/activity/summary?days=${days}`),
};

export const holidaysApi = {
  getSettings: () => request<CalendarSettings>("/holidays/settings"),

  updateSettings: (patch: {
    country?: string;
    timezone?: string;
    skipWeekends?: boolean;
    skipNationalHolidays?: boolean;
    skipJointHolidays?: boolean;
  }) =>
    request<CalendarSettings>("/holidays/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  list: (year?: number) => {
    const params = new URLSearchParams();
    if (year) params.set("year", String(year));
    return request<{ holidays: Holiday[] }>(
      `/holidays${params.toString() ? `?${params.toString()}` : ""}`
    ).then((r) => r.holidays);
  },

  upcoming: (limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.set("limit", String(limit));
    return request<{ holidays: Holiday[] }>(
      `/holidays/upcoming${params.toString() ? `?${params.toString()}` : ""}`
    ).then((r) => r.holidays);
  },

  sync: (year?: number) =>
    request<{ year: number; synced: number; holidays: Holiday[] }>(
      "/holidays/sync",
      { method: "POST", body: JSON.stringify({ year }) }
    ),

  checkDate: (date: string) =>
    request<{ excluded: boolean; reason?: string }>(
      `/holidays/check?date=${encodeURIComponent(date)}`
    ),

  listExceptions: () =>
    request<{ exceptions: CalendarException[] }>("/holidays/exceptions").then(
      (r) => r.exceptions
    ),

  createException: (input: {
    date: string;
    reason?: string | null;
    skip?: boolean;
  }) =>
    request<CalendarException>("/holidays/exceptions", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteException: (id: string) =>
    request<{ deleted: boolean }>(`/holidays/exceptions/${id}`, {
      method: "DELETE",
    }),
};

export const standupsApi = {
  list: (date: string) =>
    request<{ date: string; standups: StandupSession[] }>(
      `/standups?date=${encodeURIComponent(date)}`
    ),
};

export const reportsApi = {
  daily: (date?: string) =>
    request<DailyReport>(
    `/reports/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`
  ),

  weekly: () => request<WeeklyReport>("/reports/weekly"),
};

export const whatsappApi = {
  status: () => request<WhatsAppStatus>("/whatsapp/status"),

  start: () =>
    request<{ ok: boolean }>("/whatsapp/start", {
      method: "POST",
    }),

  stop: () =>
    request<{ ok: boolean }>("/whatsapp/stop", {
      method: "POST",
    }),

  pair: (phoneNumber: string) =>
    request<{ pairingCode: string }>("/whatsapp/pair", {
      method: "POST",
      body: JSON.stringify({ phoneNumber }),
    }),
};

export type AiProvider = "gemini" | "groq" | "openai" | "openrouter" | "custom";

export interface AiSettings {
  configured: boolean;
  provider: AiProvider | null;
  baseUrl: string | null;
  model: string | null;
  apiKeyHint: string | null;
  updatedAt: string | null;
  sharedKeyAvailable: boolean;
  providers: Record<AiProvider, { baseUrl: string; model: string; models: { id: string; note: string }[] }>;
}

export interface SaveAiSettingsInput {
  provider: AiProvider;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

export interface AiPolicy {
  allowEmployees: boolean;
  employeeDailyLimit: number;
  workspaceDailyLimit: number;
}

export interface AiUsage {
  today: number;
  week: { name: string; messages: number; tokens: number; today: number }[];
}

export const aiApi = {
  policy: () => request<{ policy: AiPolicy; usage: AiUsage }>("/ai/policy"),

  savePolicy: (patch: Partial<AiPolicy>) =>
    request<{ policy: AiPolicy }>("/ai/policy", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  settings: () => request<AiSettings>("/ai/settings"),

  save: (input: SaveAiSettingsInput) =>
    request<{ settings: AiSettings; warning: string | null }>("/ai/settings", {
      method: "PUT",
      body: JSON.stringify(input),
    }),

  remove: () =>
    request<AiSettings>("/ai/settings", {
      method: "DELETE",
    }),
};

export const rolesApi = {
  list: () =>
    request<{ roles: Role[] }>("/roles").then((r) => r.roles),
};

export async function apiHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
