import bpy, zlib, struct, os, json
import numpy as np

TMP = os.path.join(os.environ.get("TEMP", "."), "dsh_png_probe")
os.makedirs(TMP, exist_ok=True)

def make_png(path, w, h, rgba_rows):
    raw = b""
    for row in rgba_rows:
        raw += b"\x00" + bytes(row)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    open(path, "wb").write(png)

def decode_png(path):
    data = open(path, "rb").read()
    pos = 8; idat = b""; w = h = ct = None
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos+4])[0]
        typ = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+ln]
        pos += 12 + ln
        if typ == b"IHDR":
            w, h, bd, ct, comp, filt, inter = struct.unpack(">IIBBBBB", chunk)
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    ch = {0:1,2:3,3:1,4:2,6:4}[ct]
    stride = w * ch
    rows = []
    prev = bytearray(stride)
    i = 0
    filters = []
    for y in range(h):
        f = raw[i]; i += 1
        filters.append(f)
        line = bytearray(raw[i:i+stride]); i += stride
        if f == 1:
            for x in range(ch, stride): line[x] = (line[x] + line[x-ch]) & 255
        elif f == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                a = line[x-ch] if x >= ch else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x-ch] if x >= ch else 0
                b = prev[x]
                c = prev[x-ch] if x >= ch else 0
                p = a + b - c; pa = abs(p-a); pb = abs(p-b); pc = abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(list(line))
        prev = line
    return w, h, ch, rows, filters

# known 4x4 RGBA image
KNOWN = [
    [(0, 0, 0, 0), (255, 0, 0, 255), (0, 255, 0, 255), (0, 0, 255, 255)],
    [(17, 34, 51, 68), (255, 255, 255, 255), (128, 64, 32, 255), (255, 128, 0, 200)],
    [(1, 2, 3, 4), (5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16)],
    [(200, 100, 50, 25), (0, 0, 0, 255), (255, 255, 255, 0), (127, 127, 127, 127)],
]
src = os.path.join(TMP, "known.png")
make_png(src, 4, 4, [[c for px in row for c in px] for row in KNOWN])

res = {}
w, h, ch, rows, filters = decode_png(src)
res["own_decode_filters"] = filters
res["own_decode_first_row"] = rows[0][:8]

for cs in ["Non-Color", "sRGB"]:
    img = bpy.data.images.load(src)
    img.colorspace_settings.name = cs
    px = np.array(img.pixels[:], dtype=np.float32).reshape(4, 4, 4)
    # blender image rows are bottom-up
    top = px[3]
    res["load_" + cs] = {
        "row0_px0": [round(float(v), 4) for v in top[0]],
        "row0_px1": [round(float(v), 4) for v in top[1]],
        "byte_expected": KNOWN[0][1],
    }
    bpy.data.images.remove(img)

# round trip: load Non-Color -> new image -> save -> decode
img = bpy.data.images.load(src)
img.colorspace_settings.name = "Non-Color"
arr = np.array(img.pixels[:], dtype=np.float32).reshape(4, 4, 4)
# nearest downsample 4x4 -> 2x2
small = arr[::2, ::2, :]
out_img = bpy.data.images.new("testout", width=2, height=2, alpha=True)
out_img.colorspace_settings.name = "Non-Color"
out_img.pixels = small.ravel().tolist()
dst = os.path.join(TMP, "out.png")
out_img.filepath_raw = dst
out_img.file_format = "PNG"
out_img.save()
bpy.data.images.remove(img)
bpy.data.images.remove(out_img)
w2, h2, ch2, rows2, filters2 = decode_png(dst)
res["roundtrip"] = {"size": [w2, h2, ch2], "filters": filters2, "rows": rows2}
print("PROBE2_JSON " + json.dumps(res))
