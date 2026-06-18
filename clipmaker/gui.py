"""Basit masaüstü uygulaması (Tkinter) — klip editörünü pencereden kullan.

CMD'ye gerek kalmadan: dosya seç, seçenekleri işaretle, "Hazırla"ya bas.
Tkinter Python ile birlikte gelir (Windows'ta ekstra kurulum gerekmez).

Çalıştırma:  python -m clipmaker.gui   (ya da argümansız: python -m clipmaker)
"""
from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
from pathlib import Path
from typing import Optional

from clipmaker.config import Settings


def build_editor_settings(
    formats: list[str],
    captions: bool,
    caption_model: str,
    language: str,
    trim_start: Optional[str],
    trim_end: Optional[str],
    title: Optional[str],
    normalize: bool,
    out_dir: str,
) -> Settings:
    """Arayüz değerlerinden Settings üretir (saf — test edilebilir)."""
    from clipmaker.editor import parse_timestamp
    fmts = tuple(f for f in formats if f in ("vertical", "square", "horizontal")) or ("vertical",)
    return Settings(
        out_dir=Path(out_dir or "output"),
        formats=fmts,
        captions=captions,
        caption_model=caption_model or "base",
        language=language or "tr",
        normalize_audio=normalize,
        trim_start=parse_timestamp(trim_start),
        trim_end=parse_timestamp(trim_end),
        title=(title or None),
    )


def open_folder(path: Path) -> None:
    """Çıktı klasörünü dosya gezgininde açar (platformlar arası)."""
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(path))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.run(["open", str(path)], check=False)
        else:
            subprocess.run(["xdg-open", str(path)], check=False)
    except Exception:
        pass


class _QueueWriter:
    """print() çıktısını arayüze taşımak için sys.stdout yerine geçer."""

    def __init__(self, q: "queue.Queue[str]"):
        self.q = q

    def write(self, text: str) -> int:
        if text:
            self.q.put(text)
        return len(text)

    def flush(self) -> None:
        pass


def launch() -> int:
    try:
        import tkinter as tk
    except Exception:
        print("HATA: Bu Python kurulumunda Tkinter yok. Windows'ta Python'u "
              "python.org'dan kurarsanız Tkinter dahil gelir.")
        return 1
    root = tk.Tk()
    build_app(root)
    root.mainloop()
    return 0


def build_app(root) -> None:
    """Pencere ve tüm widget'ları kurar (mainloop hariç — test edilebilir)."""
    import tkinter as tk
    from tkinter import filedialog, messagebox, ttk

    root.title("Clip Maker — Klip Hazırlayıcı")
    root.geometry("680x640")
    root.minsize(620, 560)

    state = {"files": [], "running": False, "last_out": None}
    log_q: "queue.Queue[str]" = queue.Queue()
    done_q: "queue.Queue[int]" = queue.Queue()

    pad = {"padx": 10, "pady": 4}
    main = ttk.Frame(root, padding=12)
    main.pack(fill="both", expand=True)

    ttk.Label(main, text="🎬 Klibini sosyal medyaya hazırla",
              font=("Segoe UI", 14, "bold")).pack(anchor="w")
    ttk.Label(main, text="Bir video dosyası seç → seçenekleri ayarla → Hazırla.",
              foreground="#555").pack(anchor="w", pady=(0, 8))

    # --- Dosya seçimi ---
    file_frame = ttk.LabelFrame(main, text="Video dosyası (montaj için birden çok seçebilirsin)")
    file_frame.pack(fill="x", **pad)
    files_var = tk.StringVar(value="Henüz dosya seçilmedi")
    ttk.Label(file_frame, textvariable=files_var, foreground="#333",
              wraplength=560).pack(side="left", fill="x", expand=True, padx=8, pady=8)

    def choose_files():
        paths = filedialog.askopenfilenames(
            title="Video seç",
            filetypes=[("Video dosyaları", "*.mp4 *.mov *.mkv *.webm *.avi *.m4v *.flv *.ts"),
                       ("Tüm dosyalar", "*.*")])
        if paths:
            state["files"] = [Path(p) for p in paths]
            names = ", ".join(p.name for p in state["files"])
            files_var.set(names if len(names) < 90 else names[:87] + "...")

    ttk.Button(file_frame, text="Seç...", command=choose_files).pack(side="right", padx=8, pady=8)

    # --- Seçenekler ---
    opt = ttk.LabelFrame(main, text="Seçenekler")
    opt.pack(fill="x", **pad)

    row1 = ttk.Frame(opt); row1.pack(fill="x", padx=8, pady=4)
    ttk.Label(row1, text="Formatlar:").pack(side="left")
    v_vertical = tk.BooleanVar(value=True)
    v_square = tk.BooleanVar(value=False)
    v_horizontal = tk.BooleanVar(value=False)
    ttk.Checkbutton(row1, text="Dikey 9:16", variable=v_vertical).pack(side="left", padx=6)
    ttk.Checkbutton(row1, text="Kare 1:1", variable=v_square).pack(side="left", padx=6)
    ttk.Checkbutton(row1, text="Yatay 16:9", variable=v_horizontal).pack(side="left", padx=6)

    row2 = ttk.Frame(opt); row2.pack(fill="x", padx=8, pady=4)
    v_captions = tk.BooleanVar(value=True)
    ttk.Checkbutton(row2, text="Karaoke altyazı", variable=v_captions).pack(side="left")
    ttk.Label(row2, text="  Kalite:").pack(side="left")
    v_model = tk.StringVar(value="base")
    ttk.Combobox(row2, textvariable=v_model, width=8, state="readonly",
                 values=["tiny", "base", "small"]).pack(side="left", padx=4)
    ttk.Label(row2, text="  Dil:").pack(side="left")
    v_lang = tk.StringVar(value="tr")
    ttk.Entry(row2, textvariable=v_lang, width=5).pack(side="left", padx=4)
    v_norm = tk.BooleanVar(value=True)
    ttk.Checkbutton(row2, text="Ses normalize", variable=v_norm).pack(side="left", padx=10)

    row3 = ttk.Frame(opt); row3.pack(fill="x", padx=8, pady=4)
    ttk.Label(row3, text="Kırp — baştan:").pack(side="left")
    v_ts = tk.StringVar(value="")
    ttk.Entry(row3, textvariable=v_ts, width=8).pack(side="left", padx=4)
    ttk.Label(row3, text="sona kadar:").pack(side="left")
    v_te = tk.StringVar(value="")
    ttk.Entry(row3, textvariable=v_te, width=8).pack(side="left", padx=4)
    ttk.Label(row3, text="(örn. 0:05 — boş bırakırsan tüm klip)").pack(side="left", padx=6)

    row4 = ttk.Frame(opt); row4.pack(fill="x", padx=8, pady=4)
    ttk.Label(row4, text="Üst başlık (isteğe bağlı):").pack(side="left")
    v_title = tk.StringVar(value="")
    ttk.Entry(row4, textvariable=v_title, width=40).pack(side="left", padx=4)

    row5 = ttk.Frame(opt); row5.pack(fill="x", padx=8, pady=4)
    ttk.Label(row5, text="Çıktı klasörü:").pack(side="left")
    v_out = tk.StringVar(value="output")
    ttk.Entry(row5, textvariable=v_out, width=34).pack(side="left", padx=4)

    def choose_out():
        d = filedialog.askdirectory(title="Çıktı klasörü seç")
        if d:
            v_out.set(d)
    ttk.Button(row5, text="...", width=3, command=choose_out).pack(side="left")

    # --- Çalıştır + ilerleme ---
    run_btn = ttk.Button(main, text="🚀 Hazırla")
    run_btn.pack(fill="x", **pad)

    log_box = tk.Text(main, height=12, wrap="word", state="disabled",
                      background="#111", foreground="#e0e0e0", font=("Consolas", 9))
    log_box.pack(fill="both", expand=True, **pad)

    bottom = ttk.Frame(main); bottom.pack(fill="x", **pad)
    open_btn = ttk.Button(bottom, text="📂 Çıktı klasörünü aç", state="disabled")
    open_btn.pack(side="right")

    def append_log(text: str):
        log_box.configure(state="normal")
        log_box.insert("end", text)
        log_box.see("end")
        log_box.configure(state="disabled")

    def worker(inputs, settings):
        old = sys.stdout
        sys.stdout = _QueueWriter(log_q)
        try:
            from clipmaker.editor import run_editor
            rc = run_editor(inputs, settings)
        except Exception as e:  # beklenmedik hata arayüzde görünsün
            print(f"\nHATA: {e}")
            rc = 1
        finally:
            sys.stdout = old
        done_q.put(rc)

    def start():
        if state["running"]:
            return
        if not state["files"]:
            messagebox.showwarning("Dosya yok", "Önce bir video dosyası seç.")
            return
        formats = []
        if v_vertical.get(): formats.append("vertical")
        if v_square.get(): formats.append("square")
        if v_horizontal.get(): formats.append("horizontal")
        if not formats:
            messagebox.showwarning("Format yok", "En az bir format seç (örn. Dikey 9:16).")
            return
        settings = build_editor_settings(
            formats, v_captions.get(), v_model.get(), v_lang.get(),
            v_ts.get(), v_te.get(), v_title.get(), v_norm.get(), v_out.get())
        state["last_out"] = Path(v_out.get() or "output") / f"{state['files'][0].stem}_hazir"
        log_box.configure(state="normal"); log_box.delete("1.0", "end"); log_box.configure(state="disabled")
        state["running"] = True
        run_btn.configure(text="⏳ İşleniyor...", state="disabled")
        open_btn.configure(state="disabled")
        threading.Thread(target=worker, args=(list(state["files"]), settings), daemon=True).start()

    run_btn.configure(command=start)
    open_btn.configure(command=lambda: open_folder(state["last_out"]) if state["last_out"] else None)

    def drain():
        try:
            while True:
                append_log(log_q.get_nowait())
        except queue.Empty:
            pass
        try:
            rc = done_q.get_nowait()
            state["running"] = False
            run_btn.configure(text="🚀 Hazırla", state="normal")
            if rc == 0:
                open_btn.configure(state="normal")
                append_log("\n✅ Tamamlandı. 'Çıktı klasörünü aç' ile dosyalara ulaşabilirsin.\n")
            else:
                append_log("\n❌ İşlem tamamlanamadı (yukarıdaki mesajlara bak).\n")
        except queue.Empty:
            pass
        root.after(120, drain)

    root.after(120, drain)


if __name__ == "__main__":
    raise SystemExit(launch())
