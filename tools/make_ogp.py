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
