#!/usr/bin/env python3
"""world-art.py — Step 2/3 art pipeline for the 41 non-HUD originals.

The 19 HUD overlays were done by tools/hud-art.py (Step 1). These 41 need the
*opposite* treatment in several cases, so they are split by role instead of
being run through one rule:

  TILE   road, sidewalk, facades, racing line — these repeat across geometry.
         Background removal would punch holes in a tiling surface, so they are
         resized + quantised ONLY and stay fully opaque.
  SPRITE cars, weapon art, cone, tree, streetlight, tram, parked car — objects
         photographed on black. The border-connected flood removes the black
         (a colour key would also eat tyres, which are themselves near-black)
         and the result is a clean cut-out usable in the garage and the world.
  CARD   driver portraits, brand billboards, app icon, loading screen —
         rectangular panels shown whole. Opaque, resized + quantised.

Originals are read-only from /sdcard and are never modified. Output goes to
public/art/ with the *clean* name (the originals carry a numeric prefix, e.g.
"20 car-falcon.png" -> "car-falcon.png").

Usage:  python3 tools/world-art.py            # process + verify
        python3 tools/world-art.py --dry      # show the plan only
"""
import os
import sys

from PIL import Image, ImageDraw

SRC = os.environ.get(
    "RK_ART_SRC", "/storage/emulated/0/Road kill/copy images/renamed")
DST = os.environ.get(
    "RK_ART_DST",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                 "public", "art"))

DRY = "--dry" in sys.argv

# original filename (cleaned) -> (category, longest-edge cap)
# cap ~= 2x on-screen pixels, so the asset stays sharp without bloating the repo.
PLAN = {
    # ---- TILE: tiling world surfaces, must stay opaque -------------------
    "texture-road.png": ("TILE", 512),
    "texture-sidewalk.png": ("TILE", 512),
    "building-facade-1.png": ("TILE", 512),
    "building-facade-2.png": ("TILE", 512),
    "building-facade-3.png": ("TILE", 512),
    "racing-line-glow.png": ("TILE", 384),

    # ---- SPRITE: object-on-black cut-outs --------------------------------
    "car-falcon.png": ("SPRITE", 384),
    "car-nebula.png": ("SPRITE", 384),
    "car-bulwark.png": ("SPRITE", 384),
    "car-tortoise.png": ("SPRITE", 384),
    "car-trike.png": ("SPRITE", 384),
    "car-volt.png": ("SPRITE", 384),
    "car-volt-stowed.png": ("SPRITE", 384),
    "icon-rocket.png": ("SPRITE", 192),
    "icon-mg.png": ("SPRITE", 192),
    "icon-mine.png": ("SPRITE", 192),
    "icon-shield.png": ("SPRITE", 192),
    "icon-plasma.png": ("SPRITE", 192),
    "icon-railgun.png": ("SPRITE", 192),
    "icon-emp.png": ("SPRITE", 192),
    "icon-swarm.png": ("SPRITE", 192),
    "texture-cone.png": ("SPRITE", 256),
    "texture-tree.png": ("SPRITE", 256),
    "streetlight.png": ("SPRITE", 256),
    "tram.png": ("SPRITE", 384),
    "parkedcar.png": ("SPRITE", 384),

    # ---- CARD: whole rectangular panels, opaque --------------------------
    "ava.png": ("CARD", 256),
    "rex.png": ("CARD", 256),
    "mia.png": ("CARD", 256),
    "leo.png": ("CARD", 256),
    "zoe.png": ("CARD", 256),
    "max.png": ("CARD", 256),
    "ivy.png": ("CARD", 256),
    "omar.png": ("CARD", 256),
    "nia.png": ("CARD", 256),
    "nitro-cola.png": ("CARD", 384),
    "turbo-tires.png": ("CARD", 384),
    "octane-oil.png": ("CARD", 384),
    "volta-cells.png": ("CARD", 384),
    "app-icon.png": ("CARD", 192),
    "loading-screen.png": ("CARD", 512),
}

# Highest first: keep the strongest cut that still leaves the subject intact.
THRESHOLDS = (40, 34, 28, 22, 18)


def resolve(name: str) -> str:
    """Originals are numbered ("20 car-falcon.png"); output is clean."""
    if os.path.exists(os.path.join(SRC, name)):
        return os.path.join(SRC, name)
    for f in sorted(os.listdir(SRC)):
        if f.endswith(name):
            return os.path.join(SRC, f)
    raise FileNotFoundError(name)


def load(name: str, cap: int) -> Image.Image:
    im = Image.open(resolve(name)).convert("RGBA")
    if max(im.size) > cap:
        r = cap / max(im.size)
        im = im.resize((max(1, round(im.width * r)),
                        max(1, round(im.height * r))), Image.LANCZOS)
    return im


def flood_alpha(im: Image.Image, thresh: int) -> tuple:
    """Remove black connected to the border. Returns (alpha, removed_fraction).

    A colour key is not usable here: these sprites are neon-on-black and their
    own dark parts (tyres, shadow, window tint) are as black as the backdrop.
    Only black that reaches the border is background, so a flood is the only
    correct cut. A 1px black pad makes every border pixel touch the seed, so
    one flood reaches an L-shaped backdrop.
    """
    w, h = im.size
    src = im.load()
    g = Image.new("L", (w, h))
    gp = g.load()
    for y in range(h):
        for x in range(w):
            r, gg, b, _ = src[x, y]
            gp[x, y] = 0 if max(r, gg, b) <= thresh else 255

    pad = Image.new("L", (w + 2, h + 2), 0)
    pad.paste(g, (1, 1))
    ImageDraw.floodfill(pad, (0, 0), 128, thresh=0)
    pad = pad.crop((1, 1, w + 1, h + 1))

    alpha = Image.new("L", (w, h))
    ap, pp, removed = alpha.load(), pad.load(), 0
    for y in range(h):
        for x in range(w):
            if pp[x, y] == 128:
                ap[x, y] = 0
                removed += 1
            else:
                ap[x, y] = 255
    return alpha, removed / (w * h)


def corners_transparent(alpha: Image.Image) -> bool:
    w, h = alpha.size
    pts = [(1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2),
           (w // 2, 1), (1, h // 2), (w - 2, h // 2), (w // 2, h - 2)]
    return all(alpha.getpixel(p) <= 8 for p in pts)


def subject_mask(im: Image.Image, thresh: int = 55) -> Image.Image:
    """Where the object actually is, judged on the pristine original.

    "The centre pixel must stay opaque" is a bad test for this art set: a
    streetlight is a thin pole with empty space at the middle of its frame, and
    a dark-hulled car can have its true centre fall on backdrop. Comparing the
    cut against the object's own lit pixels works regardless of where the
    subject sits in the frame.
    """
    w, h = im.size
    src = im.load()
    m = Image.new("L", (w, h))
    mp = m.load()
    for y in range(h):
        for x in range(w):
            r, g, b, _ = src[x, y]
            mp[x, y] = 255 if (0.2126 * r + 0.7152 * g + 0.0722 * b) > thresh else 0
    return m


def subject_kept(mask: Image.Image, alpha: Image.Image) -> float:
    """Fraction of the object's lit pixels the cut left opaque."""
    w, h = mask.size
    sp, ap = mask.load(), alpha.load()
    total = kept = 0
    for y in range(h):
        for x in range(w):
            if sp[x, y]:
                total += 1
                if ap[x, y] >= 200:
                    kept += 1
    return kept / total if total else 1.0


def cut_sprite(im: Image.Image) -> tuple:
    """Strongest threshold that removes the backdrop without eating the object."""
    mask = subject_mask(im)
    best = None
    for t in THRESHOLDS:
        alpha, frac = flood_alpha(im, t)
        if corners_transparent(alpha) and subject_kept(mask, alpha) >= 0.92:
            best = (alpha, frac, t, mask)
            break
        if not corners_transparent(alpha):
            break          # too dark to cut at all — nothing higher will work
    if best is None:       # every threshold ate the subject: take the gentlest
        t = THRESHOLDS[-1]
        alpha, frac = flood_alpha(im, t)
        best = (alpha, frac, t, mask)
    return best


def main() -> int:
    os.makedirs(DST, exist_ok=True)
    rows, total_in, total_out, fails = [], 0, 0, []

    for name, (cat, cap) in PLAN.items():
        src = resolve(name)
        total_in += os.path.getsize(src)

        if DRY:
            rows.append((name, cat, f"{cap}px", "-", "-"))
            continue

        im = load(name, cap)
        alpha = None
        if cat == "SPRITE":
            alpha, frac, t, mask = cut_sprite(im)
            im.putalpha(alpha)
            keep = subject_kept(mask, alpha)
            ok = corners_transparent(alpha) and keep >= 0.92
            note = f"cut@{t} (-{frac * 100:.0f}%, subject {keep * 100:.0f}%)"
            if not ok:
                fails.append(f"{name}: cut damaged the subject ({note})")
        else:
            # TILE/CARD must never become transparent.
            if im.getchannel("A").getextrema()[0] < 255:
                im = Image.merge("RGB", im.convert("RGB").split())
                im = im.convert("RGBA")
                im.putalpha(255)
            note = "opaque"

        # MEDIANCUT only quantises RGB, and RGBA quantise needs FASTOCTREE /
        # libimagequant (neither is guaranteed here). So quantise the colour
        # and put the *exact* cut alpha back afterwards — that keeps the soft
        # anti-aliased sprite edge instead of letting a palette quantiser
        # re-derive it and leave a fringe.
        if cat == "SPRITE":
            cut = im.getchannel("A")
            im = im.convert("RGB").quantize(colors=256,
                                            method=Image.MEDIANCUT).convert("RGBA")
            im.putalpha(cut)
        else:
            im = im.convert("RGB").quantize(colors=256, method=Image.MEDIANCUT)

        out = os.path.join(DST, name)
        im.save(out, optimize=True)
        size = os.path.getsize(out)
        total_out += size
        rows.append((name, cat, f"{Image.open(src).size} -> {im.size}",
                     f"{size // 1024}KB", note))

    print(f"{'file':26} {'cat':6} {'size':22} {'out':7} {'note'}")
    print("-" * 82)
    for r in rows:
        print(f"{r[0][:26]:26} {r[1]:6} {r[2]:22} {r[3]:7} {r[4]}")

    print(f"\nprocessed: {len(rows)}   "
          f"source {total_in // 1024}KB -> output {total_out // 1024}KB "
          f"({total_out / max(total_in, 1) * 100:.1f}%)")

    # ---- verification pass: re-open every file we claim to have written ----
    if not DRY:
        bad = []
        for name, (cat, cap) in PLAN.items():
            p = os.path.join(DST, name)
            if not os.path.exists(p):
                bad.append(f"{name}: missing")
                continue
            im = Image.open(p).convert("RGBA")
            amin, amax = im.getchannel("A").getextrema()
            if cat == "SPRITE":
                if not (amin == 0 and amax == 255):
                    bad.append(f"{name}: alpha {amin}..{amax} (want 0..255)")
                elif not corners_transparent(im.getchannel("A")):
                    bad.append(f"{name}: corners not transparent")
                else:
                    keep = subject_kept(subject_mask(load(name, cap)),
                                        im.getchannel("A"))
                    if keep < 0.92:
                        bad.append(f"{name}: cut ate {100 - keep * 100:.0f}% "
                                   f"of the object")
            else:
                if amin != 255:
                    bad.append(f"{name}: has transparency (tiles/cards must be opaque)")
        for f in fails:
            bad.append(f)
        if bad:
            print("\nVERIFICATION FAILED:")
            for b in bad:
                print("  " + b)
            return 1
        print("verification: all 41 OK "
              "(sprites cut cleanly, tiles/cards fully opaque)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
