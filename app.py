from pathlib import Path

import streamlit as st

st.set_page_config(
    page_title="Gesture Camera Puzzle",
    page_icon="🧩",
    layout="wide",
    initial_sidebar_state="collapsed",
)

BASE_DIR = Path(__file__).resolve().parent

html_code = (BASE_DIR / "component" / "component.html").read_text(encoding="utf-8")
css_code = (BASE_DIR / "component" / "component.css").read_text(encoding="utf-8")
js_code = (BASE_DIR / "component" / "component.js").read_text(encoding="utf-8")

st.title("🧩 Gesture Camera Puzzle 3×3")
st.caption(
    "Kamera dan hand tracking berjalan langsung di browser. "
    "Foto tidak diunggah atau disimpan oleh aplikasi."
)

gesture_puzzle = st.components.v2.component(
    name="gesture_camera_puzzle",
    html=html_code,
    css=css_code,
    js=js_code,
    isolate_styles=True,
)

gesture_puzzle(key="main_gesture_puzzle")

with st.expander("Petunjuk dan troubleshooting"):
    st.markdown(
        """
1. Klik **Mulai Kamera**, lalu pilih **Allow / Izinkan**.
2. Bentuk dua tangan seperti huruf **L** pada sudut berlawanan.
3. Tahan hingga countdown 3 detik dimulai.
4. Setelah puzzle muncul, cubit ibu jari dan telunjuk untuk mengambil tile.
5. Geser sambil tetap mencubit, lalu buka cubitan pada kotak tujuan.
6. Gunakan **Capture Manual** untuk menguji puzzle tanpa gesture bingkai.

**Jika kamera tidak terbuka:** cek izin kamera pada browser, tutup Teams/Zoom
yang sedang memakai kamera, lalu muat ulang halaman.
        """
    )
