#!/usr/bin/env python3
"""
Optimize local scene GIF packs.

Default mode is read-only. Use --in-place to actually rewrite files.

Examples:
  py -3 tools/optimize_visual_gifs.py --dry-run
  py -3 tools/optimize_visual_gifs.py --in-place --max-width 640 --colors 96
  py -3 tools/optimize_visual_gifs.py assets/gifs/combat --in-place --max-width 480
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
from tempfile import NamedTemporaryFile

try:
    from PIL import Image, ImageSequence
except ImportError as exc:
    raise SystemExit(
        "Pillow is required: py -3 -m pip install pillow"
    ) from exc


def format_size(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.2f} MB"
    if size >= 1024:
        return f"{size / 1024:.1f} KB"
    return f"{size} B"


def iter_gifs(root: Path):
    if root.is_file() and root.suffix.lower() == ".gif":
        yield root
        return
    if root.is_dir():
        yield from sorted(root.rglob("*.gif"))


def fit_size(width: int, height: int, max_width: int, max_height: int) -> tuple[int, int]:
    scale = 1.0
    if max_width > 0 and width > max_width:
        scale = min(scale, max_width / width)
    if max_height > 0 and height > max_height:
        scale = min(scale, max_height / height)
    if scale >= 1.0:
        return width, height
    return max(1, int(width * scale)), max(1, int(height * scale))


def optimize_gif(
    source: Path,
    *,
    max_width: int,
    max_height: int,
    colors: int,
    min_duration_ms: int,
    max_frames: int,
) -> Path:
    with Image.open(source) as image:
        loop = image.info.get("loop", 0)
        frames = []
        durations = []
        previous_duration = image.info.get("duration", min_duration_ms)

        for index, frame in enumerate(ImageSequence.Iterator(image)):
            if max_frames > 0 and index >= max_frames:
                break

            duration = frame.info.get("duration", previous_duration)
            previous_duration = duration
            durations.append(max(min_duration_ms, int(duration or min_duration_ms)))

            rgba = frame.convert("RGBA")
            target_size = fit_size(rgba.width, rgba.height, max_width, max_height)
            if target_size != rgba.size:
                rgba = rgba.resize(target_size, Image.Resampling.LANCZOS)

            palette_frame = rgba.convert("RGB").quantize(
                colors=max(2, min(256, colors)),
                method=Image.Quantize.MEDIANCUT,
            )
            frames.append(palette_frame)

        if not frames:
            raise ValueError("GIF has no frames")

        temp = NamedTemporaryFile(
            prefix=f"{source.stem}.",
            suffix=".optimized.gif",
            dir=str(source.parent),
            delete=False,
        )
        temp_path = Path(temp.name)
        temp.close()

        frames[0].save(
            temp_path,
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=loop,
            optimize=True,
            disposal=2,
        )
        return temp_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Optimize local scene GIF packs.")
    parser.add_argument("path", nargs="?", default="assets/gifs", help="GIF file or folder to scan.")
    parser.add_argument("--dry-run", action="store_true", help="Only print GIF sizes. This is the default unless --in-place is used.")
    parser.add_argument("--in-place", action="store_true", help="Rewrite GIFs when the optimized result is smaller.")
    parser.add_argument("--max-width", type=int, default=640, help="Maximum output width. 0 keeps original width.")
    parser.add_argument("--max-height", type=int, default=360, help="Maximum output height. 0 keeps original height.")
    parser.add_argument("--colors", type=int, default=96, help="Palette size from 2 to 256.")
    parser.add_argument("--min-duration-ms", type=int, default=70, help="Clamp very short frame durations.")
    parser.add_argument("--max-frames", type=int, default=80, help="Maximum frames to keep. 0 keeps all frames.")
    parser.add_argument("--backup", action="store_true", help="Write .bak copies before replacing files.")
    parser.add_argument("--keep-larger", action="store_true", help="Keep optimized output even if it is larger.")
    args = parser.parse_args()

    root = Path(args.path)
    gifs = list(iter_gifs(root))
    if not gifs:
        print(f"No GIF files found in {root}")
        return 0

    total_before = sum(path.stat().st_size for path in gifs)
    total_after = total_before

    if args.dry_run or not args.in_place:
        print(f"Dry run: {len(gifs)} GIF files, total {format_size(total_before)}")
        for path in sorted(gifs, key=lambda item: item.stat().st_size, reverse=True)[:30]:
            print(f"{format_size(path.stat().st_size):>9}  {path}")
        print("Run with --in-place to compress files.")
        return 0

    for gif in gifs:
        before = gif.stat().st_size
        try:
            optimized = optimize_gif(
                gif,
                max_width=args.max_width,
                max_height=args.max_height,
                colors=args.colors,
                min_duration_ms=args.min_duration_ms,
                max_frames=args.max_frames,
            )
        except Exception as exc:
            print(f"SKIP {gif}: {exc}")
            continue

        after = optimized.stat().st_size
        if after < before or args.keep_larger:
            if args.backup:
                backup = gif.with_suffix(gif.suffix + ".bak")
                if not backup.exists():
                    os.replace(gif, backup)
                else:
                    gif.unlink()
            else:
                gif.unlink()
            os.replace(optimized, gif)
            total_after += after - before
            print(f"OK   {gif}: {format_size(before)} -> {format_size(after)}")
        else:
            optimized.unlink(missing_ok=True)
            print(f"KEEP {gif}: optimized was not smaller ({format_size(before)} <= {format_size(after)})")

    saved = total_before - total_after
    print(f"Total: {format_size(total_before)} -> {format_size(total_after)} saved {format_size(max(0, saved))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
