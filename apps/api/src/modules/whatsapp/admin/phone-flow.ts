import { HttpError } from "../../../lib/http-error.js";
import {
  findEmployeeByPhone,
  findEmployeesByIdentifier,
  updateEmployeePhone,
} from "../../employees/service.js";
import {
  clearFlow,
  extractPhones,
  INVALID_PHONE,
  isNo,
  isYes,
  setFlow,
  toValidPhone,
  type AdminSender,
  type PendingFlow,
} from "./flows.js";

function phoneConfirmation(employeeName: string, phone: string) {
  return `Saya akan mengubah nomor WhatsApp ${employeeName} menjadi ${phone}. Sudah benar? Balas YA atau TIDAK.`;
}

function askNewPhone(flowKey: string, target: { id: string; name: string }) {
  setFlow(flowKey, {
    kind: "phone",
    step: "phone",
    employeeId: target.id,
    employeeName: target.name,
  });
  return `What is the new WhatsApp number for ${target.name}?`;
}

export async function startPhoneFlow(
  workspaceId: string,
  flowKey: string,
  rest: string,
): Promise<string> {
  const numbers = extractPhones(rest);

  if (numbers.length >= 2) {
    const currentPhone = numbers[0];
    const newPhone = numbers[1];
    if (!currentPhone || !newPhone) return INVALID_PHONE;

    const target = await findEmployeeByPhone(workspaceId, currentPhone);
    if (!target) return "Karyawan dengan nomor itu tidak ditemukan.";

    setFlow(flowKey, {
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

    const target = await findEmployeeByPhone(workspaceId, currentPhone);
    if (!target) return "Karyawan dengan nomor itu tidak ditemukan.";
    return askNewPhone(flowKey, target);
  }

  setFlow(flowKey, { kind: "phone", step: "employee" });
  return "Karyawan yang mana? Kirim nama atau nomor WhatsApp saat ini.";
}

export async function continuePhoneFlow(
  workspaceId: string,
  flowKey: string,
  flow: Extract<PendingFlow, { kind: "phone" }>,
  text: string,
  sender: AdminSender,
): Promise<string> {
  if (flow.step === "employee") {
    const matches = await findEmployeesByIdentifier(workspaceId, text);
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
    if (!target) return "Karyawan dengan nama atau nomor itu tidak ditemukan.";
    return askNewPhone(flowKey, target);
  }

  if (flow.step === "phone") {
    const candidate = toValidPhone(text);
    if (!candidate) return INVALID_PHONE;

    setFlow(flowKey, {
      kind: "phone",
      step: "confirm",
      employeeId: flow.employeeId,
      employeeName: flow.employeeName,
      phone: candidate,
    });
    return phoneConfirmation(flow.employeeName, candidate);
  }

  if (isYes(text)) {
    clearFlow(flowKey);
    try {
      await updateEmployeePhone(workspaceId, flow.employeeId, flow.phone, sender.userId);
      return "Nomor WhatsApp diperbarui.";
    } catch (error) {
      if (error instanceof HttpError) return error.message;
      throw error;
    }
  }

  if (isNo(text)) {
    clearFlow(flowKey);
    return "Dibatalkan.";
  }

  return `Reply YES to update ${flow.employeeName}'s number to ${flow.phone}, or NO to cancel.`;
}
