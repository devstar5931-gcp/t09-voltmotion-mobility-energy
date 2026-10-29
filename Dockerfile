FROM python:3.12-slim

WORKDIR /workspace

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    SEED_PACK=t09 \
    GOOGLE_GENAI_USE_VERTEXAI=1 \
    GOOGLE_CLOUD_LOCATION=global \
    GEMINI_MODEL=gemini-3.8-flash \
    AGENT_RUNTIME_LOCATION=europe-west1 \
    BQ_LOCATION=EU \
    PORT=8080

COPY pyproject.toml ./
RUN pip install --no-cache-dir . uvicorn fastapi

COPY app ./app
COPY seed_packs ./seed_packs
COPY challenges ./challenges
COPY eval ./eval

EXPOSE 8080

CMD ["uvicorn", "app.web_app:app", "--host", "0.0.0.0", "--port", "8080"]
