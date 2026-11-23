<template>
  <header class="mb-7">
    <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Figma</h2>
    <p class="text-text-muted text-sm mt-1">
      Versi, komentar, dan perubahan dari file Figma pilihan. Ini catatan aktivitas desain, bukan nilai kinerja.
    </p>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in" role="alert">{{ error }}</div>
  <div v-if="loading && !status" class="flex items-center gap-3 text-sm text-text-muted">
    <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
    Memuat…
  </div>

  <div v-if="status" class="space-y-6">
    <!-- Connection (FIG-001) -->
    <section class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="fg-connection">
      <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="fg-connection" class="text-lg font-extrabold text-text">Koneksi</h3>
          <p class="mt-1 text-sm text-text-muted">
            Pakai Personal Access Token dari akun Figma yang punya akses ke file desain tim
            (Figma → Settings → Security → Personal access tokens).
          </p>
        </div>
        <div v-if="isAdmin && status.connected" class="flex gap-1">
          <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover disabled:opacity-50" :disabled="busy === 'sync'" @click="sync">{{ busy === "sync" ? "Menyinkronkan…" : "Sinkronkan" }}</button>
          <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-danger/5 hover:text-danger" @click="disconnect">Lepas</button>
        </div>
      </div>

      <div v-if="status.connected && status.account" class="rounded-xl border border-border p-3 text-sm">
        <span class="font-bold text-text">{{ status.account.handle ?? status.account.id }}</span>
        <span v-if="status.account.email" class="ml-2 text-text-muted">{{ status.account.email }}</span>
        <span class="ml-2 text-xs text-text-dim">token …{{ status.tokenHint }}</span>
        <p class="mt-1 text-xs text-text-muted">
          {{ status.lastSyncedAt ? `Sinkron terakhir ${when(status.lastSyncedAt)}` : "Belum pernah disinkronkan" }} · otomatis tiap jam
          · webhook {{ status.webhooksEnabled ? "aktif" : "nonaktif (PUBLIC_API_URL belum diisi)" }}
        </p>
        <p v-if="status.lastSyncError" class="mt-2 whitespace-pre-line rounded-lg bg-warning/10 px-3 py-2 text-xs font-semibold text-warning">{{ status.lastSyncError }}</p>
      </div>
      <p v-else-if="!isAdmin" class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">Figma belum terhubung.</p>

      <form v-if="isAdmin" class="mt-3 flex flex-col gap-2 sm:flex-row" @submit.prevent="connect">
        <label class="sr-only" for="figma-token">Personal Access Token Figma</label>
        <input id="figma-token" v-model="token" type="password" autocomplete="off" :placeholder="status.connected ? 'Ganti token (figd_…)' : 'figd_…'" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm" />
        <button type="submit" class="min-h-11 shrink-0 rounded-xl bg-accent px-4 text-sm font-bold text-white disabled:opacity-60" :disabled="!token.trim() || busy === 'connect'">
          {{ busy === "connect" ? "Memeriksa…" : status.connected ? "Ganti token" : "Hubungkan Figma" }}
        </button>
      </form>
      <p v-if="isAdmin" class="mt-2 text-xs text-text-dim">
        Scope token: <code class="font-mono">current_user:read</code>, <code class="font-mono">file_content:read</code>,
        <code class="font-mono">file_versions:read</code>, <code class="font-mono">file_comments:read</code>, dan
        <code class="font-mono">webhooks:write</code> bila memakai webhook. Token disimpan terenkripsi.
      </p>
    </section>

    <!-- Files (FIG-003) -->
    <section v-if="status.connected" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="fg-files">
      <h3 id="fg-files" class="text-lg font-extrabold text-text">File dipantau</h3>
      <p class="mt-1 mb-4 text-sm text-text-muted">Tempel link file dari tombol Share di Figma. Hanya file yang dicentang yang aktivitasnya dicatat.</p>
      <form v-if="isAdmin" class="mb-4 flex flex-col gap-2 sm:flex-row" @submit.prevent="addFile">
        <label class="sr-only" for="figma-file">Link file Figma</label>
        <input id="figma-file" v-model="fileUrl" type="url" placeholder="https://www.figma.com/design/…" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm" />
        <button type="submit" class="min-h-11 shrink-0 rounded-xl border border-border bg-panel px-4 text-sm font-bold text-text disabled:opacity-50" :disabled="!fileUrl.trim() || busy === 'file'">{{ busy === "file" ? "Menambahkan…" : "Tambah file" }}</button>
      </form>
      <p v-if="!status.files.length" class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">Belum ada file yang dipantau.</p>
      <ul class="space-y-2">
        <li v-for="f in status.files" :key="f.id" class="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-sm">
          <input type="checkbox" class="h-5 w-5 accent-accent" :checked="f.isActive" :disabled="!isAdmin" :aria-label="`Pantau ${f.name}`" @change="track(f, ($event.target as HTMLInputElement).checked)" />
          <span class="min-w-0 flex-1">
            <a :href="`https://www.figma.com/file/${f.fileKey}`" target="_blank" rel="noopener" class="block truncate font-semibold text-text hover:text-accent hover:underline">{{ f.name }}</a>
            <span class="text-xs text-text-muted">
              {{ EDITOR_LABEL[f.editorType ?? ""] ?? "Figma" }}<template v-if="f.lastModified"> · diubah {{ when(f.lastModified) }}</template><template v-if="f.webhooks"> · webhook aktif</template>
            </span>
          </span>
          <button v-if="isAdmin" type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-danger/5 hover:text-danger" @click="removeFile(f)">Hapus</button>
        </li>
      </ul>
    </section>

    <!-- Identity mapping (FIG-006) -->
    <section v-if="status.connected" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="fg-accounts">
      <h3 id="fg-accounts" class="text-lg font-extrabold text-text">Akun Figma anggota</h3>
      <p class="mt-1 mb-4 text-sm text-text-muted">
        Akun di bawah ini muncul dari versi dan komentar yang dicatat Figma beserta pembuatnya. Aktivitas baru dikaitkan ke anggota setelah dipetakan di sini.
        Perubahan file tanpa nama pengubah tidak pernah dikaitkan ke siapa pun.
      </p>
      <p v-if="!accounts.length" class="rounded-xl bg-panel-hover p-4 text-sm text-text-muted">Belum ada akun Figma yang terlihat. Tambahkan file lalu sinkronkan.</p>
      <ul class="space-y-2">
        <li v-for="a in accounts" :key="a.figmaId" class="flex flex-col gap-2 rounded-xl bg-panel-hover p-3 sm:flex-row sm:items-center">
          <span class="min-w-0 flex-1">
            <span class="font-semibold text-text">{{ a.handle ?? `Akun ${a.figmaId}` }}</span>
            <span class="ml-2 text-xs text-text-muted">{{ a.events }} aktivitas<template v-if="a.lastSeen"> · terakhir {{ when(a.lastSeen) }}</template></span>
          </span>
          <select :value="a.employeeId ?? ''" :disabled="!isAdmin || busy === `map:${a.figmaId}`" :aria-label="`Anggota untuk ${a.handle ?? a.figmaId}`" class="min-h-11 w-full rounded-xl border border-border bg-panel px-3 text-sm sm:w-64" @change="mapAccount(a, ($event.target as HTMLSelectElement).value)">
            <option value="">Belum dipetakan</option>
            <option v-for="e in employees" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
        </li>
      </ul>
    </section>

    <!-- Timeline (FIG-007) -->
    <section v-if="status.connected" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="fg-activity">
      <h3 id="fg-activity" class="text-lg font-extrabold text-text">Aktivitas terbaru</h3>
      <p v-if="!activity.length" class="mt-3 rounded-xl bg-panel-hover p-4 text-sm text-text-muted">Belum ada aktivitas.</p>
      <ol class="mt-2 divide-y divide-border">
        <li v-for="a in activity" :key="a.id" class="flex gap-3 py-2.5 text-sm">
          <span class="w-28 shrink-0 text-text-muted">{{ when(a.occurredAt) }}</span>
          <span class="min-w-0 flex-1">
            <span class="font-semibold text-text">{{ a.employeeName ?? a.handle ?? "Tidak diketahui" }}</span>
            <span class="text-text-muted"> · {{ TYPE_LABEL[a.type] ?? a.type }} · {{ a.file }}</span>
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
  employeesApi,
  figmaApi,
  showToast,
  type Employee,
  type FigmaAccount,
  type FigmaActivity,
  type FigmaFile,
  type FigmaStatus,
} from "../api";
import { isAdmin } from "../session";

const TYPE_LABEL: Record<string, string> = {
  version_saved: "menyimpan versi",
  file_edited: "mengedit",
  commented: "berkomentar",
  comment_replied: "membalas komentar",
  file_updated: "file diperbarui",
  dev_status: "status Dev Mode",
};
const EDITOR_LABEL: Record<string, string> = { figma: "Design", figjam: "FigJam", slides: "Slides" };

const status = ref<FigmaStatus | null>(null);
const accounts = ref<FigmaAccount[]>([]);
const activity = ref<FigmaActivity[]>([]);
const employees = ref<Employee[]>([]);
const token = ref("");
const fileUrl = ref("");
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
    status.value = await figmaApi.status();
    if (status.value.connected) {
      const [acc, act, emp] = await Promise.all([figmaApi.accounts(), figmaApi.activity(30), employeesApi.list({ active: true })]);
      accounts.value = acc;
      activity.value = act;
      employees.value = emp;
    }
  } catch (err) {
    error.value = message(err, "Gagal memuat data Figma.");
  } finally {
    loading.value = false;
  }
}

onMounted(load);

async function connect() {
  busy.value = "connect";
  try {
    status.value = await figmaApi.connect(token.value.trim());
    token.value = "";
    showToast("Figma terhubung. Tambahkan file yang ingin dipantau.", "success");
    await load();
  } catch (err) {
    showToast(message(err, "Gagal menghubungkan Figma."), "error");
  } finally {
    busy.value = null;
  }
}

async function disconnect() {
  if (!confirm("Lepas Figma dari workspace? Token, daftar file, dan webhook dihapus. Aktivitas yang sudah tercatat tetap disimpan.")) return;
  try {
    await figmaApi.disconnect();
    await load();
  } catch (err) {
    showToast(message(err, "Gagal melepas Figma."), "error");
  }
}

async function sync() {
  busy.value = "sync";
  try {
    const result = await figmaApi.sync();
    if (result.errors?.length) showToast(`Sebagian file gagal disinkronkan: ${result.errors[0]}`, "error");
    else showToast(`${result.stored ?? 0} aktivitas baru dari ${result.files ?? 0} file.`, "success");
    await load();
  } catch (err) {
    showToast(message(err, "Gagal sinkronisasi."), "error");
  } finally {
    busy.value = null;
  }
}

async function addFile() {
  busy.value = "file";
  try {
    const { file, stored, webhookError } = await figmaApi.addFile(fileUrl.value.trim());
    fileUrl.value = "";
    showToast(`"${file.name}" dipantau, ${stored} aktivitas tercatat.`, "success");
    if (webhookError) showToast(`Webhook tidak bisa dipasang, file tetap disinkronkan tiap jam. ${webhookError}`, "info");
    await load();
  } catch (err) {
    showToast(message(err, "Gagal menambahkan file."), "error");
  } finally {
    busy.value = null;
  }
}

async function track(file: FigmaFile, isActive: boolean) {
  try {
    Object.assign(file, await figmaApi.track(file.id, isActive));
  } catch (err) {
    showToast(message(err, "Gagal menyimpan."), "error");
    await load();
  }
}

async function removeFile(file: FigmaFile) {
  if (!confirm(`Berhenti memantau "${file.name}"? Aktivitas yang sudah tercatat tetap disimpan.`)) return;
  try {
    await figmaApi.removeFile(file.id);
    await load();
  } catch (err) {
    showToast(message(err, "Gagal menghapus file."), "error");
  }
}

async function mapAccount(account: FigmaAccount, employeeId: string) {
  busy.value = `map:${account.figmaId}`;
  try {
    await figmaApi.mapAccount(account.figmaId, employeeId || null);
    const name = employees.value.find((e) => e.id === employeeId)?.name;
    showToast(name ? `${account.handle ?? account.figmaId} → ${name}` : `Pemetaan ${account.handle ?? account.figmaId} dilepas.`, "success");
    const [acc, act] = await Promise.all([figmaApi.accounts(), figmaApi.activity(30)]);
    accounts.value = acc;
    activity.value = act;
  } catch (err) {
    showToast(message(err, "Gagal menyimpan."), "error");
    accounts.value = await figmaApi.accounts().catch(() => accounts.value);
  } finally {
    busy.value = null;
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
</script>
