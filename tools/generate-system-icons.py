from pathlib import Path

from PIL import Image, ImageChops, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"


def centered_crop(image: Image.Image, side: int, center: tuple[float, float]) -> Image.Image:
    left = round(center[0] - side / 2)
    top = round(center[1] - side / 2)
    return image.crop((left, top, left + side, top + side))


def prepare(image: Image.Image, side: int, center: tuple[float, float]) -> Image.Image:
    cropped = centered_crop(image, side, center)
    resized = cropped.resize((512, 512), Image.Resampling.LANCZOS)
    return resized.filter(ImageFilter.UnsharpMask(radius=0.7, percent=115, threshold=2))


def add_keyline(image: Image.Image, dark: bool) -> Image.Image:
    """Keep the rounded app silhouette readable against matching taskbars."""
    inset = 28
    base = Image.new("RGBA", image.size, (0, 0, 0, 0))
    inner = image.resize(
        (image.width - inset * 2, image.height - inset * 2),
        Image.Resampling.LANCZOS,
    )
    base.alpha_composite(inner, (inset, inset))
    alpha = base.getchannel("A")
    expanded = alpha.filter(ImageFilter.MaxFilter(41))
    ring = ImageChops.subtract(expanded, alpha)
    ring = ring.point(lambda value: round(value * 0.88))
    color = (221, 216, 255, 0) if dark else (63, 59, 79, 0)
    outline = Image.new("RGBA", image.size, color)
    outline.putalpha(ring)
    return Image.alpha_composite(outline, base)


dark_source = Image.open(ASSETS / "app-icon.png").convert("RGBA")
light_source = Image.open(ROOT / "Visual Vault Big Light.png").convert("RGBA")

# Both supplied Big logos share identical geometry. Reusing the audited dark
# silhouette removes the white canvas from the light artwork without changing
# its internal light materials or purple accents.
light_source.putalpha(dark_source.getchannel("A"))

alpha_box = dark_source.getchannel("A").getbbox()
if not alpha_box:
    raise RuntimeError("Dark logo has no visible pixels")

center = ((alpha_box[0] + alpha_box[2]) / 2, (alpha_box[1] + alpha_box[3]) / 2)

outputs = {
    "system-icon-dark.png": add_keyline(prepare(dark_source, 920, center), True),
    "system-icon-light.png": add_keyline(prepare(light_source, 920, center), False),
    "tray-icon-dark.png": prepare(dark_source, 760, center),
    "tray-icon-light.png": prepare(light_source, 760, center),
}

for name, image in outputs.items():
    image.save(ASSETS / name, optimize=True)
    image.resize((32, 32), Image.Resampling.LANCZOS).save(
        ROOT / ".qa" / f"preview-32-{name}", optimize=True
    )
    image.resize((16, 16), Image.Resampling.LANCZOS).save(
        ROOT / ".qa" / f"preview-16-{name}", optimize=True
    )

print("Generated:", ", ".join(outputs))
