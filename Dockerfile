FROM node:22-alpine AS frontend-build

WORKDIR /frontend

COPY ./package.json ./package-lock.json ./
RUN npm ci

COPY ./index.html ./metadata.json ./tsconfig.json ./vite.config.ts ./
COPY ./src ./src
RUN npm run build

FROM python:3.10-slim AS runtime

ENV PYTHONPATH=/app \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY ./requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY ./app ./app
COPY --from=frontend-build /frontend/dist ./app/static

EXPOSE 8080

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
