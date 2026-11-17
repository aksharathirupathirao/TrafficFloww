#ifndef AVL_H
#define AVL_H

typedef struct AVLNode {
    int id;
    char name[50];
    int height;
    struct AVLNode *left;
    struct AVLNode *right;
} AVLNode;

AVLNode *insert_avl(AVLNode *root, int id, const char *name);
AVLNode *search_avl(AVLNode *root, int id);
AVLNode *delete_avl(AVLNode *root, int id);
void display_avl(AVLNode *root);
void free_avl(AVLNode *root);

#endif