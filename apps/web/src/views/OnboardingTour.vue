<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-text/30 p-0 backdrop-blur-sm fade-in-fast sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="tour-title">
    <div class="w-full max-w-[460px] rounded-t-3xl border border-border bg-panel p-6 shadow-soft-lg sm:rounded-3xl sm:p-8 reveal">
      <div class="mb-6 flex items-center justify-between">
        <div class="flex gap-1.5" aria-hidden="true">
          <span v-for="(_, i) in steps" :key="i" class="h-1.5 rounded-full transition-all" :class="i === step ? 'w-6 bg-accent' : 'w-1.5 bg-border'"></span>
        </div>
        <button class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="emit('close')">Lewati</button>
      </div>

      <div :key="step" class="slide-in">
        <div class="mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-accent/10 text-2xl text-accent" aria-hidden="true">{{ current.icon }}</div>
        <p class="text-xs font-bold uppercase tracking-wider text-text-dim">Langkah {{ step + 1 }} dari {{ steps.length }}</p>
        <h2 id="tour-title" class="mt-1 font-display text-2xl font-extrabold tracking-tight text-text">{{ current.title }}</h2>
        <p class="mt-2 text-base leading-relaxed text-text-muted">{{ current.body }}</p>
      </div>

      <div class="mt-8 flex gap-2">
        <button v-if="step > 0" class="min-h-12 rounded-xl border border-border px-4 text-sm font-bold text-text hover:bg-panel-hover" @click="step--">Kembali</button>
        <button class="min-h-12 flex-1 rounded-xl bg-accent px-4 text-sm font-bold text-white transition hover:bg-accent-hover" @click="next">
          {{ isLast ? "Mulai siapkan tim" : "Lanjut" }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";

const emit = defineEmits<{ (event: "close"): void }>();

const steps = [
  { icon: "👋", title: "Selamat datang di Team Assistant", body: "Ini workspace Anda sendiri: bot WhatsApp, anggota, dan laporan Anda terpisah dari pengguna lain. Asisten menanyakan kabar harian tim lewat WhatsApp, lalu merangkumnya untuk Anda." },
  { icon: "💬", title: "Standup lewat WhatsApp", body: "Setiap hari kerja, bot mengirim pertanyaan standup ke anggota. Mereka cukup membalas chat — tanpa aplikasi tambahan." },
  { icon: "🔑", title: "AI dengan API key Anda sendiri", body: "Bot memakai AI untuk menjawab pertanyaan dan perintah bebas. Setiap workspace memakai API key miliknya sendiri, jadi kuota Anda tidak terbagi dengan pengguna lain. Google Gemini dan Groq punya kuota gratis; key disimpan terenkripsi. Secara bawaan AI hanya untuk Owner, Admin, dan Manager; karyawan cukup memakai kata kunci STANDUP, dan Anda bisa mengatur batas hariannya." },
  { icon: "📊", title: "Pantau dari Beranda", body: "Lihat siapa yang sudah mengisi, hambatan yang muncul, dan laporan mingguan dalam satu tempat." },
  { icon: "✅", title: "Siap dalam 4 langkah", body: "Hubungkan nomor WhatsApp untuk bot, pasang API key AI di Pengaturan → AI, tambahkan anggota (termasuk diri Anda dengan role Admin agar bisa memberi perintah lewat WhatsApp), lalu cek jadwal. Daftar periksa di Beranda akan memandu Anda." },
];

const step = ref(0);
const current = computed(() => steps[step.value]!);
const isLast = computed(() => step.value === steps.length - 1);

function next() {
  if (isLast.value) emit("close");
  else step.value++;
}
</script>
