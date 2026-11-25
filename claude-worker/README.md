# claude-worker

Claude Code sebagai orkestrator dan pekerja untuk papan Kanban Hermes. Hermes hanya
menyimpan papan dan kantor Naya (`kanban.dispatch_in_gateway: false`,
`kanban.auto_decompose: false`, lihat [`hermes/`](../hermes/README.md)); skrip ini
yang berpikir.

Setiap kali jalan (tiap menit, dengan lock agar tidak tumpang tindih), papan dikerjakan
sampai habis, maksimal 30 aksi:

1. Ada tugas di `triage` → Claude memutuskan dikerjakan langsung atau dipecah menjadi
   2–5 subtugas berurutan.
2. Jika tidak, satu tugas `ready` (prioritas tertinggi dulu) → Claude mengerjakannya,
   menulis hasil sebagai komentar, lalu `complete`, `request-review` (jika instruksi
   meminta review manusia), atau `block` (butuh masukan).

Tugas yang gagal dikembalikan ke antrean dan baru dicoba lagi pada run berikutnya.
Begitu sebuah kartu masuk review, worker langsung meminta API daily mengirim WhatsApp
serah terima ke PIC (lihat env di bawah). Tanpa env itu, WhatsApp tetap terkirim lewat
pengecekan 10 menit di worker daily.

## Roster agent

Setiap bagian kartu dikerjakan oleh satu agent dari roster Naya (blueprint v3), yaitu
[`packages/shared/src/naya-roster.json`](../packages/shared/src/naya-roster.json). Saat memecah,
Claude bertindak sebagai Naya Core: ia memilih agent untuk tiap subtugas dan untuk penyusun hasil
akhir, berdasarkan input dan output di kontraknya. Kode agent menjadi assignee task di Hermes.
Saat mengerjakan task, kontrak agent itu (peran, input, output, siapa yang mereview, dan
instruksinya) masuk ke system prompt. Agent bertanda `available: false` (butuh internet, GitHub,
dan sebagainya) tidak pernah dipilih. Assignee yang tidak dikenal, misalnya profil Hermes lama,
dikerjakan oleh Generalis.

Di server, salin roster ke sebelah skrip dengan nama `roster.json`. Tanpa file itu, semua task
dikerjakan Generalis seperti sebelumnya:

```sh
scp -P <port> packages/shared/src/naya-roster.json root@<host>:/root/team-assistant/claude-worker/roster.json
```

Claude dijalankan tanpa tool (`--tools ""`): teks tugas hanyalah data, dan tidak ada
akses kode, shell, maupun internet.

## Pasang di VPS

Prasyarat: Claude Code terpasang dan sudah login untuk `root` (`/root/.local/bin/claude`),
dan folder ini berada di sebelah `docker-compose.prod.yml` (mis.
`/root/team-assistant/claude-worker/`).

Crontab `root`:

```cron
* * * * * cd /root/team-assistant/claude-worker && PATH=/root/.local/bin:/usr/local/bin:/usr/bin:/bin NAYA_NOTIFY_URL=http://localhost:4000/naya/notify INTERNAL_API_TOKEN=… NAYA_WORKSPACE_ID=… /usr/bin/python3 worker.py >> worker.log 2>&1
```

Saat antrean kosong, satu run hanya menjalankan satu `kanban list`. Tiga env terakhir
opsional:

- `NAYA_NOTIFY_URL`: endpoint `/naya/notify` API daily, dilihat dari host.
- `INTERNAL_API_TOKEN`: sama dengan yang dipakai API.
- `NAYA_WORKSPACE_ID`: id workspace Naya.

File yang dibuat saat berjalan (tidak masuk git): `worker.log`, `.lock`, dan `work/`
(direktori kerja Claude yang sengaja kosong). Tugas yang masih `running` saat run baru
mulai adalah klaim dari run yang mati (deploy, crash) dan dikembalikan ke antrean;
`hermes kanban` dicoba ulang beberapa kali saat container Hermes sedang di-restart.
