#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "avl.h"

static int height(AVLNode *node) {
    return node ? node->height : 0;
}

static int max(int a, int b) {
    return a > b ? a : b;
}

static AVLNode *create_node(int id, const char *name) {
    AVLNode *node = malloc(sizeof(AVLNode));

    if (!node) {
        printf("Memory allocation failed!\n");
        return NULL;
    }

    node->id = id;
    strncpy(node->name, name, sizeof(node->name) - 1);
    node->name[sizeof(node->name) - 1] = '\0';
    node->height = 1;
    node->left = NULL;
    node->right = NULL;

    return node;
}

static int balance_factor(AVLNode *node) {
    return node ? height(node->left) - height(node->right) : 0;
}

static AVLNode *right_rotate(AVLNode *y) {
    AVLNode *x = y->left;
    AVLNode *t2 = x->right;

    x->right = y;
    y->left = t2;

    y->height = 1 + max(height(y->left), height(y->right));
    x->height = 1 + max(height(x->left), height(x->right));

    return x;
}

static AVLNode *left_rotate(AVLNode *x) {
    AVLNode *y = x->right;
    AVLNode *t2 = y->left;

    y->left = x;
    x->right = t2;

    x->height = 1 + max(height(x->left), height(x->right));
    y->height = 1 + max(height(y->left), height(y->right));

    return y;
}

AVLNode *insert_avl(AVLNode *root, int id, const char *name) {
    if (!root)
        return create_node(id, name);

    if (id < root->id)
        root->left = insert_avl(root->left, id, name);
    else if (id > root->id)
        root->right = insert_avl(root->right, id, name);
    else {
        strncpy(root->name, name, sizeof(root->name) - 1);
        root->name[sizeof(root->name) - 1] = '\0';
        return root;
    }

    root->height = 1 + max(height(root->left), height(root->right));

    int balance = balance_factor(root);

    if (balance > 1 && id < root->left->id)
        return right_rotate(root);

    if (balance < -1 && id > root->right->id)
        return left_rotate(root);

    if (balance > 1 && id > root->left->id) {
        root->left = left_rotate(root->left);
        return right_rotate(root);
    }

    if (balance < -1 && id < root->right->id) {
        root->right = right_rotate(root->right);
        return left_rotate(root);
    }

    return root;
}

AVLNode *search_avl(AVLNode *root, int id) {
    if (!root || root->id == id)
        return root;

    if (id < root->id)
        return search_avl(root->left, id);

    return search_avl(root->right, id);
}

static AVLNode *minimum_node(AVLNode *node) {
    while (node && node->left)
        node = node->left;

    return node;
}

AVLNode *delete_avl(AVLNode *root, int id) {
    if (!root)
        return NULL;

    if (id < root->id) {
        root->left = delete_avl(root->left, id);
    } else if (id > root->id) {
        root->right = delete_avl(root->right, id);
    } else {
        if (!root->left || !root->right) {
            AVLNode *child = root->left ? root->left : root->right;
            free(root);
            return child;
        }

        AVLNode *successor = minimum_node(root->right);
        root->id = successor->id;
        strcpy(root->name, successor->name);
        root->right = delete_avl(root->right, successor->id);
    }

    root->height = 1 + max(height(root->left), height(root->right));

    int balance = balance_factor(root);

    if (balance > 1 && balance_factor(root->left) >= 0)
        return right_rotate(root);

    if (balance > 1 && balance_factor(root->left) < 0) {
        root->left = left_rotate(root->left);
        return right_rotate(root);
    }

    if (balance < -1 && balance_factor(root->right) <= 0)
        return left_rotate(root);

    if (balance < -1 && balance_factor(root->right) > 0) {
        root->right = right_rotate(root->right);
        return left_rotate(root);
    }

    return root;
}

void display_avl(AVLNode *root) {
    if (!root)
        return;

    display_avl(root->left);
    printf("ID: %d | Location: %s | Height: %d\n",
           root->id, root->name, root->height);
    display_avl(root->right);
}

void free_avl(AVLNode *root) {
    if (!root)
        return;

    free_avl(root->left);
    free_avl(root->right);
    free(root);
}