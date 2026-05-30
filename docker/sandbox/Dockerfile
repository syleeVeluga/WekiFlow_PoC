FROM python:3.13-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ripgrep grep gawk findutils coreutils jq \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -u 1000 -m sandbox
USER 1000:1000
WORKDIR /work
