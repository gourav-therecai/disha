from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMAGE_PIXELS = 25_000_000
FORMATS = ("JPEG", "PNG", "WEBP")


def normalize_visit_photo(upload):
    """Validate raster content and store one smaller JPEG without metadata."""
    if upload.size > MAX_UPLOAD_BYTES:
        raise ValueError("The visit photo must be 5 MB or smaller.")
    try:
        with Image.open(upload, formats=FORMATS) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise ValueError("The visit photo must be 25 megapixels or smaller.")
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((1600, 1600))
            image.info.clear()
            output = BytesIO()
            image.save(output, format="JPEG", quality=85)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("Choose a valid JPEG, PNG or WebP photo.") from exc
