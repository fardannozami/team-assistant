import { phoneNumberSchema } from "@repo/shared";
import type { NaturalSchedule } from "./natural-schedule.js";

export type AdminSender = {
  id: string;
  userId: string | null;
  name: string;
  phone: string;
  roleId: string | null;
};

export type PendingFlow =
  | { kind: "add"; step: "name"; phone?: string }
  | { kind: "add"; step: "phone"; name: string }
  | { kind: "add"; step: "confirm"; name: string; phone: string }
  | { kind: "phone"; step: "employee" }
  | {
      kind: "phone";
      step: "phone";
      employeeId: string;
      employeeName: string;
    }
  | {
      kind: "phone";
      step: "confirm";
      employeeId: string;
      employeeName: string;
      phone: string;
    }
  | {
      kind: "schedule";
      step: "confirm";
      schedule: NaturalSchedule;
    };

const YES = /^(yes|y|ya|iya|ok|oke|correct|benar|betul)$/i;
const NO = /^(no|n|tidak|bukan|salah|batal|cancel)$/i;

const FLOW_TTL_MS = 10 * 60 * 1000;
export const INVALID_PHONE =
  "Nomor itu sepertinya tidak valid. Kirim dengan kode negara, contoh 628123456789.";

// Keyed by `${workspaceId}:${phone}`.
const flows = new Map<string, { flow: PendingFlow; expiresAt: number }>();

export function setFlow(key: string, flow: PendingFlow) {
  flows.set(key, { flow, expiresAt: Date.now() + FLOW_TTL_MS });
}

export function clearFlow(key: string) {
  flows.delete(key);
}

export function getFlow(key: string): PendingFlow | null {
  const entry = flows.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    flows.delete(key);
    return null;
  }
  return entry.flow;
}

export function isYes(text: string) {
  return YES.test(text.trim().replace(/[.!,\s]+$/, ""));
}

export function isNo(text: string) {
  return NO.test(text.trim().replace(/[.!,\s]+$/, ""));
}

export function toValidPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const result = phoneNumberSchema.safeParse(input);
  return result.success ? result.data : null;
}

export function splitNameAndPhone(input: string): {
  name: string | null;
  phone: string | null;
} {
  const trimmed = input.trim();
  if (!trimmed) return { name: null, phone: null };

  const phoneAtEnd = trimmed.match(/^(.+?)[\s,;]+(\+?\d[\d\s\-()]{5,}\d)$/);
  if (phoneAtEnd) {
    const name = phoneAtEnd[1];
    const phone = phoneAtEnd[2];
    if (name && phone) return { name: name.trim(), phone };
  }

  const phoneAtStart = trimmed.match(/^(\+?\d[\d\s\-()]{5,}\d)[\s,;]+(.+)$/);
  if (phoneAtStart) {
    const phone = phoneAtStart[1];
    const name = phoneAtStart[2];
    if (name && phone) return { name: name.trim(), phone };
  }

  if (/^\+?\d[\d\s\-()]{5,}\d$/.test(trimmed)) {
    return { name: null, phone: trimmed };
  }

  return { name: trimmed, phone: null };
}

export function extractPhones(text: string): string[] {
  const matches = text.match(/\+?\d[\d\-()]{5,}/g) ?? [];
  return matches
    .map(toValidPhone)
    .filter((phone): phone is string => phone !== null);
}
