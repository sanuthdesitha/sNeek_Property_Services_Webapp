import base64
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import time
import unicodedata
import uuid


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def unit(vector):
    if not vector or len(vector) > 8192 or any(not math.isfinite(value) for value in vector):
        raise ValueError("Invalid image representation.")
    length = math.sqrt(sum(value * value for value in vector))
    if length <= 0:
        raise ValueError("Empty image representation.")
    return [value / length for value in vector]


def signature(label):
    return tuple(" ".join(unicodedata.normalize("NFKC", label[key]).lower().split()) for key in ("label", "sectionLabel"))


def decode(image):
    if image["mediaType"] not in ("image/jpeg", "image/png", "image/webp", "image/gif") or len(image["data"]) > 7_000_000:
        raise ValueError("Unsupported image.")
    try:
        data = base64.b64decode(image["data"], validate=True)
    except Exception as error:
        raise ValueError("Invalid image encoding.") from error
    if not data or len(data) > 5 * 1024 * 1024:
        raise ValueError("Image exceeds the size limit.")
    return data


@contextmanager
def property_lock(directory):
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / ".lock").open("a+b") as handle:
        if handle.tell() == 0:
            handle.write(b"0")
            handle.flush()
        handle.seek(0)
        if os.name == "nt":
            import msvcrt
            deadline = time.monotonic() + 600
            while True:
                try:
                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise RuntimeError("Property training is busy.")
                    time.sleep(.1)
            try:
                yield
            finally:
                handle.seek(0)
                msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def atomic_json(path, value):
    temporary = path.with_name(f".{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("x", encoding="utf-8") as output:
            json.dump(value, output, allow_nan=False, separators=(",", ":"))
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        if os.name != "nt":
            descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
    finally:
        temporary.unlink(missing_ok=True)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


class RevisionConflict(ValueError):
    pass


class Engine:
    """Fixed visual encoder + separately trained, versioned property prototypes.

    Validation jobs never enter prototypes. Confidence is a conservative visual
    similarity/ambiguity score, not a calibrated probability of correctness.
    """
    def __init__(self, root, encoder):
        self.root = Path(root)
        self.encoder = encoder

    def directory(self, property_id):
        if not property_id or len(property_id) > 200:
            raise ValueError("Invalid property identity.")
        return self.root / hashlib.sha256(property_id.encode()).hexdigest()

    def rank(self, vector, prototypes):
        scores = sorted(((sum(a * b for a, b in zip(vector, prototype)), key) for key, prototype in prototypes.items() if len(vector) == len(prototype)), reverse=True)
        if len(scores) < 2:
            return None, 0.0
        similarity, field = scores[0]
        margin = similarity - scores[1][0]
        confidence = max(0, min(1, (similarity + 1) / 2)) * min(1, max(0, margin) / .2)
        if similarity < .25 or margin < .05:
            return None, confidence
        return field, confidence

    def evaluate(self, vectors, prototypes):
        totals, correct = {}, {}
        for row, vector in vectors:
            field = row["sectionId"]
            predicted, confidence = self.rank(vector, prototypes)
            totals[field] = totals.get(field, 0) + 1
            correct[field] = correct.get(field, 0) + int(predicted == field and confidence >= .8)
        accuracy = sum(correct.values()) / sum(totals.values())
        balanced = sum(correct.get(field, 0) / count for field, count in totals.items()) / len(totals)
        return {"accuracy": accuracy, "balancedAccuracy": balanced, "validationExamples": sum(totals.values())}

    def train(self, property_id, request):
        directory = self.directory(property_id)
        request_digest = digest(request)
        version = hashlib.sha256((property_id + "\0" + request["revision"]).encode()).hexdigest()
        with property_lock(directory):
            versions = directory / "versions"
            versions.mkdir(exist_ok=True)
            version_path = versions / f"{version}.json"
            existing = read_json(version_path)
            if existing:
                if existing["requestDigest"] != request_digest:
                    raise RevisionConflict("This revision was already submitted with different examples.")
                return existing["response"]
            # The immutable artifact is the only commit record. Derive the last
            # promoted baseline so a crash cannot split a version receipt from
            # a separately written active pointer.
            promoted = [read_json(path) for path in versions.glob("*.json")]
            promoted = [row for row in promoted if row["response"]["status"] == "promoted"]
            previous = max(promoted, key=lambda row: row.get("generation", 0)) if promoted else None

            labels = {label["id"]: label for label in request["labels"]}
            examples = request["examples"]
            if len(labels) != len(request["labels"]) or len({row["id"] for row in examples}) != len(examples) or any(row["sectionId"] not in labels for row in examples):
                raise ValueError("Duplicate or unknown training labels.")
            # Re-uploading identical bytes under another job must not leak the
            # same photograph into training and held-out validation sets.
            unique_examples, content_seen, content_by_id = [], {}, {}
            total_bytes = 0
            for row in examples:
                raw = decode(row["image"])
                total_bytes += len(raw)
                if total_bytes > 100 * 1024 * 1024:
                    raise ValueError("Training library exceeds 100 MB.")
                content_hash = hashlib.sha256(raw).hexdigest()
                duplicate = content_seen.get(content_hash)
                if duplicate:
                    if duplicate["sectionId"] != row["sectionId"]:
                        raise ValueError("Identical photographs have conflicting section labels.")
                    continue
                content_seen[content_hash] = row
                content_by_id[row["id"]] = content_hash
                unique_examples.append(row)
            examples = unique_examples
            artifact = {"propertyId": property_id, "revision": request["revision"], "requestDigest": request_digest, "modelVersion": version, "labels": labels, "generation": (previous.get("generation", 0) if previous else 0) + 1}

            def finish(status, reason, metrics=None):
                response = {"status": status, "reason": reason, **({"modelVersion": version} if status == "promoted" else {}), **({"metrics": metrics} if metrics else {})}
                artifact["response"] = response
                atomic_json(version_path, artifact)
                return response

            jobs_by_class = {field: {row["jobId"] for row in examples if row["sectionId"] == field} for field in labels}
            if len(labels) < 2 or any(len(jobs) < 3 for jobs in jobs_by_class.values()):
                return finish("insufficient_data", "Each of at least two sections needs photos from three distinct jobs.")
            all_jobs = set().union(*jobs_by_class.values())
            heldout = set(previous.get("validationJobIds", [])) & all_jobs if previous else set()
            previous_training = set(previous.get("trainingJobIds", [])) if previous else set()
            previous_content = set(previous.get("trainingContentHashes", [])) if previous else set()
            previous_training.update(row["jobId"] for row in examples if content_by_id[row["id"]] in previous_content)
            heldout -= previous_training
            for field, jobs in jobs_by_class.items():
                if not heldout & jobs:
                    choices = jobs - previous_training
                    if not choices:
                        return finish("insufficient_data", "Fresh validation jobs are needed after the library changed.")
                    heldout.add(sorted(choices, key=lambda job: digest([property_id, job]))[0])
            if any(len(jobs - heldout) < 2 for jobs in jobs_by_class.values()):
                return finish("insufficient_data", "Need two training jobs per section separate from validation jobs.")

            training, validation = [], []
            dimensions = None
            for row in examples:
                raw = decode(row["image"])
                vector = unit(self.encoder.encode(raw))
                if dimensions is not None and dimensions != len(vector):
                    raise ValueError("Inconsistent image representations.")
                dimensions = len(vector)
                (validation if row["jobId"] in heldout else training).append((row, vector))
            prototypes = {}
            for field in labels:
                class_vectors = [vector for row, vector in training if row["sectionId"] == field]
                prototypes[field] = unit([sum(values) / len(class_vectors) for values in zip(*class_vectors)])
            metrics = self.evaluate(validation, prototypes)
            metrics.update({"trainingExamples": len(training), "trainingJobs": len({row["jobId"] for row, _ in training}), "validationJobs": len(heldout), "sections": len(labels)})
            if metrics["accuracy"] < .8 or metrics["balancedAccuracy"] < .8:
                return finish("rejected", "Candidate did not meet the 80% held-out validation threshold.", metrics)
            if previous and previous.get("encoderIdentity") == self.encoder.identity:
                matching = {field: prototype for field, prototype in previous["prototypes"].items() if field in labels and signature(previous["labels"][field]) == signature(labels[field])}
                baseline = self.evaluate(validation, matching)
                metrics["previousAccuracy"] = baseline["accuracy"]
                metrics["previousBalancedAccuracy"] = baseline["balancedAccuracy"]
                if metrics["accuracy"] < baseline["accuracy"] or metrics["balancedAccuracy"] < baseline["balancedAccuracy"]:
                    return finish("rejected", "Candidate regressed against the previous model on the same held-out jobs.", metrics)
            elif previous:
                return finish("rejected", "Encoder changed. A separately validated migration is required.", metrics)
            artifact.update({"encoderIdentity": self.encoder.identity, "prototypes": prototypes, "validationJobIds": sorted(heldout), "trainingJobIds": sorted({row["jobId"] for row, _ in training}), "trainingContentHashes": sorted(content_by_id[row["id"]] for row, _ in training), "exampleIds": [row["id"] for row in examples]})
            return finish("promoted", "Validated property classifier is available for suggestions.", metrics)

    def predict(self, property_id, request):
        directory = self.directory(property_id)
        version = hashlib.sha256((property_id + "\0" + request["libraryRevision"]).encode()).hexdigest()
        artifact = read_json(directory / "versions" / f"{version}.json")
        photos = request["photos"]
        if len({photo["id"] for photo in photos}) != len(photos) or len({field["id"] for field in request["fields"]}) != len(request["fields"]):
            raise ValueError("Duplicate prediction identifiers.")
        def unavailable(reason):
            return {"trained": False, "assignments": [{"photoId": photo["id"], "fieldId": None, "confidence": 0, "reason": reason} for photo in photos]}
        if not artifact or artifact["propertyId"] != property_id or artifact["revision"] != request["libraryRevision"] or artifact["response"]["status"] != "promoted":
            return unavailable("No validated model exists for the current property library.")
        if artifact["encoderIdentity"] != self.encoder.identity:
            return unavailable("The visual encoder changed; model validation is required.")
        fields = {field["id"]: field for field in request["fields"]}
        # Keep all trained prototypes in competition, even when a field is full or
        # hidden. Otherwise a photo of that room could be forced into another room.
        assignments = []
        total_bytes = 0
        for photo in photos:
            raw = decode(photo)
            total_bytes += len(raw)
            if total_bytes > 20 * 1024 * 1024:
                raise ValueError("Prediction batch exceeds 20 MB.")
            field, confidence = self.rank(unit(self.encoder.encode(raw)), artifact["prototypes"])
            if field not in fields or signature(fields[field]) != signature(artifact["labels"][field]):
                field = None
            assignments.append({"photoId": photo["id"], "fieldId": field, "confidence": confidence, "reason": "Matches validated property location examples; confirm before applying." if field else "Location is ambiguous, unavailable, or its label changed. Assign manually."})
        return {"trained": True, "modelVersion": artifact["modelVersion"], "assignments": assignments}
