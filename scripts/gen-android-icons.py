"""Sinh icon launcher Android từ icon PWA (public/icon-512.png).

Chạy: python3 scripts/gen-android-icons.py   (cần Pillow)
- ic_launcher.png        : ô vuông bo góc như icon.svg (rx 14/64)
- ic_launcher_round.png  : hình tròn
- ic_launcher_foreground : chữ "LĐ" trắng trên nền trong suốt (adaptive icon),
                           nền màu #c2410c đặt ở values/ic_launcher_background.xml
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public/icon-512.png"
RES = ROOT / "android/app/src/main/res"
BG = (0xC2, 0x41, 0x0C)
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
S = 2048  # vẽ ở độ phân giải lớn rồi thu nhỏ cho mịn

src = Image.open(SRC).convert("RGB").resize((S, S), Image.LANCZOS)

def masked(shape):
    m = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(m)
    if shape == "round":
        d.ellipse((0, 0, S - 1, S - 1), fill=255)
    else:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=S * 14 / 64, fill=255)
    out = src.convert("RGBA")
    out.putalpha(m)
    return out

# Chữ trắng tách khỏi nền cam: alpha theo kênh B (nền B=12, chữ B=255)
r, g, b = src.split()
alpha = b.point(lambda v: max(0, min(255, round((v - BG[2]) * 255 / (255 - BG[2])))))
glyph = Image.new("RGBA", (S, S), (255, 255, 255, 0))
glyph.putalpha(alpha)
# Adaptive icon 108dp, launcher hiển thị ~72dp ở giữa → icon PWA chiếm 72/108
fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
inner = round(S * 72 / 108)
fg.alpha_composite(glyph.resize((inner, inner), Image.LANCZOS), ((S - inner) // 2,) * 2)

legacy, rnd = masked("square"), masked("round")
for name, k in DENSITIES.items():
    d = RES / f"mipmap-{name}"
    legacy.resize((round(48 * k),) * 2, Image.LANCZOS).save(d / "ic_launcher.png")
    rnd.resize((round(48 * k),) * 2, Image.LANCZOS).save(d / "ic_launcher_round.png")
    fg.resize((round(108 * k),) * 2, Image.LANCZOS).save(d / "ic_launcher_foreground.png")

(RES / "values/ic_launcher_background.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
    '    <color name="ic_launcher_background">#C2410C</color>\n</resources>\n'
)
print("done")
