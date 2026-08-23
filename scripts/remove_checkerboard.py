"""Remove a bright neutral checkerboard connected to image borders.

This intentionally preserves bright hair and clothing enclosed by dark line art.
It is a deterministic post-process for the generated mascot assets.
"""

from collections import deque
from pathlib import Path
import sys

from PIL import Image, ImageFilter


def is_background(pixel):
    r, g, b, _ = pixel
    spread = max(r, g, b) - min(r, g, b)
    return min(r, g, b) >= 226 and spread <= 13


def remove(source: Path, destination: Path):
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    background = bytearray(width * height)
    queue = deque()

    def add(x, y):
        index = y * width + x
        if not background[index] and is_background(pixels[x, y]):
            background[index] = 1
            queue.append((x, y))

    for x in range(width):
        add(x, 0)
        add(x, height - 1)
    for y in range(height):
        add(0, y)
        add(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < width and 0 <= ny < height:
                add(nx, ny)

    mask = Image.new("L", image.size, 255)
    mask_pixels = mask.load()
    for y in range(height):
        row = y * width
        for x in range(width):
            if background[row + x]:
                mask_pixels[x, y] = 0

    mask = mask.filter(ImageFilter.GaussianBlur(0.45))
    image.putalpha(mask)
    image.thumbnail((720, 720), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "WEBP", quality=92, method=6)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: remove_checkerboard.py SOURCE DESTINATION")
    remove(Path(sys.argv[1]), Path(sys.argv[2]))
