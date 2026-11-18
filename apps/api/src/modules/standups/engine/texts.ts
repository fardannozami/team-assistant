import { CORE_STANDUP_ELEMENTS, type StandupElement } from "@repo/shared";

export const STANDUP_QUESTIONS: Record<StandupElement, string> = {
  yesterday: "Apa yang kamu kerjakan kemarin?",
  today: "Apa rencanamu hari ini?",
  blockers: "Ada kendala atau blocker? (balas 'tidak ada' jika aman)",
};

const ELEMENT_LABEL: Record<StandupElement, string> = {
  yesterday: "Kemarin",
  today: "Hari ini",
  blockers: "Kendala",
};

export const EMPLOYEE_MENU = [
  "Perintah standup:",
  "STANDUP - mulai atau lanjutkan standup hari ini",
  "STANDUP kemarin: ... hari ini: ... kendala: ... - isi sekaligus",
  "UBAH STANDUP kendala: ... - ubah jawaban yang sudah terkirim",
  "CHECKOUT - isi/lanjutkan check-out mingguan",
  "MOOD - isi/lanjutkan ice breaking awal minggu",
  "BANTUAN - tampilkan pesan ini",
].join("\n");

export const EDIT_HINT = "Untuk mengubah, kirim UBAH STANDUP diikuti bagiannya, contoh: UBAH STANDUP kendala: menunggu akses server";

export function standupPromptText(date: string, githubHint?: string | null): string {
  return [
    `Standup harian untuk ${date}:`,
    ...(githubHint ? [githubHint, ""] : []),
    `1. ${STANDUP_QUESTIONS.yesterday}`,
    `2. ${STANDUP_QUESTIONS.today}`,
    `3. ${STANDUP_QUESTIONS.blockers}`,
    "Balas dalam satu pesan atau beberapa pesan - jawabanmu akan saya catat.",
  ].join("\n");
}

/** Prompt when "kemarin" was already drafted from GitHub: asks for the rest. */
export function draftedPromptText(date: string, from: string, draft: string): string {
  return [
    `Standup harian untuk ${date}:`,
    `Kemarin (dari aktivitas GitHub kamu sejak ${from}):`,
    draft,
    "Kalau kurang tepat, kirim: kemarin: <jawabanmu>",
    "",
    `1. ${STANDUP_QUESTIONS.today}`,
    `2. ${STANDUP_QUESTIONS.blockers}`,
    "Balas dalam satu pesan atau beberapa pesan - jawabanmu akan saya catat.",
  ].join("\n");
}

/** Asks only for the answers still missing (all three by default). */
export function standupReminderText(
  date: string,
  missing: readonly StandupElement[] = CORE_STANDUP_ELEMENTS,
): string {
  const partial = missing.length < CORE_STANDUP_ELEMENTS.length;
  return [
    partial
      ? `Pengingat: standup ${date} kamu belum lengkap.`
      : `Pengingat: kamu belum mengirim standup untuk ${date}.`,
    ...missing.map((key) => STANDUP_QUESTIONS[key]),
  ].join("\n");
}

export function summarize(date: string, title: string, answers: { questionKey: string; answer: string }[]) {
  const answerFor = (key: StandupElement) =>
    answers.find((a) => a.questionKey === key)?.answer ?? "-";
  return [
    `${title} ${date}.`,
    ...CORE_STANDUP_ELEMENTS.map((key) => `${ELEMENT_LABEL[key]}: ${answerFor(key)}`),
  ].join("\n");
}

export function closedText(date: string) {
  return `Standup ${date} sudah ditutup, jawaban tidak bisa dicatat lagi. Sampai jumpa di standup berikutnya!`;
}
