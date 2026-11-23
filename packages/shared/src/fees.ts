// Bonus fees for the international market (T&C Bonus): each person's
// contribution, and each lead's project total, earns a tier percent once it
// reaches $500. Below that it carries over to the next period.

export const FEE_GROUPS = ["pm", "maker", "lead_design", "lead_development"] as const;
export type FeeGroup = (typeof FEE_GROUPS)[number];

// An employee's position; only the two leads earn the lead bonus.
export const EMPLOYEE_LEADS = ["design", "development", "developer", "designer", "pm_sales"] as const;
export type EmployeeLead = (typeof EMPLOYEE_LEADS)[number];

export const FEE_GROUP_LABEL: Record<FeeGroup, string> = {
  pm: "PM & Sales",
  maker: "Designer / Developer",
  lead_design: "Lead Designer",
  lead_development: "Lead Developer",
};

export const BONUS_CURRENCY = "USD";
export const BONUS_MIN = 500;

// From the lowest omset up; `above` is exclusive except for the first tier.
export const BONUS_TIERS: { above: number; pm: number; maker: number; lead: number }[] = [
  { above: 500, pm: 2, maker: 2, lead: 2 },
  { above: 1000, pm: 5, maker: 4, lead: 2 },
  { above: 1500, pm: 6, maker: 5, lead: 3 },
  { above: 3000, pm: 7, maker: 6, lead: 3 },
  { above: 5000, pm: 8, maker: 7, lead: 3 },
];

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The tier percent for a base, 0 below $500. */
export function bonusPercent(group: FeeGroup, base: number) {
  const column = group === "pm" ? "pm" : group === "maker" ? "maker" : "lead";
  let percent = 0;
  for (const [i, tier] of BONUS_TIERS.entries()) {
    if (i === 0 ? base >= tier.above : base > tier.above) percent = tier[column];
  }
  return percent;
}

export type FeeProject = {
  id: string;
  platform: string;
  name: string;
  type: string; // development | design
  status: string;
  currency: string;
  endDate: string | null;
  splitBase: number;
  members: { employeeId: string; employeeName: string; role: string; sharePercent: number; fee: number }[];
};

export type FeeRow = {
  projectId: string;
  platform: string;
  name: string;
  type: string;
  endDate: string;
  members: string[];
  /** The project's fee diterima. */
  total: number;
  /** Ended before the period: carried over from an earlier one. */
  carried: boolean;
  /** Unpaid amounts this row adds to each of the person's groups. */
  amounts: Partial<Record<FeeGroup, number>>;
  /** The person's share on the project, all roles together. */
  contributionPercent: number;
  /** The person's own fee on the project (pm + maker), unpaid part only. */
  fee: number;
};

export type FeeGroupTotal = {
  group: FeeGroup;
  base: number;
  eligible: boolean;
  tierPercent: number;
  percent: number;
  bonus: number;
};

export type FeeStatement = {
  employeeId: string;
  rows: FeeRow[];
  groups: FeeGroupTotal[];
  total: number;
};

/**
 * Projects that count for bonuses: USD, not cancelled, ended by `to` (and on
 * or after the workspace's start date). Earlier periods are included on
 * purpose: what was never paid out carries over.
 */
export function bonusProjects(projects: FeeProject[], to: string, startDate?: string | null) {
  return projects.filter(
    (p) =>
      p.currency === BONUS_CURRENCY &&
      p.status !== "cancelled" &&
      !!p.endDate &&
      p.endDate <= to &&
      (!startDate || p.endDate >= startDate),
  );
}

const ROLE_GROUP: Record<string, FeeGroup> = { pm_sales: "pm", designer: "maker", developer: "maker" };

/**
 * One person's statement for the period ending `to`: every unpaid amount in
 * their groups, each group's base, and its bonus once the base reaches $500.
 * `paid` holds "<group>:<projectId>" already paid out to this person.
 * `overrides` replaces a group's tier percent (still 0 when not eligible).
 */
export function feeStatement(args: {
  projects: FeeProject[];
  employee: { id: string; lead?: string | null };
  from: string;
  to: string;
  startDate?: string | null;
  paid?: Set<string>;
  overrides?: Partial<Record<FeeGroup, number>>;
}): FeeStatement {
  const paid = args.paid ?? new Set<string>();
  const leadGroup: FeeGroup | null =
    args.employee.lead === "design" ? "lead_design" : args.employee.lead === "development" ? "lead_development" : null;
  const unpaid = (group: FeeGroup, projectId: string) => !paid.has(`${group}:${projectId}`);

  const rows: FeeRow[] = [];
  for (const p of bonusProjects(args.projects, args.to, args.startDate)) {
    const own = p.members.filter((m) => m.employeeId === args.employee.id);
    const amounts: Partial<Record<FeeGroup, number>> = {};
    for (const m of own) {
      const group = ROLE_GROUP[m.role];
      if (group && unpaid(group, p.id)) amounts[group] = round2((amounts[group] ?? 0) + m.fee);
    }
    if (leadGroup && p.type === args.employee.lead && unpaid(leadGroup, p.id)) amounts[leadGroup] = p.splitBase;
    if (!Object.keys(amounts).length) continue;

    const makers = p.members.filter((m) => m.role !== "pm_sales").map((m) => m.employeeName);
    rows.push({
      projectId: p.id,
      platform: p.platform,
      name: p.name,
      type: p.type,
      endDate: p.endDate!,
      members: [...new Set(makers.length ? makers : p.members.map((m) => m.employeeName))],
      total: p.splitBase,
      carried: p.endDate! < args.from,
      amounts,
      contributionPercent: round2(own.reduce((s, m) => s + m.sharePercent, 0)),
      fee: round2((amounts.pm ?? 0) + (amounts.maker ?? 0)),
    });
  }
  rows.sort((a, b) => a.endDate.localeCompare(b.endDate) || a.name.localeCompare(b.name));

  const present = FEE_GROUPS.filter((g) => g === leadGroup || rows.some((r) => r.amounts[g] !== undefined));
  const groups = present.map((group): FeeGroupTotal => {
    const base = round2(rows.reduce((s, r) => s + (r.amounts[group] ?? 0), 0));
    const eligible = base >= BONUS_MIN;
    const tierPercent = bonusPercent(group, base);
    const percent = eligible ? (args.overrides?.[group] ?? tierPercent) : 0;
    return { group, base, eligible, tierPercent, percent, bonus: eligible ? round2((base * percent) / 100) : 0 };
  });
  return {
    employeeId: args.employee.id,
    rows,
    groups,
    total: round2(groups.reduce((s, g) => s + g.bonus, 0)),
  };
}
