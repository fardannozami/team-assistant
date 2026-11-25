# claude-worker

Claude Code sebagai orkestrator dan pekerja untuk papan Kanban Hermes. Hermes hanya
menyimpan papan dan kantor Naya (`kanban.dispatch_in_gateway: false`,
`kanban.auto_decompose: false`, lihat [`hermes/`](../hermes/README.md)); skrip ini
yang berpikir.

Setiap kali jalan, satu aksi saja (dengan lock agar tidak tumpang tindih):

1. Ada tugas di `triage` → Claude memutuskan dikerjakan langsung atau dipecah menjadi
   2–5 subtugas berurutan.
2. Jika tidak, satu tugas `ready` (prioritas tertinggi dulu) → Claude mengerjakannya,
   menulis hasil sebagai komentar, lalu `complete`, `request-review` (jika instruksi
   meminta review manusia), atau `block` (butuh masukan).

Claude dijalankan tanpa tool (`--tools ""`): teks tugas hanyalah data, dan tidak ada
akses kode, shell, maupun internet.

## Pasang di VPS

Prasyarat: Claude Code terpasang dan sudah login untuk `root` (`/root/.local/bin/claude`),
dan folder ini berada di sebelah `docker-compose.prod.yml` (mis.
`/root/team-assistant/claude-worker/`).

Crontab `root`:

```cron
*/10 * * * * cd /root/team-assistant/claude-worker && PATH=/root/.local/bin:/usr/local/bin:/usr/bin:/bin /usr/bin/python3 worker.py >> worker.log 2>&1
```

File yang dibuat saat berjalan (tidak masuk git): `worker.log`, `.lock`, `state.json`
(tugas yang sedang diklaim; jika proses mati, run berikutnya mengembalikannya ke
antrean), dan `work/` (direktori kerja Claude yang sengaja kosong).
