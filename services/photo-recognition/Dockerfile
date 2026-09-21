FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu 'torch>=2.5,<3' torchvision && pip install --no-cache-dir -r requirements.txt
COPY recognition ./recognition
RUN useradd --create-home recognition && mkdir -p /data/models && chown -R recognition:recognition /data /app
USER recognition
ENV MODEL_DEVICE=cpu MODEL_STORAGE_DIR=/data/models
EXPOSE 8080
CMD ["uvicorn", "recognition.app:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1", "--limit-concurrency", "4", "--timeout-keep-alive", "5"]
