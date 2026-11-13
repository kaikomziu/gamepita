# Scratch で宣伝するためのサムネイル（promo/scratch-thumb.png）を作る
# Scratch のサムネは 4:3（480x360）。きれいに見えるよう 2 倍の 960x720 でも書き出す。
# ゲームの公式画像は使わず、絵文字と図形だけのオリジナル画像にする。
import os
from PIL import Image, ImageDraw, ImageFont

S = 2  # 2倍で描いてから縮める
W, H = 480 * S, 360 * S
BOLD = 'C:/Windows/Fonts/YuGothB.ttc'
EMOJI = 'C:/Windows/Fonts/seguiemj.ttf'
os.makedirs('promo', exist_ok=True)

def font(px): return ImageFont.truetype(BOLD, px * S)

def emoji(e, size):
    f = ImageFont.truetype(EMOJI, 109)
    tmp = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((80, 80), e.replace(chr(0xFE0F), ''), font=f, embedded_color=True, anchor='mm')
    tmp = tmp.crop(tmp.getbbox())
    r = size / max(tmp.size)
    return tmp.resize((int(tmp.width * r), int(tmp.height * r)), Image.LANCZOS)

# 背景：サイトと同じオレンジ → ピンク → むらさき
im = Image.new('RGB', (W, H)); px = im.load()
c1, c2, c3 = (255, 122, 69), (255, 79, 107), (200, 76, 255)
for y in range(H):
    for x in range(W):
        t = (x / W) * 0.6 + (y / H) * 0.4
        a, b, k = (c1, c2, t / 0.55) if t < 0.55 else (c2, c3, (t - 0.55) / 0.45)
        px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
im = im.convert('RGBA')

# 背景にうすくゲームっぽい絵文字をちらす
deco = Image.new('RGBA', (W, H), (0, 0, 0, 0))
spots = [('🎮', 20, 14, 46, -15), ('⭐', 420, 20, 34, 10), ('🕹️', 432, 300, 40, 12), ('🏆', 14, 300, 38, -10),
         ('⚔️', 380, 120, 30, 0), ('🧩', 30, 150, 30, 15), ('🚀', 250, 6, 28, 20), ('🎲', 210, 318, 30, -8)]
for e, x, y, s, rot in spots:
    g = emoji(e, s * S).rotate(rot, expand=True)
    g.putalpha(g.getchannel('A').point(lambda v: int(v * 0.35)))
    deco.alpha_composite(g, (x * S, y * S))
im.alpha_composite(deco)
d = ImageDraw.Draw(im)

# ロゴ（パズルのピース）＋ GamePita
tw_ = font(52).getlength('GamePita')
lx, ly = int((W - (92 * S + tw_)) // 2), 46 * S
d.rounded_rectangle((lx, ly, lx + 64 * S, ly + 64 * S), radius=16 * S, fill='white')
d.ellipse((lx + 20 * S, ly - 11 * S, lx + 42 * S, ly + 11 * S), fill='white')
d.ellipse((lx + 53 * S, ly + 21 * S, lx + 75 * S, ly + 43 * S), fill='white')
d.ellipse((lx + 20 * S, ly + 30 * S, lx + 29 * S, ly + 39 * S), fill=(255, 79, 107))
d.ellipse((lx + 36 * S, ly + 30 * S, lx + 45 * S, ly + 39 * S), fill=(255, 79, 107))
d.text((lx + 92 * S, ly + 33 * S), 'GamePita', font=font(52), fill='white', anchor='lm',
       stroke_width=2 * S, stroke_fill=(180, 40, 90))

# キャッチコピー
d.text((W // 2, 150 * S), '自分に合うゲームが', font=font(30), fill='white', anchor='mm', stroke_width=2 * S, stroke_fill=(170, 40, 100))
d.text((W // 2, 190 * S), 'ピタっと見つかる！', font=font(40), fill=(255, 245, 120), anchor='mm', stroke_width=3 * S, stroke_fill=(170, 40, 100))

# 3つのできること（白い札）
items = [('🔮', 'ピタっと診断'), ('📝', '記事を書ける'), ('💬', 'みんなと交流')]
bw, bh, gap = 140 * S, 50 * S, 10 * S
x0 = (W - (bw * 3 + gap * 2)) // 2
for i, (e, label) in enumerate(items):
    x = x0 + i * (bw + gap); y = 232 * S
    d.rounded_rectangle((x, y, x + bw, y + bh), radius=14 * S, fill=(255, 255, 255, 240))
    g = emoji(e, 26 * S); im.alpha_composite(g, (x + 10 * S, y + (bh - g.height) // 2))
    f = font(15)
    d.text((x + 42 * S, y + bh // 2), label, font=f, fill=(90, 40, 80), anchor='lm')

# 下の帯：無料・だれでも
d.rounded_rectangle((120 * S, 302 * S, 360 * S, 336 * S), radius=17 * S, fill=(60, 30, 90, 200))
d.text((W // 2, 319 * S), '無料・だれでも読める！', font=font(18), fill='white', anchor='mm')

big = im.convert('RGB')
big.save('promo/scratch-thumb@2x.png', optimize=True)
big.resize((480, 360), Image.LANCZOS).save('promo/scratch-thumb.png', optimize=True)
print('ok')
