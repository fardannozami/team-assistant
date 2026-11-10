<template>
  <div class="flex items-baseline justify-between mt-6 mb-3.5 gap-4 flex-wrap">
    <div>
      <h2 class="text-[24px] font-display font-extrabold tracking-tight">WhatsApp</h2>
      <p class="text-text-muted text-sm mt-1.5">
        Connect the Team Assistant bot to WhatsApp so it can message employees
        and receive replies.
      </p>
    </div>
  </div>

  <div v-if="error" class="flex items-center gap-3 px-4 py-3 rounded-sm text-sm mb-4 bg-red-300/10 text-red-300 border border-red-300/35 slide-in">{{ error }}</div>

  <!-- Connection status -->
  <div class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg">
    <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted mb-[18px]">Connection status</div>

    <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 mb-[14px]">
      <div class="flex items-center gap-2.5 px-4 py-3 rounded-sm border border-border bg-[#0b1020]">
        <span class="text-[11px] font-extrabold tracking-wider uppercase text-text-muted">Bot</span>
        <span
          class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1"
          :class="status.connected ? 'bg-success/10 text-success border border-success/30' : 'bg-text-muted/10 text-text-muted border border-border'"
        >
          {{ status.connected ? "Connected" : "Disconnected" }}
        </span>
      </div>
      <div class="flex items-center gap-2.5 px-4 py-3 rounded-sm border border-border bg-[#0b1020]">
        <span class="text-[11px] font-extrabold tracking-wider uppercase text-text-muted">Registered</span>
        <span
          class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-tight uppercase border transition-all duration-200 ease-in hover:-translate-y-1"
          :class="status.registered ? 'bg-success/10 text-success border border-success/30' : 'bg-text-muted/10 text-text-muted border border-border'"
        >
          {{ status.registered ? "Registered" : "Not registered" }}
        </span>
      </div>
      <div v-if="status.pairingCode" class="flex items-center gap-2.5 px-4 py-3 rounded-sm border border-border bg-[#0b1020]">
        <span class="text-[11px] font-extrabold tracking-wider uppercase text-text-muted">Pairing code</span>
        <span class="font-mono text-[13px] tracking-wider text-accent bg-panel-hover border border-border px-2 py-0.5 rounded-[6px]">{{ status.pairingCode }}</span>
      </div>
    </div>

    <div class="flex gap-2.5 mt-2">
      <button
        class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
        @click="startBot"
        :disabled="loadingStart || status.connected"
      >
        {{ loadingStart ? "Starting…" : "Start bot" }}
      </button>
      <button
        class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight border border-danger/40 bg-danger/10 text-danger transition-all duration-200 ease-in hover:bg-danger/35 hover:border-danger whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
        @click="stopBot"
        :disabled="loadingStop || !status.connected"
      >
        {{ loadingStop ? "Stopping…" : "Stop bot" }}
      </button>
    </div>

    <p v-if="status.phone" class="text-text-muted text-[11px] mt-[10px]">
      Linked number: <span class="font-mono text-[13px] text-text">{{ status.phone }}</span>
    </p>
  </div>

  <!-- QR code -->
  <div class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg mt-[14px]">
    <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted mb-[18px]">QR code</div>

    <div class="flex flex-col items-center gap-[14px] pt-1.5">
      <div v-if="qrLoading" class="flex flex-col items-center gap-2.5 py-[26px] px-5 text-text-muted fade-in-fast">
        <span class="w-[18px] h-[18px] border-[2.5px] border-white/25 border-t-white rounded-full spin-slow"></span> Loading QR…
      </div>

      <div v-else-if="qrCode">
        <img :src="qrImageUrl" :alt="''" class="w-[220px] h-[220px] border border-border rounded-sm bg-[#0b1020] shadow" />
        <p class="m-0 text-text-muted text-sm text-center">
          Scan this QR with WhatsApp &rarr; Linked Devices
        </p>
      </div>

      <div v-else class="flex flex-col items-center gap-2 py-[30px] px-5 text-text-muted text-center">
        <p class="text-text-muted text-sm">No QR available (connected or waiting).</p>
        <p class="text-text-muted text-[11px]">Start the bot above to generate a pairing QR code.</p>
      </div>
    </div>
  </div>

  <!-- Pairing code -->
  <div class="bg-panel border border-border rounded p-6 shadow transition-all duration-200 ease-in hover:border-border-focus hover:-translate-y-[2px] hover:shadow-lg mt-[14px]">
    <div class="text-[13px] font-extrabold tracking-wider uppercase text-text-muted mb-[18px]">Pair by phone number</div>

    <p class="text-text-muted text-sm mb-4">
      Enter your WhatsApp number with country code (for example
      <span class="font-mono text-[13px] text-text">+62 812-3456-7890</span>). The bot will send a pairing
      code to that number.
    </p>

    <form @submit.prevent="pairPhone" class="flex flex-col gap-4 grid grid-cols-[repeat(auto-fit,minmax(260px,1fr))] items-end">
      <div class="mb-[18px]" :class="{ 'border-danger focus:ring-danger/40': pairError, 'border-border focus:ring-accent/50': !pairError }">
        <label class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-2">Phone number</label>
        <input
          v-model="pairPhoneNumber"
          type="tel"
          placeholder="+62 812-3456-7890"
          required
          @input="pairError = ''"
          class="w-full px-3.5 py-[11px] rounded-sm border text-sm placeholder-text-dim transition-all duration-200 ease-in focus:ring-4 focus:-translate-y-1 bg-[#0b1020] border-border focus:ring-accent/50 focus:border-border-focus"
        />
      </div>
      <p v-if="pairError" class="text-danger text-[11px] font-extrabold mt-2 slide-in">{{ pairError }}</p>
      <div class="flex gap-2.5 items-end mt-2">
        <button
          class="inline-flex items-center justify-center gap-2 px-3 py-1.5 rounded-sm text-[12px] font-extrabold tracking-tight bg-accent text-white shadow-[0_0_0_4px_rgba(91,107,245,0.45)] transition-all duration-200 ease-in hover:bg-accent-hover hover:shadow-[0_0_0_10px_rgba(91,107,245,0.45)] active:shadow-[0_0_0_4px_rgba(91,107,245,0.45)] whitespace-nowrap leading-none disabled:opacity-50 disabled:cursor-not-allowed"
          type="submit"
          :disabled="pairing"
        >
          {{ pairing ? "Pairing…" : "Send pairing code" }}
        </button>
      </div>
    </form>

    <div v-if="pairingCode" class="mt-[14px] p-4 bg-[#0b1020] border border-border rounded-sm text-center">
      <span class="block text-[11px] font-extrabold tracking-wider uppercase text-text-muted mb-1.5">Pairing code</span>
      <span class="font-mono text-[13px] tracking-wider text-success border border-success/40 bg-panel-hover border-border px-2 py-0.5 rounded-[6px] inline-block">{{ pairingCode }}</span>
      <p class="text-text-muted text-[11px] mt-2 mb-0">
        Enter this code in WhatsApp &rarr; Linked Devices &rarr; Link with phone number instead.
      </p>
    </div>
  </div>
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
const qrCode = ref<string | null>(null);
const qrLoading = ref(false);
const error = ref("");

const loadingStart = ref(false);
const loadingStop = ref(false);

const pairPhoneNumber = ref("");
const pairing = ref(false);
const pairError = ref("");
const pairingCode = ref<string | null>(null);

const qrImageUrl = computed(() =>
  qrCode.value
    ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(qrCode.value)}`
    : ""
);

let statusTimer: number | null = null;
let qrTimer: number | null = null;

function startPolling() {
  fetchStatus();
  fetchQr();
  statusTimer = window.setInterval(fetchStatus, 5000);
  qrTimer = window.setInterval(fetchQr, 3000);
}

function stopPolling() {
  if (statusTimer !== null) {
    window.clearInterval(statusTimer);
    statusTimer = null;
  }
  if (qrTimer !== null) {
    window.clearInterval(qrTimer);
    qrTimer = null;
  }
}

async function fetchStatus() {
  try {
    status.value = await whatsappApi.status();
  } catch {
    // Background polls stay silent; errors are surfaced through explicit actions.
  }
}

async function fetchQr() {
  qrLoading.value = true;
  try {
    const res = await whatsappApi.qr();
    qrCode.value = res.qr ?? null;
  } catch {
    // Keep the last known QR on transient failures.
  } finally {
    qrLoading.value = false;
  }
}

async function startBot() {
  loadingStart.value = true;
  error.value = "";
  try {
    await whatsappApi.start();
    showToast("WhatsApp bot starting.", "success");
    await fetchStatus();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to start the bot.";
  } finally {
    loadingStart.value = false;
  }
}

async function stopBot() {
  loadingStop.value = true;
  error.value = "";
  try {
    await whatsappApi.stop();
    showToast("WhatsApp bot stopped.", "success");
    await fetchStatus();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Failed to stop the bot.";
  } finally {
    loadingStop.value = false;
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
  } catch (err) {
    pairError.value = err instanceof ApiError ? err.message : "Failed to send pairing code.";
  } finally {
    pairing.value = false;
  }
}

onMounted(startPolling);
onUnmounted(stopPolling);
</script>
