"""Split a generated checkerboard sprite sheet into aligned transparent WebP frames."""

from collections import deque
from pathlib import Path
import argparse

from PIL import Image, ImageFilter


def is_bright_neutral(pixel):
    r, g, b, _ = pixel
    return min(r, g, b) >= 222 and max(r, g, b) - min(r, g, b) <= 18


def clear_connected_background(image):
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    background = bytearray(width * height)
    queue = deque()

    def add(x, y):
        index = y * width + x
        if not background[index] and is_bright_neutral(pixels[x, y]):
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
    image.putalpha(mask.filter(ImageFilter.GaussianBlur(0.35)))
    return image


def clear_chroma_magenta(image):
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, _ = pixels[x, y]
            chroma = min(r, b) - g
            if r > 155 and b > 155 and abs(r - b) < 34 and chroma > 36:
                alpha = max(0, min(255, round((82 - chroma) / 46 * 255)))
                if alpha == 0:
                    pixels[x, y] = (0, 0, 0, 0)
                elif alpha < 255:
                    coverage = alpha / 255
                    foreground = (
                        max(0, min(255, round((r - (1 - coverage) * 255) / coverage))),
                        max(0, min(255, round(g / coverage))),
                        max(0, min(255, round((b - (1 - coverage) * 255) / coverage))),
                        alpha,
                    )
                    pixels[x, y] = foreground
    alpha = image.getchannel("A")
    alpha_pixels = alpha.load()
    visited = bytearray(image.width * image.height)
    components = []
    for y in range(image.height):
        for x in range(image.width):
            index = y * image.width + x
            if visited[index] or alpha_pixels[x, y] <= 24:
                continue
            visited[index] = 1
            queue = deque([(x, y)])
            component = []
            while queue:
                cx, cy = queue.popleft()
                component.append((cx, cy))
                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if 0 <= nx < image.width and 0 <= ny < image.height:
                        neighbor = ny * image.width + nx
                        if not visited[neighbor] and alpha_pixels[nx, ny] > 24:
                            visited[neighbor] = 1
                            queue.append((nx, ny))
            components.append(component)

    if components:
        keep = set(max(components, key=len))
        for y in range(image.height):
            for x in range(image.width):
                if (x, y) not in keep:
                    alpha_pixels[x, y] = 0
    image.putalpha(alpha.filter(ImageFilter.MinFilter(3)))
    return image


def split(source, output_dir, prefix, columns, rows, chroma_magenta=False):
    sheet = Image.open(source).convert("RGBA")
    cell_width = sheet.width // columns
    cell_height = sheet.height // rows
    output_dir.mkdir(parents=True, exist_ok=True)

    for index in range(columns * rows):
        column = index % columns
        row = index // columns
        cell = sheet.crop((
            column * cell_width,
            row * cell_height,
            (column + 1) * cell_width,
            (row + 1) * cell_height,
        ))
        cell = clear_chroma_magenta(cell) if chroma_magenta else clear_connected_background(cell)
        cell.thumbnail((720, 720), Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (720, 720), (0, 0, 0, 0))
        canvas.alpha_composite(cell, ((720 - cell.width) // 2, 0))
        destination = output_dir / f"{prefix}-{index + 1:02d}.webp"
        canvas.save(destination, "WEBP", lossless=True, method=6)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("prefix")
    parser.add_argument("--columns", type=int, default=4)
    parser.add_argument("--rows", type=int, default=2)
    parser.add_argument("--chroma-magenta", action="store_true")
    args = parser.parse_args()
    split(args.source, args.output_dir, args.prefix, args.columns, args.rows, args.chroma_magenta)


if __name__ == "__main__":
    main()
