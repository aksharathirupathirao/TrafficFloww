// =============================================
// TRAFFICFLOW — CITY-AWARE BUS SERVICES
// =============================================

const GTFS_PATH = "./gtfs/";

let busSelectedCity = {
    name: "Hyderabad",
    key: "hyderabad"
};

let busDataLoaded = false;
let busDataLoading = false;

let busRoutes = [];
let busStops = [];
let busTrips = [];
let busStopTimes = [];

let busLoadError = null;

// =============================================
// COMMON HELPERS
// =============================================

function busElement(id) {
    return document.getElementById(id);
}

function busSetText(id, value) {
    const element = busElement(id);

    if (element) {
        element.textContent = value;
    }
}

function busEscapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

// =============================================
// CSV PARSER
// =============================================

function parseGTFSCSV(text) {

    const rows = [];
    let row = [];
    let value = "";
    let insideQuotes = false;

    for (let i = 0; i < text.length; i++) {

        const character = text[i];
        const nextCharacter = text[i + 1];

        if (character === '"') {

            if (insideQuotes && nextCharacter === '"') {
                value += '"';
                i++;
            } else {
                insideQuotes = !insideQuotes;
            }

        } else if (character === "," && !insideQuotes) {

            row.push(value);
            value = "";

        } else if (
            (character === "\n" || character === "\r") &&
            !insideQuotes
        ) {

            if (character === "\r" && nextCharacter === "\n") {
                i++;
            }

            row.push(value);

            if (row.some(cell => cell.trim() !== "")) {
                rows.push(row);
            }

            row = [];
            value = "";

        } else {

            value += character;
        }
    }

    if (value.length || row.length) {

        row.push(value);

        if (row.some(cell => cell.trim() !== "")) {
            rows.push(row);
        }
    }

    if (!rows.length) {
        return [];
    }

    const headers = rows[0].map(header => header.trim());

    return rows.slice(1).map(cells => {

        const record = {};

        headers.forEach((header, index) => {
            record[header] = (cells[index] ?? "").trim();
        });

        return record;
    });
}

// =============================================
// LOAD ONE GTFS FEED
// =============================================

async function fetchGTFSFile(filename) {

    const response = await fetch(
        `${GTFS_PATH}${filename}`,
        { cache: "no-store" }
    );

    if (!response.ok) {
        throw new Error(`${filename} could not be loaded.`);
    }

    const text = await response.text();

    return parseGTFSCSV(text);
}

async function loadBusData() {

    if (busDataLoaded) {
        return true;
    }

    if (busDataLoading) {
        return false;
    }

    busDataLoading = true;
    busLoadError = null;

    busSetText(
        "busSearchStatus",
        "Loading Hyderabad GTFS bus schedule data..."
    );

    try {

        const [
            routes,
            stops,
            trips,
            stopTimes
        ] = await Promise.all([
            fetchGTFSFile("routes.txt"),
            fetchGTFSFile("stops.txt"),
            fetchGTFSFile("trips.txt"),
            fetchGTFSFile("stop_times.txt")
        ]);

        busRoutes = routes;
        busStops = stops;
        busTrips = trips;
        busStopTimes = stopTimes;

        busDataLoaded = true;

        console.log(
            "GTFS bus data loaded:",
            {
                routes: busRoutes.length,
                stops: busStops.length,
                trips: busTrips.length,
                stopTimes: busStopTimes.length
            }
        );

        return true;

    } catch (error) {

        busLoadError = error;

        console.error("GTFS loading error:", error);

        busSetText(
            "busSearchStatus",
            "Unable to load the Hyderabad bus feed. Check that the GTFS files are available in frontend/gtfs/."
        );

        return false;

    } finally {

        busDataLoading = false;
    }
}

// =============================================
// CITY SUPPORT
// =============================================

function isHyderabadBusFeedAvailable() {
    return busSelectedCity.key === "hyderabad";
}

function updateBusCityHeadings() {

    busSetText(
        "busServiceEyebrow",
        busSelectedCity.name.toUpperCase()
    );

    busSetText(
        "busServiceHeading",
        `${busSelectedCity.name} Bus Services`
    );

    busSetText(
        "busServiceDescription",
        `Search available bus routes and scheduled services for ${busSelectedCity.name}.`
    );

    busSetText(
        "busNetworkLabel",
        isHyderabadBusFeedAvailable()
            ? "TGSRTC / Hyderabad GTFS feed"
            : `${busSelectedCity.name} bus feed`
    );

    busSetText(
        "busFeedDescription",
        isHyderabadBusFeedAvailable()
            ? "Using the Hyderabad GTFS schedule files available in this project."
            : `No GTFS bus schedule has been configured for ${busSelectedCity.name}.`
    );
}

function clearBusResults() {

    const results = busElement("busResults");

    if (results) {
        results.innerHTML = "";
    }

    const input = busElement("busSearch");

    if (input) {
        input.value = "";
    }
}

function setBusCity(city) {

    if (!city || !city.name) {
        return;
    }

    busSelectedCity = {
        name: city.name,
        key: String(city.key || city.name)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
    };

    clearBusResults();
    updateBusCityHeadings();

    if (!isHyderabadBusFeedAvailable()) {

        busSetText(
            "busSearchStatus",
            `Bus schedules are not available for ${busSelectedCity.name} because this project currently contains only the Hyderabad GTFS feed.`
        );

        busSetText(
            "busServiceNote",
            "No bus routes are displayed because a verified feed for this city has not been configured."
        );

        return;
    }

    busSetText(
        "busSearchStatus",
        "Hyderabad bus feed selected. Loading scheduled services..."
    );

    busSetText(
        "busServiceNote",
        "Routes and timings are read from the Hyderabad GTFS files included with this project."
    );

    loadBusData().then(success => {

        if (
            !success ||
            !isHyderabadBusFeedAvailable()
        ) {
            return;
        }

        displayBusResults(busRoutes.slice(0, 20));

        busSetText(
            "busSearchStatus",
            `${busRoutes.length} Hyderabad bus routes loaded. Search by route number, route name or stop name.`
        );
    });
}

window.setBusCity = setBusCity;

// Listen for city changes from script.js.

window.addEventListener(
    "trafficflow:citychange",
    event => {
        setBusCity(event.detail);
    }
);

// =============================================
// BUILD ROUTE DETAILS
// =============================================

function getTripsForRoute(routeId) {

    return busTrips.filter(trip =>
        trip.route_id === routeId
    );
}

function getStopsForRoute(routeId) {

    const routeTrips = getTripsForRoute(routeId);

    const tripIds = new Set(
        routeTrips.map(trip => trip.trip_id)
    );

    const routeStopTimes = busStopTimes
        .filter(item => tripIds.has(item.trip_id))
        .sort((a, b) => {

            const tripA = a.trip_id;
            const tripB = b.trip_id;

            if (tripA !== tripB) {
                return tripA.localeCompare(tripB);
            }

            return Number(a.stop_sequence) -
                Number(b.stop_sequence);
        });

    const stopMap = new Map(
        busStops.map(stop => [
            stop.stop_id,
            stop
        ])
    );

    const uniqueStops = [];
    const seenStops = new Set();

    routeStopTimes.forEach(item => {

        if (seenStops.has(item.stop_id)) {
            return;
        }

        const stop = stopMap.get(item.stop_id);

        if (!stop) {
            return;
        }

        seenStops.add(item.stop_id);

        uniqueStops.push({
            name: stop.stop_name,
            arrivalTime: item.arrival_time || item.departure_time || "--"
        });
    });

    return uniqueStops;
}

function getRouteDisplayDetails(route) {

    const routeTrips = getTripsForRoute(route.route_id);
    const stops = getStopsForRoute(route.route_id);

    return {
        id: route.route_id || "--",
        number: route.route_short_name || route.route_id || "--",
        name: route.route_long_name || "Bus route",
        trips: routeTrips.length,
        stops,
        sampleStops: stops.slice(0, 5)
    };
}

// =============================================
// DISPLAY BUS RESULTS
// =============================================

function displayBusResults(routes) {

    const resultsContainer = busElement("busResults");

    if (!resultsContainer) {
        return;
    }

    resultsContainer.innerHTML = "";

    if (!isHyderabadBusFeedAvailable()) {

        busSetText(
            "busSearchStatus",
            `No verified bus feed is configured for ${busSelectedCity.name}.`
        );

        return;
    }

    if (!routes || !routes.length) {

        resultsContainer.textContent =
            "No matching bus routes found.";

        return;
    }

    routes.forEach(route => {

        const details = getRouteDisplayDetails(route);

        const card = document.createElement("article");

        card.className = "bus-result-card";

        const heading = document.createElement("h3");
        heading.textContent =
            `Bus ${details.number}`;

        const routeName = document.createElement("p");
        routeName.textContent = details.name;

        const routeId = document.createElement("p");
        routeId.textContent = `Route ID: ${details.id}`;

        const tripCount = document.createElement("p");
        tripCount.textContent =
            `${details.trips} scheduled trips`;

        const stopHeading = document.createElement("strong");
        stopHeading.textContent = "Sample stops";

        const stopList = document.createElement("ol");

        if (details.sampleStops.length) {

            details.sampleStops.forEach(stop => {

                const item = document.createElement("li");

                item.textContent =
                    `${stop.name} — ${stop.arrivalTime}`;

                stopList.appendChild(item);
            });

        } else {

            const item = document.createElement("li");
            item.textContent = "Stop details unavailable";

            stopList.appendChild(item);
        }

        const totalStops = document.createElement("p");

        totalStops.textContent =
            `${details.stops.length} unique stops found in the feed`;

        card.appendChild(heading);
        card.appendChild(routeName);
        card.appendChild(routeId);
        card.appendChild(tripCount);
        card.appendChild(stopHeading);
        card.appendChild(stopList);
        card.appendChild(totalStops);

        resultsContainer.appendChild(card);
    });

    busSetText(
        "busSearchStatus",
        `${routes.length} matching Hyderabad bus route(s) displayed.`
    );
}

// =============================================
// SEARCH BUS ROUTES
// =============================================

function findMatchingBusRoutes(query) {

    if (!query) {
        return [];
    }

    const normalizedQuery = query.toLowerCase();

    return busRoutes.filter(route => {

        const routeNumber =
            String(route.route_short_name || "").toLowerCase();

        const routeName =
            String(route.route_long_name || "").toLowerCase();

        const routeId =
            String(route.route_id || "").toLowerCase();

        if (
            routeNumber.includes(normalizedQuery) ||
            routeName.includes(normalizedQuery) ||
            routeId.includes(normalizedQuery)
        ) {
            return true;
        }

        const routeTrips = getTripsForRoute(route.route_id);

        const tripIds = new Set(
            routeTrips.map(trip => trip.trip_id)
        );

        const stopIds = new Set(
            busStopTimes
                .filter(item => tripIds.has(item.trip_id))
                .map(item => item.stop_id)
        );

        return busStops.some(stop =>
            stopIds.has(stop.stop_id) &&
            String(stop.stop_name || "")
                .toLowerCase()
                .includes(normalizedQuery)
        );
    });
}

async function searchBusRoutes() {

    if (!isHyderabadBusFeedAvailable()) {

        busSetText(
            "busSearchStatus",
            `Bus schedules are not configured for ${busSelectedCity.name}.`
        );

        clearBusResults();

        return;
    }

    const input = busElement("busSearch");
    const query = input?.value.trim();

    if (!query) {

        busSetText(
            "busSearchStatus",
            "Enter a bus number, route name or stop name."
        );

        return;
    }

    busSetText(
        "busSearchStatus",
        "Searching Hyderabad bus schedules..."
    );

    const loaded = await loadBusData();

    if (!loaded) {
        return;
    }

    if (!isHyderabadBusFeedAvailable()) {
        return;
    }

    const matches = findMatchingBusRoutes(query);

    displayBusResults(matches);
}

// =============================================
// DASHBOARD SEARCH INTEGRATION
// =============================================

window.searchBusRoutesFromDashboard = async function(query) {

    if (!isHyderabadBusFeedAvailable()) {

        return {
            success: false,
            matches: []
        };
    }

    const loaded = await loadBusData();

    if (!loaded || !isHyderabadBusFeedAvailable()) {

        return {
            success: false,
            matches: []
        };
    }

    const matches = findMatchingBusRoutes(query);

    return {
        success: true,

        matches: matches.map(route => {

            const details = getRouteDisplayDetails(route);

            return {
                id: details.id,
                number: details.number,
                name: details.name,
                trips: details.trips
            };
        })
    };
};

window.showDashboardBusResults = function(query) {

    const busesButton =
        document.querySelector('[data-view="buses"]');

    if (busesButton) {
        busesButton.click();
    }

    const input = busElement("busSearch");

    if (input) {
        input.value = query || "";
    }

    searchBusRoutes();
};

// =============================================
// BUTTONS AND INPUT EVENTS
// =============================================

const busSearchButton = busElement("searchBuses");
const busSearchInput = busElement("busSearch");
const busClearButton = busElement("clearBusSearch");

if (busSearchButton) {

    busSearchButton.addEventListener(
        "click",
        searchBusRoutes
    );
}

if (busSearchInput) {

    busSearchInput.addEventListener("keydown", event => {

        if (event.key === "Enter") {
            searchBusRoutes();
        }
    });
}

if (busClearButton) {

    busClearButton.addEventListener("click", () => {

        clearBusResults();

        if (!isHyderabadBusFeedAvailable()) {
            busSetText(
                "busSearchStatus",
                `No bus feed is configured for ${busSelectedCity.name}.`
            );

            return;
        }

        if (busDataLoaded) {

            displayBusResults(busRoutes.slice(0, 20));

        } else {

            busSetText(
                "busSearchStatus",
                "Search cleared."
            );
        }
    });
}

// =============================================
// INITIALIZE BUS MODULE
// =============================================

// Read the currently selected city if script.js
// has already initialized.

if (typeof window.getSelectedTrafficCity === "function") {

    setBusCity(
        window.getSelectedTrafficCity()
    );

} else {

    updateBusCityHeadings();
}