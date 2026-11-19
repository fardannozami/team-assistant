/** Bonus fees: tiers, carry-over below $500, and the sample "Fee Februari - Abdan". */
import { describe, expect, test } from "bun:test";
import { bonusPercent, feeStatement, type FeeProject } from "@repo/shared";
import { periodLabel, statementPdf } from "./modules/fees/pdf.js";

const ABDAN = "00000000-0000-0000-0000-00000000000a";
const ZAINAL = "00000000-0000-0000-0000-00000000000b";

let seq = 0;
function project(total: number, abdan: { share: number; fee: number } | null, extra: Partial<FeeProject> = {}): FeeProject {
  seq++;
  return {
    id: `p${seq}`,
    platform: "Upwork",
    name: `Project ${seq}`,
    type: "design",
    status: "completed",
    currency: "USD",
    endDate: "2026-02-15",
    splitBase: total,
    members: [
      ...(abdan ? [{ employeeId: ABDAN, employeeName: "Abdan", role: "designer", sharePercent: abdan.share, fee: abdan.fee }] : []),
      { employeeId: ZAINAL, employeeName: "Zainal", role: "designer", sharePercent: 100 - (abdan?.share ?? 0), fee: 0 },
    ],
    ...extra,
  };
}

// The February sheet: every design project, Abdan's share where he worked.
const february = [
  project(56.25, { share: 100, fee: 56.25 }),
  project(33.15, null),
  project(81.6, null),
  project(165.75, null),
  project(35.7, null),
  project(180, null),
  project(225, { share: 25, fee: 56.25 }),
  project(4.5, { share: 100, fee: 4.5 }),
  project(20.4, null),
  project(153, null),
  project(225, { share: 30, fee: 67.5 }),
  project(90, { share: 30, fee: 27 }),
  project(108, { share: 25, fee: 27 }),
  project(65.25, { share: 100, fee: 65.25 }),
  // Highlighted in the sheet and left out of its $1,616.55 total.
  project(339.15, null, { status: "cancelled" }),
  project(45, null),
  project(92.25, { share: 75, fee: 69.19 }),
  project(35.7, null),
];
const FEB = { from: "2026-02-01", to: "2026-02-28" };

describe("bonus tiers", () => {
  test("edges of the table", () => {
    const cases: [number, number, number, number][] = [
      [499.99, 0, 0, 0],
      [500, 2, 2, 2],
      [1000, 2, 2, 2],
      [1000.01, 5, 4, 2],
      [1500, 5, 4, 2],
      [1616.55, 6, 5, 3],
      [3000, 6, 5, 3],
      [5000, 7, 6, 3],
      [5000.01, 8, 7, 3],
    ];
    for (const [base, pm, maker, lead] of cases) {
      expect([base, bonusPercent("pm", base), bonusPercent("maker", base), bonusPercent("lead_design", base)]).toEqual([base, pm, maker, lead]);
    }
  });
});

describe("fee statement", () => {
  test("the February sample: designer not eligible yet, lead 3% of the design total", () => {
    const s = feeStatement({ projects: february, employee: { id: ABDAN, lead: "design" }, ...FEB });
    expect(s.rows).toHaveLength(17);
    const maker = s.groups.find((g) => g.group === "maker")!;
    expect(maker).toMatchObject({ base: 372.94, eligible: false, bonus: 0 });
    const lead = s.groups.find((g) => g.group === "lead_design")!;
    expect(lead).toMatchObject({ base: 1616.55, eligible: true, percent: 3, bonus: 48.5 });
    expect(s.total).toBe(48.5);
  });

  test("a non-lead only sees the projects they worked on", () => {
    const s = feeStatement({ projects: february, employee: { id: ABDAN }, ...FEB });
    expect(s.rows).toHaveLength(8);
    expect(s.groups.map((g) => g.group)).toEqual(["maker"]);
  });

  test("below $500 carries over until it is eligible", () => {
    const jan = project(300, { share: 100, fee: 300 }, { type: "development", endDate: "2026-01-20" });
    const feb = project(250, { share: 100, fee: 250 }, { type: "development", endDate: "2026-02-10" });
    const january = feeStatement({ projects: [jan, feb], employee: { id: ABDAN }, from: "2026-01-01", to: "2026-01-31" });
    expect(january.groups[0]).toMatchObject({ base: 300, eligible: false });

    const s = feeStatement({ projects: [jan, feb], employee: { id: ABDAN }, ...FEB });
    expect(s.groups[0]).toMatchObject({ group: "maker", base: 550, eligible: true, percent: 2, bonus: 11 });
    expect(s.rows.map((r) => r.carried)).toEqual([true, false]);

    // Once paid, it leaves the carry-over.
    const paid = new Set([`maker:${jan.id}`, `maker:${feb.id}`]);
    expect(feeStatement({ projects: [jan, feb], employee: { id: ABDAN }, ...FEB, paid }).rows).toHaveLength(0);
  });

  test("overrides change eligible groups only", () => {
    const s = feeStatement({
      projects: february,
      employee: { id: ABDAN, lead: "design" },
      ...FEB,
      overrides: { lead_design: 5, maker: 10 },
    });
    expect(s.groups.find((g) => g.group === "lead_design")!.bonus).toBe(80.83);
    expect(s.groups.find((g) => g.group === "maker")!.bonus).toBe(0);
  });

  test("non-USD, cancelled, open-ended, too late and before the start date are left out", () => {
    const projects = [
      project(600, { share: 100, fee: 600 }, { currency: "IDR" }),
      project(600, { share: 100, fee: 600 }, { status: "cancelled" }),
      project(600, { share: 100, fee: 600 }, { endDate: null }),
      project(600, { share: 100, fee: 600 }, { endDate: "2026-03-01" }),
      project(600, { share: 100, fee: 600 }, { endDate: "2025-12-31" }),
    ];
    const s = feeStatement({ projects, employee: { id: ABDAN }, ...FEB, startDate: "2026-01-01" });
    expect(s.rows).toHaveLength(0);
  });

  test("PM & Sales has its own column", () => {
    const p = project(1000, null);
    p.members.push({ employeeId: ABDAN, employeeName: "Abdan", role: "pm_sales", sharePercent: 60, fee: 600 });
    const s = feeStatement({ projects: [p], employee: { id: ABDAN }, ...FEB });
    expect(s.groups).toEqual([{ group: "pm", base: 600, eligible: true, tierPercent: 2, percent: 2, bonus: 12 }]);
  });
});

describe("statement PDF", () => {
  test("period label", () => {
    expect(periodLabel("2026-02-01", "2026-02-28")).toBe("Februari 2026");
    expect(periodLabel("2026-02-01", "2026-03-15")).toBe("1 Feb 2026 – 15 Mar 2026");
  });

  test("renders a PDF", async () => {
    const statement = feeStatement({ projects: february, employee: { id: ABDAN, lead: "design" }, ...FEB });
    const pdf = await statementPdf({ name: "Abdan", ...FEB, statement });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
    await Bun.write(`${process.env.FEE_PDF_OUT ?? "/dev/null"}`, pdf);
  });
});
