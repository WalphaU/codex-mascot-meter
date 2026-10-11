"""Convert a 4x2 ImageGen sheet into a transparent, anchored WebP atlas."""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


GRID_COLUMNS = 4
GRID_ROWS = 2
CELL_SIZE = 360
SAFE_WIDTH = 330
SAFE_HEIGHT = 340


def remove_magenta(image: Image.Image) -> Image.Image:
    pixels = np.asarray(image.convert("RGBA"), dtype=np.float32)
    red, green, blue = pixels[..., 0], pixels[..., 1], pixels[..., 2]
    dominance = np.minimum(red, blue) - green
    keyed = (dominance > 48) & (red > 145) & (blue > 145)
    alpha = np.full(red.shape, 255.0, dtype=np.float32)
    alpha[keyed] = np.clip((150.0 - dominance[keyed]) * (255.0 / 102.0), 0.0, 255.0)
    alpha = np.clip(alpha, 0.0, 255.0)

    # Undo the magenta contribution at antialiased edges to avoid a pink halo.
    soft = keyed & (alpha > 0)
    fraction = np.maximum(alpha / 255.0, 1e-4)
    for channel in (0, 2):
        source = pixels[..., channel]
        corrected = (source - (1.0 - fraction) * 255.0) / fraction
        source[soft] = np.clip(corrected[soft], 0.0, 255.0)
    pixels[..., 1][soft] = np.clip((green / fraction)[soft], 0.0, 255.0)
    pixels[..., 3] = alpha
    return Image.fromarray(pixels.astype(np.uint8), "RGBA")


def frame_bounds(frame: Image.Image) -> tuple[int, int, int, int]:
    alpha = frame.getchannel("A")
    bounds = alpha.point(lambda value: 255 if value >= 12 else 0).getbbox()
    return bounds or (0, 0, frame.width, frame.height)


def build_atlas(source: Path, destination: Path) -> None:
    sheet = Image.open(source).convert("RGBA")
    cell_width = sheet.width // GRID_COLUMNS
    cell_height = sheet.height // GRID_ROWS
    frames: list[Image.Image] = []
    bounds: list[tuple[int, int, int, int]] = []

    for row in range(GRID_ROWS):
        for column in range(GRID_COLUMNS):
            box = (
                column * cell_width,
                row * cell_height,
                (column + 1) * cell_width,
                (row + 1) * cell_height,
            )
            frame = remove_magenta(sheet.crop(box))
            frames.append(frame)
            bounds.append(frame_bounds(frame))

    max_width = max(right - left for left, _top, right, _bottom in bounds)
    common_top = min(top for _left, top, _right, _bottom in bounds)
    common_floor = max(bottom for _left, _top, _right, bottom in bounds)
    scale = min(SAFE_WIDTH / max_width, SAFE_HEIGHT / (common_floor - common_top))
    atlas = Image.new("RGBA", (CELL_SIZE * GRID_COLUMNS, CELL_SIZE * GRID_ROWS), (0, 0, 0, 0))

    for index, (frame, box) in enumerate(zip(frames, bounds)):
        left, top, right, bottom = box
        subject = frame.crop(box)
        width = max(1, round(subject.width * scale))
        height = max(1, round(subject.height * scale))
        subject = subject.resize((width, height), Image.Resampling.LANCZOS)
        source_center = cell_width / 2
        x = index % GRID_COLUMNS * CELL_SIZE + round(CELL_SIZE / 2 + (left - source_center) * scale)
        y = index // GRID_COLUMNS * CELL_SIZE + round(CELL_SIZE - 6 - (common_floor - top) * scale)
        atlas.alpha_composite(subject, (x, y))

    destination.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(destination, "WEBP", lossless=True, method=6)
    print(f"{source.name}: {sheet.width}x{sheet.height} -> {destination.name} ({destination.stat().st_size} bytes)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    build_atlas(args.input, args.output)


if __name__ == "__main__":
    main()
