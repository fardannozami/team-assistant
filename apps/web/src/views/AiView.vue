<template>
  <header class="flex items-baseline justify-between gap-3 flex-wrap mb-7">
    <div>
      <h2 class="text-[26px] font-display font-extrabold tracking-tight text-text">Asisten AI</h2>
      <p class="text-text-muted text-sm mt-1">
        Bot memakai AI untuk memahami pesan bebas dari anggota. Gunakan API key milik Anda sendiri, sehingga pemakaian dan kuotanya terpisah dari workspace lain.
      </p>
    </div>
  </header>

  <div v-if="error" class="mb-5 px-4 py-3.5 rounded-xl border border-danger/30 bg-danger/5 text-danger text-[12px] font-extrabold slide-in" role="alert">{{ error }}</div>

  <div v-if="loading" class="flex items-center gap-3 text-sm text-text-muted">
    <span class="h-5 w-5 animate-spin rounded-full border-2 border-accent/20 border-t-accent" aria-hidden="true"></span>
    Memuat pengaturan…
  </div>

  <template v-else-if="settings">
    <!-- Status -->
    <section class="mb-7">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">Status</div>
      <div class="flex flex-wrap items-center gap-3 px-4 py-4 rounded-xl border border-border bg-panel-hover">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold tracking-tight uppercase border" :class="settings.configured ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border-border'">
          {{ settings.configured ? "Aktif" : settings.sharedKeyAvailable ? "Memakai key server" : "Belum diatur" }}
        </span>
        <span v-if="settings.configured" class="text-sm text-text-muted">
          {{ providerLabel(settings.provider) }} · <span class="font-mono text-text">{{ settings.model }}</span> · key berakhiran
          <span class="font-mono text-text">…{{ settings.apiKeyHint }}</span>
        </span>
        <span v-else class="text-sm text-text-muted">Tanpa API key, bot tetap mencatat standup, tetapi tidak menjawab pertanyaan bebas.</span>
      </div>
      <p v-if="warning" class="mt-3 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5 text-sm text-text slide-in">{{ warning }}</p>
    </section>

    <!-- Form -->
    <section>
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">{{ settings.configured ? "Ubah API key" : "Masukkan API key" }}</div>

      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5" role="radiogroup" aria-label="Penyedia AI">
        <button
          v-for="p in providerOptions"
          :key="p.id"
          type="button"
          role="radio"
          :aria-checked="form.provider === p.id"
          class="min-h-12 rounded-xl border px-3 text-sm font-semibold transition"
          :class="form.provider === p.id ? 'border-accent bg-accent/10 text-accent' : 'border-border text-text-muted hover:bg-panel-hover'"
          @click="selectProvider(p.id)"
        >
          {{ p.label }}
        </button>
      </div>

      <p v-if="currentOption.help" class="text-text-muted text-sm mb-5">
        {{ currentOption.help }}
        <a v-if="currentOption.keyUrl" :href="currentOption.keyUrl" target="_blank" rel="noopener" class="font-semibold text-accent hover:underline">Buat API key ›</a>
      </p>

      <form class="grid gap-4" @submit.prevent="save">
        <div v-if="form.provider === 'custom'">
          <label for="ai-base-url" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Base URL (kompatibel OpenAI)</label>
          <input id="ai-base-url" v-model="form.baseUrl" type="url" placeholder="https://api.contoh.com/v1" required :class="inputClass" />
        </div>
        <div>
          <label for="ai-model" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Model</label>
          <input id="ai-model" v-model="form.model" type="text" :placeholder="settings.providers[form.provider].model || 'nama-model'" :class="inputClass" />
          <div v-if="modelOptions.length" class="mt-2">
            <p class="text-text-muted text-xs mb-1.5">Gratis dan mendukung tool calling:</p>
            <div class="flex flex-wrap gap-2">
              <button
                v-for="m in modelOptions"
                :key="m.id"
                type="button"
                class="rounded-xl border px-3 py-2 text-left transition"
                :class="activeModel === m.id ? 'border-accent bg-accent/10' : 'border-border hover:bg-panel-hover'"
                :aria-pressed="activeModel === m.id"
                @click="form.model = m.id"
              >
                <span class="block font-mono text-xs font-semibold text-text">{{ m.id }}</span>
                <span class="block text-[11px] text-text-muted">{{ m.note }}</span>
              </button>
            </div>
          </div>
          <p v-else-if="form.provider !== 'custom'" class="mt-1.5 text-text-muted text-xs">Pilih model yang mendukung tool calling; tanpa itu bot tidak bisa membaca data tim.</p>
        </div>
        <div>
          <label for="ai-key" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">API key</label>
          <input
            id="ai-key"
            v-model="form.apiKey"
            type="password"
            autocomplete="off"
            :placeholder="keepsExistingKey ? `Biarkan kosong untuk tetap memakai …${settings.apiKeyHint}` : 'Tempel API key'"
            :required="!keepsExistingKey"
            :class="inputClass"
          />
          <p class="mt-1.5 text-text-muted text-xs">Disimpan terenkripsi dan tidak pernah ditampilkan kembali.</p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="submit"
            :disabled="saving"
            class="inline-flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white shadow-accent transition-all duration-200 ease-in hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span v-if="saving" class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full spin-slow" aria-hidden="true"></span>
            {{ saving ? "Menguji key…" : "Uji & simpan" }}
          </button>
          <button
            v-if="settings.configured"
            type="button"
            :disabled="saving"
            class="px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight border border-border text-danger hover:bg-danger/5 disabled:opacity-60"
            @click="remove"
          >
            Hapus key
          </button>
        </div>
      </form>
    </section>

    <!-- Tavily: web search for the sales briefing -->
    <section v-if="search" class="mt-9">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">Pencarian leads (Tavily)</div>
      <p class="text-text-muted text-sm mb-4">
        Briefing sales mencari lowongan publik di LinkedIn, Freelancer.com, dan RFP lewat Tavily. Tanpa key, briefing tetap jalan dari job board dan tender saja.
        Ada 1.000 pencarian gratis per bulan; satu briefing memakai sekitar 3.
        <a :href="search.keyUrl" target="_blank" rel="noopener" class="font-semibold text-accent hover:underline">Buat API key Tavily ›</a>
      </p>
      <div class="flex flex-wrap items-center gap-3 px-4 py-4 mb-4 rounded-xl border border-border bg-panel-hover">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-[11px] font-extrabold tracking-tight uppercase border" :class="search.configured ? 'bg-success/8 text-success border-success/20' : 'bg-text-muted/10 text-text-dim border-border'">
          {{ search.configured ? "Aktif" : search.sharedKeyAvailable ? "Memakai key server" : "Belum diatur" }}
        </span>
        <span v-if="search.configured" class="text-sm text-text-muted">Key berakhiran <span class="font-mono text-text">…{{ search.apiKeyHint }}</span></span>
      </div>
      <p v-if="searchWarning" class="mb-4 px-4 py-3 rounded-xl border border-warning/30 bg-warning/5 text-sm text-text slide-in">{{ searchWarning }}</p>
      <form class="grid gap-4" @submit.prevent="saveSearch">
        <div>
          <label for="tavily-key" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">API key Tavily</label>
          <input
            id="tavily-key"
            v-model="searchKey"
            type="password"
            autocomplete="off"
            placeholder="tvly-…"
            required
            :class="inputClass"
          />
          <p class="mt-1.5 text-text-muted text-xs">Diuji dengan satu pencarian, lalu disimpan terenkripsi dan tidak pernah ditampilkan kembali.</p>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            type="submit"
            :disabled="savingSearch"
            class="inline-flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white transition hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span v-if="savingSearch" class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full spin-slow" aria-hidden="true"></span>
            {{ savingSearch ? "Menguji key…" : "Uji & simpan" }}
          </button>
          <button
            v-if="search.configured"
            type="button"
            :disabled="savingSearch"
            class="px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight border border-border text-danger hover:bg-danger/5 disabled:opacity-60"
            @click="removeSearch"
          >
            Hapus key
          </button>
        </div>
      </form>
    </section>

    <!-- Naya: Hermes agents people can chat with -->
    <section v-if="nayaAgents" class="mt-9">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">Agent Naya</div>
      <p class="text-text-muted text-sm mb-4">
        Daftarkan profil Hermes yang bisa diajak chat di Naya. API key adalah <span class="font-mono text-text">API_SERVER_KEY</span> profil itu, disimpan terenkripsi.
        Agent <b>lead</b> menjawab "Tanya Naya".
      </p>
      <ul v-if="nayaAgents.length" class="mb-4 space-y-2">
        <li v-for="a in nayaAgents" :key="a.profile" class="flex flex-wrap items-center gap-2 rounded-xl border border-border px-4 py-3">
          <div class="min-w-0 flex-1">
            <div class="font-semibold text-text">{{ a.displayName }} <span class="font-mono text-xs text-text-muted">({{ a.profile }})</span><span v-if="a.isLead" class="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">lead</span></div>
            <div class="text-xs text-text-muted">Chat: {{ a.chatRoles.join(", ") || "—" }} · {{ a.hasKey ? `key …${a.apiKeyHint}` : "API key belum diisi" }}</div>
          </div>
          <button type="button" class="text-xs font-extrabold text-accent hover:underline" @click="editAgent(a)">Ubah</button>
          <button type="button" :disabled="savingAgent" class="text-xs font-extrabold text-danger hover:underline disabled:opacity-60" @click="removeAgent(a)">Hapus</button>
        </li>
      </ul>
      <form class="grid gap-3 rounded-xl border border-border p-4" @submit.prevent="saveAgent">
        <div class="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
          <div>
            <label for="agent-profile" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Profil Hermes</label>
            <input id="agent-profile" v-model="agentForm.profile" type="text" maxlength="64" placeholder="mis. sales" required :disabled="agentEditing" :class="[inputClass, 'disabled:opacity-60']" />
          </div>
          <div>
            <label for="agent-display" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Nama tampilan</label>
            <input id="agent-display" v-model="agentForm.displayName" type="text" maxlength="60" placeholder="mis. Sales Hunter" required :class="inputClass" />
          </div>
        </div>
        <div>
          <label for="agent-key" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">API key Hermes</label>
          <input id="agent-key" v-model="agentForm.apiKey" type="password" autocomplete="off" :placeholder="agentEditing ? 'Kosongkan untuk tetap memakai key lama' : 'API_SERVER_KEY profil ini'" :class="inputClass" />
        </div>
        <fieldset>
          <legend class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Boleh chat</legend>
          <div class="flex flex-wrap gap-3">
            <label v-for="r in CHAT_ROLE_OPTIONS" :key="r" class="flex items-center gap-2 text-sm"><input v-model="agentForm.chatRoles" type="checkbox" :value="r" class="h-4 w-4 accent-accent" /> {{ r }}</label>
          </div>
        </fieldset>
        <label class="flex items-center gap-2 text-sm"><input v-model="agentForm.isLead" type="checkbox" class="h-4 w-4 accent-accent" /> Agent lead (menjawab "Tanya Naya")</label>
        <div class="flex flex-wrap gap-2">
          <button type="submit" :disabled="savingAgent" class="px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white transition hover:bg-accent-hover disabled:opacity-60">{{ savingAgent ? "Menyimpan…" : agentEditing ? "Simpan agent" : "Tambah agent" }}</button>
          <button v-if="agentEditing" type="button" class="px-4 py-3 rounded-xl text-[13px] font-extrabold tracking-tight border border-border" @click="resetAgentForm">Batal</button>
        </div>
      </form>
    </section>

    <!-- Naya: tokens for Hermes agents reading daily over MCP -->
    <section v-if="agentTokens" class="mt-9">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">Token MCP agent</div>
      <p class="text-text-muted text-sm mb-4">
        Agent Hermes bisa membaca proyek, anggota, standup, laporan, anggota yang sedang kosong, dan leads briefing (tanpa fee dan nomor HP).
        Token dengan akses <b>ops</b> (khusus Owner) juga bisa melihat status dan log service app, dan me-restart-nya. Berikan hanya ke agent <span class="font-mono text-text">ops</span>.
        Buat satu token per agent, lalu pasang di <span class="font-mono text-text">config.yaml</span> profil Hermes-nya.
      </p>
      <div class="px-4 py-3 mb-4 rounded-xl border border-border bg-panel-hover text-sm">
        <span class="text-text-muted">URL MCP:</span> <span class="font-mono text-text break-all">{{ nayaApi.mcpUrl }}</span>
      </div>
      <div v-if="newToken" class="mb-4 px-4 py-4 rounded-xl border border-success/30 bg-success/5 slide-in">
        <p class="text-sm font-bold text-text mb-2">Token untuk "{{ newToken.name }}". Salin sekarang, token ini tidak ditampilkan lagi.</p>
        <div class="flex flex-wrap items-center gap-2">
          <code class="flex-1 min-w-0 break-all rounded-lg border border-border bg-panel px-3 py-2 font-mono text-xs text-text">{{ newToken.token }}</code>
          <button type="button" class="px-3 py-2 rounded-lg text-xs font-extrabold border border-border hover:bg-panel-hover" @click="copyToken">Salin</button>
        </div>
      </div>
      <form class="flex flex-wrap items-end gap-2 mb-4" @submit.prevent="createAgentToken">
        <div class="flex-1 min-w-[200px]">
          <label for="agent-token-name" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Nama agent</label>
          <input id="agent-token-name" v-model="agentName" type="text" maxlength="60" placeholder="mis. sales" required :class="inputClass" />
        </div>
        <fieldset class="flex flex-wrap items-center gap-3 basis-full">
          <legend class="sr-only">Akses token</legend>
          <label v-for="o in SCOPE_OPTIONS" :key="o.scope" class="flex items-center gap-2 text-sm" :class="o.ownerOnly && currentRole !== 'Owner' ? 'opacity-50' : ''"><input v-model="tokenScopes" type="checkbox" :value="o.scope" :disabled="o.ownerOnly && currentRole !== 'Owner'" class="h-4 w-4 accent-accent" /> {{ o.label }}</label>
        </fieldset>
        <button
          type="submit"
          :disabled="savingToken || tokenScopes.length === 0"
          class="px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white transition hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {{ savingToken ? "Membuat…" : "Buat token" }}
        </button>
      </form>
      <p v-if="agentTokens.length === 0" class="text-sm text-text-muted">Belum ada token agent.</p>
      <div v-else class="overflow-x-auto rounded-xl border border-border">
        <table class="w-full text-sm">
          <thead class="bg-panel-hover text-left text-[11px] font-extrabold uppercase tracking-wider text-text-dim">
            <tr>
              <th class="px-4 py-2.5">Agent</th>
              <th class="px-4 py-2.5">Token</th>
              <th class="px-4 py-2.5">Akses</th>
              <th class="px-4 py-2.5">Terakhir dipakai</th>
              <th class="px-4 py-2.5"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in agentTokens" :key="t.id" class="border-t border-border">
              <td class="px-4 py-2.5 text-text">{{ t.name }}</td>
              <td class="px-4 py-2.5 font-mono text-text-muted">…{{ t.tokenHint }}</td>
              <td class="px-4 py-2.5 text-xs text-text-muted">{{ t.scopes.join(", ") }}</td>
              <td class="px-4 py-2.5 text-text-muted">{{ t.lastUsedAt ? formatDateTime(t.lastUsedAt) : "Belum pernah" }}</td>
              <td class="px-4 py-2.5 text-right">
                <button type="button" :disabled="savingToken" class="text-xs font-extrabold text-danger hover:underline disabled:opacity-60" @click="revokeAgentToken(t)">Cabut</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Akses & batas -->
    <section v-if="policy" class="mt-9">
      <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-3">Akses & batas</div>
      <form class="grid gap-4" @submit.prevent="savePolicy">
        <label class="flex items-start gap-3 px-4 py-4 rounded-xl border border-border bg-panel-hover cursor-pointer">
          <input v-model="policyForm.allowEmployees" type="checkbox" class="mt-1 h-4 w-4 accent-accent" />
          <span>
            <span class="block text-sm font-bold text-text">Izinkan AI untuk karyawan</span>
            <span class="block text-sm text-text-muted">
              Mati: karyawan hanya memakai kata kunci standup (STANDUP, UBAH STANDUP, BANTUAN). Hidup: AI hanya membantu standup mereka sendiri, dengan batas harian di bawah. Owner, Admin, dan Manager selalu bisa memakai AI.
            </span>
          </span>
        </label>
        <div class="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4">
          <div>
            <label for="ai-employee-limit" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Pesan AI per karyawan / hari</label>
            <input id="ai-employee-limit" v-model.number="policyForm.employeeDailyLimit" type="number" min="1" max="500" required :disabled="!policyForm.allowEmployees" :class="[inputClass, 'disabled:opacity-50']" />
          </div>
          <div>
            <label for="ai-workspace-limit" class="block text-[11px] font-extrabold tracking-wider uppercase text-text-dim mb-1.5">Pesan AI seluruh workspace / hari</label>
            <input id="ai-workspace-limit" v-model.number="policyForm.workspaceDailyLimit" type="number" min="1" max="10000" required :class="inputClass" />
          </div>
        </div>
        <p class="text-text-muted text-xs -mt-2">Pesan karyawan ke AI maksimal 1.000 karakter, admin 4.000. Hitungan harian direset tengah malam WIB.</p>
        <div>
          <button
            type="submit"
            :disabled="savingPolicy || !policyDirty"
            class="px-4 py-3.5 rounded-xl text-[13px] font-extrabold tracking-tight bg-accent text-white transition hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {{ savingPolicy ? "Menyimpan…" : "Simpan batas" }}
          </button>
        </div>
      </form>
    </section>

    <!-- Pemakaian -->
    <section v-if="usage" class="mt-9">
      <div class="flex items-baseline justify-between gap-3 mb-3">
        <div class="text-[11px] font-extrabold tracking-wider uppercase text-text-dim">Pemakaian 7 hari terakhir</div>
        <div class="text-sm text-text-muted">Hari ini: <span class="font-bold text-text">{{ usage.today }}</span> / {{ policy?.workspaceDailyLimit }}</div>
      </div>
      <p v-if="usage.week.length === 0" class="text-sm text-text-muted">Belum ada pemakaian AI.</p>
      <div v-else class="overflow-x-auto rounded-xl border border-border">
        <table class="w-full text-sm">
          <thead class="bg-panel-hover text-left text-[11px] font-extrabold uppercase tracking-wider text-text-dim">
            <tr>
              <th class="px-4 py-2.5">Anggota</th>
              <th class="px-4 py-2.5 text-right">Hari ini</th>
              <th class="px-4 py-2.5 text-right">7 hari</th>
              <th class="px-4 py-2.5 text-right">Token</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in usage.week" :key="row.name" class="border-t border-border">
              <td class="px-4 py-2.5 text-text">{{ row.name }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ row.today }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums">{{ row.messages }}</td>
              <td class="px-4 py-2.5 text-right tabular-nums text-text-muted">{{ row.tokens.toLocaleString("id-ID") }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { currentRole } from "../session";
import { aiApi, ApiError, briefingsApi, nayaApi, showToast, type AgentToken, type AgentTokenScope, type NayaAgent, type AiPolicy, type AiProvider, type AiSettings, type AiUsage, type SearchKeyStatus } from "../api";

const providerOptions: { id: AiProvider; label: string; help: string; keyUrl?: string }[] = [
  { id: "gemini", label: "Google Gemini", help: "Ada kuota gratis harian. Buat key di Google AI Studio.", keyUrl: "https://aistudio.google.com/apikey" },
  { id: "groq", label: "Groq", help: "Gratis tanpa kartu kredit, dengan batas permintaan per menit dan per hari. Sangat cepat.", keyUrl: "https://console.groq.com/keys" },
  { id: "openai", label: "OpenAI", help: "Berbayar sesuai pemakaian.", keyUrl: "https://platform.openai.com/api-keys" },
  { id: "openrouter", label: "OpenRouter", help: "Satu key untuk banyak model. Tulis model dengan format penyedia/model.", keyUrl: "https://openrouter.ai/keys" },
  { id: "custom", label: "Lainnya", help: "Penyedia lain yang kompatibel dengan API OpenAI (endpoint /chat/completions)." },
];

const inputClass =
  "w-full px-4 py-3.5 rounded-xl border border-border bg-panel text-sm placeholder-text-dim transition-all duration-200 ease-in focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none";

const settings = ref<AiSettings | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref("");
const warning = ref("");
const form = reactive<{ provider: AiProvider; baseUrl: string; model: string; apiKey: string }>({
  provider: "gemini",
  baseUrl: "",
  model: "",
  apiKey: "",
});

const search = ref<SearchKeyStatus | null>(null);
const searchKey = ref("");
const searchWarning = ref("");
const savingSearch = ref(false);

const CHAT_ROLE_OPTIONS = ["Owner", "Admin", "Manager", "PM", "Employee"];
const SCOPE_OPTIONS: { scope: AgentTokenScope; label: string; ownerOnly: boolean }[] = [
  { scope: "mcp:read", label: "Baca data daily", ownerOnly: false },
  { scope: "ops:read", label: "Ops: status & log", ownerOnly: true },
  { scope: "ops:restart", label: "Ops: restart service", ownerOnly: true },
];
const nayaAgents = ref<NayaAgent[] | null>(null);
const emptyAgent = () => ({ profile: "", displayName: "", apiKey: "", chatRoles: ["Owner", "Admin"], isLead: false });
const agentForm = reactive(emptyAgent());
const agentEditing = ref(false);
const savingAgent = ref(false);
const tokenScopes = ref<AgentTokenScope[]>(["mcp:read"]);
const agentTokens = ref<AgentToken[] | null>(null);
const agentName = ref("");
const newToken = ref<{ name: string; token: string } | null>(null);
const savingToken = ref(false);

const policy = ref<AiPolicy | null>(null);
const usage = ref<AiUsage | null>(null);
const policyForm = reactive<AiPolicy>({ allowEmployees: false, employeeDailyLimit: 10, workspaceDailyLimit: 200 });
const savingPolicy = ref(false);
const policyDirty = computed(
  () =>
    !!policy.value &&
    (policy.value.allowEmployees !== policyForm.allowEmployees ||
      policy.value.employeeDailyLimit !== policyForm.employeeDailyLimit ||
      policy.value.workspaceDailyLimit !== policyForm.workspaceDailyLimit),
);

const currentOption = computed(() => providerOptions.find((p) => p.id === form.provider)!);
// The server keeps the stored key only when the endpoint stays the same.
const keepsExistingKey = computed(() => Boolean(settings.value?.configured && settings.value.provider === form.provider && (form.provider !== "custom" || form.baseUrl.replace(/\/+$/, "") === settings.value.baseUrl)));

const modelOptions = computed(() => settings.value?.providers[form.provider].models ?? []);
const activeModel = computed(() => form.model.trim() || settings.value?.providers[form.provider].model || "");

function providerLabel(id: AiProvider | null) {
  return providerOptions.find((p) => p.id === id)?.label ?? "";
}

function selectProvider(id: AiProvider) {
  form.provider = id;
  const current = settings.value;
  form.model = current?.provider === id ? (current.model ?? "") : "";
  form.baseUrl = current?.provider === id ? (current.baseUrl ?? "") : "";
  error.value = "";
}

function fillForm(s: AiSettings) {
  settings.value = s;
  selectProvider(s.provider ?? "gemini");
  form.apiKey = "";
}

function fillPolicy(p: AiPolicy) {
  policy.value = p;
  Object.assign(policyForm, p);
}

async function savePolicy() {
  error.value = "";
  savingPolicy.value = true;
  try {
    fillPolicy((await aiApi.savePolicy({ ...policyForm })).policy);
    showToast("Batas AI disimpan.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Batas AI gagal disimpan.";
  } finally {
    savingPolicy.value = false;
  }
}

async function load() {
  loading.value = true;
  try {
    const [s, p, k, t, n] = await Promise.all([aiApi.settings(), aiApi.policy(), briefingsApi.searchKey(), nayaApi.tokens(), nayaApi.agents()]);
    search.value = k;
    agentTokens.value = t;
    nayaAgents.value = n;
    fillPolicy(p.policy);
    usage.value = p.usage;
    fillForm(s);
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Pengaturan AI gagal dimuat.";
  } finally {
    loading.value = false;
  }
}

async function save() {
  error.value = "";
  warning.value = "";
  saving.value = true;
  try {
    const res = await aiApi.save({
      provider: form.provider,
      baseUrl: form.provider === "custom" ? form.baseUrl : undefined,
      model: form.model.trim() || undefined,
      apiKey: form.apiKey.trim() || undefined,
    });
    fillForm(res.settings);
    warning.value = res.warning ? `Key disimpan, tetapi: ${res.warning}` : "";
    showToast("API key berhasil diuji dan disimpan.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "API key gagal disimpan.";
  } finally {
    saving.value = false;
  }
}

async function saveSearch() {
  error.value = "";
  searchWarning.value = "";
  savingSearch.value = true;
  try {
    const res = await briefingsApi.saveSearchKey(searchKey.value.trim());
    search.value = res.status;
    searchKey.value = "";
    searchWarning.value = res.warning ? `Key disimpan, tetapi: ${res.warning}` : "";
    showToast("API key Tavily berhasil diuji dan disimpan.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "API key Tavily gagal disimpan.";
  } finally {
    savingSearch.value = false;
  }
}

async function removeSearch() {
  if (!confirm("Hapus API key Tavily? Briefing sales hanya akan memakai job board dan tender.")) return;
  savingSearch.value = true;
  try {
    search.value = await briefingsApi.removeSearchKey();
    searchWarning.value = "";
    showToast("API key Tavily dihapus.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "API key Tavily gagal dihapus.";
  } finally {
    savingSearch.value = false;
  }
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

async function createAgentToken() {
  error.value = "";
  savingToken.value = true;
  try {
    const name = agentName.value.trim();
    const { token } = await nayaApi.createToken(name, tokenScopes.value);
    newToken.value = { name, token };
    agentName.value = "";
    tokenScopes.value = ["mcp:read"];
    agentTokens.value = await nayaApi.tokens();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Token agent gagal dibuat.";
  } finally {
    savingToken.value = false;
  }
}

function resetAgentForm() {
  Object.assign(agentForm, emptyAgent());
  agentEditing.value = false;
}

function editAgent(a: NayaAgent) {
  Object.assign(agentForm, { profile: a.profile, displayName: a.displayName, apiKey: "", chatRoles: [...a.chatRoles], isLead: a.isLead });
  agentEditing.value = true;
}

async function saveAgent() {
  error.value = "";
  savingAgent.value = true;
  try {
    await nayaApi.saveAgent(agentForm.profile.trim(), {
      displayName: agentForm.displayName.trim(),
      apiKey: agentForm.apiKey.trim() || undefined,
      chatRoles: agentForm.chatRoles,
      isLead: agentForm.isLead,
    });
    nayaAgents.value = await nayaApi.agents();
    showToast(`Agent ${agentForm.displayName.trim()} disimpan.`, "success");
    resetAgentForm();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Agent gagal disimpan.";
  } finally {
    savingAgent.value = false;
  }
}

async function removeAgent(a: NayaAgent) {
  if (!confirm(`Hapus agent "${a.displayName}" dari Naya? Agent di Hermes tidak ikut terhapus.`)) return;
  savingAgent.value = true;
  try {
    await nayaApi.removeAgent(a.profile);
    nayaAgents.value = await nayaApi.agents();
    if (agentForm.profile === a.profile) resetAgentForm();
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Agent gagal dihapus.";
  } finally {
    savingAgent.value = false;
  }
}

async function copyToken() {
  if (!newToken.value) return;
  try {
    await navigator.clipboard.writeText(newToken.value.token);
    showToast("Token disalin.", "success");
  } catch {
    showToast("Gagal menyalin. Pilih teksnya lalu salin manual.", "error");
  }
}

async function revokeAgentToken(t: AgentToken) {
  if (!confirm(`Cabut token agent "${t.name}"? Agent itu tidak bisa membaca data daily lagi.`)) return;
  savingToken.value = true;
  try {
    await nayaApi.revokeToken(t.id);
    agentTokens.value = await nayaApi.tokens();
    showToast("Token dicabut.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "Token gagal dicabut.";
  } finally {
    savingToken.value = false;
  }
}

async function remove() {
  if (!confirm("Hapus API key? Bot akan berhenti menjawab pertanyaan bebas.")) return;
  saving.value = true;
  try {
    fillForm(await aiApi.remove());
    warning.value = "";
    showToast("API key dihapus.", "success");
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : "API key gagal dihapus.";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>
