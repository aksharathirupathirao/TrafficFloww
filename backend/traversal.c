#include <stdio.h>
#include <stdlib.h>
#include "traversal.h"

int bfs_order(Graph *graph, int start, int result[MAX_VERTICES]) {
    if (!graph || start < 0 || start >= graph->vertex_count)
        return 0;

    int n = graph->vertex_count;
    int *visited = calloc((size_t)n, sizeof(int));
    int *queue = malloc((size_t)n * sizeof(int));

    if (!visited || !queue) {
        free(visited);
        free(queue);
        return 0;
    }

    int front = 0, rear = 0, count = 0;

    visited[start] = 1;
    queue[rear++] = start;

    while (front < rear) {
        int current = queue[front++];
        result[count++] = current;

        for (Edge *edge = graph->adjacency_list[current];
             edge != NULL; edge = edge->next) {

            int next = edge->destination;

            if (edge->is_open &&
                next >= 0 && next < n &&
                !visited[next]) {
                visited[next] = 1;
                queue[rear++] = next;
            }
        }
    }

    free(visited);
    free(queue);
    return count;
}

int dfs_order(Graph *graph, int start, int result[MAX_VERTICES]) {
    if (!graph || start < 0 || start >= graph->vertex_count)
        return 0;

    typedef struct {
        int vertex;
        Edge *next;
    } DFSFrame;

    int n = graph->vertex_count;
    int *visited = calloc((size_t)n, sizeof(int));
    DFSFrame *stack = malloc((size_t)n * sizeof(DFSFrame));

    if (!visited || !stack) {
        free(visited);
        free(stack);
        return 0;
    }

    int top = 0;
    int count = 0;

    visited[start] = 1;
    result[count++] = start;
    stack[top++] = (DFSFrame){start, graph->adjacency_list[start]};

    while (top > 0) {
        DFSFrame *frame = &stack[top - 1];
        Edge *edge = frame->next;

        while (edge && (!edge->is_open ||
               edge->destination < 0 ||
               edge->destination >= n ||
               visited[edge->destination])) {
            edge = edge->next;
        }

        if (!edge) {
            top--;
            continue;
        }

        frame->next = edge->next;

        int next = edge->destination;
        visited[next] = 1;
        result[count++] = next;

        stack[top++] = (DFSFrame){
            next,
            graph->adjacency_list[next]
        };
    }

    free(visited);
    free(stack);
    return count;
}

void bfs(Graph *graph, int start) {
    int *result = malloc(MAX_VERTICES * sizeof(int));
    if (!result)
        return;

    int count = bfs_order(graph, start, result);

    printf("BFS: ");
    for (int i = 0; i < count; i++)
        printf("%s%s", graph->names[result[i]],
               i == count - 1 ? "" : " -> ");

    printf("\n");
    free(result);
}

void dfs(Graph *graph, int start) {
    int *result = malloc(MAX_VERTICES * sizeof(int));
    if (!result)
        return;

    int count = dfs_order(graph, start, result);

    printf("DFS: ");
    for (int i = 0; i < count; i++)
        printf("%s%s", graph->names[result[i]],
               i == count - 1 ? "" : " -> ");

    printf("\n");
    free(result);
}