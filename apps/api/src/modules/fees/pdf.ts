/**
 * A person's fee statement as a PDF, laid out like the team's spreadsheet
 * export: one row per project, then the bonus per group and the total.
 */
import PDFDocument from "pdfkit";
import { BONUS_MIN, FEE_GROUP_LABEL, type FeeStatement } from "@repo/shared";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const money = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function shortDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return `${day} ${MONTHS[m! - 1]!.slice(0, 3)} ${y}`;
}

/** "Februari 2026" for a whole month, else "1 Feb 2026 – 15 Mar 2026". */
export function periodLabel(from: string, to: string) {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(ty!, tm!, 0)).getUTCDate();
  if (fy === ty && fm === tm && fd === 1 && td === lastDay) return `${MONTHS[fm! - 1]} ${fy}`;
  return `${shortDate(from)} – ${shortDate(to)}`;
}

/** "Fee Designer" or "Fee Developer" by the project types worked on. */
function makerLabel(statement: FeeStatement) {
  const types = new Set(statement.rows.filter((r) => r.amounts.maker !== undefined).map((r) => r.type));
  if (types.size === 1) return types.has("design") ? "Fee Designer" : "Fee Developer";
  return "Fee Designer/Dev";
}

const GREEN = "#36664F";
const STRIPE = "#F3F4F6";
const HIGHLIGHT = "#FFFF00";

export function statementPdf(args: { name: string; from: string; to: string; statement: FeeStatement }): Promise<Buffer> {
  const { name, statement } = args;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const cols = [
    { title: "Platform", w: 70, align: "left" as const },
    { title: "Nama Project", w: 250, align: "left" as const },
    { title: "Anggota", w: 160, align: "left" as const },
    { title: "Total Fee", w: 90, align: "right" as const },
    { title: `Kontribusi ${name} (%)`, w: width - 70 - 250 - 160 - 90 - 90, align: "right" as const },
    { title: `Fee ${name}`, w: 90, align: "right" as const },
  ];
  const ROW = 20;

  doc.font("Helvetica-Bold").fontSize(16).fillColor("#111").text(`Fee ${periodLabel(args.from, args.to)} - ${name}`, left, 36);
  doc.font("Helvetica").fontSize(9).fillColor("#555").text(`Periode ${shortDate(args.from)} – ${shortDate(args.to)}`);
  let y = doc.y + 10;

  const cells = (values: string[], opts: { bold?: boolean; color?: string; fill?: string; at?: number }) => {
    const top = opts.at ?? y;
    if (opts.fill) doc.rect(left, top, width, ROW).fill(opts.fill);
    doc.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(opts.color ?? "#222");
    let x = left;
    values.forEach((v, i) => {
      const col = cols[i]!;
      doc.text(v, x + 5, top + 6, { width: col.w - 10, align: col.align, lineBreak: false, ellipsis: true });
      x += col.w;
    });
  };
  const header = () => {
    cells(cols.map((c) => c.title), { bold: true, color: "#fff", fill: GREEN });
    y += ROW;
  };
  const room = () => {
    if (y + ROW > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.page.margins.top;
      header();
    }
  };

  header();
  statement.rows.forEach((r, i) => {
    room();
    cells(
      [
        r.platform,
        `${r.carried ? "* " : ""}${r.name}`,
        r.members.join(", "),
        money(r.total),
        r.fee ? String(r.contributionPercent) : "",
        money(r.fee),
      ],
      { fill: i % 2 ? STRIPE : undefined },
    );
    y += ROW;
  });
  if (!statement.rows.length) {
    cells(["", "Tidak ada project yang belum dibayar.", "", "", "", ""], { color: "#777" });
    y += ROW;
  }

  // Totals, in the last two columns like the spreadsheet.
  const labelX = left + cols.slice(0, 4).reduce((s, c) => s + c.w, 0);
  const labelW = cols[4]!.w;
  const valueW = cols[5]!.w;
  const totalLine = (label: string, value: string, opts: { fill?: string; note?: string; bold?: boolean } = {}) => {
    room();
    if (opts.fill) doc.rect(labelX, y, labelW + valueW, ROW).fill(opts.fill);
    doc.font(opts.bold === false ? "Helvetica" : "Helvetica-Bold").fontSize(8.5).fillColor("#222");
    doc.text(label, labelX + 5, y + 6, { width: labelW - 10, align: "right", lineBreak: false });
    doc.text(value, labelX + labelW + 5, y + 6, { width: valueW - 10, align: "right", lineBreak: false });
    if (opts.note) {
      doc.font("Helvetica").fontSize(7.5).fillColor("#666");
      doc.text(opts.note, left, y + 6, { width: labelX - left - 10, align: "right", lineBreak: false });
    }
    y += ROW;
  };

  y += 4;
  const sumTotal = statement.rows.reduce((s, r) => s + r.total, 0);
  const sumFee = statement.rows.reduce((s, r) => s + r.fee, 0);
  room();
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#222");
  doc.text(money(sumTotal), left + cols.slice(0, 3).reduce((s, c) => s + c.w, 0) + 5, y + 6, { width: cols[3]!.w - 10, align: "right" });
  totalLine("TOTAL", money(sumFee));

  for (const g of statement.groups) {
    const label = g.group === "maker" ? makerLabel(statement) : `Fee ${FEE_GROUP_LABEL[g.group]}`;
    const note = g.eligible
      ? `${g.percent}% × ${money(g.base)}`
      : `${money(g.base)} belum eligible (min. ${money(BONUS_MIN)}), dibawa ke periode berikutnya`;
    totalLine(label, g.eligible ? money(g.bonus) : "-", { note });
  }
  totalLine("TOTAL FEE", money(statement.total), { fill: HIGHLIGHT });

  if (statement.rows.some((r) => r.carried)) {
    y += 8;
    room();
    doc.font("Helvetica").fontSize(7.5).fillColor("#666").text("* Project dari periode sebelumnya yang belum dibayarkan (carry over).", left, y);
  }

  doc.end();
  return done;
}
