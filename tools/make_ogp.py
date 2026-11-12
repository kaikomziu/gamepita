# OGP 画像（ogp.png, 1200x630）を作る。一度作れば OK（文言を変えたら作り直す）
from PIL import Image, ImageDraw, ImageFont
W, H = 1200, 630
img = Image.new('RGB', (W, H))
px = img.load()
# 斜めのグラデーション（オレンジ → ピンク → むらさき）
c1, c2, c3 = (255, 122, 69), (255, 79, 107), (200, 76, 255)
for y in range(H):
    for x in range(W):
        t = (x / W) * 0.7 + (y / H) * 0.3
        a, b, k = (c1, c2, t / 0.55) if t < 0.55 else (c2, c3, (t - 0.55) / 0.45)
        px[x, y] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
d = ImageDraw.Draw(img)
bold = 'C:/Windows/Fonts/YuGothB.ttc'
f1 = ImageFont.truetype(bold, 120); f2 = ImageFont.truetype(bold, 52); f3 = ImageFont.truetype(bold, 34)
# パズルのピース
d.rounded_rectangle((90, 110, 270, 290), radius=44, fill=(255, 255, 255))
d.ellipse((150, 80, 210, 140), fill=(255, 255, 255)); d.ellipse((240, 170, 300, 230), fill=(255, 255, 255))
d.ellipse((150, 185, 172, 207), fill=(255, 79, 107)); d.ellipse((190, 185, 212, 207), fill=(255, 79, 107))
d.text((320, 120), 'GamePita', font=f1, fill=(255, 255, 255))
d.text((96, 360), '自分に合うゲームを、ピタっと見つける。', font=f2, fill=(255, 255, 255))
d.text((96, 450), 'みんなで書くゲーム紹介記事 ＆ ピタっと診断', font=f3, fill=(255, 240, 245))
img.save('ogp.png', optimize=True)
print('ogp.png を作りました')

# ---------- 診断タイプごとのシェア画像（ogp/type-<slug>.png）----------
# render.js の TYPES と同じ並び・名前にする
import os
TYPES = [
    ('solo-short-easy', '🌱', 'ゆるっとひとり時間タイプ'), ('solo-short-hard', '⚡', 'ひとりで腕だめしタイプ'),
    ('solo-long-easy', '📖', 'じっくり物語ひたりタイプ'), ('solo-long-hard', '🏔️', 'やりこみ求道者タイプ'),
    ('multi-short-easy', '🎉', 'みんなでワイワイタイプ'), ('multi-short-hard', '🔥', '白熱バトルタイプ'),
    ('multi-long-easy', '🏕️', 'まったり協力タイプ'), ('multi-long-hard', '🛡️', '最強チーム攻略タイプ'),
]
os.makedirs('ogp', exist_ok=True)
emoji_font = ImageFont.truetype('C:/Windows/Fonts/seguiemj.ttf', 160)
fname = ImageFont.truetype(bold, 76)
for slug, emo, name in TYPES:
    im = img.copy()  # 同じグラデーションを使う
    dd = ImageDraw.Draw(im)
    dd.rectangle((0, 0, W, H), fill=None)
    # 上の画像の文字を消すため、グラデーションを作り直す
    im = Image.new('RGB', (W, H)); pp = im.load()
    for y in range(H):
        for x in range(W):
            t = (x / W) * 0.7 + (y / H) * 0.3
            a, b, k = (c1, c2, t / 0.55) if t < 0.55 else (c2, c3, (t - 0.55) / 0.45)
            pp[x, y] = tuple(int(a[i] + (b[i] - a[i]) * k) for i in range(3))
    dd = ImageDraw.Draw(im)
    dd.text((W // 2, 92), 'GamePita ピタっと診断', font=f3, fill=(255, 240, 245), anchor='mm')
    try:
        dd.text((W // 2, 250), emo.replace(chr(0xFE0F), ''), font=emoji_font, embedded_color=True, anchor='mm')
    except Exception as e:
        print('絵文字を描けませんでした:', e)
    dd.text((W // 2, 430), name, font=fname, fill=(255, 255, 255), anchor='mm')
    dd.text((W // 2, 540), 'あなたにピタっと合うゲームは？', font=f3, fill=(255, 240, 245), anchor='mm')
    im.save(f'ogp/type-{slug}.png', optimize=True)
print('タイプ画像を8枚作りました')
