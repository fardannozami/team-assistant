<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">WhatsApp</h2>
      <p class="text-text-muted text-sm mt-1">
        Connect the Team Assistant bot to WhatsApp so it can message employees
        and receive replies.
      </p>
    </div>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in">{{ error }}</div>

  <!-- Connection status -->
  <section class="mb-7">
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">Connection status</div>
    <div class="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
      <div class="flex items-center gap-3 px-4 py-4 rounded-xl border border-border bg-panel-hover">
        <span class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim">Bot</span>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold tracking-tight uppercase border" :class="status.connected ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">
          {{ status.connected ? "Connected" : "Disconnected" }}
        </span>
      </div>
      <div class="flex items-center gap-3 px-4 py-4 rounded-xl border border-border bg-panel-hover">
        <span class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim">Registered</span>
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold tracking-tight uppercase border" :class="status.registered ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border border-border'">
          {{ status.registered ? "Registered" : "Not registered" }}
        </span>
      </div>
      <div v-if="code" class="flex items-center gap-3 px-4 py-4 rounded-xl border border-border bg-panel-hover">
        <span class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim">Pairing code</span>
        <span class="font-mono text-[14px] font-extrabold tracking-tight text-text border border-border bg-panel px-2.5 py-1 rounded-lg">{{ codeDisplay }}</span>
      </div>
    </div>
    <p v-if="status.phone" class="mt-3 text-text-muted text-sm">
      Linked number: <span class="font-mono text-[14px] text-text">{{ status.phone }}</span>
    </p>
  </section>

  <!-- Pair with phone number -->
  <section>
    <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">Pair with phone number</div>
    <p v-if="!status.connected && !status.registered" class="text-text-muted text-sm mb-5">
      Enter your WhatsApp number with country code (for example
      <span class="font-mono text-[14px] text-text">+62 812-3456-7890</span>). A pairing code will be sent to that number.
    </p>

    <form v-if="!status.connected && !status.registered" @submit.prevent="pairPhone" class="grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] gap-4 items-end mb-6">
      <div>
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Phone number</label>
        <input
          v-model="pairPhoneNumber"
          type="tel"
          placeholder="+62 812-3456-7890"
          required
          @input="pairError = ''"
          class="w-full px-4 py-3.5 rounded-xl border text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none bg-panel border-border"
          :class="{ 'border-danger': pairError, 'border-border': !pairError }"
        />
      </div>
      <p v-if="pairError" class="col-span-full text-danger text-[11px] font-extrabold mt-1.5 slide-in">{{ pairError }}</p>
      <button
        type="submit"
        :disabled="pairing"
        class="inline-flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_12px_rgba(63,68,226,0.45)] active:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
      >
        <span v-if="pairing" class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full spin-slow" aria-hidden="true"></span>
        {{ pairing ? "Sending…" : "Send pairing code" }}
      </button>
    </form>

    <div v-if="status.connected || status.registered" class="mb-6">
      <button
        type="button"
        :disabled="disconnecting"
        @click="disconnect"
        class="inline-flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-danger text-white transition-all duration-200 ease-in hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {{ disconnecting ? "Disconnecting…" : "Disconnect / unpair" }}
      </button>
      <p class="mt-2 text-text-muted text-xs">
        This stops the bot and clears the active WhatsApp session.
      </p>
    </div>

    <div v-if="code" class="p-5 rounded-xl border border-border bg-panel-hover text-center">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Pairing code</div>
      <span class="font-mono text-[20px] font-extrabold tracking-tight text-text inline-block mb-3 border border-border bg-panel px-3 py-1.5 rounded-lg">{{ codeDisplay }}</span>
      <ol class="text-sm text-text-muted text-left list-disc list-inside space-y-1.5 max-w-[460px] mx-auto">
        <li>Open WhatsApp on your phone.</li>
        <li>Go to <span class="font-semibold text-text">Linked devices</span>.</li>
        <li>Tap <span class="font-semibold text-text">Link with phone number</span>.</li>
        <li>Enter your phone number and the pairing code shown above.</li>
      </ol>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import {
  whatsappApi,
  ApiError,
  showToast,
  type WhatsAppStatus,
} from "../api";

const status = ref<WhatsAppStatus>({
  connected: false,
  registered: false,
  pairingCode: null,
  phone: null,
});
const error = ref("");

const pairPhoneNumber = ref("");
const pairing = ref(false);
const disconnecting = ref(false);
const pairError = ref("");
const pairingCode = ref<string | null>(null);

const code = computed(() => status.value.pairingCode ?? pairingCode.value);
const codeDisplay = computed(() => {
  const c = code.value;
  if (!c) return null;
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
});

let statusTimer: number | null = null;

function startPolling() {
  fetchStatus();
  statusTimer = window.setInterval(fetchStatus, 5000);
}

function stopPolling() {
  if (statusTimer !== null) {
    window.clearInterval(statusTimer);
    statusTimer = null;
  }
}

async function fetchStatus() {
  try {
    status.value = await whatsappApi.status();
  } catch {
    // Background polls stay silent; errors surface through explicit actions.
  }
}

async function pairPhone() {
  pairError.value = "";
  if (!pairPhoneNumber.value.trim()) {
    pairError.value = "Enter a phone number.";
    return;
  }

  pairing.value = true;
  try {
    const res = await whatsappApi.pair(pairPhoneNumber.value.trim());
    pairingCode.value = res.pairingCode ?? null;
    showToast("Pairing code sent to your number.", "success");
    await fetchStatus();
  } catch (err) {
    pairError.value = err instanceof ApiError ? err.message : "Failed to send pairing code.";
  } finally {
    pairing.value = false;
  }
}

async function disconnect() {
  disconnecting.value = true;
  try {
    await whatsappApi.stop();
    pairingCode.value = null;
    showToast("WhatsApp disconnected.", "success");
    await fetchStatus();
  } catch (err) {
    pairError.value = err instanceof ApiError ? err.message : "Failed to disconnect.";
  } finally {
    disconnecting.value = false;
  }
}

onMounted(startPolling);
onUnmounted(stopPolling);
</script>
