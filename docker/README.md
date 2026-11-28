# Vaultite in Docker

Build and run the Vaultite server container, with Compose or directly.

## Build the image

From the repo root:

```sh
docker build -f docker/Dockerfile -t vaultite:latest .
```

## Run with Compose

```sh
docker compose -f docker/compose.yaml up -d
```

Then open <http://localhost:8793>. The vault is a named volume,
`vaultite-vault`, mounted at `/app/vault` inside the container
(`docker compose -f docker/compose.yaml up -d --remove-orphans` and
`docker volume ls` to see it; edit `docker/compose.yaml` for a bind mount).

## Run the image directly

```sh
docker run --rm -d -p 8793:8793 -v "$PWD/vault:/app/vault" --name vaultite vaultite:latest
```

The image listens on `0.0.0.0:8793` (set as `HOST`/`PORT` in the image's
`ENV`); the app needs Node >= 23.6 and the image is based on
`node:24-bookworm`.

The container builds the app itself (`npm ci` + `npm run build`), so you
need no local toolchain.
