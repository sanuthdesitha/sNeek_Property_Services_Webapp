"""A fixed, locally provisioned OpenCLIP encoder, loaded only on first inference."""
import hashlib
import io
import os
from pathlib import Path
import re
import threading


class OpenClipEncoder:
    def __init__(self):
        self._lock = threading.Lock()
        self._model = None
        self._identity = None

    @property
    def identity(self):
        self._load()
        return self._identity

    def _load(self):
        with self._lock:
            if self._model is not None:
                return
            checkpoint = Path(os.environ.get("OPENCLIP_CHECKPOINT", ""))
            model_name = os.environ.get("OPENCLIP_MODEL", "ViT-B-32")
            if not checkpoint.is_file() or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", model_name):
                raise RuntimeError("Provision a local OpenCLIP checkpoint before recognition.")
            import torch
            import open_clip
            device = os.environ.get("MODEL_DEVICE", "cpu")
            if device not in ("cpu", "cuda") or (device == "cuda" and not torch.cuda.is_available()):
                raise RuntimeError("Configured inference device is unavailable.")
            digest = hashlib.sha256()
            with checkpoint.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
            model, _, transform = open_clip.create_model_and_transforms(model_name, pretrained=str(checkpoint), device=device)
            model.eval()
            self._transform = transform
            self._device = device
            self._torch = torch
            self._identity = f"openclip:{model_name}:{digest.hexdigest()}"
            self._model = model

    def encode(self, image_bytes):
        self._load()
        from PIL import Image, ImageOps
        Image.MAX_IMAGE_PIXELS = 40_000_000
        with Image.open(io.BytesIO(image_bytes)) as image:
            if image.width * image.height > 40_000_000 or image.format not in ("JPEG", "PNG", "WEBP", "GIF"):
                raise ValueError("Unsupported image.")
            image = ImageOps.exif_transpose(image).convert("RGB")
            tensor = self._transform(image).unsqueeze(0).to(self._device)
        # Serialize model use to bound CPU/GPU concurrency and memory.
        with self._lock, self._torch.inference_mode():
            features = self._model.encode_image(tensor)
            features = features / features.norm(dim=-1, keepdim=True)
            return features[0].float().cpu().tolist()
