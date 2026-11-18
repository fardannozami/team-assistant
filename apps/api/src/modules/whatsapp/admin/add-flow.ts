import { HttpError } from "../../../lib/http-error.js";
import { createEmployee } from "../../employees/service.js";
import {
  clearFlow,
  INVALID_PHONE,
  isNo,
  isYes,
  setFlow,
  splitNameAndPhone,
  toValidPhone,
  type AdminSender,
  type PendingFlow,
} from "./flows.js";

function addConfirmation(name: string, phone: string) {
  return `Saya akan menambahkan ${name} (${phone}). Sudah benar? Balas YA atau TIDAK.`;
}

export async function startAddFlow(flowKey: string, rest: string): Promise<string> {
  const { name, phone: rawPhone } = splitNameAndPhone(rest);
  const parsedPhone = toValidPhone(rawPhone);

  if (rawPhone && !parsedPhone) return INVALID_PHONE;

  if (name && parsedPhone) {
    setFlow(flowKey, {
      kind: "add",
      step: "confirm",
      name,
      phone: parsedPhone,
    });
    return addConfirmation(name, parsedPhone);
  }

  if (parsedPhone) {
    setFlow(flowKey, { kind: "add", step: "name", phone: parsedPhone });
    return "Siapa nama karyawannya?";
  }

  if (name) {
    setFlow(flowKey, { kind: "add", step: "phone", name });
    return `Berapa nomor WhatsApp ${name} (dengan kode negara)?`;
  }

  setFlow(flowKey, { kind: "add", step: "name" });
  return "Siapa nama karyawannya?";
}

export async function continueAddFlow(
  workspaceId: string,
  flowKey: string,
  flow: Extract<PendingFlow, { kind: "add" }>,
  text: string,
  sender: AdminSender,
): Promise<string> {
  if (flow.step === "name") {
    const name = text.trim();
    if (!name) return "Siapa nama karyawannya?";

    const existingPhone = toValidPhone(flow.phone);
    if (!existingPhone) {
      setFlow(flowKey, { kind: "add", step: "phone", name });
      return `Berapa nomor WhatsApp ${name} (dengan kode negara)?`;
    }

    setFlow(flowKey, {
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

    setFlow(flowKey, {
      kind: "add",
      step: "confirm",
      name: flow.name,
      phone: candidate,
    });
    return addConfirmation(flow.name, candidate);
  }

  if (isYes(text)) {
    clearFlow(flowKey);
    try {
      const created = await createEmployee(
        workspaceId,
        { name: flow.name, phone: flow.phone },
        sender.userId,
      );
      return created
        ? `Employee successfully added.\n${created.name} - ${created.phone}`
        : "Karyawan berhasil ditambahkan.";
    } catch (error) {
      if (error instanceof HttpError) return error.message;
      throw error;
    }
  }

  if (isNo(text)) {
    clearFlow(flowKey);
    return "Dibatalkan.";
  }

  return `Reply YES to confirm adding ${flow.name} (${flow.phone}), or NO to cancel.`;
}
