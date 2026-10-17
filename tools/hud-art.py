#!/usr/bin/env python3
"""Build the Step-1 HUD art from the originals.

Pipeline (per asset):  read ORIGINAL -> downscale to ~2x display size ->
knock out the black background -> feather -> 256-colour palette PNG.

Why not "delete all black"? These are glow-on-black assets whose button faces
are themselves near-black, so a global colour key would punch holes in them.
Instead:
  * BORDER FLOOD  - removes only the black rectangle touching the edges, and
                    stops at the neon rings, so dark interiors survive.
  * CENTRE FLOOD  - extra pass for frames/dials whose black disc is *enclosed*
                    by the ring; that hole is where the live canvas shows through.
  * LUMA RAMP     - for pure-glow art (logo, needle) so glow fades out softly.

Threshold is adaptive: start most aggressive, back off if the cut eats the
subject. Every file is then verified (corners transparent, centre opaque).
Originals on the SD card are never written to.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

SRC = os.environ.get("RK_ART_SRC", "/storage/emulated/0/Road kill/copy images/renamed")
DST = os.environ.get("RK_ART_DST", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "public", "art"))

# file-number -> (filename, longest-edge cap)   cap ~= 2x on-screen pixels
STEP1 = {
    1:  ("minimap-frame.png",   320),
    2:  ("speedometer.png",     320),
    3:  ("speedo-needle.png",   224),
    4:  ("panel-score.png",     320),
    5:  ("panel-status.png",    320),
    6:  ("banner-objective.png", 384),
    7:  ("button-menu.png",     160),
    8:  ("button-coins.png",    320),
    35: ("logo.png",            512),
    51: ("ctrl-steer-left.png", 240),
    52: ("ctrl-steer-right.png", 240),
    53: ("ctrl-gas.png",        240),
    54: ("ctrl-brake.png",      240),
    55: ("ctrl-fire.png",       200),
    56: ("ctrl-boost.png",      200),
    57: ("ctrl-jump.png",       200),
    58: ("ctrl-weapon.png",     200),
    59: ("ctrl-camera.png",     144),
    60: ("ctrl-pause.png",      144),
}
RAMP        = {"logo.png", "speedo-needle.png"}
# the logo's "black" is really dark grey (~20), so a pure luma ramp never
# reaches zero and leaves a 30% veil over the whole rectangle. Cut the
# border-connected veil with a flood, but keep the ramp inside the subject so
# the neon glow still feathers out softly instead of ending on a hard edge.
HYBRID      = {"logo.png"}
CENTER_HOLE = {"minimap-frame.png", "speedometer.png"}
THRESHOLDS  = [52, 40, 28, 16, 10]   # most aggressive first


def load_original(number: int, cap: int) -> Image.Image:
    path = os.path.join(SRC, f"{number} {STEP1[number][0]}")
    im = Image.open(path).convert("RGBA")
    if max(im.size) > cap:
        r = cap / max(im.size)
        im = im.resize((max(1, round(im.width * r)), max(1, round(im.height * r))), Image.LANCZOS)
    return im


def luma_ramp_alpha(im: Image.Image, lo: int = 6, hi: int = 54) -> Image.Image:
    """Glow-on-black: brightness becomes opacity. Nothing to protect."""
    w, h = im.size
    alpha = Image.new("L", (w, h))
    src, dst = im.load(), alpha.load()
    span = max(1, hi - lo)
    for y in range(h):
        for x in range(w):
            r, g, b, _ = src[x, y]
            m = max(r, g, b)
            t = 0 if m <= lo else 255 if m >= hi else int((m - lo) * 255 / span)
            dst[x, y] = t
    return alpha


def flood_alpha(im: Image.Image, thresh: int, center_hole: bool = False) -> tuple:
    """Remove black connected to the border (and optionally to the centre).
    Returns (alpha, removed_fraction)."""
    w, h = im.size
    src = im.load()
    g = Image.new("L", (w, h))
    gp = g.load()
    for y in range(h):
        for x in range(w):
            r, gg, b, _ = src[x, y]
            gp[x, y] = 0 if max(r, gg, b) <= thresh else 255

    # 1px black pad => every border pixel touches it, so ONE seed reaches all
    # border-connected black even if it's L-shaped.
    pad = Image.new("L", (w + 2, h + 2), 0)
    pad.paste(g, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128, thresh=0)
    if center_hole:
        cx, cy = w // 2 + 1, h // 2 + 1
        if pad.getpixel((cx, cy)) == 0:
            ImageDraw.floodfill(pad, (cx, cy), 64, thresh=0)
    pad = pad.crop((1, 1, w + 1, h + 1))

    alpha = Image.new("L", (w, h))
    ap, pp, removed = alpha.load(), pad.load(), 0
    for y in range(h):
        for x in range(w):
            v = pp[x, y]
            if v == 128 or v == 64:
                ap[x, y] = 0
                removed += 1
            else:
                ap[x, y] = 255
    return alpha, removed / (w * h)


def corner_ok(alpha: Image.Image) -> bool:
    w, h = alpha.size
    pts = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2),
           (w // 2, 1), (1, h // 2), (w - 2, h // 2), (w // 2, h - 2)]
    return all(alpha.getpixel(p) <= 8 for p in pts)


def centre_ok(alpha: Image.Image, want_hole: bool, ramp: bool = False) -> bool:
    """The cut must leave the subject intact at the middle of the image.
    Ramped glow art has soft edges, so it is judged more leniently."""
    w, h = alpha.size
    v = alpha.getpixel((w // 2, h // 2))
    if want_hole:
        return v <= 12
    return v >= (128 if ramp else 240)


def build(name: str, number: int, cap: int):
    im = load_original(number, cap)
    want_hole = name in CENTER_HOLE

    if name in RAMP:
        alpha = luma_ramp_alpha(im)
        method = "ramp"
        if name in HYBRID:
            veil, _ = flood_alpha(im, 28, center_hole=want_hole)
            vp, ap = veil.load(), alpha.load()
            for y in range(alpha.height):
                for x in range(alpha.width):
                    if vp[x, y] == 0:
                        ap[x, y] = 0
            method = "ramp+flood(t=28)"
        ok = corner_ok(alpha) and centre_ok(alpha, want_hole, ramp=True)
    else:
        ok, alpha, removed, method = False, None, None, None
        for t in THRESHOLDS:                      # aggressive -> conservative
            cand, frac = flood_alpha(im, t, center_hole=want_hole)
            method = f"flood(t={t})"
            alpha, removed = cand, frac
            if corner_ok(alpha) and centre_ok(alpha, want_hole) and frac <= 0.85:
                ok = True
                break

    if not ok:
        return name, None, None, method, "FAILED verification", None

    alpha = alpha.filter(ImageFilter.GaussianBlur(1.0))   # feather the cut
    out = im.copy()
    out.putalpha(alpha)

    q = out.quantize(colors=256, method=Image.FASTOCTREE)
    dst = os.path.join(DST, name)
    q.save(dst, "PNG", optimize=True)
    return name, im.size, q.size, method, "ok", os.path.getsize(dst)


def main() -> int:
    os.makedirs(DST, exist_ok=True)
    for f in os.listdir(DST):                      # start clean
        os.remove(os.path.join(DST, f))

    total = 0
    failures = 0
    print(f"{'file':26s} {'size':11s} {'method':14s} {'KB':>5s}  status")
    for number, (name, cap) in sorted(STEP1.items()):
        name_, src_size, out_size, method, status, size = build(name, number, cap)
        if status != "ok":
            failures += 1
            print(f"{name_:26s} {str(src_size):11s} {str(method):14s} {'-':>5s}  {status}")
            continue
        total += size
        print(f"{name_:26s} {out_size[0]}x{out_size[1]:<6d} {method:14s} "
              f"{size//1024:5d}  ok")

    print(f"\nStep-1 art: {len(STEP1)} files, {total/1024:.0f} KB total "
          f"({len(STEP1)-failures} ok, {failures} failed)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
