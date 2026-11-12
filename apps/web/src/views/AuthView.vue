<template>
  <div class="w-full max-w-[400px]">
    <div class="mb-8 flex flex-col items-center text-center">
      <div class="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent font-display text-lg font-extrabold text-white shadow-accent">TA</div>
      <h1 class="font-display text-3xl font-extrabold tracking-tight text-text">Team Assistant</h1>
      <p class="mt-2 text-text-muted">Standup harian tim lewat WhatsApp.</p>
    </div>

    <div class="bg-panel border border-border rounded-2xl shadow-soft-lg p-6 sm:p-8 reveal-slow">
      <div v-if="error" class="mb-6 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

      <div v-if="invite" class="mb-5 rounded-xl border border-accent/30 bg-accent/5 p-4 text-sm text-text" role="status">
        Anda diundang sebagai <b>{{ invite.role }}</b> di <b>{{ invite.workspaceName }}</b>.
        Masuk dengan akun Google <b>{{ invite.email }}</b> untuk bergabung.
      </div>
      <p v-else-if="inviteInvalid" class="mb-5 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">
        Link undangan ini sudah tidak berlaku atau sudah dipakai. Minta link baru ke admin workspace.
      </p>
      <p v-if="!invite" class="mb-5 text-center text-sm text-text-muted">Masuk dengan akun Google Anda. Akun baru otomatis mendapat workspace sendiri, kecuali email Anda sudah diundang.</p>
      <div v-if="googleEnabled === null" class="flex justify-center py-3" aria-label="Memuat">
        <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent"></span>
      </div>
      <template v-else-if="googleEnabled">
        <a
          :href="authApi.googleLoginUrl"
          class="flex min-h-12 items-center justify-center gap-3 rounded-xl border border-border bg-panel px-4 text-[15px] font-bold text-text transition hover:bg-panel-hover"
        >
          <svg class="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Masuk dengan Google
        </a>
      </template>
      <p v-else class="px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-center text-sm text-danger" role="alert">
        Login Google belum dikonfigurasi di server (GOOGLE_CLIENT_ID dan GOOGLE_CLIENT_SECRET), atau API tidak dapat dihubungi.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { authApi, usersApi, type InviteInfo } from "../api";

const props = defineProps<{ initialError?: string }>();

const error = ref(props.initialError ?? "");
// null while loading the providers.
const googleEnabled = ref<boolean | null>(null);
const invite = ref<InviteInfo | null>(null);
const inviteInvalid = ref(false);

/** ?invite=<token> from an invite link; the token only drives this banner. */
async function loadInvite() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("invite");
  if (!token) return;
  try {
    invite.value = await usersApi.inviteInfo(token);
  } catch {
    inviteInvalid.value = true;
  }
}

onMounted(async () => {
  loadInvite();
  googleEnabled.value = (await authApi.providers()).google;
});
</script>
