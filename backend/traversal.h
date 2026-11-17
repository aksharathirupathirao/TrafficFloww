#ifndef TRAVERSAL_H
#define TRAVERSAL_H

#include "graph.h"

void bfs(Graph *graph, int start);
void dfs(Graph *graph, int start);

int bfs_order(Graph *graph, int start, int result[MAX_VERTICES]);
int dfs_order(Graph *graph, int start, int result[MAX_VERTICES]);

#endif
