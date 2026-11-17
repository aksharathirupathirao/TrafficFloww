#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <ctype.h>
#include <limits.h>
#include <stdint.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <sys/types.h>
#include <sys/socket.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <unistd.h>

typedef int SOCKET;
#define INVALID_SOCKET (-1)
#define SOCKET_ERROR (-1)
#define closesocket close
#define SEND_FLAGS MSG_NOSIGNAL
#endif
#ifdef _WIN32
#define SEND_FLAGS 0
#endif
#include <curl/curl.h>

#include "graph.h"
#include "minheap.h"
#include "dijkstra.h"
#include "avl.h"
#include "hashmap.h"
#include "traversal.h"

#define DEFAULT_PORT 8080
#define BUFFER_SIZE 8192
#define RESPONSE_SIZE 65536


Graph trafficGraph;
Graph liveTrafficGraph;

AVLNode *locationTree = NULL;
HashMap locationMap;

/* =========================================================
   TOMTOM HTTP RESPONSE BUFFER
   ========================================================= */

typedef struct {
    char data[RESPONSE_SIZE];
    size_t size;
} HttpResponse;


/* =========================================================
   SEND ALL HTTP DATA
   ========================================================= */

int send_all(SOCKET client, const char *data, size_t length) {

    size_t sent = 0;

    while (sent < length) {

        size_t remaining = length - sent;

        int chunk = remaining > INT_MAX
            ? INT_MAX
            : (int)remaining;

        int result = send(
    client,
    data + sent,
    chunk,
    SEND_FLAGS
);

        if (result <= 0)
            return 0;

        sent += (size_t)result;
    }

    return 1;
}


/* =========================================================
   LIBCURL CALLBACK
   ========================================================= */

size_t write_callback(
    void *contents,
    size_t size,
    size_t nmemb,
    void *userp
) {

    if (size != 0 && nmemb > SIZE_MAX / size)
        return 0;

    size_t total_size = size * nmemb;

    HttpResponse *response = (HttpResponse *)userp;

    if (response->size >= sizeof(response->data) - 1 ||
        total_size > sizeof(response->data) - 1 - response->size) {

        return 0;
    }

    memcpy(
        response->data + response->size,
        contents,
        total_size
    );

    response->size += total_size;

    response->data[response->size] = '\0';

    return total_size;
}


/* =========================================================
   SEND JSON HTTP RESPONSE
   ========================================================= */

void send_json(
    SOCKET client,
    const char *body,
    int status,
    const char *status_text
) {

    if (body == NULL)
        return;

    char header[512];

    size_t body_length = strlen(body);

    int header_length = snprintf(
        header,
        sizeof(header),

        "HTTP/1.1 %d %s\r\n"
        "Content-Type: application/json; charset=utf-8\r\n"
        "Access-Control-Allow-Origin: *\r\n"
        "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
        "Access-Control-Allow-Headers: Content-Type\r\n"
        "Content-Length: %zu\r\n"
        "Connection: close\r\n\r\n",

        status,
        status_text,
        body_length
    );

    if (header_length < 0 ||
        header_length >= (int)sizeof(header)) {

        return;
    }

    if (!send_all(client, header, (size_t)header_length))
        return;

    send_all(client, body, body_length);
}


/* =========================================================
   RECEIVE COMPLETE HTTP REQUEST
   ========================================================= */

int receive_request(
    SOCKET client,
    char *buffer,
    int capacity
) {

    int total = 0;

    buffer[0] = '\0';

    while (total < capacity - 1) {

        int received = recv(
            client,
            buffer + total,
            capacity - 1 - total,
            0
        );

        if (received <= 0)
            return -1;

        total += received;

        buffer[total] = '\0';

        char *header_end = strstr(
            buffer,
            "\r\n\r\n"
        );

        if (header_end != NULL) {

            int body_offset =
                (int)(header_end - buffer) + 4;

            int content_length = 0;

            char *length_header =
                strstr(buffer, "Content-Length:");

            if (length_header != NULL) {

                content_length = atoi(
                    length_header + 15
                );
            }

            if (content_length < 0 ||
                content_length > capacity - body_offset - 1) {

                return -1;
            }

            int expected_length =
                body_offset + content_length;

            while (total < expected_length) {

                received = recv(
                    client,
                    buffer + total,
                    capacity - total - 1,
                    0
                );

                if (received <= 0)
                    return -1;

                total += received;

                buffer[total] = '\0';
            }

            return total;
        }
    }

    return -1;
}


/* =========================================================
   EXTRACT REQUEST BODY
   ========================================================= */

char *get_request_body(char *request) {

    char *body = strstr(
        request,
        "\r\n\r\n"
    );

    if (body == NULL)
        return NULL;

    return body + 4;
}


/* =========================================================
   PARSE ROAD NAME FROM JSON
   ========================================================= */

int parse_road_name(
    const char *body,
    char *road,
    size_t road_size
) {

    const char *start = strstr(
        body,
        "\"road\""
    );

    if (start == NULL)
        return 0;

    start = strchr(start, ':');

    if (start == NULL)
        return 0;

    start++;

    while (isspace((unsigned char)*start))
        start++;

    if (*start != '"')
        return 0;

    start++;

    const char *end = strchr(start, '"');

    if (end == NULL)
        return 0;

    size_t length = (size_t)(end - start);

    if (length == 0 || length >= road_size)
        return 0;

    memcpy(road, start, length);

    road[length] = '\0';

    return 1;
}


/* =========================================================
   PARSE ROAD IDENTIFIERS
   ========================================================= */

int parse_road_ids(
    const char *road,
    int *source,
    int *destination
) {

    char extra;

    if (sscanf(
        road,
        "%d-%d%c",
        source,
        destination,
        &extra
    ) != 2) {

        return 0;
    }

    if (*source < 0 ||
        *destination < 0 ||
        *source >= trafficGraph.vertex_count ||
        *destination >= trafficGraph.vertex_count ||
        *source == *destination) {

        return 0;
    }

    return 1;
}


/* =========================================================
   PARSE BOOLEAN VALUE FROM JSON
   ========================================================= */

int parse_boolean_field(
    const char *body,
    const char *field,
    int *value
) {

    const char *start = strstr(body, field);

    if (start == NULL)
        return 0;

    start = strchr(start, ':');

    if (start == NULL)
        return 0;

    start++;

    while (isspace((unsigned char)*start))
        start++;

    if (strncmp(start, "true", 4) == 0) {

        *value = 1;
        return 1;
    }

    if (strncmp(start, "false", 5) == 0) {

        *value = 0;
        return 1;
    }

    return 0;
}


/* =========================================================
   EXTRACT NUMBER FROM JSON
   ========================================================= */

double get_json_number(
    const char *json,
    const char *key,
    double default_value
) {

    char search_key[64];

    snprintf(
        search_key,
        sizeof(search_key),
        "\"%s\":",
        key
    );

    const char *value = strstr(
        json,
        search_key
    );

    if (value == NULL)
        return default_value;

    return strtod(
        value + strlen(search_key),
        NULL
    );
}


/* =========================================================
   FETCH LIVE TRAFFIC FROM TOMTOM
   ========================================================= */

int fetch_tomtom_traffic(
    double latitude,
    double longitude,
    char *output,
    size_t output_size
) {

    const char *api_key = getenv("TOMTOM_API_KEY");

    if (api_key == NULL || strlen(api_key) == 0) {

        printf("TomTom API key is not configured.\n");
        return 0;
    }

    CURL *curl = curl_easy_init();

    if (curl == NULL) {

        printf("Could not initialize TomTom connection.\n");
        return 0;
    }

    char url[2048];

char *encoded_key = curl_easy_escape(curl, api_key, 0);

if (encoded_key == NULL) {
    curl_easy_cleanup(curl);
    return 0;
}

snprintf(
    url,
    sizeof(url),
    "https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=%.6f,%.6f&key=%s",
    latitude,
    longitude,
    encoded_key
);

curl_free(encoded_key);

    HttpResponse response = {0};

    curl_easy_setopt(curl, CURLOPT_URL, url);

    curl_easy_setopt(
        curl,
        CURLOPT_WRITEFUNCTION,
        write_callback
    );

    curl_easy_setopt(
        curl,
        CURLOPT_WRITEDATA,
        &response
    );

    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 15L);

    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);

    curl_easy_setopt(
        curl,
        CURLOPT_USERAGENT,
        "TrafficFlow/1.0"
    );

    CURLcode result = curl_easy_perform(curl);

    long http_status = 0;

    curl_easy_getinfo(
        curl,
        CURLINFO_RESPONSE_CODE,
        &http_status
    );

    curl_easy_cleanup(curl);
    if (response.data != NULL && response.size > 0) {
    printf("TomTom response body: %.*s\n",
        (int)(response.size > 1000 ? 1000 : response.size),
        response.data);
}

    if (result != CURLE_OK || http_status != 200) {

        printf("TomTom request failed.\n");
        printf("HTTP status: %ld\n", http_status);
        printf("Error: %s\n", curl_easy_strerror(result));

        return 0;
    }

    if (response.size + 1 > output_size)
        return 0;

    memcpy(
        output,
        response.data,
        response.size + 1
    );

    return 1;
}


/* =========================================================
   INITIALIZE ORIGINAL TRAFFIC NETWORK
   ========================================================= */

void initializeTrafficNetwork(void) {

    init_graph(&trafficGraph);

    init_hashmap(&locationMap);

    const char *locations[] = {
        "Central",
        "Airport",
        "University",
        "Railway Station"
    };

    for (int i = 0; i < 4; i++) {

        int id = add_location(
            &trafficGraph,
            locations[i]
        );

        if (id < 0)
            continue;

        locationTree = insert_avl(
            locationTree,
            id,
            locations[i]
        );

        insert_hash(
            &locationMap,
            locations[i],
            id
        );
    }

    add_road(&trafficGraph, 0, 1, 12);
    add_road(&trafficGraph, 0, 2, 8);
    add_road(&trafficGraph, 1, 3, 10);
    add_road(&trafficGraph, 2, 3, 15);

    printf("\nTraffic network initialized!\n");
    printf("Locations: 4\n");
    printf("Roads: 4\n\n");

    display_graph(&trafficGraph);
}


/* =========================================================
   INITIALIZE LIVE HYDERABAD PILOT NETWORK
   ========================================================= */

void initializeLiveTrafficNetwork(void) {

    init_graph(&liveTrafficGraph);

    int start = add_location(
        &liveTrafficGraph,
        "HITEC City Segment Start"
    );

    int end = add_location(
        &liveTrafficGraph,
        "HITEC City Segment End"
    );

    if (start == -1 || end == -1) {

        printf("Live traffic network initialization failed.\n");
        return;
    }

    int alternate = add_location(
        &liveTrafficGraph,
        "Gachibowli Segment"
    );

    add_road(&liveTrafficGraph, start, end, 6);

    add_road(
        &liveTrafficGraph,
        start,
        alternate,
        8
    );

    add_road(
        &liveTrafficGraph,
        alternate,
        end,
        7
    );

    printf("\nLive Hyderabad pilot network initialized!\n");

    display_graph(&liveTrafficGraph);
}


/* =========================================================
   SEND LIVE ROUTE RESPONSE
   ========================================================= */

void handle_live_route(SOCKET client_socket) {

    RouteResult route = find_shortest_path(
        &liveTrafficGraph,
        0,
        1
    );

    if (!route.found) {

        send_json(
            client_socket,
            "{\"found\":false,\"path\":[],\"travelTimeMinutes\":-1}",
            200,
            "OK"
        );

        return;
    }

    size_t capacity =
        (size_t)route.path_size * (MAX_NAME_LEN + 8) + 64;

    char *path = malloc(capacity);

    if (path == NULL) {

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    size_t used = 0;

    path[0] = '[';

    used = 1;

    for (int i = 0; i < route.path_size; i++) {

        int written = snprintf(
            path + used,
            capacity - used,

            "%s\"%s\"",

            i == 0 ? "" : ",",
            liveTrafficGraph.names[route.path[i]]
        );

        if (written < 0 ||
            (size_t)written >= capacity - used) {

            free(path);

            send_json(
                client_socket,
                "{\"error\":\"Route formatting failed\"}",
                500,
                "Internal Server Error"
            );

            return;
        }

        used += (size_t)written;
    }

    path[used++] = ']';
    path[used] = '\0';

    size_t body_capacity = used + 128;

    char *body = malloc(body_capacity);

    if (body == NULL) {

        free(path);

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    snprintf(
        body,
        body_capacity,

        "{\"found\":true,"
        "\"path\":%s,"
        "\"travelTimeMinutes\":%d}",

        path,
        route.distance
    );

    send_json(
        client_socket,
        body,
        200,
        "OK"
    );

    free(path);
    free(body);
}


/* =========================================================
   TOMTOM LIVE TRAFFIC API
   ========================================================= */

void handle_live_traffic(
    SOCKET client_socket,
    char *buffer
) {

    char *lat_ptr = strstr(buffer, "lat=");
    char *lon_ptr = strstr(buffer, "lon=");

    if (lat_ptr == NULL || lon_ptr == NULL) {

        send_json(
            client_socket,
            "{\"error\":\"Latitude and longitude are required\"}",
            400,
            "Bad Request"
        );

        return;
    }

    double latitude = strtod(lat_ptr + 4, NULL);

    double longitude = strtod(lon_ptr + 4, NULL);

    if (latitude < -90.0 ||
        latitude > 90.0 ||
        longitude < -180.0 ||
        longitude > 180.0) {

        send_json(
            client_socket,
            "{\"error\":\"Invalid coordinates\"}",
            400,
            "Bad Request"
        );

        return;
    }

    char tomtom_response[RESPONSE_SIZE];

    if (!fetch_tomtom_traffic(
        latitude,
        longitude,
        tomtom_response,
        sizeof(tomtom_response)
    )) {

        send_json(
            client_socket,
            "{\"error\":\"Could not retrieve TomTom traffic data\"}",
            502,
            "Bad Gateway"
        );

        return;
    }

    double current_speed = get_json_number(
        tomtom_response,
        "currentSpeed",
        0
    );

    double free_flow_speed = get_json_number(
        tomtom_response,
        "freeFlowSpeed",
        0
    );

    double current_travel_time = get_json_number(
        tomtom_response,
        "currentTravelTime",
        0
    );

    double free_flow_travel_time = get_json_number(
        tomtom_response,
        "freeFlowTravelTime",
        0
    );

    double confidence = get_json_number(
        tomtom_response,
        "confidence",
        0
    );

    int live_travel_minutes =
        (int)((current_travel_time + 59) / 60);

    if (live_travel_minutes > 0) {

        if (latitude > 17.44) {

            update_road_weight(
                &liveTrafficGraph,
                0,
                1,
                live_travel_minutes
            );

        } else {

            update_road_weight(
                &liveTrafficGraph,
                2,
                1,
                live_travel_minutes
            );
        }

        printf(
            "Live road updated: %d minutes\n",
            live_travel_minutes
        );
    }

    RouteResult route = find_shortest_path(
        &liveTrafficGraph,
        0,
        1
    );

    if (route.found) {

        printf(
            "Live Dijkstra route calculated: %d minutes\n",
            route.distance
        );
    }

    char response[512];

    snprintf(
        response,
        sizeof(response),

        "{\"currentSpeed\":%.2f,"
        "\"freeFlowSpeed\":%.2f,"
        "\"currentTravelTime\":%.2f,"
        "\"freeFlowTravelTime\":%.2f,"
        "\"confidence\":%.2f}",

        current_speed,
        free_flow_speed,
        current_travel_time,
        free_flow_travel_time,
        confidence
    );

    send_json(
        client_socket,
        response,
        200,
        "OK"
    );
}


/* =========================================================
   ORIGINAL DIJKSTRA ROUTE API
   ========================================================= */

void handle_route(SOCKET client_socket, char *buffer) {

    int source = -1;
    int destination = -1;

    char *source_ptr = strstr(buffer, "source=");
    char *destination_ptr = strstr(buffer, "destination=");

    if (source_ptr != NULL)
        source = atoi(source_ptr + 7);

    if (destination_ptr != NULL)
        destination = atoi(destination_ptr + 12);

    if (source < 0 ||
        destination < 0 ||
        source >= trafficGraph.vertex_count ||
        destination >= trafficGraph.vertex_count) {

        send_json(
            client_socket,
            "{\"found\":false,\"path\":[],\"distance\":-1}",
            400,
            "Bad Request"
        );

        return;
    }

    RouteResult route = find_shortest_path(
        &trafficGraph,
        source,
        destination
    );

    if (!route.found) {

        send_json(
            client_socket,
            "{\"found\":false,\"path\":[],\"distance\":-1}",
            200,
            "OK"
        );

        return;
    }

    size_t capacity =
        (size_t)route.path_size * (MAX_NAME_LEN + 8) + 64;

    char *path = malloc(capacity);

    if (path == NULL) {

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    size_t used = 1;

    path[0] = '[';

    for (int i = 0; i < route.path_size; i++) {

        int written = snprintf(
            path + used,
            capacity - used,

            "%s\"%s\"",

            i == 0 ? "" : ",",
            trafficGraph.names[route.path[i]]
        );

        if (written < 0 ||
            (size_t)written >= capacity - used) {

            free(path);

            send_json(
                client_socket,
                "{\"error\":\"Route formatting failed\"}",
                500,
                "Internal Server Error"
            );

            return;
        }

        used += (size_t)written;
    }

    path[used++] = ']';
    path[used] = '\0';

    size_t body_capacity = used + 128;

    char *body = malloc(body_capacity);

    if (body == NULL) {

        free(path);

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    snprintf(
        body,
        body_capacity,

        "{\"found\":true,"
        "\"path\":%s,"
        "\"distance\":%d}",

        path,
        route.distance
    );

    send_json(
        client_socket,
        body,
        200,
        "OK"
    );

    free(path);
    free(body);
}


/* =========================================================
   ROAD MANAGEMENT API
   ========================================================= */

void handle_road_management(
    SOCKET client_socket,
    char *buffer
) {

    char *request_body = get_request_body(buffer);

    char road[20];

    int is_open = -1;

    int source = -1;
    int destination = -1;

    if (request_body == NULL ||
        !parse_road_name(
            request_body,
            road,
            sizeof(road)
        ) ||
        !parse_boolean_field(
            request_body,
            "\"isOpen\"",
            &is_open
        ) ||
        !parse_road_ids(
            road,
            &source,
            &destination
        )) {

        send_json(
            client_socket,
            "{\"message\":\"Invalid road request\"}",
            400,
            "Bad Request"
        );

        return;
    }

    set_road_status(
        &trafficGraph,
        source,
        destination,
        is_open
    );

    char response[200];

    snprintf(
        response,
        sizeof(response),

        "{\"message\":\"Road %s successfully\"}",

        is_open ? "opened" : "closed"
    );

    send_json(
        client_socket,
        response,
        200,
        "OK"
    );
}


/* =========================================================
   TRAFFIC CONGESTION API
   ========================================================= */

void handle_traffic_update(
    SOCKET client_socket,
    char *buffer
) {

    char *request_body = get_request_body(buffer);

    char road[20];

    int source = -1;
    int destination = -1;

    if (request_body == NULL ||
        !parse_road_name(
            request_body,
            road,
            sizeof(road)
        ) ||
        !parse_road_ids(
            road,
            &source,
            &destination
        )) {

        send_json(
            client_socket,
            "{\"message\":\"Invalid traffic request\"}",
            400,
            "Bad Request"
        );

        return;
    }

    char *time_ptr = strstr(
        request_body,
        "\"travelTime\""
    );

    if (time_ptr == NULL) {

        send_json(
            client_socket,
            "{\"message\":\"Travel time is required\"}",
            400,
            "Bad Request"
        );

        return;
    }

    time_ptr = strchr(time_ptr, ':');

    if (time_ptr == NULL) {

        send_json(
            client_socket,
            "{\"message\":\"Invalid travel time\"}",
            400,
            "Bad Request"
        );

        return;
    }

    char *end_ptr;

    long travel_time = strtol(
        time_ptr + 1,
        &end_ptr,
        10
    );

    if (end_ptr == time_ptr + 1 ||
        travel_time <= 0 ||
        travel_time > 100000) {

        send_json(
            client_socket,
            "{\"message\":\"Invalid travel time value\"}",
            400,
            "Bad Request"
        );

        return;
    }

    update_road_weight(
        &trafficGraph,
        source,
        destination,
        (int)travel_time
    );

    send_json(
        client_socket,
        "{\"message\":\"Traffic updated successfully\"}",
        200,
        "OK"
    );
}


/* =========================================================
   BFS AND DFS TRAVERSAL API
   ========================================================= */

void handle_traversal(
    SOCKET client_socket,
    char *buffer
) {

    char *algorithm_ptr = strstr(
        buffer,
        "algorithm="
    );

    char *start_ptr = strstr(
        buffer,
        "start="
    );

    int start = -1;

    if (start_ptr != NULL)
        start = atoi(start_ptr + 6);

    if (start < 0 ||
        start >= trafficGraph.vertex_count ||
        algorithm_ptr == NULL) {

        send_json(
            client_socket,
            "{\"error\":\"Invalid traversal request\"}",
            400,
            "Bad Request"
        );

        return;
    }

    int *result = malloc(
        (size_t)trafficGraph.vertex_count * sizeof(int)
    );

    if (result == NULL) {

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    int count = 0;

    if (strncmp(algorithm_ptr + 10, "bfs", 3) == 0) {

        count = bfs_order(
            &trafficGraph,
            start,
            result
        );

    } else if (strncmp(algorithm_ptr + 10, "dfs", 3) == 0) {

        count = dfs_order(
            &trafficGraph,
            start,
            result
        );

    } else {

        free(result);

        send_json(
            client_socket,
            "{\"error\":\"Unknown traversal algorithm\"}",
            400,
            "Bad Request"
        );

        return;
    }

    size_t capacity =
        (size_t)count * (MAX_NAME_LEN + 8) + 16;

    char *order = malloc(capacity);

    if (order == NULL) {

        free(result);

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    size_t used = 1;

    order[0] = '[';

    for (int i = 0; i < count; i++) {

        int written = snprintf(
            order + used,
            capacity - used,

            "%s\"%s\"",

            i == 0 ? "" : ",",
            trafficGraph.names[result[i]]
        );

        if (written < 0 ||
            (size_t)written >= capacity - used) {

            free(order);
            free(result);

            send_json(
                client_socket,
                "{\"error\":\"Traversal formatting failed\"}",
                500,
                "Internal Server Error"
            );

            return;
        }

        used += (size_t)written;
    }

    order[used++] = ']';
    order[used] = '\0';

    size_t body_capacity = used + 32;

    char *body = malloc(body_capacity);

    if (body == NULL) {

        free(order);
        free(result);

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    snprintf(
        body,
        body_capacity,
        "{\"order\":%s}",
        order
    );

    send_json(
        client_socket,
        body,
        200,
        "OK"
    );

    free(body);
    free(order);
    free(result);
}


/* =========================================================
   DASHBOARD STATISTICS API
   GET /api/state
   ========================================================= */

void handle_state(SOCKET client_socket) {

    int open_roads = 0;
    int total_roads = 0;

    /* Count roads first. */

    for (int i = 0;
         i < trafficGraph.vertex_count;
         i++) {

        Edge *edge = trafficGraph.adjacency_list[i];

        while (edge != NULL) {

            if (i < edge->destination)
                total_roads++;

            edge = edge->next;
        }
    }

    size_t roads_capacity =
        (size_t)total_roads * 128 + 3;

    char *roads = malloc(roads_capacity);

    if (roads == NULL) {

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    size_t used = 1;

    roads[0] = '[';

    int formatting_error = 0;

    /* Generate all road records. */

    for (int i = 0;
         i < trafficGraph.vertex_count && !formatting_error;
         i++) {

        Edge *edge = trafficGraph.adjacency_list[i];

        while (edge != NULL) {

            int destination = edge->destination;

            if (i < destination) {

                if (edge->is_open)
                    open_roads++;

                int written = snprintf(
                    roads + used,
                    roads_capacity - used,

                    "%s{\"source\":%d,"
                    "\"destination\":%d,"
                    "\"isOpen\":%s,"
                    "\"travelTime\":%d}",

                    used == 1 ? "" : ",",
                    i,
                    destination,
                    edge->is_open ? "true" : "false",
                    edge->travel_time
                );

                if (written < 0 ||
                    (size_t)written >= roads_capacity - used) {

                    formatting_error = 1;
                    break;
                }

                used += (size_t)written;
            }

            edge = edge->next;
        }
    }

    if (formatting_error) {

        free(roads);

        send_json(
            client_socket,
            "{\"error\":\"Road data formatting failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    roads[used++] = ']';
    roads[used] = '\0';

    size_t body_capacity = used + 256;

    char *body = malloc(body_capacity);

    if (body == NULL) {

        free(roads);

        send_json(
            client_socket,
            "{\"error\":\"Memory allocation failed\"}",
            500,
            "Internal Server Error"
        );

        return;
    }

    snprintf(
        body,
        body_capacity,

        "{\"locationCount\":%d,"
        "\"roadCount\":%d,"
        "\"openRoadCount\":%d,"
        "\"closedRoadCount\":%d,"
        "\"roads\":%s}",

        trafficGraph.vertex_count,
        total_roads,
        open_roads,
        total_roads - open_roads,
        roads
    );

    send_json(
        client_socket,
        body,
        200,
        "OK"
    );

    free(roads);
    free(body);
}


/* =========================================================
   MAIN SERVER
   ========================================================= */

int main(void) {

    if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) {

        printf("Could not initialize libcurl.\n");
        return 1;
    }

    #ifdef _WIN32
    WSADATA wsa;
#endif

   SOCKET server_socket;
SOCKET client_socket;

struct sockaddr_in server_address;

int port = DEFAULT_PORT;
char *port_env = getenv("PORT");

if (port_env != NULL && port_env[0] != '\0') {
    int requested_port = atoi(port_env);

    if (requested_port > 0 && requested_port <= 65535) {
        port = requested_port;
    }
}

    printf("Starting TrafficFlow C Backend...\n");

    initializeLiveTrafficNetwork();

    #ifdef _WIN32
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) {

        printf("Winsock initialization failed.\n");

        curl_global_cleanup();

        return 1;
    }
#endif

    server_socket = socket(
        AF_INET,
        SOCK_STREAM,
        0
    );

    if (server_socket == INVALID_SOCKET) {

        printf("Socket creation failed.\n");

        #ifdef _WIN32
        WSACleanup();
#endif
        curl_global_cleanup();

        return 1;
    }

    server_address.sin_family = AF_INET;
    server_address.sin_addr.s_addr = INADDR_ANY;
    server_address.sin_port = htons(port);

    if (bind(
        server_socket,
        (struct sockaddr *)&server_address,
        sizeof(server_address)
    ) == SOCKET_ERROR) {

        printf("Port binding failed. Is port 8080 already in use?\n");

        closesocket(server_socket);
        #ifdef _WIN32
        WSACleanup();
#endif
        curl_global_cleanup();

        return 1;
    }

    if (listen(server_socket, 5) == SOCKET_ERROR) {

        printf("Server listening failed.\n");

        closesocket(server_socket);
        #ifdef _WIN32
        WSACleanup();
#endif
        curl_global_cleanup();

        return 1;
    }

    printf(
        "\nTrafficFlow backend running at http://localhost:%d\n",
        port
    );

    printf("Waiting for requests...\n");

    /* =====================================================
       SERVER REQUEST LOOP
       ===================================================== */

    while (1) {

        client_socket = accept(
            server_socket,
            NULL,
            NULL
        );

        if (client_socket == INVALID_SOCKET)
            continue;

        char buffer[BUFFER_SIZE] = {0};

        int received = receive_request(
            client_socket,
            buffer,
            BUFFER_SIZE
        );

        if (received <= 0) {

            closesocket(client_socket);
            continue;
        }

        printf("\nRequest received:\n%s\n", buffer);


        /* =================================================
           CORS PREFLIGHT
           ================================================= */

        if (strncmp(buffer, "OPTIONS ", 8) == 0) {

            const char *response =
                "HTTP/1.1 204 No Content\r\n"
                "Access-Control-Allow-Origin: *\r\n"
                "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
                "Access-Control-Allow-Headers: Content-Type\r\n"
                "Content-Length: 0\r\n"
                "Connection: close\r\n\r\n";

            send_all(
                client_socket,
                response,
                strlen(response)
            );

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           LIVE TRAFFIC DIJKSTRA ROUTE
           GET /api/live-route
           ================================================= */

        if (strncmp(
            buffer,
            "GET /api/live-route ",
            20
        ) == 0) {

            handle_live_route(client_socket);

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           TOMTOM LIVE TRAFFIC
           GET /api/live-traffic
           ================================================= */

        if (strncmp(
            buffer,
            "GET /api/live-traffic?",
            22
        ) == 0) {

            handle_live_traffic(
                client_socket,
                buffer
            );

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           ORIGINAL DIJKSTRA ROUTE
           GET /api/route
           ================================================= */

        if (strncmp(
            buffer,
            "GET /api/route?",
            15
        ) == 0) {

            handle_route(
                client_socket,
                buffer
            );

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           ROAD MANAGEMENT
           POST /api/road
           ================================================= */

        if (strncmp(
            buffer,
            "POST /api/road ",
            15
        ) == 0) {

            handle_road_management(
                client_socket,
                buffer
            );

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           TRAFFIC CONGESTION
           POST /api/traffic
           ================================================= */

        if (strncmp(
            buffer,
            "POST /api/traffic ",
            18
        ) == 0) {

            handle_traffic_update(
                client_socket,
                buffer
            );

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           BFS AND DFS
           GET /api/traversal
           ================================================= */

        if (strncmp(
            buffer,
            "GET /api/traversal?",
            19
        ) == 0) {

            handle_traversal(
                client_socket,
                buffer
            );

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           DASHBOARD STATISTICS
           GET /api/state
           ================================================= */

        if (strncmp(
            buffer,
            "GET /api/state ",
            15
        ) == 0) {

            handle_state(client_socket);

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           BACKEND STATUS
           GET /
           ================================================= */

        if (strncmp(
            buffer,
            "GET / ",
            6
        ) == 0) {

            const char *body =
                "{\"status\":\"running\","
                "\"message\":\"TrafficFlow network initialized\"}";

            send_json(
                client_socket,
                body,
                200,
                "OK"
            );

            closesocket(client_socket);
            continue;
        }


        /* =================================================
           UNKNOWN ENDPOINT
           ================================================= */

        send_json(
            client_socket,
            "{\"error\":\"Endpoint not found\"}",
            404,
            "Not Found"
        );

        closesocket(client_socket);
    }

    /* =====================================================
       CLEANUP
       ===================================================== */

    closesocket(server_socket);

    #ifdef _WIN32
        WSACleanup();
#endif

    curl_global_cleanup();

    free_graph(&trafficGraph);
    free_graph(&liveTrafficGraph);

    free_avl(locationTree);
    free_hashmap(&locationMap);

    return 0;
}