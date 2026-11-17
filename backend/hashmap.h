#ifndef HASHMAP_H
#define HASHMAP_H

#define HASH_SIZE 101
#define NAME_SIZE 50

typedef struct HashNode {
    char name[NAME_SIZE];
    int id;
    struct HashNode *next;
} HashNode;

typedef struct {
    HashNode *buckets[HASH_SIZE];
} HashMap;

void init_hashmap(HashMap *map);
void insert_hash(HashMap *map, const char *name, int id);
int search_hash(HashMap *map, const char *name);
void delete_hash(HashMap *map, const char *name);
void free_hashmap(HashMap *map);

#endif