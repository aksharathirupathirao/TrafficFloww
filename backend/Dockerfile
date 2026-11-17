
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    gcc \
    build-essential \
    libcurl4-openssl-dev \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN gcc -std=c11 -Wall -Wextra \
    main.c graph.c minheap.c dijkstra.c avl.c hashmap.c traversal.c \
    -lcurl -o trafficflow

EXPOSE 8080

CMD ["./trafficflow"]
