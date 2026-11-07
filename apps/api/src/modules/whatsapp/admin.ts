import {
  isAdminRole,
  phoneNumberSchema,
} from "@repo/shared";
import { HttpError } from "../../lib/http-error.js";
import {
  createEmployee,
  findEmployeeByPhone,
  findEmployeesByIdentifier,
  listEmployees,
  updateEmployeePhone,
} from "../employees/service.js";
import { sendStandupPrompts } from "../standups/service.js";

type AdminSender = {
  id: string;
  userId: string | null;
  name: string;
  phone: string;
  roleId: string | null;
};

type PendingFlow =
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
    };

type CommandName =
  | "ADD_EMPLOYEE"
  | "UPDATE_PHONE"
  | "EMPLOYEE_LIST"
  | "START_STANDUP"
  | "MENU"
  | "HELP";

const COMMAND_PATTERNS: { name: CommandName; re: RegExp }[] = [
  { name: "ADD_EMPLOYEE", re: /^add\s+employee\b/i },
  { name: "UPDATE_PHONE", re: /^(?:update|change|set)\s+(?:employee\s+)?(?:phone|whatsapp)\b/i },
  { name: "EMPLOYEE_LIST", re: /^employees?\s+list$/i },
  { name: "START_STANDUP", re: /^(?:start|trigger|run)\s+standup\b/i },
  { name: "MENU", re: /^menu$/i },
  { name: "HELP", re: /^help$/i },
];

const ADMIN_KEYWORD =
  /^\s*(MENU|HELP|EMPLOYEE|ADD\s+EMPLOYEE|UPDATE\s+PHONE|CHANGE\s+PHONE|START\s+STANDUP|TRIGGER\s+STANDUP|SCHEDULE|REPORT|HOLIDAY|PAUSE|RESUME)\b/i;

const YES = /^(yes|y|ya|iya|ok|oke|correct|benar|betul)$/i;
const NO = /^(no|n|tidak|bukan|salah|batal|cancel)$/i;

const FLOW_TTL_MS = 10 * 60 * 1000;
const INVALID_PHONE =
  "That phone number doesn't look valid. Send it with the country code, e.g. 628123456789.";

const MENU_TEXT = [
  "Admin menu:",
  "EMPLOYEE LIST - list active employees",
  "ADD EMPLOYEE - add an employee",
  "UPDATE PHONE - change an employee's WhatsApp number",
  "START STANDUP - send today's standup prompts now",
  "CANCEL - abort the current step",
].join("\n");

function standupTriggerReply(result: {
  sent: number;
  skipped: number;
  failed: number;
}) {
  if (result.sent > 0) {
    const parts = [`Standup prompts sent to ${result.sent} employee(s).`];
    if (result.skipped > 0) {
      parts.push(`${result.skipped} already had a session.`);
    }
    if (result.failed > 0) parts.push(`${result.failed} failed to send.`);
    return parts.join(" ");
  }
  if (result.failed > 0) {
    return `Could not send standup prompts (${result.failed} failed). Is WhatsApp connected?`;
  }
  return "No prompts sent - every employee already has a standup session for today.";
}

const flows = new Map<string, { flow: PendingFlow; expiresAt: number }>();

function setFlow(phone: string, flow: PendingFlow) {
  flows.set(phone, { flow, expiresAt: Date.now() + FLOW_TTL_MS });
}

function clearFlow(phone: string) {
  flows.delete(phone);
}

function getFlow(phone: string): PendingFlow | null {
  const entry = flows.get(phone);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    flows.delete(phone);
    return null;
  }
  return entry.flow;
}

function parseCommand(text: string): { name: CommandName; rest: string } | null {
  for (const { name, re } of COMMAND_PATTERNS) {
    const match = text.match(re);
    if (match) {
      return { name, rest: text.slice(match[0].length).trim() };
    }
  }
  return null;
}

function toValidPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const result = phoneNumberSchema.safeParse(input);
  return result.success ? result.data : null;
}

function splitNameAndPhone(input: string): {
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

function extractPhones(text: string): string[] {
  const matches = text.match(/\+?\d[\d\-()]{5,}/g) ?? [];
  return matches
    .map(toValidPhone)
    .filter((phone): phone is string => phone !== null);
}

function isYes(text: string) {
  return YES.test(text.trim().replace(/[.!,\s]+$/, ""));
}

function isNo(text: string) {
  return NO.test(text.trim().replace(/[.!,\s]+$/, ""));
}

function addConfirmation(name: string, phone: string) {
  return `I am about to add ${name} (${phone}). Is this correct? Reply YES or NO.`;
}

function phoneConfirmation(employeeName: string, phone: string) {
  return `I am about to update ${employeeName}'s WhatsApp number to ${phone}. Is this correct? Reply YES or NO.`;
}

async function renderEmployeeList() {
  const rows = await listEmployees({ active: true });
  if (rows.length === 0) return "No active employees found.";

  const lines = rows.slice(0, 50).map((employee, index) => {
    const details = [employee.phone];
    if (employee.teamName) details.push(employee.teamName);
    if (employee.roleName) details.push(employee.roleName);
    return `${index + 1}. ${employee.name} - ${details.join(" - ")}`;
  });

  const suffix =
    rows.length > 50 ? `\nShowing 50 of ${rows.length} employees.` : "";
  return [`Active employees (${rows.length}):`, ...lines].join("\n") + suffix;
}

async function startAddFlow(phone: string, rest: string): Promise<string> {
  const { name, phone: rawPhone } = splitNameAndPhone(rest);
  const parsedPhone = toValidPhone(rawPhone);

  if (rawPhone && !parsedPhone) return INVALID_PHONE;

  if (name && parsedPhone) {
    setFlow(phone, {
      kind: "add",
      step: "confirm",
      name,
      phone: parsedPhone,
    });
    return addConfirmation(name, parsedPhone);
  }

  if (parsedPhone) {
    setFlow(phone, { kind: "add", step: "name", phone: parsedPhone });
    return "What is the employee's name?";
  }

  if (name) {
    setFlow(phone, { kind: "add", step: "phone", name });
    return `What is ${name}'s WhatsApp number (with country code)?`;
  }

  setFlow(phone, { kind: "add", step: "name" });
  return "What is the employee's name?";
}

async function startPhoneFlow(phone: string, rest: string): Promise<string> {
  const numbers = extractPhones(rest);

  if (numbers.length >= 2) {
    const currentPhone = numbers[0];
    const newPhone = numbers[1];
    if (!currentPhone || !newPhone) return INVALID_PHONE;

    const target = await findEmployeeByPhone(currentPhone);
    if (!target) return "No employee found with that phone number.";

    setFlow(phone, {
      kind: "phone",
      step: "confirm",
      employeeId: target.id,
      employeeName: target.name,
      phone: newPhone,
    });
    return phoneConfirmation(target.name, newPhone);
  }

  if (numbers.length === 1) {
    const currentPhone = numbers[0];
    if (!currentPhone) return INVALID_PHONE;

    const target = await findEmployeeByPhone(currentPhone);
    if (!target) return "No employee found with that phone number.";

    setFlow(phone, {
      kind: "phone",
      step: "phone",
      employeeId: target.id,
      employeeName: target.name,
    });
    return `What is the new WhatsApp number for ${target.name}?`;
  }

  setFlow(phone, { kind: "phone", step: "employee" });
  return "Which employee? Send their name or current WhatsApp number.";
}

async function continueAddFlow(
  phone: string,
  flow: Extract<PendingFlow, { kind: "add" }>,
  text: string,
  sender: AdminSender,
): Promise<string> {
  if (flow.step === "name") {
    const name = text.trim();
    if (!name) return "What is the employee's name?";

    const existingPhone = toValidPhone(flow.phone);
    if (!existingPhone) {
      setFlow(phone, { kind: "add", step: "phone", name });
      return `What is ${name}'s WhatsApp number (with country code)?`;
    }

    setFlow(phone, {
      kind: "add",
      step: "confirm",
      name,
      phone: existingPhone,
    });
    return addConfirmation(name, existingPhone);
  }

  if (flow.step === "phone") {
    const candidate = toValidPhone(text);
    if (!candidate) return INVALID_PHONE;

    setFlow(phone, {
      kind: "add",
      step: "confirm",
      name: flow.name,
      phone: candidate,
    });
    return addConfirmation(flow.name, candidate);
  }

  if (isYes(text)) {
    clearFlow(phone);
    try {
      const created = await createEmployee(
        { name: flow.name, phone: flow.phone },
        sender.userId,
      );
      return created
        ? `Employee successfully added.\n${created.name} - ${created.phone}`
        : "Employee successfully added.";
    } catch (error) {
      if (error instanceof HttpError) return error.message;
      throw error;
    }
  }

  if (isNo(text)) {
    clearFlow(phone);
    return "Cancelled.";
  }

  return `Reply YES to confirm adding ${flow.name} (${flow.phone}), or NO to cancel.`;
}

async function continuePhoneFlow(
  phone: string,
  flow: Extract<PendingFlow, { kind: "phone" }>,
  text: string,
  sender: AdminSender,
): Promise<string> {
  if (flow.step === "employee") {
    const matches = await findEmployeesByIdentifier(text);
    if (matches.length === 0) {
      return "No employee found with that name or phone number. Send a name or current WhatsApp number, or reply CANCEL.";
    }
    if (matches.length > 1) {
      const list = matches
        .slice(0, 10)
        .map((employee) => `- ${employee.name} (${employee.phone})`)
        .join("\n");
      return `Multiple employees match:\n${list}\nReply with the exact current WhatsApp number.`;
    }

    const target = matches[0];
    if (!target) return "No employee found with that name or phone number.";

    setFlow(phone, {
      kind: "phone",
      step: "phone",
      employeeId: target.id,
      employeeName: target.name,
    });
    return `What is the new WhatsApp number for ${target.name}?`;
  }

  if (flow.step === "phone") {
    const candidate = toValidPhone(text);
    if (!candidate) return INVALID_PHONE;

    setFlow(phone, {
      kind: "phone",
      step: "confirm",
      employeeId: flow.employeeId,
      employeeName: flow.employeeName,
      phone: candidate,
    });
    return phoneConfirmation(flow.employeeName, candidate);
  }

  if (isYes(text)) {
    clearFlow(phone);
    try {
      await updateEmployeePhone(flow.employeeId, flow.phone, sender.userId);
      return "WhatsApp number updated.";
    } catch (error) {
      if (error instanceof HttpError) return error.message;
      throw error;
    }
  }

  if (isNo(text)) {
    clearFlow(phone);
    return "Cancelled.";
  }

  return `Reply YES to update ${flow.employeeName}'s number to ${flow.phone}, or NO to cancel.`;
}

export async function handleAdminMessage(args: {
  phone: string;
  body: string;
  employee: AdminSender | null;
  roleName: string | null;
}): Promise<string | null> {
  const text = args.body.trim();
  if (!text) return null;

  const command = parseCommand(text);
  const pending = getFlow(args.phone);

  if (!args.employee) {
    const looksAdmin = command || pending || ADMIN_KEYWORD.test(text);
    return looksAdmin ? "You are not a registered user." : null;
  }

  if (!isAdminRole(args.roleName)) {
    const looksAdmin = command || pending || ADMIN_KEYWORD.test(text);
    return looksAdmin ? "You are not an administrator." : null;
  }

  if (/^(cancel|batal|stop)$/i.test(text)) {
    clearFlow(args.phone);
    return "Cancelled.";
  }

  if (command) {
    clearFlow(args.phone);
    switch (command.name) {
      case "MENU":
      case "HELP":
        return MENU_TEXT;
      case "EMPLOYEE_LIST":
        return renderEmployeeList();
      case "ADD_EMPLOYEE":
        return startAddFlow(args.phone, command.rest);
      case "UPDATE_PHONE":
        return startPhoneFlow(args.phone, command.rest);
      case "START_STANDUP": {
        if (command.rest) {
          const matches = await findEmployeesByIdentifier(command.rest);
          if (matches.length === 0) {
            return "No employee found with that name or phone number.";
          }
          if (matches.length > 1 || !matches[0]) {
            return "Multiple employees match. Reply with the exact name or WhatsApp number.";
          }
          const result = await sendStandupPrompts({
            employeeId: matches[0].id,
          });
          return standupTriggerReply(result);
        }
        const result = await sendStandupPrompts();
        return standupTriggerReply(result);
      }
    }
  }

  if (pending) {
    return pending.kind === "add"
      ? continueAddFlow(args.phone, pending, text, args.employee)
      : continuePhoneFlow(args.phone, pending, text, args.employee);
  }

  return null;
}
