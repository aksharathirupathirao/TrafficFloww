#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "hashmap.h"

static unsigned int hash_function(const char *name) {
    unsigned int hash = 0;

    while (*name) {
        hash = (hash * 31 + (unsigned char)*name) % HASH_SIZE;
        name++;
    }

    return hash;
}

void init_hashmap(HashMap *map) {
    for (int i = 0; i < HASH_SIZE; i++)
        map->buckets[i] = NULL;
}

void insert_hash(HashMap *map, const char *name, int id) {
    unsigned int index = hash_function(name);

    HashNode *current = map->buckets[index];

    while (current != NULL) {
        if (strcmp(current->name, name) == 0) {
            current->id = id;
            return;
        }
        current = current->next;
    }

    HashNode *node = malloc(sizeof(HashNode));

    if (node == NULL) {
        printf("Hash table memory allocation failed!\n");
        return;
    }

    strncpy(node->name, name, NAME_SIZE - 1);
    node->name[NAME_SIZE - 1] = '\0';
    node->id = id;

    node->next = map->buckets[index];
    map->buckets[index] = node;
}

int search_hash(HashMap *map, const char *name) {
    unsigned int index = hash_function(name);

    HashNode *current = map->buckets[index];

    while (current != NULL) {
        if (strcmp(current->name, name) == 0)
            return current->id;

        current = current->next;
    }

    return -1;
}

void delete_hash(HashMap *map, const char *name) {
    unsigned int index = hash_function(name);

    HashNode *current = map->buckets[index];
    HashNode *previous = NULL;

    while (current != NULL) {
        if (strcmp(current->name, name) == 0) {
            if (previous == NULL)
                map->buckets[index] = current->next;
            else
                previous->next = current->next;

            free(current);
            return;
        }

        previous = current;
        current = current->next;
    }
}

void free_hashmap(HashMap *map) {
    for (int i = 0; i < HASH_SIZE; i++) {
        HashNode *current = map->buckets[i];

        while (current != NULL) {
            HashNode *next = current->next;
            free(current);
            current = next;
        }

        map->buckets[i] = NULL;
    }
}