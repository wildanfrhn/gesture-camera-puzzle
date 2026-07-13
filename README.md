# Gesture Camera Puzzle 3×3

Aplikasi Streamlit sederhana yang menjalankan kamera laptop, mendeteksi landmark
dua tangan, mengambil foto melalui gesture bingkai, lalu mengubah foto menjadi
puzzle 3×3 yang dapat disusun menggunakan gesture pinch.

## Fitur

- Deteksi hingga dua tangan dan 42 landmark secara real time
- Garis dan node landmark berwarna hijau
- Gesture dua tangan berbentuk L untuk memulai countdown 3 detik
- Foto berubah menjadi puzzle 3×3 setelah jeda 2 detik
- Pinch ibu jari dan telunjuk untuk memilih dan memindahkan tile
- Sistem swap antarkotak
- Pemeriksaan jawaban otomatis
- Pesan **“Cihuuyy benar!”** ketika puzzle selesai
- Tombol Capture Manual, Ulangi, dan Hentikan

## Struktur file

```text
gesture-camera-puzzle-streamlit/
├── app.py
├── requirements.txt
├── README.md
├── .streamlit/
│   └── config.toml
└── component/
    ├── component.html
    ├── component.css
    └── component.js
```

## Menjalankan secara lokal

Pastikan Python telah terinstal.

```bash
pip install -r requirements.txt
streamlit run app.py
```

Buka alamat yang ditampilkan oleh terminal, biasanya:

```text
http://localhost:8501
```

## Deploy ke Streamlit Community Cloud

1. Upload seluruh isi folder ini ke satu repository GitHub.
2. Buka Streamlit Community Cloud.
3. Klik **Create app**.
4. Pilih repository dan branch yang berisi file ini.
5. Isi **Main file path** dengan `app.py`.
6. Pilih Python 3.11 atau 3.12.
7. Klik **Deploy**.
8. Setelah aplikasi terbuka, klik **Mulai Kamera** dan izinkan akses kamera.

## Catatan teknis

Hand tracking menggunakan MediaPipe Hands versi web melalui CDN. Pemrosesan
kamera dilakukan langsung pada browser pengguna, bukan dikirim ke server
Streamlit. Karena akses kamera memerlukan secure context, gunakan HTTPS saat
deployment. Streamlit Community Cloud otomatis menyediakan HTTPS.

## Browser

Direkomendasikan menggunakan Chrome atau Microsoft Edge versi terbaru.
Firefox dan Safari modern juga dapat bekerja, tetapi perilaku izin kamera dan
performa dapat berbeda.
