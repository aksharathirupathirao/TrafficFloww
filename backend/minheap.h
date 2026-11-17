#ifndef MINHEAP_H
#define MINHEAP_H

typedef struct {
    int vertex;
    int distance;
} HeapNode;

typedef struct {
    HeapNode *nodes;
    int size;
    int capacity;
} MinHeap;

void init_heap(MinHeap *heap);
int is_heap_empty(const MinHeap *heap);
void insert_heap(MinHeap *heap, int vertex, int distance);
HeapNode extract_min(MinHeap *heap);
void free_heap(MinHeap *heap);

#endif