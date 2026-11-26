/** Night shift dates: its morning still belongs to the evening before. */
import { describe, expect, test } from "bun:test";
import { shiftDate } from "@repo/shared";
import { checkoutLaterText, morningPromptText } from "./modules/standups/engine/texts.js";

// 2026-11-20 in Jakarta (UTC+7).
const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00+07:00`);

describe("shift dates", () => {
  test("the day shift is the calendar day", () => {
    expect(shiftDate("day", "Asia/Jakarta", at("07:00"))).toBe("2026-11-20");
    expect(shiftDate(null, "Asia/Jakarta", at("23:00"))).toBe("2026-11-20");
  });

  test("the night shift's 07:00 checkout is for the evening before", () => {
    expect(shiftDate("night", "Asia/Jakarta", at("07:00"))).toBe("2026-11-19");
    expect(shiftDate("night", "Asia/Jakarta", at("11:59"))).toBe("2026-11-19");
    expect(shiftDate("night", "Asia/Jakarta", at("12:00"))).toBe("2026-11-20");
    expect(shiftDate("night", "Asia/Jakarta", at("19:00"))).toBe("2026-11-20");
    expect(shiftDate("night", "Asia/Jakarta", at("23:30"))).toBe("2026-11-20");
  });

  test("night shift texts", () => {
    expect(morningPromptText("2026-11-20", null, "night")).toBe("Selamat malam! Standup shift malam 2026-11-20 🌙\nApa rencanamu hari ini?");
    expect(checkoutLaterText("night")).toContain("Besok jam 07:00 pagi");
    expect(checkoutLaterText("day")).toContain("Jam 17:00 nanti");
  });
});
