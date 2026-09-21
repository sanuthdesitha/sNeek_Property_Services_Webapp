import base64
from concurrent.futures import ThreadPoolExecutor
import copy
import json
import threading

from fastapi.testclient import TestClient
import pytest

from recognition.app import create_app
from recognition.engine import Engine, RevisionConflict

TOKEN = "synthetic-model-service-token-only"


class FakeEncoder:
    identity = "synthetic-encoder-v1"
    def __init__(self):
        self.calls = 0
        self.lock = threading.Lock()
    def encode(self, data):
        with self.lock:
            self.calls += 1
        return {b"A": [1., 0.], b"B": [0., 1.], b"ambiguous": [1., 1.]}[data.split(b":")[0]]


def image(value):
    return {"mediaType": "image/jpeg", "data": base64.b64encode(value.encode()).decode()}


def training(revision="r1", jobs=3):
    return {"revision": revision, "labels": [{"id": "a", "label": "Bed", "sectionLabel": "Bedroom one"}, {"id": "b", "label": "Bed", "sectionLabel": "Bedroom two"}],
            "examples": [{"id": f"{job}-{field}", "sectionId": field, "jobId": f"job-{job}", "image": image(f"{field.upper()}:{job}")} for job in range(jobs) for field in ("a", "b")]}


def prediction(revision="r1"):
    return {"libraryRevision": revision, "photos": [{"id": "photo", **image("A")}], "fields": training()["labels"]}


@pytest.fixture
def engine(tmp_path):
    return Engine(tmp_path, FakeEncoder())


def test_separate_job_validation_promotes_and_predicts(engine):
    result = engine.train("property", training())
    assert result["status"] == "promoted"
    assert result["metrics"]["accuracy"] == 1
    artifact = json.loads(next((engine.directory("property") / "versions").glob("*.json")).read_text())
    assert set(artifact["trainingJobIds"]).isdisjoint(artifact["validationJobIds"])
    assert len(artifact["trainingJobIds"]) == 2
    assert "image" not in artifact and "examples" not in artifact
    prediction_result = engine.predict("property", prediction())
    assert prediction_result["modelVersion"] == result["modelVersion"]
    assert prediction_result["assignments"][0]["fieldId"] == "a"


def test_insufficient_jobs_never_encode_or_activate(engine):
    result = engine.train("property", training(jobs=2))
    assert result["status"] == "insufficient_data"
    assert engine.encoder.calls == 0
    assert engine.predict("property", prediction())["trained"] is False


def test_retry_receipt_is_durable_and_changed_body_conflicts(engine):
    first = engine.train("property", training())
    calls = engine.encoder.calls
    reloaded = Engine(engine.root, engine.encoder)
    assert reloaded.train("property", training()) == first
    assert engine.encoder.calls == calls
    different = training()
    different["labels"][0]["label"] = "Different"
    with pytest.raises(RevisionConflict):
        engine.train("property", different)


def test_concurrent_duplicate_training_encodes_only_once(engine):
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(lambda _: engine.train("property", training()), range(2)))
    assert results[0] == results[1]
    assert engine.encoder.calls == 6


def test_property_and_library_revision_isolation(engine):
    engine.train("first", training())
    assert engine.predict("second", prediction())["trained"] is False
    assert engine.predict("first", prediction("changed-library"))["trained"] is False
    assert engine.predict("first", prediction())["trained"] is True


def test_exact_version_remains_addressable_after_newer_training(engine):
    first = engine.train("property", training("old"))
    newest = engine.train("property", training("new", jobs=4))
    assert newest["status"] == "promoted"
    assert first["modelVersion"] != newest["modelVersion"]
    assert engine.predict("property", prediction("old"))["modelVersion"] == first["modelVersion"]
    assert engine.predict("property", prediction("new"))["modelVersion"] == newest["modelVersion"]


def test_ambiguous_hidden_and_repurposed_sections_abstain(engine):
    engine.train("property", training())
    request = prediction()
    request["photos"][0].update(image("ambiguous"))
    assert engine.predict("property", request)["assignments"][0]["fieldId"] is None
    request = prediction()
    request["fields"] = [request["fields"][1]]
    assert engine.predict("property", request)["assignments"][0]["fieldId"] is None
    request = prediction()
    request["fields"][0]["sectionLabel"] = "Repurposed bathroom"
    assert engine.predict("property", request)["assignments"][0]["fieldId"] is None


def test_bad_validation_rejects_without_promoting(engine):
    request = training()
    for row in request["examples"]:
        row["image"] = image(f"ambiguous:{row['id']}")
    assert engine.train("property", request)["status"] == "rejected"
    assert engine.predict("property", prediction())["trained"] is False


def test_nonregression_guard_rejects_weaker_candidate(engine, monkeypatch):
    engine.train("property", training())
    results = iter([{"accuracy": .8, "balancedAccuracy": .8, "validationExamples": 10}, {"accuracy": 1., "balancedAccuracy": 1., "validationExamples": 10}])
    monkeypatch.setattr(engine, "evaluate", lambda *args: next(results))
    result = engine.train("property", training("r2"))
    assert result["status"] == "rejected"
    assert "regressed" in result["reason"]
    assert engine.predict("property", prediction("r2"))["trained"] is False


def test_encoder_change_does_not_reuse_old_model(engine):
    engine.train("property", training())
    engine.encoder.identity = "changed"
    assert engine.predict("property", prediction())["trained"] is False
    assert engine.train("property", training("new"))["status"] == "rejected"


def test_unknown_or_duplicate_labels_cannot_train(engine):
    request = training()
    request["examples"][0]["sectionId"] = "other"
    with pytest.raises(ValueError):
        engine.train("property", request)
    request = training()
    request["examples"][1]["id"] = request["examples"][0]["id"]
    with pytest.raises(ValueError):
        engine.train("property", request)


def test_authenticated_http_contract_and_validation_does_not_echo_images(engine):
    client = TestClient(create_app(engine, TOKEN))
    assert client.post("/v1/properties/property/train", json=training()).status_code == 401
    headers = {"Authorization": f"Bearer {TOKEN}"}
    response = client.post("/v1/properties/property/train", headers=headers, json=training())
    assert response.status_code == 200 and response.json()["status"] == "promoted"
    response = client.post("/v1/properties/property/predict", headers=headers, json=prediction())
    assert response.status_code == 200 and response.json()["trained"] is True
    invalid = prediction()
    invalid["photos"][0]["data"] = "sensitive raw image"
    response = client.post("/v1/properties/property/predict", headers=headers, json=invalid)
    assert response.status_code == 422
    assert "sensitive" not in response.text
    assert client.post("/v1/properties/property/train", headers=headers, json={**training(), "token": "unexpected"}).status_code == 422


def test_http_revision_conflict_and_missing_service_secret(engine):
    client = TestClient(create_app(engine, TOKEN))
    headers = {"Authorization": f"Bearer {TOKEN}"}
    client.post("/v1/properties/property/train", headers=headers, json=training())
    request = training()
    request["labels"][0]["label"] = "Changed"
    assert client.post("/v1/properties/property/train", headers=headers, json=request).status_code == 409
    assert TestClient(create_app(engine, "short")).get("/health").status_code == 503


def test_safe_storage_paths_do_not_escape_root(engine):
    directory = engine.directory("../../outside")
    assert directory.parent == engine.root
    assert len(directory.name) == 64


def test_reuploaded_identical_content_cannot_fake_independent_jobs(engine):
    request = training()
    for row in request["examples"]:
        row["image"] = image(row["sectionId"].upper())
    result = engine.train("property", request)
    assert result["status"] == "insufficient_data"
    assert engine.encoder.calls == 0


def test_identical_content_with_conflicting_labels_is_rejected(engine):
    request = training()
    request["examples"][1]["image"] = request["examples"][0]["image"]
    with pytest.raises(ValueError, match="conflicting"):
        engine.train("property", request)


def test_baseline_survives_restart_without_a_separate_active_pointer(engine):
    engine.train("property", training("first"))
    assert not (engine.directory("property") / "active.json").exists()
    reloaded = Engine(engine.root, engine.encoder)
    result = reloaded.train("property", training("second", jobs=4))
    assert result["status"] == "promoted"
    assert result["metrics"]["previousAccuracy"] == 1


def test_previous_training_bytes_reuploaded_under_new_job_cannot_be_validation(engine):
    engine.train("property", training())
    previous = json.loads(next((engine.directory("property") / "versions").glob("*.json")).read_text())
    training_jobs = previous["trainingJobIds"]
    request = training("new")
    for row in request["examples"]:
        index = int(row["jobId"].split("-")[1])
        row["jobId"] = f"new-job-{index}"
        suffix = training_jobs[index].split("-")[1] if index < 2 else "new-unseen"
        row["image"] = image(f"{row['sectionId'].upper()}:{suffix}")
    result = engine.train("property", request)
    assert result["status"] == "promoted"
    artifact = json.loads((engine.directory("property") / "versions" / f"{result['modelVersion']}.json").read_text())
    assert artifact["validationJobIds"] == ["new-job-2"]
