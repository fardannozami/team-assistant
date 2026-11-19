import { MORNING_STANDUP_ELEMENTS, SHIFT_TIMES, isNoBlocker, type StandupElement } from "@repo/shared";

export const STANDUP_QUESTIONS: Record<StandupElement, string> = {
  yesterday: "Apa yang kamu kerjakan kemarin?",
  today: "Apa rencanamu hari ini?",
  blockers: "Ada kendala atau blocker hari ini? (balas 'tidak ada' jika aman)",
};

const ELEMENT_LABEL: Record<StandupElement, string> = {
  yesterday: "Kemarin",
  today: "Rencana hari ini",
  blockers: "Kendala",
};

export const EMPLOYEE_MENU = [
  "Perintah standup:",
  "STANDUP - mulai atau lanjutkan standup pagi (rencana hari ini)",
  "UBAH STANDUP hari ini: ... - ubah rencana yang sudah terkirim",
  `CHECKOUT - isi/lanjutkan checkout harian (jam ${SHIFT_TIMES.day.checkout}, shift malam jam ${SHIFT_TIMES.night.checkout})`,
  "UBAH CHECKOUT ... - ganti yang dikerjakan hari ini (TAMBAH: ... untuk menambah, KENDALA: ... untuk kendala)",
  "CHECKOUT MINGGUAN - isi/lanjutkan check-out mingguan",
  "MOOD - isi/lanjutkan ice breaking awal minggu",
  "BANTUAN - tampilkan pesan ini",
].join("\n");

export const EDIT_HINT = "Untuk mengubah, kirim UBAH STANDUP diikuti bagiannya, contoh: UBAH STANDUP hari ini: lanjut integrasi payment";

/**
 * The morning prompt: what the employee did "kemarin" (from their checkout,
 * else GitHub), then only today's plan is asked.
 */
export function morningPromptText(
  date: string,
  opening?: { from: string; yesterday: string | null; source: "checkout" | "github" | null } | null,
  shift?: string | null,
): string {
  const yesterday = opening?.yesterday
    ? [
        opening.source === "checkout"
          ? `Kemarin (checkout ${opening.from}) kamu mengerjakan:`
          : `Kemarin (dari aktivitas GitHub kamu sejak ${opening.from}):`,
        opening.yesterday,
        "Kalau kurang tepat, kirim: kemarin: <jawabanmu>",
        "",
      ]
    : [];
  const greeting = shift === "night" ? `Selamat malam! Standup shift malam ${date} 🌙` : `Selamat pagi! Standup harian ${date} ☀️`;
  return [greeting, ...yesterday, STANDUP_QUESTIONS.today].join("\n");
}

/** When the checkout will come, said after the plan is in. */
export function checkoutLaterText(shift?: string | null) {
  return shift === "night"
    ? `Besok jam ${SHIFT_TIMES.night.checkout} pagi aku kirim checkout untuk mencatat yang kamu kerjakan shift ini.`
    : `Jam ${SHIFT_TIMES.day.checkout} nanti aku kirim checkout untuk mencatat yang kamu kerjakan hari ini.`;
}

/** Asks only for the morning answers still missing. */
export function standupReminderText(
  date: string,
  missing: readonly StandupElement[] = MORNING_STANDUP_ELEMENTS,
): string {
  return [
    `Pengingat: kamu belum mengirim rencana hari ini untuk standup ${date}.`,
    ...missing.map((key) => STANDUP_QUESTIONS[key]),
  ].join("\n");
}

/** The morning standup: kemarin and today's plan. */
export function summarize(date: string, title: string, answers: { questionKey: string; answer: string }[]) {
  const answerFor = (key: StandupElement) => answers.find((a) => a.questionKey === key)?.answer ?? "-";
  return [`${title} ${date}.`, ...(["yesterday", "today"] as const).map((key) => `${ELEMENT_LABEL[key]}: ${answerFor(key)}`)].join("\n");
}

export function closedText(date: string) {
  return `Standup ${date} sudah ditutup, jawaban tidak bisa dicatat lagi. Sampai jumpa di standup berikutnya!`;
}

// ---- Checkout ----

const CONFIRM_HINT = "Balas OK kalau sudah sesuai, kirim teks untuk menambahkan, atau GANTI: <teks> untuk mengganti semuanya.";

export const CHECKOUT_EDIT_HINT =
  "Untuk mengubah, kirim UBAH CHECKOUT <yang dikerjakan>, UBAH CHECKOUT TAMBAH: <tambahan>, atau UBAH CHECKOUT KENDALA: <kendala>.";

/** The checkout prompt: today's work drafted from GitHub, to confirm or extend. */
export function checkoutPromptText(date: string, draft: string | null): string {
  if (!draft) {
    return [
      `Checkout harian ${date} 🏁`,
      "Belum ada aktivitas GitHub kamu hari ini.",
      "Apa saja yang kamu kerjakan hari ini?",
    ].join("\n");
  }
  return [
    `Checkout harian ${date} 🏁`,
    "Yang kamu kerjakan hari ini (dari aktivitas GitHub):",
    draft,
    "",
    CONFIRM_HINT,
  ].join("\n");
}

export function checkoutBlockerQuestion(done: string) {
  return ["Dicatat. Yang dikerjakan hari ini:", done, "", STANDUP_QUESTIONS.blockers].join("\n");
}

export function checkoutSummary(date: string, title: string, answers: { questionKey: string; answer: string }[]) {
  const answerFor = (key: string) => answers.find((a) => a.questionKey === key)?.answer;
  const blockers = answerFor("blockers");
  return [
    `${title} ${date}.`,
    `Dikerjakan hari ini:\n${answerFor("done") ?? "-"}`,
    `Kendala: ${!blockers ? "-" : isNoBlocker(blockers) ? "tidak ada" : blockers}`,
  ].join("\n");
}

export function checkoutClosedText(date: string) {
  return `Checkout ${date} sudah ditutup. Sampai jumpa di checkout berikutnya!`;
}
