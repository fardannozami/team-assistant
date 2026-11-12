<template>
  <header class="mb-7">
    <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Pengguna</h2>
    <p class="text-text-muted text-sm mt-1">
      Siapa saja yang bisa membuka dashboard ini. Undang lewat email; mereka bergabung saat masuk dengan akun Google ber-email itu.
    </p>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in" role="alert">{{ error }}</div>

  <div class="space-y-6">
    <!-- Invite -->
    <section class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="invite-title">
      <h3 id="invite-title" class="text-lg font-extrabold text-text">Undang pengguna</h3>
      <form class="mt-4 flex flex-col gap-3 sm:flex-row" @submit.prevent="invite">
        <label class="sr-only" for="invite-email">Email Google</label>
        <input id="invite-email" v-model="email" type="email" required placeholder="nama@perusahaan.com" autocomplete="off" :class="inputClass" class="flex-1" />
        <label class="sr-only" for="invite-role">Peran</label>
        <select id="invite-role" v-model="role" :class="inputClass" class="sm:w-44">
          <option value="Admin">Admin</option>
          <option value="Manager">Manager</option>
        </select>
        <button type="submit" class="min-h-12 rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-60" :disabled="busy === 'invite'">
          {{ busy === "invite" ? "Membuat…" : "Buat undangan" }}
        </button>
      </form>
      <p class="mt-2 text-sm text-text-muted">{{ ROLE_HELP[role] }}</p>

      <div v-if="created" class="mt-4 rounded-xl border border-accent/30 bg-accent/5 p-4" role="status">
        <p class="text-sm font-semibold text-text">Undangan untuk {{ created.email }} siap. Bagikan link ini (berlaku 7 hari):</p>
        <div class="mt-2 flex flex-col gap-2 sm:flex-row">
          <input :value="created.url" readonly aria-label="Link undangan" class="min-h-11 flex-1 rounded-xl border border-border bg-panel px-3 font-mono text-xs" @focus="($event.target as HTMLInputElement).select()" />
          <button type="button" class="min-h-11 rounded-xl border border-border bg-panel px-4 text-sm font-semibold text-text" @click="copy(created.url)">Salin</button>
          <a :href="whatsappLink(created)" target="_blank" rel="noopener" class="inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-panel px-4 text-sm font-semibold text-text">Kirim lewat WhatsApp</a>
        </div>
        <p class="mt-2 text-xs text-text-muted">Link hanya bisa dipakai oleh akun Google {{ created.email }}. Membuat ulang undangan akan membatalkan link sebelumnya.</p>
      </div>
    </section>

    <!-- Pending invites -->
    <section v-if="invites.length" class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="pending-title">
      <h3 id="pending-title" class="text-lg font-extrabold text-text">Undangan menunggu</h3>
      <ul class="mt-3 space-y-2">
        <li v-for="i in invites" :key="i.id" class="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
          <div class="min-w-0">
            <div class="truncate font-semibold text-text">{{ i.email }}</div>
            <div class="text-xs text-text-muted">{{ i.role }} · berlaku sampai {{ date(i.expiresAt) }}<template v-if="i.invitedBy"> · oleh {{ i.invitedBy }}</template></div>
          </div>
          <div class="flex gap-1">
            <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="reinvite(i)">Buat link baru</button>
            <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-danger/5 hover:text-danger" @click="revoke(i)">Batalkan</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Users -->
    <section class="rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="users-title">
      <h3 id="users-title" class="text-lg font-extrabold text-text">Pengguna dashboard</h3>
      <div v-if="loading && !users.length" class="mt-3 flex items-center gap-3 text-sm text-text-muted">
        <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
        Memuat…
      </div>
      <ul class="mt-3 space-y-2">
        <li v-for="u in users" :key="u.id" class="flex flex-col gap-2 rounded-xl border border-border p-3 sm:flex-row sm:items-center">
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold" :class="u.isActive ? 'text-text' : 'text-text-muted line-through'">
              {{ u.name }}<span v-if="u.email === me?.user.email" class="ml-2 text-xs font-normal text-text-muted">(Anda)</span>
            </div>
            <div class="truncate text-xs text-text-muted">{{ u.email }}</div>
          </div>
          <span v-if="u.isOwner" class="self-start rounded-full bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent sm:self-center">Owner</span>
          <template v-else-if="u.email === me?.user.email">
            <span class="self-start rounded-full bg-panel-hover px-2.5 py-1 text-xs font-bold text-text-muted sm:self-center">{{ u.role }}</span>
          </template>
          <div v-else class="flex gap-2">
            <select :value="u.role ?? ''" :aria-label="`Peran ${u.name}`" class="min-h-11 rounded-xl border border-border bg-panel px-3 text-sm" :disabled="!u.isActive || busy === u.id" @change="update(u, { role: ($event.target as HTMLSelectElement).value as InvitableRole })">
              <option v-if="u.role !== 'Admin' && u.role !== 'Manager'" :value="u.role ?? ''" disabled>{{ u.role ?? "Tanpa peran" }}</option>
              <option value="Admin">Admin</option>
              <option value="Manager">Manager</option>
            </select>
            <button type="button" class="min-h-11 rounded-xl border border-border px-3 text-sm font-semibold disabled:opacity-50" :class="u.isActive ? 'text-text-muted hover:bg-danger/5 hover:text-danger' : 'text-text hover:bg-panel-hover'" :disabled="busy === u.id" @click="toggleActive(u)">
              {{ u.isActive ? "Nonaktifkan" : "Aktifkan" }}
            </button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ApiError, authApi, showToast, usersApi, type InvitableRole, type Me, type WebInvite, type WebUser } from "../api";

const ROLE_HELP: Record<InvitableRole, string> = {
  Admin: "Admin: mengelola anggota, jadwal, WhatsApp, AI, integrasi, dan pengguna lain (kecuali Owner).",
  Manager: "Manager: melihat anggota, standup, dan laporan tanpa bisa mengubah pengaturan.",
};
const inputClass =
  "min-h-12 rounded-xl border border-border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20";

const users = ref<WebUser[]>([]);
const invites = ref<WebInvite[]>([]);
const me = ref<Me | null>(null);
const email = ref("");
const role = ref<InvitableRole>("Admin");
const created = ref<{ email: string; role: string; url: string } | null>(null);
const loading = ref(false);
const error = ref("");
const busy = ref<string | null>(null);

function message(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.status === 403) return "Hanya Owner atau Admin yang bisa mengelola pengguna.";
  return err instanceof ApiError ? err.message : fallback;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const [list, who] = await Promise.all([usersApi.list(), authApi.me()]);
    users.value = list.users;
    invites.value = list.invites;
    me.value = who;
  } catch (err) {
    error.value = message(err, "Gagal memuat pengguna.");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function createInvite(target: string, targetRole: InvitableRole) {
  busy.value = "invite";
  try {
    const { invite, url } = await usersApi.invite(target, targetRole);
    created.value = { email: invite.email, role: targetRole, url };
    email.value = "";
    await load();
  } catch (err) {
    showToast(message(err, "Gagal membuat undangan."), "error");
  } finally {
    busy.value = null;
  }
}

function invite() {
  return createInvite(email.value.trim(), role.value);
}

function reinvite(i: WebInvite) {
  return createInvite(i.email, i.role as InvitableRole);
}

async function revoke(i: WebInvite) {
  if (!confirm(`Batalkan undangan untuk ${i.email}?`)) return;
  try {
    await usersApi.revoke(i.id);
    if (created.value?.email === i.email) created.value = null;
    await load();
  } catch (err) {
    showToast(message(err, "Gagal membatalkan."), "error");
  }
}

async function update(u: WebUser, input: { role?: InvitableRole; isActive?: boolean }) {
  busy.value = u.id;
  try {
    Object.assign(u, await usersApi.update(u.id, input));
    showToast(`${u.name} diperbarui.`, "success");
  } catch (err) {
    showToast(message(err, "Gagal menyimpan."), "error");
    await load();
  } finally {
    busy.value = null;
  }
}

function toggleActive(u: WebUser) {
  if (u.isActive && !confirm(`Nonaktifkan ${u.name}? Ia langsung keluar dari dashboard.`)) return;
  return update(u, { isActive: !u.isActive });
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    showToast("Link disalin.", "success");
  } catch {
    showToast("Tidak bisa menyalin otomatis; pilih dan salin link-nya.", "error");
  }
}

function whatsappLink(c: { email: string; role: string; url: string }) {
  const workspace = me.value?.workspace.name ?? "Team Assistant";
  const text = `Halo! Kamu diundang sebagai ${c.role} di ${workspace} (Team Assistant). Buka link ini lalu masuk dengan akun Google ${c.email}:\n${c.url}`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function date(iso: string) {
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
</script>
