<template>
  <header class="mb-7 flex flex-wrap items-baseline justify-between gap-3">
    <div>
      <h2 class="font-display text-[26px] font-extrabold tracking-tight text-text">Project</h2>
      <p class="mt-1 text-sm text-text-muted">Catat project, fee yang diterima, dan pembagian fee ke PM, designer, dan developer.</p>
    </div>
    <button type="button" class="min-h-12 rounded-xl bg-accent px-5 text-sm font-bold text-white shadow-accent hover:bg-accent-hover" @click="openEditor(null)">Tambah project</button>
  </header>

  <div v-if="error" class="mb-5 rounded-xl border border-danger/30 bg-danger/5 px-4 py-3.5 text-[12px] font-extrabold text-danger slide-in" role="alert">{{ error }}</div>

  <div class="mb-5 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
    <label class="sr-only" for="project-search">Cari project</label>
    <input id="project-search" v-model="search" type="search" placeholder="Cari nama project, platform, atau anggota" :class="inputClass" />
    <label class="sr-only" for="filter-type">Tipe project</label>
    <select id="filter-type" v-model="typeFilter" :class="inputClass">
      <option value="">Semua tipe</option>
      <option v-for="(label, key) in PROJECT_TYPE_LABEL" :key="key" :value="key">{{ label }}</option>
    </select>
    <label class="sr-only" for="filter-status">Status project</label>
    <select id="filter-status" v-model="statusFilter" :class="inputClass">
      <option value="">Semua status</option>
      <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
    </select>
    <label class="sr-only" for="filter-payment">Status payment</label>
    <select id="filter-payment" v-model="paymentFilter" :class="inputClass">
      <option value="">Semua payment</option>
      <option v-for="(label, key) in PAYMENT_STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
    </select>
  </div>

  <div class="-mt-2 mb-5 grid gap-3 sm:grid-cols-[auto_auto_1fr_1fr]">
    <label class="sr-only" for="filter-bonus">Status bonus</label>
    <select id="filter-bonus" v-model="bonusFilter" :class="inputClass">
      <option value="">Semua bonus</option>
      <option value="unpaid">Bonus belum dibayar</option>
      <option value="paid">Bonus sudah dibayar</option>
    </select>
    <label class="sr-only" for="filter-period">Periode</label>
    <select id="filter-period" v-model="period" :class="inputClass">
      <option v-for="(label, key) in PERIOD_LABEL" :key="key" :value="key">{{ label }}</option>
    </select>
    <label class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Dari</span>
      <input v-model="dateFrom" type="date" :max="dateTo || undefined" :class="inputClass" class="w-full min-w-0" @input="period = 'custom'" />
    </label>
    <label class="flex items-center gap-2">
      <span class="w-14 shrink-0 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Sampai</span>
      <input v-model="dateTo" type="date" :min="dateFrom || undefined" :class="inputClass" class="w-full min-w-0" @input="period = 'custom'" />
    </label>
  </div>

  <div v-if="loading && !projects.length" class="flex flex-col items-center gap-2.5 py-24 text-center text-text-muted fade-in-fast">
    <span class="h-10 w-10 rounded-full border-2 border-accent/20 border-t-accent spin-slow" aria-hidden="true"></span>
    <span class="text-sm font-extrabold tracking-tight">Memuat project…</span>
  </div>

  <div v-else-if="!error && !projects.length" class="flex flex-col items-center justify-center py-24 text-center fade-in">
    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border bg-panel-hover text-text-dim" aria-hidden="true">—</div>
    <h3 class="mb-1 text-[18px] font-extrabold tracking-tight text-text">Belum ada project</h3>
    <p class="text-sm text-text-muted">Tambahkan project pertama beserta pembagian fee-nya.</p>
  </div>

  <template v-else-if="projects.length">
    <!-- Totals of what is filtered, cancelled projects left out -->
    <section class="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Ringkasan">
      <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div class="font-display text-[26px] font-extrabold tracking-tight text-text">{{ counted.length }}</div>
        <div class="mt-1 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Project (tanpa batal)</div>
      </div>
      <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div class="font-display text-[26px] font-extrabold tracking-tight text-text">{{ totals.design }}</div>
        <div class="mt-1 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Project design</div>
      </div>
      <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div class="font-display text-[26px] font-extrabold tracking-tight text-text">{{ totals.development }}</div>
        <div class="mt-1 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Project development</div>
      </div>
      <div class="rounded-2xl border border-border bg-panel p-4 shadow-soft">
        <div class="font-display text-[20px] font-extrabold tracking-tight text-success">{{ formatTotals(totals.received) }}</div>
        <div class="mt-1 text-[11px] font-extrabold uppercase tracking-wider text-text-dim">Fee diterima</div>
      </div>
    </section>

    <section v-if="perPerson.length" class="mb-6 rounded-2xl border border-border bg-panel p-4 shadow-soft-lg sm:p-6" aria-labelledby="per-person-title">
      <h3 id="per-person-title" class="text-lg font-extrabold text-text">Rekap kontribusi per orang</h3>
      <p class="mt-1 text-sm text-text-muted">Dari project yang tampil di filter, tanpa project batal.</p>
      <div class="table-scroll mt-3">
        <table class="w-full border-collapse text-[13px]">
          <thead>
            <tr class="text-text-dim">
              <th class="border-b border-border px-3 py-2.5 text-left text-[11px] font-extrabold uppercase tracking-wider">Nama</th>
              <th class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Project</th>
              <th class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Total achievement</th>
              <th v-if="isAdmin" class="border-b border-border px-3 py-2.5 text-right text-[11px] font-extrabold uppercase tracking-wider">Fee</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in perPerson" :key="p.employeeId">
              <td class="border-b border-border px-3 py-2.5 text-text">{{ p.name }}</td>
              <td class="border-b border-border px-3 py-2.5 text-right tabular-nums text-text">{{ p.projects }}</td>
              <td class="border-b border-border px-3 py-2.5 text-right font-bold tabular-nums text-text">{{ formatTotals(p.total) }}</td>
              <td v-if="isAdmin" class="border-b border-border px-3 py-2.5 text-right">
                <template v-if="feeOf(p.employeeId)">
                  <button
                    v-if="feeEligible(feeOf(p.employeeId)!)"
                    type="button"
                    class="min-h-9 whitespace-nowrap rounded-xl border border-accent/30 bg-accent/5 px-3 text-xs font-bold text-accent hover:bg-accent/10"
                    :aria-label="`Buat fee ${p.name}`"
                    @click="openFee(feeOf(p.employeeId)!)"
                  >{{ money(feeOf(p.employeeId)!.statement.total, "USD") }} · Buat fee</button>
                  <span v-else class="text-xs text-warning" title="Total di bawah $500, dibawa ke periode berikutnya">Belum eligible</span>
                </template>
                <span v-else class="text-text-dim">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <p v-if="!filtered.length" class="py-10 text-center text-sm text-text-muted">Tidak ada project yang cocok dengan filter.</p>

    <ul class="space-y-3">
      <li v-for="p in filtered" :key="p.id" class="rounded-2xl border border-border bg-panel p-4 shadow-soft sm:p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-bold uppercase tracking-wider text-text-dim">{{ PROJECT_TYPE_LABEL[p.type] }} · {{ p.platform }} · {{ PAYMENT_TYPE_LABEL[p.paymentType] }}</div>
            <h3 class="mt-0.5 font-bold text-text">{{ p.name }}</h3>
            <p class="mt-0.5 text-xs text-text-muted">{{ dateRange(p) }}</p>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span class="badge" :class="STATUS_BADGE[p.status]">{{ STATUS_LABEL[p.status] }}</span>
            <span class="badge" :class="PAYMENT_BADGE[p.paymentStatus]">{{ PAYMENT_STATUS_LABEL[p.paymentStatus] }}</span>
          </div>
        </div>

        <dl class="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-3">
          <div><dt class="text-xs font-bold text-text-dim">Fee</dt><dd class="tabular-nums text-text">{{ money(p.feeReceived, p.currency) }}</dd></div>
          <div><dt class="text-xs font-bold text-text-dim">Potongan platform {{ p.platformFeePercent }}%</dt><dd class="tabular-nums text-text">{{ money(p.platformFee, p.currency) }}</dd></div>
          <div><dt class="text-xs font-bold text-text-dim">Fee diterima</dt><dd class="font-bold tabular-nums text-text">{{ money(p.splitBase, p.currency) }}</dd></div>
        </dl>

        <div class="mt-3 grid gap-3 sm:grid-cols-3">
          <div v-for="role in MEMBER_ROLES" :key="role.id">
            <div class="text-xs font-bold text-text-dim">{{ role.label }}</div>
            <ul v-if="membersOf(p, role.id).length" class="mt-1 space-y-0.5 text-[13px]">
              <li v-for="m in membersOf(p, role.id)" :key="m.employeeId" class="flex justify-between gap-2">
                <span class="truncate text-text">{{ m.employeeName }} <span class="text-text-dim">{{ m.sharePercent }}%</span></span>
                <span class="flex shrink-0 items-center gap-1.5">
                  <span class="tabular-nums text-text-muted">{{ money(m.fee, p.currency) }}</span>
                  <span
                    class="rounded-full px-1.5 text-[10px] font-bold"
                    :class="m.bonusPaidAt ? 'bg-success/10 text-success' : 'bg-text-muted/10 text-text-dim'"
                    :title="m.bonusPaidAt ? `Bonus difinalisasi ${formatDate(m.bonusPaidAt.slice(0, 10))}` : 'Bonus belum dibayar'"
                  >{{ m.bonusPaidAt ? "Bonus ✓" : "Bonus belum" }}</span>
                </span>
              </li>
            </ul>
            <p v-else class="mt-1 text-[13px] text-text-dim">—</p>
          </div>
        </div>

        <p v-if="p.leadPaid.length" class="mt-2 text-xs text-success">
          Bonus lead dibayar: <span v-for="(l, i) in p.leadPaid" :key="l.group + l.employeeName">{{ i ? ", " : "" }}{{ l.employeeName }} ({{ formatDate(l.paidAt.slice(0, 10)) }})</span>
        </p>

        <p v-if="p.notes" class="mt-3 whitespace-pre-wrap text-sm text-text-muted">{{ p.notes }}</p>

        <div class="mt-3 flex justify-end gap-1">
          <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="openEditor(p)">Ubah</button>
          <button type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-danger/5 hover:text-danger" @click="remove(p)">Hapus</button>
        </div>
      </li>
    </ul>
  </template>

  <!-- Editor: teleported because the page's reveal transform would pin `fixed` to the page, under the header -->
  <Teleport to="body">
  <div v-if="form" class="fixed inset-0 z-50 flex items-end justify-center bg-text/30 backdrop-blur-sm fade-in-fast sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="editor-title" @keydown.esc="closeEditor" @keydown.tab="trapTabIn($event, formEl)">
    <form ref="formEl" novalidate :class="{ 'show-invalid': triedSave }" class="max-h-[92vh] w-full max-w-[720px] overflow-y-auto rounded-t-2xl border border-border bg-panel p-4 shadow-soft-lg sm:rounded-2xl sm:p-6" @submit.prevent="save">
      <div class="flex items-center justify-between gap-3">
        <h3 id="editor-title" class="text-lg font-extrabold text-text">{{ editingId ? "Ubah project" : "Tambah project" }}</h3>
        <button type="button" class="grid h-10 w-10 place-items-center rounded-xl text-lg text-text-dim hover:bg-panel-hover" aria-label="Tutup" @click="closeEditor">×</button>
      </div>

      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <label class="block">
          <span :class="labelClass">Nama project</span>
          <input v-model="form.name" required maxlength="300" :class="inputClass" class="w-full" />
        </label>
        <label class="block">
          <span :class="labelClass">Tipe project</span>
          <select v-model="form.type" :class="inputClass" class="w-full">
            <option v-for="(label, key) in PROJECT_TYPE_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="block">
          <span :class="labelClass">Platform</span>
          <input v-model="form.platform" required maxlength="100" list="platforms" placeholder="Upwork" :class="inputClass" class="w-full" />
          <datalist id="platforms"><option v-for="p in platforms" :key="p" :value="p" /></datalist>
        </label>
        <label class="block">
          <span :class="labelClass">Tipe payment</span>
          <select v-model="form.paymentType" :class="inputClass" class="w-full">
            <option v-for="(label, key) in PAYMENT_TYPE_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="block">
          <span :class="labelClass">Start date</span>
          <input v-model="form.startDate" type="date" :class="inputClass" class="w-full" />
        </label>
        <label class="block">
          <span :class="labelClass">End date</span>
          <input v-model="form.endDate" type="date" :min="form.startDate || undefined" :class="inputClass" class="w-full" />
        </label>
        <label class="block">
          <span :class="labelClass">Status project</span>
          <select v-model="form.status" :class="inputClass" class="w-full">
            <option v-for="(label, key) in STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
        <label class="block">
          <span :class="labelClass">Status payment</span>
          <select v-model="form.paymentStatus" :class="inputClass" class="w-full">
            <option v-for="(label, key) in PAYMENT_STATUS_LABEL" :key="key" :value="key">{{ label }}</option>
          </select>
        </label>
      </div>

      <fieldset class="mt-6">
        <legend class="text-sm font-extrabold text-text">Fee</legend>
        <div class="mt-2 grid gap-4 sm:grid-cols-4">
          <label class="block">
            <span :class="labelClass">Mata uang</span>
            <input v-model="form.currency" required maxlength="3" :class="inputClass" class="w-full uppercase" />
          </label>
          <label class="block">
            <span :class="labelClass">Fee</span>
            <input v-model.number="form.feeReceived" type="number" min="0" step="0.01" required :class="inputClass" class="w-full" />
          </label>
          <label class="block">
            <span :class="labelClass">Potongan platform %</span>
            <input v-model.number="form.platformFeePercent" type="number" min="0" max="99" step="0.01" required :class="inputClass" class="w-full" />
          </label>
          <label class="block">
            <span :class="labelClass">Fee diterima</span>
            <input v-model.number="totalFeeInput" type="number" min="0" step="0.01" :placeholder="`Otomatis: ${preview.auto}`" :class="inputClass" class="w-full" />
          </label>
        </div>
        <p class="mt-2 text-sm text-text-muted">
          Potongan platform: <strong class="text-text">{{ money(preview.cut, form.currency) }}</strong> · Fee diterima: <strong class="text-text">{{ money(preview.base, form.currency) }}</strong>.
          "Fee diterima" otomatis fee dikurangi potongan platform; isi hanya kalau jumlahnya berbeda.
        </p>
        <p v-if="totalFeeTooHigh" class="mt-1 text-sm font-semibold text-danger">Fee diterima lebih besar dari fee.</p>
      </fieldset>

      <fieldset v-for="role in MEMBER_ROLES" :key="role.id" class="mt-6">
        <legend class="text-sm font-extrabold text-text">{{ role.label }}</legend>
        <ul class="mt-2 space-y-2">
          <li v-for="(m, i) in formMembers(role.id)" :key="i" class="grid grid-cols-[1fr_88px_auto] items-center gap-2 sm:grid-cols-[1fr_96px_120px_auto]">
            <label class="sr-only" :for="`member-${role.id}-${i}`">{{ role.label }} {{ i + 1 }}</label>
            <select :id="`member-${role.id}-${i}`" v-model="m.employeeId" required :class="inputClass" class="min-w-0">
              <option value="" disabled>Pilih anggota</option>
              <option v-for="person in peopleFor(m)" :key="person.id" :value="person.id">{{ person.name }}{{ person.isActive ? "" : " (nonaktif)" }}</option>
            </select>
            <label class="relative">
              <span class="sr-only">Persen</span>
              <input v-model.number="m.sharePercent" type="number" min="0" max="100" step="0.01" required :class="inputClass" class="w-full pr-7" />
              <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-dim">%</span>
            </label>
            <span class="hidden text-right text-sm tabular-nums text-text-muted sm:block">{{ money(previewFees.get(m) ?? 0, form.currency) }}</span>
            <button type="button" class="grid h-11 w-11 place-items-center rounded-xl text-lg text-text-dim hover:bg-danger/5 hover:text-danger" :aria-label="`Hapus ${role.label} ${i + 1}`" @click="removeMember(m)">×</button>
          </li>
        </ul>
        <div class="mt-2 flex flex-wrap gap-2">
          <button type="button" class="min-h-10 rounded-xl border border-border px-3 text-sm font-semibold text-text hover:bg-panel-hover" @click="addMember(role.id)">+ {{ role.label }}</button>
          <button v-if="formMembers(role.id).length > 1" type="button" class="min-h-10 rounded-xl px-3 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="splitEvenly(role.id)">Bagi rata</button>
        </div>
      </fieldset>

      <label class="mt-6 block">
        <span :class="labelClass">Catatan</span>
        <textarea v-model="form.notes" rows="2" maxlength="2000" :class="inputClass" class="w-full py-3"></textarea>
      </label>

      <div class="mt-6 flex justify-end gap-2">
        <button type="button" class="min-h-12 rounded-xl px-5 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="closeEditor">Batal</button>
        <button type="submit" class="min-h-12 rounded-xl bg-accent px-5 text-sm font-bold text-white disabled:opacity-60" :disabled="saving">{{ saving ? "Menyimpan…" : "Simpan" }}</button>
      </div>
    </form>
  </div>
  </Teleport>

  <!-- Fee: set the percents, then preview the PDF and download or send it -->
  <Teleport to="body">
  <div v-if="fee" class="fixed inset-0 z-50 flex items-end justify-center bg-text/30 backdrop-blur-sm fade-in-fast sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="fee-title" @keydown.esc="closeFee" @keydown.tab="trapTabIn($event, feeEl)">
    <div ref="feeEl" class="flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-t-2xl border border-border bg-panel p-4 shadow-soft-lg sm:rounded-2xl sm:p-6" :class="fee.pdfUrl ? 'max-w-[960px]' : 'max-w-[560px]'">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h3 id="fee-title" class="text-lg font-extrabold text-text">Fee {{ feePeriodText }} - {{ fee.person.employee.name }}</h3>
          <p class="mt-0.5 text-xs text-text-muted">{{ fee.pdfUrl ? "Preview PDF" : "Langkah 1 dari 2 · Atur persen fee" }}</p>
        </div>
        <button type="button" class="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-lg text-text-dim hover:bg-panel-hover" aria-label="Tutup" @click="closeFee">×</button>
      </div>

      <template v-if="!fee.pdfUrl">
        <div class="mt-4 space-y-2">
          <div v-for="g in fee.person.statement.groups" :key="g.group" class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
            <div class="min-w-0">
              <div class="text-sm font-bold text-text">Fee {{ GROUP_LABEL[g.group] }}</div>
              <div class="text-xs text-text-muted">
                Total {{ money(g.base, "USD") }}
                <template v-if="g.eligible"> · tabel {{ g.tierPercent }}%</template>
                <template v-else> · belum eligible (min. $500), dibawa ke periode berikutnya</template>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <label v-if="g.eligible" class="relative">
                <span class="sr-only">Persen {{ GROUP_LABEL[g.group] }}</span>
                <input
                  v-model.number="fee.percents[g.group]"
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  class="min-h-10 w-24 rounded-xl border border-border bg-panel px-3 pr-7 text-right text-sm tabular-nums focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none"
                />
                <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-text-dim">%</span>
              </label>
              <span class="w-24 text-right font-bold tabular-nums text-text">{{ g.eligible ? money(feeBonus(g), "USD") : "-" }}</span>
            </div>
          </div>
          <div class="flex items-center justify-between rounded-xl bg-warning/10 px-4 py-3">
            <span class="text-sm font-extrabold text-text">TOTAL FEE</span>
            <span class="font-display text-[20px] font-extrabold tabular-nums text-text">{{ money(feeTotal, "USD") }}</span>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button type="button" class="min-h-12 rounded-xl px-5 text-sm font-semibold text-text-muted hover:bg-panel-hover" @click="closeFee">Batal</button>
          <button type="button" class="min-h-12 rounded-xl bg-accent px-5 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-60" :disabled="fee.busy" @click="previewFee">{{ fee.busy ? "Membuat PDF…" : "Preview PDF" }}</button>
        </div>
      </template>

      <template v-else>
        <iframe :src="fee.pdfUrl" :title="`Preview PDF fee ${fee.person.employee.name}`" class="mt-4 h-[65vh] w-full rounded-xl border border-border bg-panel-hover"></iframe>
        <div class="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" class="mr-auto min-h-12 rounded-xl px-5 text-sm font-semibold text-text-muted hover:bg-panel-hover" :disabled="fee.busy" @click="backToPercents">Kembali</button>
          <button type="button" class="min-h-12 rounded-xl border border-border px-5 text-sm font-bold text-text hover:bg-panel-hover" @click="downloadFee">Download PDF</button>
          <button type="button" class="min-h-12 rounded-xl border border-border px-5 text-sm font-bold text-text hover:bg-panel-hover disabled:opacity-60" :disabled="fee.busy" @click="sendFee">Kirim ke WhatsApp</button>
          <button type="button" class="min-h-12 rounded-xl bg-accent px-5 text-sm font-bold text-white hover:bg-accent-hover disabled:opacity-60" :disabled="fee.busy" @click="finalizeFee">Finalisasi</button>
        </div>
      </template>
    </div>
  </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  ApiError,
  feesApi,
  projectsApi,
  showToast,
  type FeeGroup,
  type FeeGroupTotal,
  type FeePerson,
  type PaymentStatus,
  type PaymentType,
  type Project,
  type ProjectInput,
  type ProjectMemberRole,
  type ProjectPerson,
  type ProjectStatus,
  type ProjectType,
} from "../api";
import { localIsoDate } from "../dates";
import { isAdmin } from "../session";

type FormMember = ProjectInput["members"][number];

const PROJECT_TYPE_LABEL: Record<ProjectType, string> = { development: "Development", design: "Design" };
const STATUS_LABEL: Record<ProjectStatus, string> = { ongoing: "Ongoing", completed: "Completed", cancelled: "Batal" };
const PAYMENT_TYPE_LABEL: Record<PaymentType, string> = { fixed: "Fixed", hourly: "Hourly" };
const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { pending: "Pending", accepted: "Accepted", paid: "Dibayar ke tim" };
const STATUS_BADGE: Record<ProjectStatus, string> = {
  ongoing: "bg-warning/8 text-warning border-warning/20",
  completed: "bg-success/8 text-success border-success/20",
  cancelled: "bg-text-muted/10 text-text-dim border border-border",
};
const PAYMENT_BADGE: Record<PaymentStatus, string> = {
  pending: "bg-text-muted/10 text-text-dim border border-border",
  accepted: "bg-accent/8 text-accent border-accent/20",
  paid: "bg-success/8 text-success border-success/20",
};
const MEMBER_ROLES: { id: ProjectMemberRole; label: string }[] = [
  { id: "pm_sales", label: "PM & Sales" },
  { id: "designer", label: "Designer" },
  { id: "developer", label: "Developer" },
];
const inputClass =
  "min-h-12 rounded-xl border border-border bg-panel px-4 text-base placeholder-text-dim focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/20 focus-visible:outline-none";
const labelClass = "mb-1.5 block text-[11px] font-extrabold uppercase tracking-wider text-text-dim";

const projects = ref<Project[]>([]);
const people = ref<ProjectPerson[]>([]);
const loading = ref(false);
const error = ref("");
const search = ref("");
const typeFilter = ref<ProjectType | "">("");
const statusFilter = ref<ProjectStatus | "">("");
const paymentFilter = ref<PaymentStatus | "">("");
// "paid": every member's bonus finalized; "unpaid": someone's is still open.
const bonusFilter = ref<"" | "paid" | "unpaid">("");
const bonusPaid = (p: Project) => p.members.length > 0 && p.members.every((m) => m.bonusPaidAt);

// Date filter: a preset fills the range; editing a date by hand makes it "custom".
type Period = "this_month" | "last_month" | "this_year" | "all" | "custom";
const PERIOD_LABEL: Record<Period, string> = {
  this_month: "Bulan ini",
  last_month: "Bulan lalu",
  this_year: "Tahun ini",
  all: "Semua tanggal",
  custom: "Custom",
};
function periodRange(p: Period): [string, string] | null {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  if (p === "this_month") return [localIsoDate(new Date(y, m, 1)), localIsoDate(new Date(y, m + 1, 0))];
  if (p === "last_month") return [localIsoDate(new Date(y, m - 1, 1)), localIsoDate(new Date(y, m, 0))];
  if (p === "this_year") return [`${y}-01-01`, `${y}-12-31`];
  if (p === "all") return ["", ""];
  return null;
}
const period = ref<Period>("this_month");
const [defaultFrom, defaultTo] = periodRange("this_month")!;
const dateFrom = ref(defaultFrom);
const dateTo = ref(defaultTo);
watch(period, (p) => {
  const range = periodRange(p);
  if (range) [dateFrom.value, dateTo.value] = range;
});

const form = ref<ProjectInput | null>(null);
const formEl = ref<HTMLFormElement | null>(null);
const editingId = ref<string | null>(null);
const saving = ref(false);
// Highlights invalid fields only once the user has tried to save.
const triedSave = ref(false);

function message(err: unknown, fallback: string) {
  if (err instanceof ApiError && err.status === 403) return "Hanya PM, Admin, atau Owner yang bisa mengelola project.";
  return err instanceof ApiError ? err.message : fallback;
}

async function load() {
  loading.value = true;
  error.value = "";
  try {
    [projects.value, people.value] = await Promise.all([projectsApi.list(), projectsApi.people()]);
  } catch (err) {
    error.value = message(err, "Gagal memuat project.");
  } finally {
    loading.value = false;
  }
  loadFees();
}
onMounted(load);

// ---- List ----

// A project matches when its run overlaps the range: no end date means still
// running, and one without any dates counts on the day it was last updated.
function inDateRange(p: Project) {
  const start = p.startDate ?? p.endDate ?? localIsoDate(new Date(p.updatedAt));
  const end = p.endDate ?? (p.startDate ? "9999-12-31" : start);
  return (!dateTo.value || start <= dateTo.value) && (!dateFrom.value || end >= dateFrom.value);
}

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  return projects.value.filter(
    (p) =>
      (!typeFilter.value || p.type === typeFilter.value) &&
      (!statusFilter.value || p.status === statusFilter.value) &&
      (!paymentFilter.value || p.paymentStatus === paymentFilter.value) &&
      (!bonusFilter.value || (bonusFilter.value === "paid") === bonusPaid(p)) &&
      inDateRange(p) &&
      (!q || [p.name, p.platform, ...p.members.map((m) => m.employeeName)].some((s) => s.toLowerCase().includes(q))),
  );
});
const counted = computed(() => filtered.value.filter((p) => p.status !== "cancelled"));

type Totals = Record<string, number>; // per currency
const add = (t: Totals, currency: string, n: number) => {
  t[currency] = Math.round(((t[currency] ?? 0) + n) * 100) / 100;
};

const totals = computed(() => {
  // Fee diterima: what is left after the platform's cut, the base members split.
  const received: Totals = {};
  for (const p of counted.value) add(received, p.currency, p.splitBase);
  const ofType = (t: ProjectType) => counted.value.filter((p) => p.type === t).length;
  return { received, design: ofType("design"), development: ofType("development") };
});

const perPerson = computed(() => {
  const map = new Map<string, { employeeId: string; name: string; projects: Set<string>; total: Totals }>();
  for (const p of counted.value) {
    for (const m of p.members) {
      const entry = map.get(m.employeeId) ?? { employeeId: m.employeeId, name: m.employeeName, projects: new Set(), total: {} };
      entry.projects.add(p.id);
      add(entry.total, p.currency, m.fee);
      map.set(m.employeeId, entry);
    }
  }
  return [...map.values()]
    .map((e) => ({ ...e, projects: e.projects.size }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

const platforms = computed(() => [...new Set(["Upwork", "Fiverr", "Direct", ...projects.value.map((p) => p.platform)])]);

function membersOf(p: Project, role: ProjectMemberRole) {
  return p.members.filter((m) => m.role === role);
}

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency, maximumFractionDigits: 2 }).format(n || 0);
  } catch {
    return `${currency} ${(n || 0).toLocaleString("id-ID")}`;
  }
}
function formatTotals(t: Totals) {
  const entries = Object.entries(t);
  return entries.length ? entries.map(([c, n]) => money(n, c)).join(" + ") : money(0, "USD");
}
function formatDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}
function dateRange(p: Project) {
  if (!p.startDate && !p.endDate) return "Tanggal belum diisi";
  return `${p.startDate ? formatDate(p.startDate) : "?"} – ${p.endDate ? formatDate(p.endDate) : "sekarang"}`;
}

async function remove(p: Project) {
  if (!confirm(`Hapus project "${p.name}" beserta pembagian fee-nya?`)) return;
  try {
    await projectsApi.remove(p.id);
    projects.value = projects.value.filter((x) => x.id !== p.id);
    showToast("Project dihapus.", "success");
  } catch (err) {
    showToast(message(err, "Gagal menghapus project."), "error");
  }
}

// ---- Editor ----

// The button that opened the editor gets focus back when it closes.
let editorOpener: HTMLElement | null = null;

function openEditor(p: Project | null) {
  editorOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  editingId.value = p?.id ?? null;
  triedSave.value = false;
  form.value = p
    ? {
        platform: p.platform,
        name: p.name,
        type: p.type,
        startDate: p.startDate,
        endDate: p.endDate,
        status: p.status,
        paymentType: p.paymentType,
        currency: p.currency,
        feeReceived: p.feeReceived,
        platformFeePercent: p.platformFeePercent,
        totalFee: p.totalFee,
        paymentStatus: p.paymentStatus,
        notes: p.notes,
        members: p.members.map((m) => ({ employeeId: m.employeeId, role: m.role, sharePercent: m.sharePercent })),
      }
    : {
        platform: "Upwork",
        name: "",
        type: "development",
        startDate: null,
        endDate: null,
        status: "ongoing",
        paymentType: "fixed",
        currency: "USD",
        feeReceived: 0,
        platformFeePercent: 10,
        totalFee: null,
        paymentStatus: "pending",
        notes: null,
        members: [],
      };
  // Move focus into the dialog: the first field (the name).
  nextTick(() => formEl.value?.querySelector<HTMLElement>("input, select, textarea")?.focus());
}
function closeEditor() {
  form.value = null;
  editingId.value = null;
  editorOpener?.focus();
  editorOpener = null;
}

// Keep Tab inside a dialog: wrap from the last focusable to the first and back.
function trapTabIn(event: KeyboardEvent, root: HTMLElement | null) {
  const focusable = Array.from(
    root?.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ?? [],
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

// Empty input means "use fee received", stored as null.
const totalFeeInput = computed({
  get: () => form.value?.totalFee ?? "",
  set: (v: number | string) => {
    if (form.value) form.value.totalFee = v === "" || v === null ? null : Number(v);
  },
});

const preview = computed(() => {
  const f = form.value;
  if (!f) return { cut: 0, auto: 0, base: 0 };
  const received = Number(f.feeReceived) || 0;
  const cut = Math.round(received * Math.min(Number(f.platformFeePercent) || 0, 99)) / 100;
  const auto = Math.round((received - cut) * 100) / 100;
  return { cut, auto, base: f.totalFee ?? auto };
});
const totalFeeTooHigh = computed(() => !!form.value && form.value.totalFee != null && form.value.totalFee > (Number(form.value.feeReceived) || 0));

// Same rounding as the API: cents, leftover cents to the largest remainders,
// so shares adding up to 100% pay out the split base exactly.
const previewFees = computed(() => {
  const members = form.value?.members ?? [];
  const base = preview.value.base;
  const exact = members.map((m) => Math.round(base * (Number(m.sharePercent) || 0) * 1e6) / 1e6);
  const cents = exact.map(Math.floor);
  let left = Math.round(exact.reduce((s, c) => s + c, 0)) - cents.reduce((s, c) => s + c, 0);
  const order = exact.map((_, k) => k).sort((a, b) => exact[b]! - cents[b]! - (exact[a]! - cents[a]!));
  for (const k of order) {
    if (left <= 0) break;
    cents[k]! += 1;
    left -= 1;
  }
  return new Map(members.map((m, k) => [m, cents[k]! / 100]));
});

// Every member's percent is a part of the one fee received; together they may pass 100%.
const round2 = (n: number) => Math.round(n * 100) / 100;
const sumShares = (members: FormMember[]) => round2(members.reduce((s, m) => s + (Number(m.sharePercent) || 0), 0));
const shareTotal = computed(() => sumShares(form.value?.members ?? []));
function formMembers(role: ProjectMemberRole) {
  return form.value?.members.filter((m) => m.role === role) ?? [];
}
// PM & Sales start at 50% of the split fee, others at what is left, never past 100%.
function addMember(role: ProjectMemberRole) {
  const left = Math.max(0, round2(100 - shareTotal.value));
  form.value?.members.push({ employeeId: "", role, sharePercent: role === "pm_sales" ? Math.min(50, left) : left });
}
function removeMember(m: FormMember) {
  if (form.value) form.value.members = form.value.members.filter((x) => x !== m);
}
// Splits what the other roles leave over evenly within this role.
function splitEvenly(role: ProjectMemberRole) {
  const own = formMembers(role);
  const available = Math.max(0, round2(100 - sumShares(form.value?.members.filter((m) => m.role !== role) ?? [])));
  const each = Math.floor((available / own.length) * 100) / 100;
  own.forEach((m, i) => (m.sharePercent = i === own.length - 1 ? round2(available - each * (own.length - 1)) : each));
}
// Active people, plus whoever is already picked (they may have been deactivated since).
function peopleFor(m: FormMember) {
  const taken = new Set(formMembers(m.role).filter((x) => x !== m).map((x) => x.employeeId));
  return people.value.filter((p) => (p.isActive || p.id === m.employeeId) && !taken.has(p.id));
}

// The browser's own "Please fill out this field" doesn't say which field (and
// can point at one scrolled out of the dialog), so name it and scroll to it.
// Fields only: a <fieldset> holding an invalid field matches :invalid too.
function invalidField() {
  const el = formEl.value?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input:invalid, select:invalid, textarea:invalid",
  );
  if (!el) return null;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
  const labelEl = el.labels?.[0];
  const label = (labelEl?.querySelector("span") ?? labelEl)?.textContent?.trim() || "field";
  const role = el.closest("fieldset")?.querySelector("legend")?.textContent?.trim();
  if (el instanceof HTMLSelectElement && el.id.startsWith("member-")) {
    return `${role ?? "Anggota"} belum dipilih orangnya. Pilih orangnya, atau hapus barisnya.`;
  }
  if (el.closest("li") && role) {
    return el.validity.valueMissing ? `Persen ${role} wajib diisi.` : `Persen ${role} belum valid: ${el.validationMessage}`;
  }
  if (el.validity.valueMissing) return `"${label}" wajib diisi.`;
  return `"${label}" belum valid: ${el.validationMessage}`;
}

async function save() {
  if (!form.value) return;
  triedSave.value = true;
  const problem = invalidField();
  if (problem) {
    showToast(problem, "error");
    return;
  }
  if (totalFeeTooHigh.value) {
    showToast("Fee diterima tidak boleh lebih dari fee.", "error");
    return;
  }
  saving.value = true;
  try {
    const input: ProjectInput = {
      ...form.value,
      startDate: form.value.startDate || null,
      endDate: form.value.endDate || null,
      notes: form.value.notes?.trim() || null,
    };
    if (editingId.value) await projectsApi.update(editingId.value, input);
    else await projectsApi.create(input);
    showToast("Project disimpan.", "success");
    closeEditor();
    await load();
  } catch (err) {
    showToast(message(err, "Gagal menyimpan project."), "error");
  } finally {
    saving.value = false;
  }
}

// ---- Fee (Owner and Admin) ----

const GROUP_LABEL: Record<FeeGroup, string> = {
  pm: "PM & Sales",
  maker: "Designer / Developer",
  lead_design: "Lead Designer",
  lead_development: "Lead Developer",
};
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

// The fee period follows the date filter; an open end means up to today,
// an open start the first of that month (older unpaid projects carry over).
const feeRange = computed(() => {
  const to = dateTo.value || localIsoDate(new Date());
  const from = dateFrom.value && dateFrom.value <= to ? dateFrom.value : `${to.slice(0, 8)}01`;
  return { from, to };
});
const feePeriodText = computed(() => {
  const { from, to } = feeRange.value;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  if (fy === ty && fm === tm && fd === 1 && td === new Date(ty!, tm!, 0).getDate()) return `${MONTHS[fm! - 1]} ${fy}`;
  return `${formatDate(from)} – ${formatDate(to)}`;
});

const feePeople = ref<FeePerson[]>([]);
let feeSeq = 0;
async function loadFees() {
  if (!isAdmin.value) return;
  const seq = ++feeSeq;
  try {
    const overview = await feesApi.overview(feeRange.value.from, feeRange.value.to);
    if (seq === feeSeq) feePeople.value = overview.people;
  } catch {
    // The recap still works without the fee column's numbers.
    if (seq === feeSeq) feePeople.value = [];
  }
}
watch([feeRange, isAdmin], loadFees);

function feeOf(employeeId: string) {
  return feePeople.value.find((f) => f.employee.id === employeeId) ?? null;
}
const feeEligible = (f: FeePerson) => f.statement.groups.some((g) => g.eligible);

const fee = ref<{ person: FeePerson; percents: Partial<Record<FeeGroup, number>>; pdf: Blob | null; pdfUrl: string; busy: boolean } | null>(null);
const feeEl = ref<HTMLElement | null>(null);
let feeOpener: HTMLElement | null = null;

// Percents start at the tier table's.
function openFee(person: FeePerson) {
  feeOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const percents: Partial<Record<FeeGroup, number>> = {};
  for (const g of person.statement.groups) if (g.eligible) percents[g.group] = g.tierPercent;
  fee.value = { person, percents, pdf: null, pdfUrl: "", busy: false };
  nextTick(() => feeEl.value?.querySelector<HTMLElement>("input")?.focus());
}
function clearPdf() {
  if (fee.value?.pdfUrl) URL.revokeObjectURL(fee.value.pdfUrl);
  if (fee.value) Object.assign(fee.value, { pdf: null, pdfUrl: "" });
}
function closeFee() {
  clearPdf();
  fee.value = null;
  feeOpener?.focus();
  feeOpener = null;
}
function backToPercents() {
  clearPdf();
  nextTick(() => feeEl.value?.querySelector<HTMLElement>("input")?.focus());
}

function feePercent(g: FeeGroupTotal) {
  // A cleared input (v-model.number leaves "") falls back to the table.
  const n = fee.value?.percents[g.group];
  return typeof n === "number" && Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : g.tierPercent;
}
function feeBonus(g: FeeGroupTotal) {
  return g.eligible ? round2((g.base * feePercent(g)) / 100) : 0;
}
const feeTotal = computed(() => round2((fee.value?.person.statement.groups ?? []).reduce((s, g) => s + feeBonus(g), 0)));

// Only percents that differ from the table are sent.
function feeInput() {
  const f = fee.value!;
  const percents: Partial<Record<FeeGroup, number>> = {};
  for (const g of f.person.statement.groups) {
    if (g.eligible && feePercent(g) !== g.tierPercent) percents[g.group] = feePercent(g);
  }
  return { ...feeRange.value, employeeId: f.person.employee.id, percents };
}

async function previewFee() {
  const f = fee.value;
  if (!f) return;
  f.busy = true;
  try {
    const pdf = await feesApi.pdf(feeInput());
    if (fee.value !== f) return;
    f.pdf = pdf;
    f.pdfUrl = URL.createObjectURL(pdf);
  } catch (err) {
    showToast(message(err, "Gagal membuat PDF."), "error");
  } finally {
    f.busy = false;
  }
}

function downloadFee() {
  const f = fee.value;
  if (!f?.pdfUrl) return;
  const a = document.createElement("a");
  a.href = f.pdfUrl;
  a.download = `Fee ${feePeriodText.value} - ${f.person.employee.name}.pdf`;
  a.click();
}

async function sendFee() {
  const f = fee.value;
  if (!f || !confirm(`Kirim PDF fee ${feePeriodText.value} ke ${f.person.employee.name} (${f.person.employee.phone}) lewat WhatsApp?`)) return;
  f.busy = true;
  try {
    await feesApi.send(feeInput());
    showToast(`PDF fee terkirim ke ${f.person.employee.name}.`, "success");
  } catch (err) {
    showToast(message(err, "Gagal mengirim lewat WhatsApp."), "error");
  } finally {
    f.busy = false;
  }
}

// Marks the eligible groups paid: their projects stop counting toward later fees.
async function finalizeFee() {
  const f = fee.value;
  if (!f) return;
  const lines = f.person.statement.groups
    .filter((g) => g.eligible)
    .map((g) => `${GROUP_LABEL[g.group]}: ${feePercent(g)}% × ${money(g.base, "USD")} = ${money(feeBonus(g), "USD")}`);
  if (!confirm(`Finalisasi fee ${f.person.employee.name}?\n\n${lines.join("\n")}\n\nProject-nya ditandai sudah dibayar dan tidak dihitung lagi.`)) return;
  f.busy = true;
  try {
    await feesApi.finalize(feeInput());
    showToast(`Fee ${f.person.employee.name} difinalisasi.`, "success");
    closeFee();
    await load();
  } catch (err) {
    showToast(message(err, "Gagal finalisasi."), "error");
    f.busy = false;
  }
}
</script>
