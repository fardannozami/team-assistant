<template>
  <header class="mb-7">
    <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">GitHub</h2>
    <p class="text-text-muted text-sm mt-1">
      Aktivitas commit, pull request, review, dan issue dari repositori pilihan. Ini catatan aktivitas, bukan nilai kinerja.
    </p>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in" role="alert">{{ error }}</div>
  <div v-if="loading && !status" class="flex items-center gap-3 text-sm text-text-muted">
    <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
    Memuat…
  </div>

  <div v-if="status" class="space-y-6">
    <section v-if="!status.configured" class="rounded-2xl border border-border bg-panel p-4 shadow-soft sm:p-6">
      <h3 class="text-lg font-extrabold text-text">Belum dikonfigurasi di server</h3>
      <p class="mt-1 text-sm text-text-muted">
        Pengelola server perlu membuat GitHub App dan mengisi variabel <code class="font-mono text-xs">GITHUB_APP_*</code>,
        <code class="font-mono text-xs">GITHUB_WEBHOOK_SECRET</code>, dan <code class="font-mono text-xs">GITHUB_CLIENT_*</code> (lihat .env.example).
      </p>
    </section>

    <!-- Connection -->
    <section class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="gh-connection">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="gh-connection" class="text-lg font-extrabold text-text">Koneksi</h3>
          <p class="mt-1 text-sm text-text-muted">Pasang GitHub App di akun atau organisasi, lalu pilih repositori yang boleh dibaca.</p>
        </div>
        <button type="button" class="min-h-11 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-60" :disabled="!status.configured || busy === 'install'" @click="install">
          {{ status.installations.length ? "Tambah akun GitHub" : "Hubungkan GitHub" }}
        </button>
      </div>
      <p v-if="!status.installations.length" class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">Belum ada akun GitHub yang terhubung.</p>
      <ul class="space-y-2">
        <li v-for="i in status.installations" :key="i.id" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3">
          <div class="min-w-0">
            <span class="font-bold text-text">@{{ i.accountLogin ?? i.installationId }}</span>
            <span class="ml-2 text-xs text-text-muted">{{ i.accountType === "Organization" ? "Organisasi" : "Pengguna" }} · {{ i.repositorySelection === "all" ? "semua repo" : "repo terpilih" }}</span>
            <span v-if="!i.isActive" class="ml-2 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-bold text-danger">Ditangguhkan</span>
          </div>
          <div class="flex gap-1">
            <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover disabled:opacity-50" :disabled="busy === `sync:${i.id}`" @click="sync(i.id)">Sinkronkan repo</button>
            <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-danger/5 hover:text-danger" @click="unlink(i.id, i.accountLogin)">Lepas</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Repositories (GIT-009) -->
    <section v-if="status.repositories.length" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="gh-repos">
      <h3 id="gh-repos" class="text-lg font-extrabold text-text">Repositori dipantau</h3>
      <p class="mt-1 mb-4 text-sm text-text-muted">Hanya repositori yang dicentang yang aktivitasnya dicatat.</p>
      <ul class="grid gap-2 sm:grid-cols-2">
        <li v-for="r in status.repositories" :key="r.id">
          <label class="flex min-h-12 items-center gap-3 rounded-xl border border-border px-3 text-sm">
            <input type="checkbox" class="h-5 w-5 accent-accent" :checked="r.isActive" @change="track(r, ($event.target as HTMLInputElement).checked)" />
            <span class="min-w-0 flex-1 truncate font-semibold text-text">{{ r.fullName }}</span>
            <span v-if="r.isPrivate" class="rounded-full bg-panel-hover px-2 py-0.5 text-xs text-text-muted">private</span>
          </label>
        </li>
      </ul>
    </section>

    <!-- Identity mapping (GIT-007) -->
    <section class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="gh-members">
      <h3 id="gh-members" class="text-lg font-extrabold text-text">Akun GitHub anggota</h3>
      <p class="mt-1 mb-4 text-sm text-text-muted">
        Aktivitas hanya dikaitkan ke anggota lewat username GitHub di sini. Commit dengan email atau nama yang tidak terhubung ke akun GitHub tidak dikaitkan ke siapa pun.
      </p>
      <ul class="space-y-2">
        <li v-for="m in members" :key="m.employeeId" class="flex flex-col gap-2 rounded-xl bg-panel-hover p-3 sm:flex-row sm:items-center">
          <span class="min-w-0 flex-1 font-semibold text-text" :class="{ 'text-text-muted': !m.isActive }">{{ m.name }}<span v-if="!m.isActive" class="ml-2 text-xs font-normal">(nonaktif)</span></span>
          <div class="flex gap-2">
            <input v-model="logins[m.employeeId]" type="text" placeholder="username GitHub" maxlength="40" :aria-label="`Username GitHub ${m.name}`" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm sm:w-56" @keydown.enter="saveLogin(m)" />
            <button type="button" class="min-h-11 shrink-0 rounded-xl border border-border bg-panel px-3 text-sm font-semibold text-text disabled:opacity-40" :disabled="(logins[m.employeeId] ?? '').trim() === (m.login ?? '') || busy === `login:${m.employeeId}`" @click="saveLogin(m)">Simpan</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Activity (GIT-008) -->
    <section class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="gh-activity">
      <h3 id="gh-activity" class="text-lg font-extrabold text-text">Aktivitas 7 hari terakhir</h3>
      <p v-if="!summary.length" class="mt-3 rounded-xl bg-panel-hover p-4 text-sm text-text-muted">Belum ada aktivitas yang terkait ke anggota.</p>
      <ul v-else class="mt-3 grid gap-2 sm:grid-cols-2">
        <li v-for="s in summary" :key="s.employeeId" class="rounded-xl border border-border p-3">
          <div class="font-bold text-text">{{ s.employeeName }}</div>
          <ul class="mt-1 text-sm text-text-muted">
            <li v-for="line in summaryLines(s.counts)" :key="line">{{ line }}</li>
          </ul>
        </li>
      </ul>

      <h4 class="mt-6 mb-2 text-sm font-extrabold uppercase tracking-wider text-text-dim">Terbaru</h4>
      <p v-if="!activity.length" class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">Belum ada aktivitas.</p>
      <ol class="divide-y divide-border">
        <li v-for="a in activity" :key="a.id" class="flex gap-3 py-2.5 text-sm">
          <span class="w-28 shrink-0 text-text-muted">{{ when(a.occurredAt) }}</span>
          <span class="min-w-0 flex-1">
            <span class="font-semibold text-text">{{ a.employeeName ?? (a.actorLogin ? `@${a.actorLogin}` : "Tidak diketahui") }}</span>
            <span class="text-text-muted"> · {{ TYPE_LABEL[a.type] ?? a.type }} · {{ a.repository }}</span>
            <a v-if="a.url" :href="a.url" target="_blank" rel="noopener" class="block truncate text-accent hover:underline">{{ a.title }}</a>
            <span v-else class="block truncate text-text">{{ a.title }}</span>
          </span>
        </li>
      </ol>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import {
  ApiError,
  githubApi,
  showToast,
  type GithubActivity,
  type GithubMember,
  type GithubRepository,
  type GithubStatus,
  type GithubSummary,
} from "../api";

const TYPE_LABEL: Record<string, string> = {
  commit: "commit",
  pr_opened: "membuat PR",
  pr_reopened: "membuka ulang PR",
  pr_ready: "PR siap direview",
  pr_updated: "memperbarui PR",
  pr_merged: "merge PR",
  pr_closed: "menutup PR",
  pr_reviewed: "mereview PR",
  pr_commented: "komentar di PR",
  issue_opened: "membuat issue",
  issue_closed: "menutup issue",
  issue_reopened: "membuka ulang issue",
  issue_commented: "komentar di issue",
};
const SUMMARY_LABEL: [string, string][] = [
  ["commit", "commit di-push"],
  ["pr_opened", "PR dibuat"],
  ["pr_reviewed", "PR direview"],
  ["pr_merged", "PR di-merge"],
  ["pr_commented", "komentar PR"],
  ["issue_opened", "issue dibuat"],
  ["issue_closed", "issue ditutup"],
  ["issue_commented", "komentar issue"],
];
const REDIRECT_MESSAGES: Record<string, string> = {
  connected: "GitHub terhubung. Pilih repositori yang ingin dipantau.",
  requested: "Permintaan pemasangan dikirim ke pemilik organisasi GitHub.",
  invalid_state: "Tautan pemasangan kedaluwarsa. Coba hubungkan lagi.",
  invalid_request: "Pemasangan tidak lengkap. Pastikan GitHub App meminta otorisasi pengguna saat instalasi.",
  not_yours: "Akun GitHub Anda tidak punya akses ke instalasi tersebut.",
  already_linked: "Instalasi GitHub ini sudah terhubung ke workspace lain.",
  github_error: "GitHub sedang bermasalah. Coba lagi sebentar.",
};

const status = ref<GithubStatus | null>(null);
const members = ref<GithubMember[]>([]);
const logins = ref<Record<string, string>>({});
const summary = ref<GithubSummary[]>([]);
const activity = ref<GithubActivity[]>([]);
const loading = ref(false);
const error = ref("");
const busy = ref<string | null>(null);

function message(err: unknown, fallback: string) {
  return err instanceof ApiError ? err.message : fallback;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [s, m, sum, act] = await Promise.all([githubApi.status(), githubApi.members(), githubApi.summary(7), githubApi.activity({ limit: 30 })]);
    status.value = s;
    members.value = m;
    logins.value = Object.fromEntries(m.map((x) => [x.employeeId, x.login ?? ""]));
    summary.value = sum.summary;
    activity.value = act;
  } catch (err) {
    error.value = message(err, "Gagal memuat data GitHub.");
  } finally {
    loading.value = false;
  }
}

/** Result of the GitHub install redirect (?github=… / ?github_error=…). */
function consumeRedirect() {
  const params = new URLSearchParams(window.location.search);
  const ok = params.get("github");
  const failed = params.get("github_error");
  if (!ok && !failed) return;
  if (ok && ok !== "updated") showToast(REDIRECT_MESSAGES[ok] ?? "GitHub diperbarui.", "success");
  if (failed) showToast(REDIRECT_MESSAGES[failed] ?? "Gagal menghubungkan GitHub.", "error");
  params.delete("github");
  params.delete("github_error");
  const query = params.toString();
  history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : "") + window.location.hash);
}

onMounted(() => {
  consumeRedirect();
  load();
});

async function install() {
  busy.value = "install";
  try {
    window.location.href = (await githubApi.install()).url;
  } catch (err) {
    showToast(message(err, "Gagal memulai pemasangan."), "error");
    busy.value = null;
  }
}

async function sync(id: string) {
  busy.value = `sync:${id}`;
  try {
    const { repositories } = await githubApi.sync(id);
    showToast(`${repositories} repositori disinkronkan.`, "success");
    await load();
  } catch (err) {
    showToast(message(err, "Gagal sinkronisasi."), "error");
  } finally {
    busy.value = null;
  }
}

async function unlink(id: string, account: string | null) {
  if (!confirm(`Lepas @${account ?? "akun ini"} dari workspace? Aktivitas yang sudah tercatat tetap disimpan. Untuk mencabut akses sepenuhnya, uninstall juga GitHub App di GitHub.`)) return;
  try {
    await githubApi.unlink(id);
    await load();
  } catch (err) {
    showToast(message(err, "Gagal melepas."), "error");
  }
}

async function track(repo: GithubRepository, isActive: boolean) {
  try {
    Object.assign(repo, await githubApi.track(repo.id, isActive));
  } catch (err) {
    showToast(message(err, "Gagal menyimpan."), "error");
    await load();
  }
}

async function saveLogin(m: GithubMember) {
  const value = (logins.value[m.employeeId] ?? "").trim();
  busy.value = `login:${m.employeeId}`;
  try {
    const saved = await githubApi.setLogin(m.employeeId, value || null);
    m.login = saved.login;
    logins.value[m.employeeId] = saved.login ?? "";
    showToast(saved.login ? `${m.name} → @${saved.login}` : `Akun GitHub ${m.name} dilepas.`, "success");
    const [sum, act] = await Promise.all([githubApi.summary(7), githubApi.activity({ limit: 30 })]);
    summary.value = sum.summary;
    activity.value = act;
  } catch (err) {
    showToast(message(err, "Gagal menyimpan."), "error");
  } finally {
    busy.value = null;
  }
}

function summaryLines(counts: Record<string, number>) {
  return SUMMARY_LABEL.filter(([key]) => counts[key]).map(([key, label]) => `${counts[key]} ${label}`);
}

function when(iso: string) {
  return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
</script>
