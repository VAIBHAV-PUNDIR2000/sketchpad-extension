#!/usr/bin/env python3
"""Generate the extension icons. Pure stdlib: no Pillow, no build step.

Draws a zinc-900 rounded square with a white scribble, supersampled 4x and
box-filtered down so the small sizes stay clean.
"""
import math
import struct
import sys
import zlib
from pathlib import Path

SS = 4  # supersample factor
BG = (24, 24, 27)       # zinc-900
FG = (250, 250, 250)    # zinc-50


def write_png(path, w, h, px):
    raw = b"".join(b"\x00" + bytes(px[y * w * 4:(y + 1) * w * 4]) for y in range(h))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    out = b"\x89PNG\r\n\x1a\n"
    out += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    out += chunk(b"IDAT", zlib.compress(raw, 9))
    out += chunk(b"IEND", b"")
    Path(path).write_bytes(out)


def in_round_rect(x, y, size, radius):
    r = radius
    cx = min(max(x, r), size - r)
    cy = min(max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def dist_to_segment(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    seg = dx * dx + dy * dy
    t = 0.0 if seg == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size):
    S = size * SS
    radius = S * 0.225
    stroke = S * 0.085

    # A quick three-beat scribble plus a baseline — reads as "sketch" even at 16px.
    pts = [(0.22, 0.62), (0.38, 0.40), (0.50, 0.60), (0.64, 0.34), (0.79, 0.50)]
    scribble = [(x * S, y * S) for x, y in pts]
    base = [(0.22 * S, 0.78 * S), (0.78 * S, 0.78 * S)]

    buf = bytearray(S * S * 4)
    for y in range(S):
        for x in range(S):
            i = (y * S + x) * 4
            if not in_round_rect(x + 0.5, y + 0.5, S, radius):
                continue
            r, g, b = BG
            d = min(
                [dist_to_segment(x + 0.5, y + 0.5, *scribble[k], *scribble[k + 1])
                 for k in range(len(scribble) - 1)]
                + [dist_to_segment(x + 0.5, y + 0.5, *base[0], *base[1])]
            )
            if d <= stroke / 2:
                r, g, b = FG
            buf[i:i + 4] = bytes((r, g, b, 255))

    # box downsample
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            acc = [0, 0, 0, 0]
            for sy in range(SS):
                for sx in range(SS):
                    j = ((y * SS + sy) * S + (x * SS + sx)) * 4
                    for c in range(4):
                        acc[c] += buf[j + c]
            k = (y * size + x) * 4
            n = SS * SS
            out[k:k + 4] = bytes(v // n for v in acc)
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "icons")
    target.mkdir(parents=True, exist_ok=True)
    for s in (16, 32, 48, 128):
        write_png(target / f"icon{s}.png", s, s, render(s))
        print(f"icons/icon{s}.png")
