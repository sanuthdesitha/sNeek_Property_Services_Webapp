import json
import os
import secrets
from typing import Literal

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool
from .encoder import OpenClipEncoder
from .engine import Engine, RevisionConflict


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Image(StrictModel):
    mediaType: Literal["image/jpeg", "image/png", "image/webp", "image/gif"]
    data: str = Field(min_length=4, max_length=7_000_000)


class Photo(Image):
    id: str = Field(min_length=1, max_length=200)


class Label(StrictModel):
    id: str = Field(min_length=1, max_length=200)
    label: str = Field(min_length=1, max_length=300)
    sectionLabel: str = Field(max_length=300)


class Example(StrictModel):
    id: str = Field(min_length=1, max_length=200)
    sectionId: str = Field(min_length=1, max_length=200)
    jobId: str = Field(min_length=1, max_length=200)
    image: Image


class TrainingRequest(StrictModel):
    revision: str = Field(min_length=1, max_length=200)
    labels: list[Label] = Field(min_length=1, max_length=100)
    examples: list[Example] = Field(min_length=1, max_length=200)


class PredictionRequest(StrictModel):
    libraryRevision: str = Field(min_length=1, max_length=200)
    photos: list[Photo] = Field(min_length=1, max_length=8)
    fields: list[Label] = Field(min_length=1, max_length=100)


async def read_payload(request, schema, maximum):
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > maximum:
            raise HTTPException(413, "Request exceeds the image batch limit.")
    try:
        return schema.model_validate(json.loads(body)).model_dump()
    except (ValueError, ValidationError):
        # Validation details can contain entire base64 images: never echo them.
        raise HTTPException(422, "Invalid recognition request.") from None


def create_app(engine=None, token=None):
    service = engine or Engine(os.environ.get("MODEL_STORAGE_DIR", "/data/models"), OpenClipEncoder())
    application = FastAPI(title="Property photo recognition", docs_url=None, redoc_url=None, openapi_url=None)

    def authorize(authorization: str | None = Header(default=None)):
        expected = token if token is not None else os.environ.get("MODEL_SERVICE_TOKEN", "")
        if len(expected) < 24:
            raise HTTPException(503, "Recognition service authentication is not configured.")
        supplied = authorization.removeprefix("Bearer ") if authorization and authorization.startswith("Bearer ") else ""
        if not secrets.compare_digest(supplied.encode(), expected.encode()):
            raise HTTPException(401, "Unauthorized", headers={"WWW-Authenticate": "Bearer"})

    async def invoke(method, property_id, payload):
        if not property_id or len(property_id) > 200:
            raise HTTPException(422, "Invalid property identity.")
        try:
            return await run_in_threadpool(method, property_id, payload)
        except RevisionConflict:
            raise HTTPException(409, "Revision already exists with different training data.") from None
        except ValueError:
            raise HTTPException(422, "Invalid image, label, or recognition request.") from None
        except Exception:
            raise HTTPException(503, "Recognition could not complete. Check model provisioning and service health.") from None

    @application.get("/health", dependencies=[Depends(authorize)])
    async def health():
        return {"status": "available", "modelLoaded": service.encoder._model is not None if isinstance(service.encoder, OpenClipEncoder) else True}

    @application.post("/v1/properties/{property_id}/train", dependencies=[Depends(authorize)])
    async def train(property_id: str, request: Request):
        return await invoke(service.train, property_id, await read_payload(request, TrainingRequest, 140 * 1024 * 1024))

    @application.post("/v1/properties/{property_id}/predict", dependencies=[Depends(authorize)])
    async def predict(property_id: str, request: Request):
        return await invoke(service.predict, property_id, await read_payload(request, PredictionRequest, 28 * 1024 * 1024))

    return application


app = create_app()
