#include <stdio.h>
#include <stdlib.h>
#include "dijkstra.h"
#include "minheap.h"

RouteResult find_shortest_path(
    Graph *graph,
    int source,
    int destination
) {
    RouteResult result = {0};
    result.distance = INF;
    result.found = 0;

    if (graph == NULL ||
        source < 0 || destination < 0 ||
        source >= graph->vertex_count ||
        destination >= graph->vertex_count) {
        return result;
    }

    int n = graph->vertex_count;

    int *dist = malloc((size_t)n * sizeof(int));
    int *parent = malloc((size_t)n * sizeof(int));
    int *visited = calloc((size_t)n, sizeof(int));

    if (dist == NULL || parent == NULL || visited == NULL) {
        fprintf(stderr, "Dijkstra memory allocation failed.\n");
        free(dist);
        free(parent);
        free(visited);
        return result;
    }

    for (int i = 0; i < n; i++) {
        dist[i] = INF;
        parent[i] = -1;
    }

    MinHeap heap;
    init_heap(&heap);

    if (heap.nodes == NULL) {
        free(dist);
        free(parent);
        free(visited);
        return result;
    }

    dist[source] = 0;
    insert_heap(&heap, source, 0);

    while (!is_heap_empty(&heap)) {
        HeapNode current = extract_min(&heap);
        int u = current.vertex;

        if (u < 0 || u >= n || visited[u])
            continue;

        if (current.distance != dist[u])
            continue;

        visited[u] = 1;

        if (u == destination)
            break;

        Edge *edge = graph->adjacency_list[u];

        while (edge != NULL) {
            int v = edge->destination;

            if (edge->is_open &&
                v >= 0 && v < n &&
                !visited[v] &&
                edge->travel_time >= 0 &&
                dist[u] <= INF - edge->travel_time) {

                int new_distance = dist[u] + edge->travel_time;

                if (new_distance < dist[v]) {
                    dist[v] = new_distance;
                    parent[v] = u;
                    insert_heap(&heap, v, new_distance);
                }
            }

            edge = edge->next;
        }
    }

    if (dist[destination] != INF) {
        int *reverse_path = malloc((size_t)n * sizeof(int));

        if (reverse_path != NULL) {
            int count = 0;
            int current = destination;

            while (current != -1 && count < n) {
                reverse_path[count++] = current;

                if (current == source)
                    break;

                current = parent[current];
            }

            if (count > 0 && reverse_path[count - 1] == source) {
                result.path_size = count;

                for (int i = 0; i < count; i++) {
                    result.path[i] = reverse_path[count - 1 - i];
                }

                result.distance = dist[destination];
                result.found = 1;
            }

            free(reverse_path);
        }
    }

    free_heap(&heap);
    free(dist);
    free(parent);
    free(visited);

    return result;
}

void dijkstra(Graph *graph, int source, int destination) {
    RouteResult result =
        find_shortest_path(graph, source, destination);

    if (!result.found) {
        printf("No route found.\n");
        return;
    }

    printf("Shortest route: ");

    for (int i = 0; i < result.path_size; i++) {
        printf("%s", graph->names[result.path[i]]);

        if (i < result.path_size - 1)
            printf(" -> ");
    }

    printf("\nTravel time: %d minutes\n", result.distance);
}