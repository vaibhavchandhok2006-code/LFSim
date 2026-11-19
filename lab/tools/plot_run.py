import csv, sys, re, math
from PIL import Image, ImageDraw
tid = sys.argv[1]; out = sys.argv[2] if len(sys.argv) > 2 else f'/tmp/mz/{tid}.png'
im = Image.open(f'lab/tracksets/rr-2027/tracks/{tid}.png').convert('RGB')
W = 1000; sc = W / 4.0; im = im.resize((W, W)); d = ImageDraw.Draw(im)
rows = list(csv.DictReader(open(f'{sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else "/tmp/mz/out"}/{tid}.csv')))
x0, y0, h0 = float(rows[0]['x_m']), float(rows[0]['y_m']), math.radians(float(rows[0]['heading_deg']))
pts = [(float(r['x_m']) * sc, float(r['y_m']) * sc) for r in rows[::20]]
d.line(pts, fill=(230, 40, 40), width=2)
# map frame (x fwd, y left, mm) -> image frame: heading sign follows the CSV heading convention
sgn = -1 if '--flip' in sys.argv else 1
for line in open(f'{sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith("--") else "/tmp/mz/out"}/{tid}.serial.txt'):
    m = re.search(r'n=(\d+) (new|known) at (-?\d+),(-?\d+)', line)
    if not m: continue
    mx, my = int(m.group(3)) / 1000, int(m.group(4)) / 1000 * sgn
    wx = x0 + mx * math.cos(h0) - my * math.sin(h0); wy = y0 + mx * math.sin(h0) + my * math.cos(h0)
    c = (40, 90, 230) if m.group(2) == 'new' else (40, 180, 60)
    d.ellipse((wx * sc - 5, wy * sc - 5, wx * sc + 5, wy * sc + 5), outline=c, width=2)
    if m.group(2) == 'new': d.text((wx * sc + 6, wy * sc - 6), m.group(1), fill=c)
im.save(out); print(out)
