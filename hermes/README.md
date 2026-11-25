# Profil Hermes: tim AI

Tiga profil Hermes untuk stack `team-assistant`:

| ID profil | Nama tampilan | Peran | Model |
|---|---|---|---|
| `default` | Asisten Umum | Orkestrator utama, pintu masuk pengguna; juga mengerjakan desain/implementasi | `gemini-3.5-flash-lite` |
| `ceo` | CEO | Orkestrator strategi & koordinasi; boleh mendelegasikan | `gemini-3.5-flash-lite` |
| `pm` | PM | Sub-agent: spesifikasi, user story, acceptance criteria | `gemini-3.5-flash-lite` |

Semua model berada di free tier Gemini. `gemini-3.5-flash-lite` dipakai karena
`gemini-2.5-flash-lite` dan `gemini-2.5-flash` sudah tidak tersedia untuk kunci API
baru (HTTP 404 "no longer available to new users"). Untuk mengganti semua profil ke model
free-tier lain (mis. `gemini-3.5-flash`), jalankan skrip dengan:

```bash
HERMES_MODEL=gemini-3.5-flash ./hermes/setup-team-profiles.sh
```

## Isi direktori

```text
hermes/
├── README.md
├── setup-team-profiles.sh
└── profiles/
    ├── default/{profile.yaml,SOUL.md,config.yaml}
    ├── ceo/{profile.yaml,SOUL.md,config.yaml}
    └── pm/{profile.yaml,SOUL.md,config.yaml}
```

- `SOUL.md` = kepribadian dan batas peran.
- `profile.yaml` = `display_name` + deskripsi yang dipakai Kanban decomposer
  untuk routing berdasarkan peran.
- `config.yaml` = **dokumentasi referensi** nilai yang diterapkan skrip. Skrip
  sengaja memakai `hermes config set` agar tidak menimpa konfigurasi lain di
  profil yang sudah ada.

## Cara pasang di VPS

Jalankan dari direktori proyek yang berisi `docker-compose.prod.yml`:

```bash
./hermes/setup-team-profiles.sh
```

Skrip akan:

1. Membuat profile `ceo` dan `pm` jika belum ada.
2. Menyalin `SOUL.md` dan `profile.yaml` ke `/opt/data/profiles/<name>/` dan
   `/opt/data/` untuk `default`. File lama dibackup otomatis dengan suffix
   `.bak.<timestamp>`.
3. Mengubah display name `default` menjadi **Asisten Umum** (ID tetap
   `default`, sesuai batasan Hermes).
4. Menetapkan deskripsi tiap profil untuk routing Kanban.
5. Menyetel `model.provider: gemini`, `model.default: gemini-3.5-flash-lite`,
   serta aturan delegasi: `default`/`ceo` sebagai orkestrator, `pm`
   sebagai leaf worker (`orchestrator_enabled: false`, `max_spawn_depth: 1`).
6. Menyetel Kanban global di profil `default`: `auto_decompose: true`,
   `orchestrator_profile: default`, `default_assignee: default`,
   `review_dispatch: false` (review tetap dilakukan manusia di Naya).
7. Mengaktifkan toolset `kanban` hanya untuk `default` dan `ceo`.
8. Menyalin kunci Gemini ke `.env` tiap profil. Kunci diambil dari env
   `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `AI_API_KEY`, lalu dari `.env` profil
   yang sudah ada, atau diminta interaktif jika tidak ada.

Setelah selesai, restart gateway:

```bash
docker compose restart hermes
```

### Gateway platform

Secara default toolset `kanban` aktif untuk CLI/TUI/Desktop. Jika agen dipakai
melalui platform gateway, ulangi skrip dengan platform tersebut:

```bash
HERMES_PLATFORM=telegram ./hermes/setup-team-profiles.sh
```

`HERMES_PLATFORM` bisa diisi `telegram`, `discord`, `slack`, dan sebagainya
sesuai nama platform di konfigurasi Hermes.

## Verifikasi

```bash
docker compose exec hermes hermes profile list
docker compose exec hermes hermes profile describe default
docker compose exec hermes hermes profile describe ceo
docker compose exec hermes hermes config get model --json
docker compose exec hermes hermes tools list
```

Contoh alur:

1. Kirim permintaan ke Asisten Umum (`default`).
2. Asisten Umum membuat card Kanban di `triage` dan memecahnya.
3. Decomposer membaca deskripsi profil lalu menugaskan ke `pm` atau mengerjakannya
   di `default`.
4. CEO dapat dipanggil untuk keputusan prioritas/strategi dan ikut mendelegasikan.

Profil `designer` dan `developer` sempat dibuat lalu dihapus agar beban CPU
container `hermes` tetap rendah (setiap profil menambah gateway dan memperlambat
`hermes profile list`).
5. Worker menyelesaikan tugas lewat tool `kanban_*`; manusia melakukan review
   di dashboard Naya (`review_dispatch: false`).

## Catatan

- Skrip ini tidak dijalankan otomatis oleh orchestrator ini karena workspace
  lokal hanya berisi `.env` dan `docker-compose.prod.yml`, tanpa akses ke volume
  `hermes-data` di VPS.
- File `config.yaml` di direktori ini tidak disalin mentah-mentah. Jika ingin
  menerapkannya secara manual, gunakan `hermes config set` seperti yang dilakukan
  skrip agar pengaturan lain tidak hilang.
- Kunci API tidak disimpan di repository; hanya ditulis ke `.env` di dalam
  volume `hermes-data`.
