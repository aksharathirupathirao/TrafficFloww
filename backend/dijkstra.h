#ifndef DIJKSTRA_H
#define DIJKSTRA_H

#include "graph.h"

#define INF 1000000000

typedef struct {
    int path[MAX_VERTICES];
    int path_size;
    int distance;
    int found;
} RouteResult;

RouteResult find_shortest_path(
    Graph *graph,
    int source,
    int destination
);

void dijkstra(Graph *graph, int source, int destination);

#endif