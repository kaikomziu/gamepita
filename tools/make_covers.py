# AI編集部の記事の表紙画像（covers/ai-<slug>.png, 1600x900）を作る。
# ゲームの公式画像は著作権があるので使わず、絵文字と図形だけのオリジナル画像にする。
# 記事ページでは 21:9 に切り取られるので、文字や絵は上下の中央寄り（y=150〜750）に置く。
import os, random
from PIL import Image, ImageDraw, ImageFont

W, H = 1600, 900
BOLD = 'C:/Windows/Fonts/YuGothB.ttc'
EMOJI = 'C:/Windows/Fonts/seguiemj.ttf'
os.makedirs('covers', exist_ok=True)

# (ファイル名, ゲーム名, ひとこと, 色1, 色2, 主役の絵文字, 背景にちらす絵文字)
COVERS = [
    ('minecraft', 'Minecraft', 'ブロックで、世界を自由につくろう', (76, 175, 80), (121, 85, 72), '⛏️', '🧱🌲🪨🏠🌙'),
    ('fortnite', 'フォートナイト', '建てて、守って、最後の1人へ', (66, 133, 244), (156, 39, 176), '🪂', '🏗️🌀⭐🏝️🎯'),
    ('splatoon3', 'スプラトゥーン3', 'ぬって広げる、ナワバリ争い', (255, 214, 0), (233, 30, 99), '🎨', '🦑🖌️💦🟡🟣'),
    ('animal-crossing', 'あつまれ どうぶつの森', '無人島で、のんびり島づくり', (139, 195, 74), (0, 188, 212), '🏝️', '🍃🐟🦋🍎🏡'),
    ('smash-bros', '大乱闘スマッシュブラザーズ SPECIAL', 'ふっとばして勝て！みんなで対戦', (244, 67, 54), (255, 152, 0), '💥', '🥊⚡🎮⭐🏆'),
    ('mario-kart', 'マリオカート8 デラックス', 'アイテムで大逆転のレース', (255, 87, 34), (63, 81, 181), '🏎️', '🍌🏁💨🎈⭐'),
    ('zelda-totk', 'ゼルダの伝説 ティアーズ オブ ザ キングダム', '空も地下も、自由に冒険', (38, 166, 154), (40, 53, 147), '🗡️', '☁️🏔️🪵🧭✨'),
    ('among-us', 'Among Us', 'この中に、うそつきがいる…', (33, 33, 66), (183, 28, 28), '🚀', '🔍🛰️⭐🔧❓'),
]

def gradient(c1, c2):
    im = Image.new('RGB', (W, H)); px = im.load()
    for y in range(H):
        for x in range(W):
            t = (x / W) * 0.65 + (y / H) * 0.35
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return im

def emoji_img(e, size):
    # 絵文字を透明な画像に描く（U+FE0F は位置がずれるので取りのぞく）
    f = ImageFont.truetype(EMOJI, 109)  # seguiemj はこの大きさがいちばんきれい
    tmp = Image.new('RGBA', (160, 160), (0, 0, 0, 0))
    ImageDraw.Draw(tmp).text((80, 80), e.replace(chr(0xFE0F), ''), font=f, embedded_color=True, anchor='mm')
    box = tmp.getbbox() or (0, 0, 160, 160)
    tmp = tmp.crop(box)
    r = size / max(tmp.size)
    return tmp.resize((max(1, int(tmp.width * r)), max(1, int(tmp.height * r))), Image.LANCZOS)

def split_emoji(s):
    out, cur = [], ''
    for ch in s:
        if ch == chr(0xFE0F) and cur: cur += ch; continue
        if cur: out.append(cur)
        cur = ch
    if cur: out.append(cur)
    return out

def fit_font(text, max_w, start):
    size = start
    while size > 40:
        f = ImageFont.truetype(BOLD, size)
        if f.getlength(text) <= max_w: return f
        size -= 4
    return ImageFont.truetype(BOLD, size)

for slug, game, catch, c1, c2, main, deco in COVERS:
    im = gradient(c1, c2).convert('RGBA')
    rnd = random.Random(slug)  # 毎回同じ並びにする
    # 背景にうすく絵文字をちらす
    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    items = split_emoji(deco)
    for i in range(26):
        e = emoji_img(items[i % len(items)], rnd.randint(70, 130)).rotate(rnd.randint(-25, 25), expand=True)
        a = e.getchannel('A').point(lambda v: int(v * 0.28)); e.putalpha(a)
        layer.alpha_composite(e, (rnd.randint(-40, W - 60), rnd.randint(-40, H - 60)))
    im.alpha_composite(layer)
    # まん中のカード
    card = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    cd = ImageDraw.Draw(card)
    cd.rounded_rectangle((150, 190, W - 150, 710), radius=48, fill=(255, 255, 255, 54), outline=(255, 255, 255, 140), width=4)
    im.alpha_composite(card)
    # 主役の絵文字
    big = emoji_img(main, 230)
    im.alpha_composite(big, (250, 450 - big.height // 2))
    d = ImageDraw.Draw(im)
    tx, tw = 560, W - 150 - 560 - 60
    fg = fit_font(game, tw, 92)
    d.text((tx, 400), game, font=fg, fill=(255, 255, 255), anchor='ls', stroke_width=3, stroke_fill=(0, 0, 0, 90))
    fc = fit_font(catch, tw, 52)
    d.text((tx, 500), catch, font=fc, fill=(255, 255, 255), anchor='ls', stroke_width=2, stroke_fill=(0, 0, 0, 70))
    fs = ImageFont.truetype(BOLD, 32)
    d.rounded_rectangle((tx, 560, tx + 430, 620), radius=30, fill=(255, 255, 255, 230))
    d.text((tx + 215, 591), '🧩 GamePita AI編集部'.replace('🧩 ', ''), font=fs, fill=(60, 60, 80), anchor='mm')
    im.convert('RGB').save(f'covers/ai-{slug}.png', optimize=True)
    print('作りました:', slug)
