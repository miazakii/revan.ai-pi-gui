# pi-gui

GUI web untuk [pi](https://github.com/earendil-works/pi) lewat **RPC mode** (`pi --mode rpc`).
Frontend memakai **React + Vite + Tailwind CSS v4 + shadcn/ui**; backend bridge tetap Node ≥ 20 tanpa framework.

```
Browser  ──SSE (event) + POST (command)──►  server.mjs  ──JSONL stdin/stdout──►  pi --mode rpc
```

## Jalankan

```bash
cd ~/pi-gui
npm install --prefix frontend
npm run build
npm start
# buka URL yang dicetak, contoh:
# http://127.0.0.1:4789/#t=<token>
```

Setelah `frontend/dist` dibuat, menjalankan `npm start`/`node server.mjs` tidak butuh dependency frontend lagi.
Untuk development UI dengan hot reload:

```bash
cd ~/pi-gui
npm run dev            # terminal 1: backend di :4789
npm run dev:frontend   # terminal 2: Vite di :5173, proxy /api ke :4789
# buka http://127.0.0.1:5173/#t=<token-dari-backend>
```

Workspace default = `$HOME`. Ganti lewat env atau kolom `cwd` di toolbar (Enter untuk pindah;
proses pi di-restart dengan cwd baru).

| Env | Default | Keterangan |
|---|---|---|
| `PORT` | `4789` | port HTTP (selalu bind `127.0.0.1`) |
| `PI_CWD` | `$HOME` | workspace awal |
| `PI_BIN` | `pi` | path binary/CLI pi |
| `PI_GUI_TOKEN` | token stabil di `~/.pi/pi-gui/token` | override token API (opsional; jangan pakai nilai lemah) |
| `PI_GUI_STATE_DIR` | `~/.pi/pi-gui` | folder token + `projects.json` (berguna untuk tes terisolasi) |

Token disimpan di `~/.pi/pi-gui/token` (mode `0600`) supaya URL tetap sama antar-restart,
lalu ditempel di fragment (`#t=`) agar tidak ikut ke server/Referer. Query lama `?t=` masih
diterima. Token juga disimpan di `sessionStorage`, jadi refresh tetap jalan. Kalau env
`PI_GUI_TOKEN` diisi, nilai itu yang dipakai dan token file diabaikan; server mencetak peringatan
saat sumbernya env.

Event stream memakai `fetch` + header `Authorization`, bukan `EventSource`, supaya token tidak
muncul di query string dan status 401 bisa ditangani.

## Cara pakai

**1. Nyalakan server** (dari terminal mana pun):

```bash
cd ~/pi-gui && node server.mjs
```

**2. Buka URL yang dicetak**, contoh `http://127.0.0.1:4789/#t=b509…`. Token stabil antar-restart;
kalau ingin memakai token sendiri:

```bash
PI_GUI_TOKEN="$(openssl rand -hex 16)" node ~/pi-gui/server.mjs   # token acak, bukan `pi`
```

**3. Pilih workspace.** Default `$HOME`. Ketik path lain di kolom `cwd` lalu Enter — proses pi
di-restart di folder itu (riwayat per folder tetap terpisah).

**4. Ngobrol.** Tulis di kotak bawah, `Enter` kirim, `Shift+Enter` baris baru. Selama agent
bekerja:

| Aksi | Cara |
|---|---|
| Hentikan run | tombol `stop` atau `Esc` di kotak input (sekaligus mengosongkan queue dan mengembalikan teksnya ke editor) |
| Sisipkan instruksi baru | pilih `steer`, lalu kirim |
| Antre pesan setelah selesai | pilih `follow-up`, lalu kirim |
| Lihat args/output tool | klik kartu tool (`bash`, `read`, `edit`, …) |
| Lihat diff | kartu `edit`/`write` — badge `+n −m`, output mentah di dalamnya |
| Lihat proses berpikir | buka `thinking (n char)` |
| Command/skill/template | ketik `/`, pilih dengan `↑` `↓` + `Enter` |
| Kirim screenshot | `⌘V` di kotak input, atau drag & drop gambar |

**5. Sidebar** (tombol panel di kiri atas):

- tab **sesi** — semua sesi di workspace ini; klik untuk pindah. `fork` menandai sesi hasil fork.
  Tombol `rename` di bawah sidebar memberi nama sesi aktif (`set_session_name`). Tombol `×`
  di setiap sesi non-aktif menghapus file sesi setelah konfirmasi; sesi aktif tidak bisa dihapus.
  Tombol `pilih` mengaktifkan mode pilih-banyak: centang beberapa sesi (atau `pilih semua`), lalu
  `hapus (n)` untuk menghapus semuanya sekaligus. `batal` keluar dari mode pilih.
- **proyek** — tombol `+ proyek` membuat kelompok bernama. Tarik sesi (pegangan titik-titik di kiri baris)
  ke header/isi proyek untuk memindahkannya; tarik ke **tanpa proyek** untuk melepas. Proyek bisa
  diganti nama (ikon pensil) atau dihapus (ikon tempat sampah) — file sesi tidak ikut terhapus. Klik header untuk
  melipat/membuka grup (status disimpan di `localStorage`).
- tab **tree** — percabangan sesi aktif; klik pesan **user** untuk fork dari titik itu (teks pesan
  otomatis masuk ke editor), tombol `clone` untuk menduplikat branch sekarang.

**6. Toolbar kanan atas:** `baru` (sesi baru), `compact` (ringkas konteks), `export` (simpan
HTML), `stop` (hentikan run + kosongkan queue). Pemilih model & thinking level ada di sebelah
kolom `cwd`.

**7. Matikan** dengan `Ctrl+C` di terminal server.

Kalau `pi` belum pernah login di mesin ini, jalankan `pi` sekali di terminal dulu supaya kredensial
model tersimpan; GUI memakai config `.pi` yang sama.

## Fitur

- tampilan baru berbasis **shadcn/ui** (Button, Input, Native Select, Dialog/Alert Dialog, Sidebar, Tabs, Collapsible, Command, Sonner, Badge, Card, Alert, Empty)
- streaming teks + indikator thinking, tool call/result sebagai kartu yang bisa dibuka
- **Markdown GFM penuh** (tabel, task list, strikethrough) + **syntax highlight** (highlight.js) + tombol copy per blok kode
- **diff viewer** untuk `edit`/`write` (badge `+n −m`, output mentah tetap tersedia)
- **lampiran gambar**: paste (⌘V) atau drag & drop ke composer, terkirim sebagai `ImageContent`
- **menu slash command** (`/`) dari `get_commands`: extension commands, prompt template, skill
- **sidebar**: daftar sesi workspace (klik untuk pindah), **pengelompokan proyek + drag & drop**, dan tree sesi aktif (klik pesan user untuk fork)
- fork / clone / hapus sesi non-aktif, rename sesi aktif (`set_session_name`), pemilih model, thinking level, abort, queue steer/follow-up, compaction, export HTML
- riwayat sesi dipulihkan lewat `get_messages` (sesi persisten, sama seperti CLI)
- dialog extension (`select` / `confirm` / `input` / `editor`), `notify`, `setStatus`, `setWidget`
- footer token/context/cost dari `get_session_stats`

## Struktur

| File | Isi |
|---|---|
| `server.mjs` | spawn pi, framing JSONL, korelasi `id`, SSE, auth token, static server, daftar/hapus sesi, proyek (metadata GUI) |
| `frontend/src/App.jsx` | state cermin React, event SSE, command RPC, sidebar, proyek, lampiran, slash menu |
| `frontend/src/components/` | komponen aplikasi: `TopBar`, `AppSidebar`, `Transcript`, `Composer`, `Modal`, `Markdown` |
| `frontend/src/components/ui/` | komponen shadcn/ui hasil generate (Button, Dialog, Sidebar, Command, Sonner, dll.) |
| `frontend/src/styles.css` | entry Tailwind v4 + token theme shadcn (dark), style Markdown, highlight.js, dan diff |
| `frontend/components.json` | konfigurasi shadcn: JSX (`tsx: false`), Tailwind v4, alias `@/*` |
| `frontend/src/lib/utils.js` | helper `cn` (re-export dari paket `cn`) |
| `frontend/src/hooks/use-mobile.js` | hook responsif untuk Sidebar |
| `frontend/public/vendor/` | `marked`, `marked-cjk-friendly`, `highlight.js` (disalin dari paket pi, MIT/BSD) |
| `frontend/dist/` | hasil build React yang dilayani `server.mjs` |
| `public/` | fallback frontend vanilla lama (dipakai hanya jika `frontend/dist` belum ada) |
| `smoke-test.mjs` | tes protokol: command dasar + satu prompt + hitung event |
| `session-test.mjs` | tes sidebar: daftar sesi, tree, fork, clone, switch, rename, nama sesi besar, hapus sesi (satuan & massal), proyek (create/assign/rename/delete/persistensi), `details.diff` |
| `render-check.mjs` | render headless via CDP Chrome: DOM, console/CSP error, prompt dari UI, stop/queue, rename, hapus, hapus massal, fork, proyek + drag & drop |

```bash
node smoke-test.mjs "Balas satu kata: OK"
node session-test.mjs
node render-check.mjs "http://127.0.0.1:4789/#t=<token>" "Balas satu kata: OK"
PI_GUI_TEST_FORK=1 node render-check.mjs "http://127.0.0.1:4789/#t=<token>"
PI_GUI_TEST_UI=1 node render-check.mjs "http://127.0.0.1:4789/#t=<token>"   # slash + paste gambar
PI_GUI_TEST_XSS=1 node render-check.mjs "http://127.0.0.1:4789/#t=<token>"  # sanitasi markdown
PI_GUI_TEST_STOP=1 node render-check.mjs "http://127.0.0.1:4789/#t=<token>" # stop + queue
PI_GUI_TEST_RENAME=1 node render-check.mjs "http://127.0.0.1:4789/#t=<token>" # rename sesi
PI_GUI_TEST_DELETE=1 PI_GUI_TEST_DELETE_NAME=sesi-hapus-ui node render-check.mjs "http://127.0.0.1:4789/#t=<token>"
PI_GUI_TEST_MULTI_DELETE=1 node render-check.mjs "http://127.0.0.1:4789/#t=<token>" # pilih banyak + hapus
PI_GUI_TEST_PROJECTS=1 node render-check.mjs "http://127.0.0.1:4789/#t=<token>" # proyek + drag-drop
```

Catatan: server berjalan di Node ≥ 20, tetapi `render-check.mjs` memakai `WebSocket` global sehingga
butuh Node ≥ 22. Set `CHROME_BIN` kalau Chrome tidak ada di path default macOS. Tes memakai
assertion + exit code non-zero; `smoke-test`/`render-check` membersihkan server/Chrome sementara.

## Daftar sesi

RPC tidak punya command "list sessions". `GET /api/sessions` memakai `get_state.sessionFile`,
ambil direktori sesinya, lalu membaca header + preview dari awal file dan memindai bagian akhir
untuk `session_info` terbaru (nama sesi bisa berada jauh dari akhir setelah banyak pesan). Hasil
ringkasan di-cache berdasarkan `mtime`/ukuran. Sesi yang baru di-fork belum menulis file sampai
pesan pertama, jadi UI menampilkan satu item sintetis "sesi aktif" (nama tetap dari `get_state`).
`POST /api/sessions/delete` menghapus file sesi non-aktif setelah validasi path dan konfirmasi UI.
Body bisa `{ "path": "/abs/sesi.jsonl" }` untuk satu sesi atau `{ "paths": [ ... ] }` untuk hapus
massal (maksimal 200). Respons massal berisi `deleted` dan `failed` sehingga sesi yang gagal
(mis. sesi aktif atau path di luar folder) tidak membatalkan yang lain.

## Keputusan protokol yang penting

1. **Framing**: record dipisah hanya pada `\n` (`server.mjs`), bukan `readline`, karena `readline`
   juga memecah `U+2028`/`U+2029` yang legal di dalam string JSON.
2. **Selesai ≠ `agent_end`**: UI menandai idle pada `agent_settled`; `agent_end` hanya menutup
   satu low-level run (retry/compaction/steering bisa menyusul).
3. **`message_update` delta-only**: buffer per `contentIndex`, lalu diganti isi otoritatif dari
   `text_end` / `message_end`. Blok live di-render sebagai Markdown progresif (throttle 80 ms);
   `highlightAuto` dimatikan saat streaming dan hasil highlight di-cache supaya render tetap murah.
   `text_end` langsung memicu render final (highlight penuh) untuk blok itu.
4. **Korelasi command pakai `id`**, dan `extension_ui_response` dikirim apa adanya (tanpa id baru).
5. **Backpressure**: stdin di-`await` saat `write()` mengembalikan false; stdout dibaca terus.
6. **`stderr` hanya log**, tidak pernah di-parse sebagai protokol.
7. **Shutdown** = tutup stdin, `SIGTERM` setelah 1,5 s, lalu `SIGKILL` setelah 6,5 s kalau pi masih
   hidup (mis. mengabaikan SIGTERM), supaya restart tidak menumpuk proses menggantung.
8. **Fork** mengembalikan `data.text`: teks pesan yang di-fork. Pi memindahkan sesi ke titik
   *sebelum* pesan itu, jadi UI mengisi editor dengan teks tersebut (perilaku yang sama dengan TUI).
9. **Diff** ada di `toolResult.details.diff` (string berisi baris `+`/`-`/konteks dengan nomor baris),
   bukan di content text.
10. **Stop** = `clear_queue` → kembalikan teks queue ke editor → `abort`, mengikuti perilaku Esc
    yang disarankan RPC (kalau hanya `abort`, pesan queued tetap dijalankan).
11. **Crash/spawn gagal** tidak mematikan server: event `pi_error`/`pi_exit` dikirim ke UI, yang
    menampilkan banner dan tombol “nyalakan ulang” (memanggil `/api/restart`).
12. **SSE re-connect** memakai `fetch` + `Authorization`, dengan backoff 0,5–8 detik. Saat run
    masih aktif, UI tidak me-render ulang history (prefix live dipertahankan); resync penuh
    dilakukan saat `agent_settled`. Dialog extension yang belum dijawab dikirim ulang ke klien
    yang reconnect.
13. **Hapus sesi** memakai endpoint khusus; server hanya menerima file `.jsonl` di folder sesi
    aktif, menolak sesi aktif dan path di luar folder tersebut.

## Proyek sesi

Pi tidak punya konsep proyek; GUI menambahkan metadata sendiri di
`~/.pi/pi-gui/projects.json` (mode `0600`, ditulis atomik lewat tmp + `rename`, penulisan
diserialkan). Bentuknya:

```json
{
  "version": 1,
  "projects": [{ "id": "ab12cd34ef56", "name": "refactor auth", "dir": "/path/folder-sesi", "createdAt": 0, "order": 0 }],
  "assignments": { "/path/sesi.jsonl": "ab12cd34ef56" }
}
```

- `dir` = folder sesi saat proyek dibuat, jadi proyek hanya tampil di workspace itu (proyek lama
  tanpa `dir` tampil di semua workspace).
- `assignments` memetakan path sesi → id proyek. Sesi yang tidak ada di peta masuk grup
  **tanpa proyek**.
- Endpoint: `GET /api/projects`; `POST /api/projects` dengan `action` = `create` (`name`, `dir`),
  `rename` (`projectId`, `name`), `delete` (`projectId`), atau `assign` (`sessionPath`, `projectId`
  atau `null`). Endpoint ini memakai auth + cek origin yang sama dengan endpoint lain.
- `sessionPath` harus path `.jsonl` absolut. Assignment ke file yang sudah tidak ada dibersihkan
  saat `GET`, dan ikut dihapus ketika sesi dihapus lewat `/api/sessions/delete`.
- Hapus proyek **tidak** menghapus file sesi; sesi kembali ke “tanpa proyek”.

UI: drag & drop memakai HTML5 DnD (mouse-only). Selama drag, refresh sidebar ditunda supaya
node target tidak dibangun ulang di tengah operasi.

## Keamanan

- Server hanya bind `127.0.0.1`; endpoint `/api/*` wajib token, `POST` wajib JSON dan hanya
  diterima dari origin loopback dengan `Host` loopback (aman untuk SSH tunnel, menolak DNS rebinding).
- Token dibuat sekali dan disimpan di `~/.pi/pi-gui/token` (`0600`), dikirim lewat fragment URL +
  header `Authorization`. Event stream juga lewat `fetch` + header. Jangan memakai token lemah
  seperti `pi` lewat `PI_GUI_TOKEN`; nilai env selalu menang atas token file.
- Hapus sesi hanya untuk file `.jsonl` non-aktif di folder sesi; path di luar folder dan sesi
  aktif selalu ditolak.
- `projects.json` hanya berisi metadata (path sesi + nama proyek), ditulis `0600`; endpoint
  `/api/projects` menolak path relatif/non-`.jsonl` dan proyek yang tidak dikenal.
- Header keamanan: CSP (`script-src 'self'`, `connect-src 'self'`), `nosniff`, `DENY` frame,
  `no-referrer`, dan `Permissions-Policy` minimal.
- Aset statis publik (tidak berisi rahasia); token hanya menjaga `/api/*`.
- Markdown: HTML mentah di-escape (tokenizer `html`/`tag` dimatikan, seperti export HTML pi),
  URL disaring allow-list (`http`, `https`, `mailto`, `data:image/*`); URL protocol-relative
  (`//host`, `\\host`) dan skema berbahaya ditolak. Jadi `<script>` atau `[x](javascript:…)`
  dari output model tidak dieksekusi.
- Agent tetap punya akses file + bash penuh. Kalau port ini diekspos (mis. SSH tunnel ke mesin lain),
  tambahkan konfirmasi untuk `bash`/`edit`/`write` sebelum dipakai bersama.

## Sengaja belum ada (kandidat lanjutan)

- Multi-tab / multi-sesi paralel: satu child pi per tab (sekarang satu child per server).
- Reload halaman saat run aktif masih hanya menampilkan history final + delta sisa; reconnect SSE
  tidak menghapus live yang sudah tampil, tetapi reload tidak punya buffer tersebut.
- Proyek: hanya drag & drop (belum ada pilihan “pindah ke proyek” lewat keyboard/menu), dan urutan
  proyek belum bisa diubah (selalu urutan pembuatan).

## Referensi

- `docs/rpc.md`, `docs/rpc-commands.md`, `docs/json.md`, `docs/rpc-extension-ui.md`
  di paket `@earendil-works/pi-coding-agent`
- `examples/rpc-client.ts` — klien `RpcClient` resmi (kalau mau ganti bridge manual ini)
