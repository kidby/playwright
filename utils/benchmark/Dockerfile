# Dockerfile for benchmarking Playwright fork vs upstream
# Builds both branches in identical environments with resource constraints
#
# Usage:
#   docker build -t pw-bench -f utils/benchmark/Dockerfile .
#   docker run --cpus=4 --memory=8g pw-bench
#
# Or for Bun:
#   docker run --cpus=4 --memory=8g -e RUNTIME=bun pw-bench

FROM node:24-bookworm-slim AS base

# Install system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl unzip bc procps \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# ---- Stage: Build Fork ----
FROM base AS fork-build
WORKDIR /fork
COPY . /fork/
RUN npm install --ignore-scripts
RUN npm run build

# ---- Stage: Build Upstream ----
FROM base AS upstream-build
WORKDIR /upstream
RUN git clone --depth=1 https://github.com/microsoft/playwright.git /upstream
RUN npm install --ignore-scripts
RUN npm run build

# ---- Stage: Benchmark Runner ----
FROM base AS runner

COPY --from=fork-build /fork /fork
COPY --from=upstream-build /upstream /upstream

# Benchmark script
COPY utils/benchmark/run.sh /bench/run.sh
RUN chmod +x /bench/run.sh

ENV RUNTIME=node
ENV ITERATIONS=3
ENV FORK_DIR=/fork
ENV UPSTREAM_DIR=/upstream

CMD ["/bench/run.sh"]
