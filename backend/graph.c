#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "graph.h"

void init_graph(Graph *graph) {
    graph->vertex_count = 0;

    for (int i = 0; i < MAX_VERTICES; i++) {
        graph->adjacency_list[i] = NULL;
    }
}

int add_location(Graph *graph, const char *name) {
    if (graph->vertex_count >= MAX_VERTICES) {
        printf("Error: Maximum number of locations reached.\n");
        return -1;
    }

    int id = graph->vertex_count;

    strncpy(graph->names[id], name, MAX_NAME_LEN - 1);
    graph->names[id][MAX_NAME_LEN - 1] = '\0';

    graph->vertex_count++;
    return id;
}

static void add_directed_road(Graph *graph, int source,
                              int destination, int travel_time) {
    Edge *new_edge = malloc(sizeof(Edge));

    if (new_edge == NULL) {
        printf("Error: Memory allocation failed.\n");
        return;
    }

    new_edge->destination = destination;
    new_edge->travel_time = travel_time;
    new_edge->is_open = 1;
    new_edge->next = graph->adjacency_list[source];

    graph->adjacency_list[source] = new_edge;
}

void add_road(Graph *graph, int source, int destination, int travel_time) {
    if (source < 0 || destination < 0 ||
        source >= graph->vertex_count ||
        destination >= graph->vertex_count ||
        source == destination || travel_time <= 0) {
        printf("Error: Invalid road details.\n");
        return;
    }

    /* Add the road in both directions. */
    add_directed_road(graph, source, destination, travel_time);
    add_directed_road(graph, destination, source, travel_time);
}

void set_road_status(Graph *graph, int source, int destination, int is_open) {
    if (source < 0 || destination < 0 ||
        source >= graph->vertex_count ||
        destination >= graph->vertex_count) {
        printf("Error: Invalid location ID.\n");
        return;
    }

    Edge *current = graph->adjacency_list[source];

    while (current != NULL) {
        if (current->destination == destination) {
            current->is_open = is_open;
        }
        current = current->next;
    }

    /* Update the reverse direction too, since roads are two-way. */
    current = graph->adjacency_list[destination];

    while (current != NULL) {
        if (current->destination == source) {
            current->is_open = is_open;
        }
        current = current->next;
    }
}

void display_graph(const Graph *graph) {
    printf("\n========== ROAD NETWORK ==========\n");

    for (int i = 0; i < graph->vertex_count; i++) {
        printf("%s (ID %d): ", graph->names[i], i);

        Edge *current = graph->adjacency_list[i];

        while (current != NULL) {
            printf("%s [%d min, %s] -> ",
                   graph->names[current->destination],
                   current->travel_time,
                   current->is_open ? "Open" : "Closed");

            current = current->next;
        }

        printf("NULL\n");
    }

    printf("==================================\n");
}
void update_road_weight(Graph *graph, int source, int destination, int travel_time) {
    if (source < 0 || destination < 0 ||
        source >= graph->vertex_count ||
        destination >= graph->vertex_count ||
        travel_time <= 0) {
        printf("Error: Invalid road details.\n");
        return;
    }

    Edge *current = graph->adjacency_list[source];

    while (current != NULL) {
        if (current->destination == destination) {
            current->travel_time = travel_time;
            break;
        }
        current = current->next;
    }

    /* Update the reverse direction too. */
    current = graph->adjacency_list[destination];

    while (current != NULL) {
        if (current->destination == source) {
            current->travel_time = travel_time;
            break;
        }
        current = current->next;
    }
}
void free_graph(Graph *graph) {
    for (int i = 0; i < graph->vertex_count; i++) {
        Edge *current = graph->adjacency_list[i];

        while (current != NULL) {
            Edge *next_edge = current->next;
            free(current);
            current = next_edge;
        }

        graph->adjacency_list[i] = NULL;
    }

    graph->vertex_count = 0;
}