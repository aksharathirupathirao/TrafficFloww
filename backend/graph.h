#ifndef GRAPH_H
#define GRAPH_H

#define MAX_VERTICES 20000
#define MAX_NAME_LEN 50

typedef struct Edge {
    int destination;
    int travel_time;
    int is_open;
    struct Edge *next;
} Edge;

typedef struct {
int vertex_count;
char names[MAX_VERTICES][MAX_NAME_LEN];
Edge *adjacency_list[MAX_VERTICES];
} Graph;

void init_graph(Graph *graph);
int add_location(Graph *graph, const char *name);
void add_road(Graph *graph, int source, int destination, int travel_time);
void set_road_status(Graph *graph, int source, int destination, int is_open);
void update_road_weight(Graph *graph, int source, int destination, int travel_time);
void display_graph(const Graph *graph);
void free_graph(Graph *graph);

#endif
