#include <stdio.h>
#include <stdlib.h>
#include "minheap.h"

static void swap_nodes(HeapNode *a, HeapNode *b) {
    HeapNode temp = *a;
    *a = *b;
    *b = temp;
}

void init_heap(MinHeap *heap) {
    heap->size = 0;
    heap->capacity = 64;
    heap->nodes = malloc(heap->capacity * sizeof(HeapNode));

    if (heap->nodes == NULL) {
        heap->capacity = 0;
        fprintf(stderr, "Min-heap allocation failed.\n");
    }
}

int is_heap_empty(const MinHeap *heap) {
    return heap->size == 0;
}

void insert_heap(MinHeap *heap, int vertex, int distance) {
    if (heap->nodes == NULL) {
        fprintf(stderr, "Cannot insert: min-heap is not initialized.\n");
        return;
    }

    if (heap->size == heap->capacity) {
        int new_capacity = heap->capacity * 2;

        HeapNode *new_nodes = realloc(
            heap->nodes,
            new_capacity * sizeof(HeapNode)
        );

        if (new_nodes == NULL) {
            fprintf(stderr, "Min-heap memory expansion failed.\n");
            return;
        }

        heap->nodes = new_nodes;
        heap->capacity = new_capacity;
    }

    int i = heap->size;
    heap->nodes[i].vertex = vertex;
    heap->nodes[i].distance = distance;
    heap->size++;

    while (i > 0) {
        int parent = (i - 1) / 2;

        if (heap->nodes[parent].distance <= heap->nodes[i].distance)
            break;

        swap_nodes(&heap->nodes[parent], &heap->nodes[i]);
        i = parent;
    }
}

HeapNode extract_min(MinHeap *heap) {
    HeapNode empty = {-1, -1};

    if (heap->size == 0 || heap->nodes == NULL)
        return empty;

    HeapNode minimum = heap->nodes[0];

    heap->size--;

    if (heap->size == 0)
        return minimum;

    heap->nodes[0] = heap->nodes[heap->size];

    int i = 0;

    while (1) {
        int left = 2 * i + 1;
        int right = 2 * i + 2;
        int smallest = i;

        if (left < heap->size &&
            heap->nodes[left].distance <
            heap->nodes[smallest].distance) {
            smallest = left;
        }

        if (right < heap->size &&
            heap->nodes[right].distance <
            heap->nodes[smallest].distance) {
            smallest = right;
        }

        if (smallest == i)
            break;

        swap_nodes(&heap->nodes[i], &heap->nodes[smallest]);
        i = smallest;
    }

    return minimum;
}

void free_heap(MinHeap *heap) {
    free(heap->nodes);
    heap->nodes = NULL;
    heap->size = 0;
    heap->capacity = 0;
}