# LKPR radio trainer.
# Default image is small and does not include faster-whisper.
# Build with --build-arg INSTALL_WHISPER=1 only on a host with at least 2 GB RAM
# (Hugging Face Spaces free CPU is enough; a 512 MB Render instance is not).
FROM python:3.13-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends espeak-ng ffmpeg \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-whisper.txt ./
ARG INSTALL_WHISPER=0
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_WHISPER" = "1" ]; then pip install --no-cache-dir -r requirements-whisper.txt; fi

COPY app ./app
COPY static ./static
COPY data ./data

ENV PORT=7860
EXPOSE 7860

CMD ["sh", "-c", "python -m uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-7860}"]
