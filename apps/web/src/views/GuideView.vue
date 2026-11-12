<template>
  <div class="space-y-5">
    <section class="rounded-3xl border border-border bg-panel p-5 shadow-soft sm:p-6">
      <p class="text-xs font-bold uppercase tracking-wider text-accent">Panduan</p>
      <h2 class="font-display text-xl font-extrabold tracking-tight text-text">Panduan admin</h2>
      <p class="mt-2 text-sm text-text-muted">
        Anggota dengan role <b>Owner</b> atau <b>Admin</b> bisa mengelola tim lewat dua jalur: perintah WhatsApp ke nomor bot, dan dashboard web ini.
        Saat seseorang dijadikan Admin, bot otomatis mengirim ringkasan perintah ke WhatsApp-nya.
      </p>
      <div class="mt-4 flex flex-wrap gap-2">
        <button class="min-h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-white" @click="emit('navigate', 'employees')">Atur role anggota</button>
        <button class="min-h-10 rounded-xl border border-border px-4 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="emit('tour')">Lihat tur pengenalan</button>
      </div>
    </section>

    <section class="rounded-3xl border border-border bg-panel p-5 shadow-soft sm:p-6" aria-labelledby="guide-roles">
      <h3 id="guide-roles" class="font-display text-lg font-extrabold tracking-tight text-text">Hak akses per role</h3>
      <div class="mt-3 overflow-x-auto">
        <table class="w-full min-w-[480px] text-left text-sm">
          <thead class="text-xs uppercase tracking-wider text-text-dim">
            <tr><th class="py-2 pr-3">Fitur</th><th class="py-2 pr-3">Owner / Admin</th><th class="py-2 pr-3">Manager</th><th class="py-2">Employee</th></tr>
          </thead>
          <tbody class="divide-y divide-border">
            <tr v-for="row in roleRows" :key="row[0]">
              <td class="py-2 pr-3 font-semibold text-text">{{ row[0] }}</td>
              <td class="py-2 pr-3 text-text-muted">{{ row[1] }}</td>
              <td class="py-2 pr-3 text-text-muted">{{ row[2] }}</td>
              <td class="py-2 text-text-muted">{{ row[3] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="rounded-3xl border border-border bg-panel p-5 shadow-soft sm:p-6" aria-labelledby="guide-wa">
      <h3 id="guide-wa" class="font-display text-lg font-extrabold tracking-tight text-text">Perintah admin di WhatsApp</h3>
      <p class="mt-1 text-sm text-text-muted">Kirim ke nomor bot dari nomor WhatsApp yang terdaftar sebagai Admin. Huruf besar/kecil tidak masalah. Ketik <code class="rounded-lg bg-panel px-2 py-0.5 font-mono text-xs font-semibold text-accent">MENU</code> kapan saja untuk melihat daftar ini.</p>
      <dl class="mt-4 space-y-2">
        <div v-for="cmd in adminCommands" :key="cmd.cmd" class="flex flex-col gap-1 rounded-2xl bg-panel-hover p-3 sm:flex-row sm:items-baseline sm:gap-4">
          <dt class="shrink-0 sm:w-64"><code class="rounded-lg bg-panel px-2 py-0.5 font-mono text-xs font-semibold text-accent">{{ cmd.cmd }}</code></dt>
          <dd class="text-sm text-text-muted">{{ cmd.desc }}</dd>
        </div>
      </dl>
    </section>

    <section class="rounded-3xl border border-border bg-panel p-5 shadow-soft sm:p-6" aria-labelledby="guide-ai">
      <h3 id="guide-ai" class="font-display text-lg font-extrabold tracking-tight text-text">Perintah bahasa biasa (AI)</h3>
      <p class="mt-1 text-sm text-text-muted">
        Jika API key AI sudah dipasang di
        <button class="font-semibold text-accent hover:underline" @click="emit('navigate', 'ai')">Pengaturan → AI</button>,
        admin cukup menulis seperti biasa, misalnya:
      </p>
      <ul class="mt-3 space-y-2 text-sm">
        <li v-for="ex in aiExamples" :key="ex" class="rounded-2xl bg-panel-hover p-3 text-text">“{{ ex }}”</li>
      </ul>
    </section>

    <section class="rounded-3xl border border-border bg-panel p-5 shadow-soft sm:p-6" aria-labelledby="guide-standup">
      <h3 id="guide-standup" class="font-display text-lg font-extrabold tracking-tight text-text">Standup & check-in pribadi (semua anggota)</h3>
      <p class="mt-1 text-sm text-text-muted">Admin juga mengisi standup sendiri dengan perintah yang sama seperti karyawan.</p>
      <dl class="mt-4 space-y-2">
        <div v-for="cmd in standupCommands" :key="cmd.cmd" class="flex flex-col gap-1 rounded-2xl bg-panel-hover p-3 sm:flex-row sm:items-baseline sm:gap-4">
          <dt class="shrink-0 sm:w-64"><code class="rounded-lg bg-panel px-2 py-0.5 font-mono text-xs font-semibold text-accent">{{ cmd.cmd }}</code></dt>
          <dd class="text-sm text-text-muted">{{ cmd.desc }}</dd>
        </div>
      </dl>
    </section>

    <section class="rounded-3xl border border-border bg-panel p-5 shadow-soft sm:p-6" aria-labelledby="guide-web">
      <h3 id="guide-web" class="font-display text-lg font-extrabold tracking-tight text-text">Lewat dashboard web</h3>
      <ul class="mt-3 grid gap-2 sm:grid-cols-2">
        <li v-for="item in webTasks" :key="item.tab">
          <button class="flex h-full w-full items-start gap-3 rounded-2xl border border-border p-3 text-left transition hover:bg-panel-hover" @click="emit('navigate', item.tab)">
            <span class="min-w-0 flex-1">
              <span class="block font-bold text-text">{{ item.title }}</span>
              <span class="block text-sm text-text-muted">{{ item.desc }}</span>
            </span>
            <span class="text-lg text-text-dim" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
const emit = defineEmits<{ navigate: [tab: string]; tour: [] }>();

const roleRows = [
  ["Perintah admin via WhatsApp", "Ya", "Tidak", "Tidak"],
  ["Anggota, tim, jadwal, hari libur", "Kelola", "Lihat", "—"],
  ["Koneksi WhatsApp & pengaturan AI", "Kelola", "—", "—"],
  ["Laporan & riwayat standup", "Lihat", "Lihat", "—"],
  ["Isi standup lewat WhatsApp", "Ya", "Ya", "Ya"],
];

const adminCommands = [
  { cmd: "MENU / HELP", desc: "Tampilkan daftar perintah admin." },
  { cmd: "EMPLOYEE LIST", desc: "Daftar karyawan aktif." },
  { cmd: "ADD EMPLOYEE", desc: "Tambah karyawan; bot akan menanyakan nama dan nomor, lalu minta konfirmasi." },
  { cmd: "UPDATE PHONE", desc: "Ubah nomor WhatsApp karyawan." },
  { cmd: "START STANDUP", desc: "Kirim prompt standup hari ini ke semua anggota sekarang juga." },
  { cmd: "SCHEDULE", desc: "Lihat jadwal standup." },
  { cmd: "SET SCHEDULE 09:00 MON-FRI", desc: "Ubah waktu (dan hari) standup." },
  { cmd: "SET REMINDER 30 / OFF", desc: "Kirim pengingat sekian menit setelah prompt standup, atau matikan." },
  { cmd: "REPORT TODAY", desc: "Laporan standup hari ini." },
  { cmd: "REPORT WEEKLY", desc: "Laporan standup minggu ini." },
  { cmd: "START CHECKOUT / START MOOD", desc: "Kirim check-out mingguan / ice breaking sekarang juga." },
  { cmd: "REPORT CHECKOUT / REPORT MOOD", desc: "Hasil check-out / mood periode terakhir." },
  { cmd: "CANCEL / BATAL", desc: "Batalkan langkah yang sedang berjalan." },
];

const aiExamples = [
  "jadwalkan standup senin sampai jumat jam 9 pagi WIB",
  "ganti nomor Budi jadi 0812...",
  "siapa saja anggota tim Design?",
  "liburkan standup tanggal 24",
];

const standupCommands = [
  { cmd: "STANDUP", desc: "Mulai atau lanjutkan standup hari ini." },
  { cmd: "STANDUP kemarin: … hari ini: … kendala: …", desc: "Isi semua jawaban sekaligus." },
  { cmd: "UBAH STANDUP kendala: …", desc: "Ubah jawaban yang sudah terkirim." },
  { cmd: "CHECKOUT", desc: "Isi atau lanjutkan check-out mingguan (juga setelah hari Jumat)." },
  { cmd: "MOOD", desc: "Isi atau lanjutkan ice breaking awal minggu." },
  { cmd: "BANTUAN", desc: "Tampilkan bantuan standup." },
];

const webTasks = [
  { tab: "employees", title: "Anggota", desc: "Tambah anggota, atur tim dan role (termasuk menjadikan Admin)." },
  { tab: "whatsapp", title: "WhatsApp", desc: "Hubungkan nomor bot dan pantau statusnya." },
  { tab: "ai", title: "AI", desc: "Pasang API key dan atur batas pemakaian per role." },
  { tab: "schedules", title: "Jadwal", desc: "Atur jam standup dan pengingat." },
  { tab: "checkins", title: "Check-in", desc: "Atur check-out Jumat dan ice breaking Senin beserta pertanyaannya." },
  { tab: "holidays", title: "Hari libur", desc: "Tandai hari tanpa standup." },
  { tab: "reports", title: "Laporan", desc: "Lihat rekap harian dan mingguan." },
];
</script>

