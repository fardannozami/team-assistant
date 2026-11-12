import type { CheckinKind, CheckinQuestion } from "@repo/shared";

export type CheckinDefaults = {
  weekdays: number[];
  timeOfDay: string;
  reminderMinutes: number | null;
  closeTime: string | null;
  questions: CheckinQuestion[];
};

// Mirrors DailyBot's weekly check-out and Monday ice breaker, so teams moving
// over keep the same rhythm.
export const CHECKIN_DEFAULTS: Record<CheckinKind, CheckinDefaults> = {
  checkout: {
    weekdays: [5],
    timeOfDay: "16:00",
    reminderMinutes: 60,
    closeTime: null,
    questions: [
      { key: "week_score", type: "mood", text: "Secara keseluruhan, bagaimana minggu ini buatmu?" },
      { key: "wins", type: "text", text: "Apa pencapaian terbesarmu minggu ini?" },
      { key: "challenges", type: "text", text: "Apa yang belum selesai atau jadi tantangan?" },
      { key: "next_week", type: "text", text: "Apa fokus utamamu minggu depan?" },
      { key: "notes", type: "text", text: "Ada yang ingin disampaikan ke tim atau atasan? (balas - jika tidak ada)" },
    ],
  },
  icebreaker: {
    weekdays: [1],
    timeOfDay: "08:30",
    reminderMinutes: null,
    closeTime: null,
    questions: [
      { key: "mood", type: "mood", text: "Gimana mood kamu pagi ini?" },
      { key: "weekend", type: "text", text: "Ada cerita seru dari akhir pekan kemarin? (balas - untuk lewati)" },
    ],
  },
};

export const CHECKIN_LABEL: Record<CheckinKind, string> = {
  checkout: "Check-out mingguan",
  icebreaker: "Ice breaking",
};

// Used when the workspace has no AI key, or the AI call fails.
export const MOTIVATION_QUOTES = [
  "Kesuksesan adalah jumlah dari usaha kecil yang diulang hari demi hari. — Robert Collier",
  "Mulailah dari mana kamu berada. Gunakan apa yang kamu punya. Lakukan apa yang kamu bisa. — Arthur Ashe",
  "Satu-satunya cara melakukan pekerjaan hebat adalah mencintai apa yang kamu lakukan. — Steve Jobs",
  "Jangan hitung hari-harinya, buat hari-harinya berarti. — Muhammad Ali",
  "Sendirian kita bisa melakukan sedikit; bersama kita bisa melakukan banyak hal. — Helen Keller",
  "Disiplin adalah jembatan antara tujuan dan pencapaian. — Jim Rohn",
  "Kemajuan, bukan kesempurnaan.",
  "Rahasia untuk maju adalah memulai. — Mark Twain",
  "Hal besar tidak pernah datang dari zona nyaman.",
  "Kerja keras mengalahkan bakat ketika bakat tidak bekerja keras. — Tim Notke",
  "Setiap pencapaian dimulai dengan keputusan untuk mencoba. — John F. Kennedy",
  "Fokus pada langkah berikutnya, bukan seluruh tangga.",
  "Tim yang hebat bukan tim tanpa masalah, tapi tim yang menyelesaikannya bersama.",
  "Hari ini adalah kesempatan untuk menjadi sedikit lebih baik dari kemarin.",
  "Kualitas bukan tindakan, melainkan kebiasaan. — Aristoteles",
  "Percayalah kamu bisa, dan kamu sudah setengah jalan. — Theodore Roosevelt",
  "Lakukan yang terbaik sampai kamu tahu yang lebih baik; lalu, ketika tahu, lakukan yang lebih baik. — Maya Angelou",
  "Bakat memenangkan pertandingan, tapi kerja sama tim memenangkan kejuaraan. — Michael Jordan",
  "Jangan menunggu kesempatan, ciptakanlah.",
  "Masa depan bergantung pada apa yang kamu lakukan hari ini. — Mahatma Gandhi",
];
