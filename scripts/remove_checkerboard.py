"""Remove a bright neutral checkerboard connected to image borders.

This intentionally preserves bright hair and clothing enclosed by dark line art.
It is a deterministic post-process for the generated mascot assets.
"""

from collections import deque
from pathlib import Path
import sys

from PIL import Image, ImageFilter


def is_background(pixel, dark_background=False):
    r, g, b, _ = pixel
    spread = max(r, g, b) - min(r, g, b)
    if dark_background:
        # Some generations render the requested transparency as a neutral
        # black-to-gray studio gradient. Flood only low-saturation pixels
        # connected to the canvas edge so enclosed white hair stays intact.
        return max(r, g, b) <= 248 and spread <= 20
    return min(r, g, b) >= 226 and spread <= 13


def remove(source: Path, destination: Path):
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    pixels = image.load()
    corner_luma = sum(sum(pixels[x, y][:3]) / 3 for x, y in (
        (0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)
    )) / 4
    dark_background = corner_luma < 64
    background = bytearray(width * height)
    queue = deque()

    def add(x, y):
        index = y * width + x
        if not background[index] and is_background(pixels[x, y], dark_background):
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

    # Desktop-pet sprites need a compact alpha canvas so the character fills
    # the transparent Electron window without being clipped during motion.
    bounds = image.getbbox()
    if bounds:
        left, top, right, bottom = bounds
        margin = max(10, round(max(right - left, bottom - top) * 0.035))
        image = image.crop((
            max(0, left - margin),
            max(0, top - margin),
            min(width, right + margin),
            min(height, bottom + margin),
        ))
    image.thumbnail((720, 720), Image.Resampling.LANCZOS)
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.save(destination, "WEBP", quality=92, method=6)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: remove_checkerboard.py SOURCE DESTINATION")
    remove(Path(sys.argv[1]), Path(sys.argv[2]))
