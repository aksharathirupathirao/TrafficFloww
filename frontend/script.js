const API = "https://trafficflow-backend-7y4r.onrender.com/api";

// =============================================
// COMMON HELPERS
// =============================================

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = getElement(id);

    if (element) {
        element.textContent = value;
    }
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

function isValidCoordinate(latitude, longitude) {
    return (
        Number.isFinite(latitude) &&
        Number.isFinite(longitude) &&
        latitude >= -90 &&
        latitude <= 90 &&
        longitude >= -180 &&
        longitude <= 180
    );
}

function cityKey(name) {
    return String(name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
}

// =============================================
// SELECTED CITY — SINGLE SOURCE OF TRUTH
// =============================================

let selectedCity = {
    name: "Hyderabad",
    latitude: 17.3850,
    longitude: 78.4867,
    key: "hyderabad",
    extent: null
};

let cityGeneration = 0;

let dashboardTrafficLocations = [];
let trafficReadings = [];

let dashboardTrafficMap = null;
let dashboardTrafficMarkers = [];

let cityRoadDiscoveryInProgress = false;
let activeTrafficRefreshes = new Set();

// =============================================
// TRAFFIC CONDITION
// =============================================

function getTrafficCondition(currentSpeed, freeFlowSpeed) {

    if (
        !Number.isFinite(currentSpeed) ||
        !Number.isFinite(freeFlowSpeed) ||
        freeFlowSpeed <= 0
    ) {
        return {
            label: "Traffic status unavailable",
            color: "#64748b"
        };
    }

    const ratio = currentSpeed / freeFlowSpeed;

    if (ratio < 0.4) {
        return {
            label: "Heavy Traffic",
            color: "#dc2626"
        };
    }

    if (ratio < 0.7) {
        return {
            label: "Moderate Traffic",
            color: "#f59e0b"
        };
    }

    return {
        label: "Smooth Traffic",
        color: "#16a34a"
    };
}

function getCongestionPercentage(currentSpeed, freeFlowSpeed) {

    if (
        !Number.isFinite(currentSpeed) ||
        !Number.isFinite(freeFlowSpeed) ||
        freeFlowSpeed <= 0
    ) {
        return null;
    }

    return Math.max(
        0,
        Math.min(
            100,
            (1 - currentSpeed / freeFlowSpeed) * 100
        )
    );
}

// =============================================
// CITY SEARCH
// =============================================

async function searchCities(query) {

    const url =
        "https://photon.komoot.io/api/?" +
        new URLSearchParams({
            q: query,
            lat: String(selectedCity.latitude),
            lon: String(selectedCity.longitude),
            limit: "10",
            lang: "en"
        });

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("City search failed.");
    }

    const data = await response.json();

    const features = data.features || [];

    const cityFeatures = features.filter(feature => {

        const properties = feature.properties || {};

        const placeType = String(
            properties.osm_value || properties.type || ""
        ).toLowerCase();

        return (
            properties.osm_key === "place" &&
            [
                "city",
                "town",
                "village",
                "municipality",
                "hamlet"
            ].includes(placeType)
        );
    });

    return cityFeatures.map(feature => {

        const properties = feature.properties || {};
        const coordinates = feature.geometry?.coordinates;

        if (
            !coordinates ||
            coordinates.length < 2
        ) {
            return null;
        }

        const longitude = Number(coordinates[0]);
        const latitude = Number(coordinates[1]);

        if (!isValidCoordinate(latitude, longitude)) {
            return null;
        }

        const name = properties.name || "Unknown city";

        const displayName = [
            name,
            properties.state,
            properties.country
        ]
            .filter(Boolean)
            .filter((value, index, array) =>
                array.indexOf(value) === index
            )
            .join(", ");

        return {
            name,
            displayName,
            latitude,
            longitude,
            extent: properties.extent || null,
            key: cityKey(name)
        };

    }).filter(Boolean);
}

function displayCitySearchResults(cities) {

    const results = getElement("citySelectorResults");

    if (!results) {
        return;
    }

    results.innerHTML = "";

    if (!cities.length) {

        results.textContent =
            "No matching cities found. Try another city name.";

        return;
    }

    cities.forEach(city => {

        const button = document.createElement("button");

        button.type = "button";
        button.className = "city-selector-result";

        const name = document.createElement("strong");
        name.textContent = city.name;

        const detail = document.createElement("span");
        detail.textContent = city.displayName;

        button.appendChild(name);
        button.appendChild(detail);

        button.addEventListener("click", () => {
            selectCity(city);
        });

        results.appendChild(button);
    });
}

async function performCitySearch() {

    const input = getElement("citySelectorInput");
    const status = getElement("citySelectorStatus");
    const button = getElement("citySelectorButton");

    const query = input?.value.trim();

    if (!query) {

        setText(
            "citySelectorStatus",
            "Enter a city name first."
        );

        return;
    }

    if (button) {
        button.disabled = true;
    }

    setText(
        "citySelectorStatus",
        "Searching for cities..."
    );

    const results = getElement("citySelectorResults");

    if (results) {
        results.innerHTML = "";
    }

    try {

        const cities = await searchCities(query);

        displayCitySearchResults(cities);

        setText(
            "citySelectorStatus",
            cities.length
                ? "Select a city to load its dashboard."
                : "No matching cities found."
        );

    } catch (error) {

        console.error("City search error:", error);

        setText(
            "citySelectorStatus",
            "City search is temporarily unavailable."
        );

    } finally {

        if (button) {
            button.disabled = false;
        }
    }
}

const citySelectorButton = getElement("citySelectorButton");
const citySelectorInput = getElement("citySelectorInput");

if (citySelectorButton) {
    citySelectorButton.addEventListener(
        "click",
        performCitySearch
    );
}

if (citySelectorInput) {

    citySelectorInput.addEventListener("keydown", event => {

        if (event.key === "Enter") {
            performCitySearch();
        }
    });
}

// =============================================
// CITY CHANGE
// =============================================

function selectCity(city) {

    if (
        !city ||
        !isValidCoordinate(city.latitude, city.longitude)
    ) {
        return;
    }

    selectedCity = {
        ...city,
        key: city.key || cityKey(city.name)
    };

    cityGeneration++;

    dashboardTrafficLocations = [];
    trafficReadings = [];

    cityRoadDiscoveryInProgress = false;

    // Update selected city display.

    setText(
        "selectedCityName",
        selectedCity.name
    );

    setText(
        "citySelectorStatus",
        `${selectedCity.name} selected successfully. Loading its traffic information...`
    );

    const input = getElement("citySelectorInput");

    if (input) {
        input.value = selectedCity.displayName || selectedCity.name;
    }

    const results = getElement("citySelectorResults");

    if (results) {
        results.innerHTML = "";
    }

    // Update dashboard headings.

    setText(
        "dashboardSearchHeading",
        `Search ${selectedCity.name}`
    );

    setText(
        "liveTrafficHeading",
        `${selectedCity.name} Live Traffic`
    );

    setText(
        "analyticsSubtitle",
        `Traffic congestion analysis for ${selectedCity.name}`
    );

    setText(
        "trafficTrendSubtitle",
        `Traffic speed history in ${selectedCity.name}`
    );

    setText(
        "dashboardMapHeading",
        `${selectedCity.name} Traffic Map`
    );

    // Update route planner headings.

    setText(
        "cityPlannerHeading",
        `${selectedCity.name} Route Planner`
    );

    setText(
        "cityPlannerDescription",
        `Find driving routes and compare available journeys in ${selectedCity.name}.`
    );

    setText(
        "cityRouteMapHeading",
        `${selectedCity.name} Route Map`
    );

    // Reset old city information.

    resetCityDashboard();

    // Move both maps to the selected city.

    if (dashboardTrafficMap) {

        dashboardTrafficMap.setView(
            [
                selectedCity.latitude,
                selectedCity.longitude
            ],
            12
        );
    }

    if (window.hyderabadMap) {

        window.hyderabadMap.setView(
            [
                selectedCity.latitude,
                selectedCity.longitude
            ],
            12
        );
    }

    // Update page title.

    updatePageDetails();

    // Notify bus module.

    notifyBusCityChange();

    // Load traffic for the new city.

    refreshLiveTraffic();

    // Refresh map sizes.

    refreshDashboardMapSize();

    setTimeout(() => {

        if (window.hyderabadMap) {
            window.hyderabadMap.invalidateSize(true);
        }

        if (dashboardTrafficMap) {
            dashboardTrafficMap.invalidateSize(true);
        }

    }, 500);
}

function resetCityDashboard() {

    const trafficGrid = getElement("liveTrafficGrid");

    if (trafficGrid) {
        trafficGrid.innerHTML = "";
    }

    dashboardTrafficMarkers.forEach(marker => {

        if (dashboardTrafficMap) {
            dashboardTrafficMap.removeLayer(marker);
        }
    });

    dashboardTrafficMarkers = [];

    setText(
        "liveTrafficStatus",
        "Loading traffic information for " + selectedCity.name + "..."
    );

    setText(
        "dashboardMapStatus",
        "Waiting for road traffic locations..."
    );

    setText(
        "analyticsAverageSpeed",
        "-- km/h"
    );

    setText(
        "analyticsCongestion",
        "--%"
    );

    setText(
        "analyticsMostCongested",
        "Waiting for traffic data"
    );

    setText(
        "analyticsHitecSpeed",
        "-- km/h"
    );

    setText(
        "analyticsInorbitSpeed",
        "-- km/h"
    );

    setText(
        "analyticsLocationName1",
        "Road 1"
    );

    setText(
        "analyticsLocationName2",
        "Road 2"
    );

    setText(
        "analyticsLocationComparison",
        selectedCity.name
    );

    setText(
        "analyticsUpdated",
        "Waiting for measurements..."
    );

    setText(
        "analyticsHitecCondition",
        "Waiting..."
    );

    setText(
        "analyticsInorbitCondition",
        "Waiting..."
    );

    const chart = getElement("trafficTrendChart");

    if (chart) {
        chart.innerHTML = "";
    }

    setText(
        "trafficTrendStatus",
        "Waiting for traffic readings..."
    );

    const hitecBar = getElement("analyticsHitecBar");
    const inorbitBar = getElement("analyticsInorbitBar");

    if (hitecBar) {
        hitecBar.style.width = "0%";
    }

    if (inorbitBar) {
        inorbitBar.style.width = "0%";
    }

    clearCityPlanner();
}

// =============================================
// BUS MODULE CITY NOTIFICATION
// =============================================

function notifyBusCityChange() {

    const event = new CustomEvent(
        "trafficflow:citychange",
        {
            detail: {
                name: selectedCity.name,
                key: selectedCity.key,
                latitude: selectedCity.latitude,
                longitude: selectedCity.longitude
            }
        }
    );

    window.dispatchEvent(event);

    if (typeof window.setBusCity === "function") {

        window.setBusCity({
            name: selectedCity.name,
            key: selectedCity.key,
            latitude: selectedCity.latitude,
            longitude: selectedCity.longitude
        });
    }
}

// =============================================
// OPENSTREETMAP ROAD DISCOVERY
// =============================================


async function discoverCityRoads(city) {

    const radius = 5000;

    const query = `
        [out:json][timeout:25];
        way(around:${radius},${city.latitude},${city.longitude})
        ["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified)$"]
        ["name"];
        out center 20;
    `;

    const endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://overpass.nchc.org.tw/api/interpreter"
    ];

    for (const endpoint of endpoints) {

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        try {

            const response = await fetch(
                endpoint + "?data=" + encodeURIComponent(query),
                {
                    method: "GET",
                    signal: controller.signal,
                    cache: "no-store"
                }
            );

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            if (data.elements && data.elements.length > 0) {

                console.log(
                    "Roads successfully discovered:",
                    data.elements.length
                );

                return data.elements;
            }

        } catch (error) {

            console.warn(
                "Road discovery failed:",
                endpoint,
                error.message
            );

        } finally {

            clearTimeout(timeout);

        }
    }

    console.warn(
        "All Overpass servers unavailable. Using fallback roads."
    );

    return [
        { tags: { name: "HITEC City Road" }, center: { lat: 17.4435, lon: 78.3772 } },
        { tags: { name: "Gachibowli Road" }, center: { lat: 17.4401, lon: 78.3489 } },
        { tags: { name: "Madhapur Road" }, center: { lat: 17.4483, lon: 78.3915 } },
        { tags: { name: "Banjara Hills Road" }, center: { lat: 17.4156, lon: 78.4347 } },
        { tags: { name: "Jubilee Hills Road" }, center: { lat: 17.4310, lon: 78.4070 } },
        { tags: { name: "Mehdipatnam Road" }, center: { lat: 17.3930, lon: 78.4370 } },
        { tags: { name: "Kukatpally Road" }, center: { lat: 17.4933, lon: 78.3996 } },
        { tags: { name: "Secunderabad Road" }, center: { lat: 17.4399, lon: 78.4983 } }
    ];
}


function selectRoadSamplePoints(elements) {

    const priority = {
        motorway: 1,
        trunk: 2,
        primary: 3,
        secondary: 4,
        tertiary: 5,
        unclassified: 6
    };

    const candidates = elements.map(element => {

        const latitude = Number(element.center?.lat);
        const longitude = Number(element.center?.lon);

        const name = element.tags?.name;

        if (
            !name ||
            !isValidCoordinate(latitude, longitude)
        ) {
            return null;
        }

        return {
            name,
            latitude,
            longitude,
            roadType: element.tags?.highway || "road",
            priority: priority[element.tags?.highway] || 10,
            source: "OpenStreetMap"
        };

    }).filter(Boolean);

    // Prefer important roads first.

    candidates.sort((a, b) =>
        a.priority - b.priority
    );

    // Avoid selecting several points on the same nearby road.

    const selected = [];

    for (const candidate of candidates) {

        const tooClose = selected.some(existing => {

            const distance = calculateDistanceKm(
                candidate.latitude,
                candidate.longitude,
                existing.latitude,
                existing.longitude
            );

            return distance < 1.2;
        });

        if (!tooClose) {

            selected.push(candidate);
        }

        if (selected.length >= 6) {
            break;
        }
    }

    return selected;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {

    const earthRadius = 6371;

    const dLat =
        (lat2 - lat1) * Math.PI / 180;

    const dLon =
        (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    return earthRadius * 2 * Math.atan2(
        Math.sqrt(a),
        Math.sqrt(1 - a)
    );
}

// =============================================
// DASHBOARD TRAFFIC MAP
// =============================================

function initializeDashboardTrafficMap() {

    const mapElement = getElement("dashboardTrafficMap");

    if (!mapElement || typeof L === "undefined") {
        console.error("Dashboard Leaflet map is unavailable.");
        return;
    }

    if (dashboardTrafficMap) {
        return;
    }

    dashboardTrafficMap = L.map(
        "dashboardTrafficMap",
        {
            dragging: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            zoomControl: true
        }
    ).setView(
        [
            selectedCity.latitude,
            selectedCity.longitude
        ],
        12
    );

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(dashboardTrafficMap);

    setTimeout(() => {
        dashboardTrafficMap.invalidateSize(true);
    }, 500);

    setText(
        "dashboardMapStatus",
        `${selectedCity.name} map initialized.`
    );
}

function clearDashboardTrafficMarkers() {

    dashboardTrafficMarkers.forEach(marker => {

        if (dashboardTrafficMap) {
            dashboardTrafficMap.removeLayer(marker);
        }
    });

    dashboardTrafficMarkers = [];
}

function updateDashboardTrafficMap(data, index) {

    if (!dashboardTrafficMap) {
        return;
    }

    const location = dashboardTrafficLocations[index];

    if (!location) {
        return;
    }

    const currentSpeed = Number(data.currentSpeed);
    const freeFlowSpeed = Number(data.freeFlowSpeed);

    const condition = getTrafficCondition(
        currentSpeed,
        freeFlowSpeed
    );

    let marker = dashboardTrafficMarkers[index];

    if (!marker) {

        marker = L.circleMarker(
            [
                location.latitude,
                location.longitude
            ],
            {
                radius: 10,
                color: "#ffffff",
                weight: 3,
                fillColor: condition.color,
                fillOpacity: 1
            }
        ).addTo(dashboardTrafficMap);

        dashboardTrafficMarkers[index] = marker;

    } else {

        marker.setLatLng([
            location.latitude,
            location.longitude
        ]);

        marker.setStyle({
            fillColor: condition.color,
            color: "#ffffff",
            radius: 10
        });
    }

    marker.bindPopup(
        `<strong>${escapeHTML(location.name)}</strong><br>` +
        `<b>Current Speed:</b> ${currentSpeed} km/h<br>` +
        `<b>Free-flow Speed:</b> ${freeFlowSpeed} km/h<br>` +
        `<b>Traffic:</b> ${condition.label}`
    );

    setText(
        "dashboardMapStatus",
        `Showing live traffic measurements across ${selectedCity.name}.`
    );
}

function refreshDashboardMapSize() {

    if (dashboardTrafficMap) {

        setTimeout(() => {
            dashboardTrafficMap.invalidateSize(true);
        }, 300);
    }
}

// =============================================
// LIVE TRAFFIC API
// =============================================

async function fetchLiveTrafficPoint(latitude, longitude) {

    if (!isValidCoordinate(latitude, longitude)) {
        throw new Error("Invalid traffic coordinates.");
    }

    const url =
        `${API}/live-traffic?lat=${latitude}&lon=${longitude}`;

    const response = await fetch(url, {
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error("Traffic API request failed.");
    }

    const data = await response.json();

    const speed = Number(data.currentSpeed);
    const freeFlow = Number(data.freeFlowSpeed);

    if (
        !Number.isFinite(speed) ||
        !Number.isFinite(freeFlow)
    ) {
        throw new Error("Traffic API returned invalid measurements.");
    }

    return data;
}

// =============================================
// LIVE TRAFFIC CARDS
// =============================================

function createTrafficCard(location, index) {

    const grid = getElement("liveTrafficGrid");

    if (!grid) {
        return;
    }

    const card = document.createElement("div");

    card.className = "traffic-card";

    const heading = document.createElement("h3");
    heading.textContent = location.name;

    const badge = document.createElement("p");
    badge.id = `trafficCondition${index + 1}`;
    badge.textContent = "Fetching traffic...";
    badge.className = "traffic-condition-badge";

    const metrics = document.createElement("div");
    metrics.className = "traffic-card-metrics";

    const metricDefinitions = [
        ["Current Speed", `liveSpeed${index + 1}`],
        ["Travel Time", `liveTime${index + 1}`],
        ["Free-flow Speed", `freeFlow${index + 1}`],
        ["Confidence", `confidence${index + 1}`]
    ];

    metricDefinitions.forEach(([label, id]) => {

        const item = document.createElement("div");

        const title = document.createElement("span");
        title.textContent = label;

        const value = document.createElement("strong");
        value.id = id;
        value.textContent = "--";

        item.appendChild(title);
        item.appendChild(value);

        metrics.appendChild(item);
    });

    card.appendChild(heading);
    card.appendChild(badge);
    card.appendChild(metrics);

    grid.appendChild(card);
}

function buildTrafficCards() {

    const grid = getElement("liveTrafficGrid");

    if (!grid) {
        return;
    }

    grid.innerHTML = "";

    dashboardTrafficLocations.forEach((location, index) => {
        createTrafficCard(location, index);
    });
}

function updateLiveTrafficCard(data, index) {

    const number = index + 1;

    const speed = Number(data.currentSpeed);
    const travelTime = Number(data.currentTravelTime);
    const freeFlow = Number(data.freeFlowSpeed);
    const confidence = Number(data.confidence);

    setText(
        `liveSpeed${number}`,
        `${speed.toFixed(1)} km/h`
    );

    setText(
        `liveTime${number}`,
        Number.isFinite(travelTime)
            ? `${Math.ceil(travelTime / 60)} min`
            : "--"
    );

    setText(
        `freeFlow${number}`,
        `${freeFlow.toFixed(1)} km/h`
    );

    setText(
        `confidence${number}`,
        Number.isFinite(confidence)
            ? `${Math.round(confidence * 100)}%`
            : "--"
    );

    const condition = getTrafficCondition(
        speed,
        freeFlow
    );

    const badge = getElement(
        `trafficCondition${number}`
    );

    if (badge) {

        badge.textContent = condition.label;
        badge.style.color = condition.color;
    }

    updateDashboardTrafficMap(data, index);
}

// =============================================
// TRAFFIC TREND STORAGE
// =============================================

function getCityTrendStorageKey() {

    return `trafficflowTrend_${selectedCity.key}`;
}

function getTrafficTrendHistory() {

    try {

        const saved = JSON.parse(
            localStorage.getItem(getCityTrendStorageKey()) || "[]"
        );

        if (!Array.isArray(saved)) {
            return [];
        }

        return saved.filter(item =>
            Number.isFinite(Number(item.timestamp)) &&
            Number.isFinite(Number(item.averageSpeed))
        ).slice(-30);

    } catch (error) {

        console.error("Trend history error:", error);

        return [];
    }
}

function recordTrafficTrend(readings) {

    const validSpeeds = readings
        .map(item => Number(item.currentSpeed))
        .filter(speed =>
            Number.isFinite(speed) && speed >= 0
        );

    if (!validSpeeds.length) {
        return;
    }

    const averageSpeed =
        validSpeeds.reduce((sum, speed) =>
            sum + speed, 0
        ) / validSpeeds.length;

    const history = getTrafficTrendHistory();

    history.push({
        timestamp: Date.now(),
        averageSpeed
    });

    const recentHistory = history.slice(-30);

    try {

        localStorage.setItem(
            getCityTrendStorageKey(),
            JSON.stringify(recentHistory)
        );

    } catch (error) {

        console.error("Trend history saving error:", error);
    }

    renderTrafficTrendChart(recentHistory);
}

// =============================================
// SINGLE-CITY TRAFFIC TREND CHART
// =============================================

function renderTrafficTrendChart(history) {

    const chart = getElement("trafficTrendChart");
    const status = getElement("trafficTrendStatus");

    if (!chart) {
        return;
    }

    if (!history || history.length === 0) {

        chart.innerHTML = "";

        if (status) {
            status.textContent =
                `Waiting for ${selectedCity.name} traffic readings...`;
        }

        return;
    }

    const values = history.map(item =>
        Number(item.averageSpeed)
    );

    const maximum = Math.max(10, ...values);

    const yMaximum = Math.ceil(maximum / 10) * 10;

    const width = 700;
    const height = 300;

    const left = 55;
    const right = 25;
    const top = 30;
    const bottom = 45;

    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;

    const xPosition = index => {

        if (values.length === 1) {
            return left + plotWidth / 2;
        }

        return left +
            (index / (values.length - 1)) * plotWidth;
    };

    const yPosition = speed =>
        top + plotHeight -
        (speed / yMaximum) * plotHeight;

    let grid = "";
    let labels = "";

    for (let i = 0; i <= 4; i++) {

        const y = top + (plotHeight / 4) * i;

        const speed =
            yMaximum - (yMaximum / 4) * i;

        grid += `
            <line
                x1="${left}"
                y1="${y}"
                x2="${width - right}"
                y2="${y}"
                stroke="#e2e8f0"
                stroke-dasharray="4 4"
            />
        `;

        labels += `
            <text
                x="${left - 10}"
                y="${y + 4}"
                text-anchor="end"
                fill="#64748b"
                font-size="12"
            >${speed.toFixed(0)}</text>
        `;
    }

    const coordinates = values.map((speed, index) =>
        `${xPosition(index)},${yPosition(speed)}`
    ).join(" ");

    let points = "";

    values.forEach((speed, index) => {

        points += `
            <circle
                cx="${xPosition(index)}"
                cy="${yPosition(speed)}"
                r="4"
                fill="#2563eb"
            />
        `;
    });

    const firstTime = new Date(
        history[0].timestamp
    ).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit"
    });

    const lastTime = new Date(
        history[history.length - 1].timestamp
    ).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit"
    });

    chart.innerHTML = `
        <svg
            viewBox="0 0 ${width} ${height}"
            width="100%"
            role="img"
            aria-label="Average traffic speed trend for ${escapeHTML(selectedCity.name)}"
        >

            ${grid}
            ${labels}

            <polyline
                points="${coordinates}"
                fill="none"
                stroke="#2563eb"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
            />

            ${points}

            <text
                x="${left}"
                y="${height - 10}"
                fill="#64748b"
                font-size="12"
            >${firstTime}</text>

            <text
                x="${width - right}"
                y="${height - 10}"
                text-anchor="end"
                fill="#64748b"
                font-size="12"
            >${lastTime}</text>

            <text
                x="15"
                y="${height / 2}"
                transform="rotate(-90 15 ${height / 2})"
                text-anchor="middle"
                fill="#64748b"
                font-size="12"
            >Average speed (km/h)</text>

        </svg>
    `;

    setText(
        "trafficTrendLegend",
        `Average traffic speed — ${selectedCity.name}`
    );

    if (status) {

        status.textContent =
            `${history.length} readings collected for ${selectedCity.name}. Latest update: ${lastTime}`;
    }
}

// =============================================
// TRAFFIC CONDITION BADGES
// =============================================

function setTrafficConditionBadge(elementId, congestion) {

    const element = getElement(elementId);

    if (!element) {
        return;
    }

    if (!Number.isFinite(congestion)) {

        element.textContent = "Unavailable";
        return;
    }

    let label;
    let conditionClass;

    if (congestion >= 60) {

        label = "Heavy Traffic";
        conditionClass = "traffic-condition-heavy";

    } else if (congestion >= 30) {

        label = "Moderate Traffic";
        conditionClass = "traffic-condition-moderate";

    } else {

        label = "Smooth Traffic";
        conditionClass = "traffic-condition-smooth";
    }

    element.textContent = label;

    element.className =
        `traffic-condition-badge ${conditionClass}`;
}

// =============================================
// CITY TRAFFIC ANALYTICS
// =============================================

function updateTrafficAnalytics(readings) {

    const validReadings = readings.filter(reading => {

        const speed = Number(reading.currentSpeed);
        const freeFlow = Number(reading.freeFlowSpeed);

        return (
            Number.isFinite(speed) &&
            Number.isFinite(freeFlow) &&
            freeFlow > 0
        );
    });

    if (!validReadings.length) {
        return;
    }

    const locations = validReadings.map(reading => ({

        name: reading.location.name,

        speed: Number(reading.currentSpeed),

        freeFlow: Number(reading.freeFlowSpeed),

        congestion: getCongestionPercentage(
            Number(reading.currentSpeed),
            Number(reading.freeFlowSpeed)
        )

    }));

    const averageSpeed =
        locations.reduce((sum, item) =>
            sum + item.speed, 0
        ) / locations.length;

    const averageCongestion =
        locations.reduce((sum, item) =>
            sum + item.congestion, 0
        ) / locations.length;

    const mostCongested = [...locations].sort(
        (a, b) => b.congestion - a.congestion
    )[0];

    setText(
        "analyticsAverageSpeed",
        `${averageSpeed.toFixed(1)} km/h`
    );

    setText(
        "analyticsCongestion",
        `${averageCongestion.toFixed(1)}%`
    );

    setText(
        "analyticsMostCongested",
        `${mostCongested.congestion.toFixed(1)}% - ${mostCongested.name}`
    );

    // First two actual road measurements.

    const first = locations[0];
    const second = locations[1];

    setText(
        "analyticsLocationName1",
        first.name
    );

    setText(
        "analyticsLocationName2",
        second ? second.name : "No second road reading"
    );

    setText(
        "analyticsLocationComparison",
        selectedCity.name
    );

    setText(
        "analyticsHitecSpeed",
        `${first.speed.toFixed(1)} km/h`
    );

    setTrafficConditionBadge(
        "analyticsHitecCondition",
        first.congestion
    );

    const maximumSpeed = Math.max(
        ...locations.map(item => item.speed),
        1
    );

    const firstBar = getElement("analyticsHitecBar");

    if (firstBar) {

        firstBar.style.width =
            `${(first.speed / maximumSpeed) * 100}%`;
    }

    if (second) {

        setText(
            "analyticsInorbitSpeed",
            `${second.speed.toFixed(1)} km/h`
        );

        setTrafficConditionBadge(
            "analyticsInorbitCondition",
            second.congestion
        );

        const secondBar = getElement("analyticsInorbitBar");

        if (secondBar) {

            secondBar.style.width =
                `${(second.speed / maximumSpeed) * 100}%`;
        }

    } else {

        setText(
            "analyticsInorbitSpeed",
            "-- km/h"
        );

        setText(
            "analyticsInorbitCondition",
            "Unavailable"
        );

        const secondBar = getElement("analyticsInorbitBar");

        if (secondBar) {
            secondBar.style.width = "0%";
        }
    }

    setText(
        "analyticsUpdated",
        `Analytics updated: ${new Date().toLocaleTimeString("en-IN")}`
    );
}

// =============================================
// DISCOVER TRAFFIC LOCATIONS FOR SELECTED CITY
// =============================================

async function loadCityRoadLocations(generation) {

    if (cityRoadDiscoveryInProgress) {
        return;
    }

    cityRoadDiscoveryInProgress = true;

    setText(
        "liveTrafficStatus",
        `Discovering actual named roads in ${selectedCity.name}...`
    );

    try {

        const roads = await discoverCityRoads(selectedCity);

        if (generation !== cityGeneration) {
            return;
        }

        const selectedRoads = selectRoadSamplePoints(roads);

        if (!selectedRoads.length) {

            setText(
                "liveTrafficStatus",
                `No suitable named road locations were found for ${selectedCity.name}.`
            );

            setText(
                "dashboardMapStatus",
                "No road measurement locations available."
            );

            return;
        }

        dashboardTrafficLocations = selectedRoads;

        buildTrafficCards();

        clearDashboardTrafficMarkers();

        setText(
            "liveTrafficStatus",
            `${selectedRoads.length} named roads discovered. Fetching live traffic measurements...`
        );

    } catch (error) {

        console.error("City road discovery error:", error);

        if (generation === cityGeneration) {

            setText(
                "liveTrafficStatus",
                `Unable to discover road locations in ${selectedCity.name}. Please try again later.`
            );

            setText(
                "dashboardMapStatus",
                "Road discovery service unavailable."
            );
        }

    } finally {

        cityRoadDiscoveryInProgress = false;
    }
}

// =============================================
// REFRESH LIVE TRAFFIC
// =============================================

async function refreshLiveTraffic() {

    const generation = cityGeneration;
    const city = selectedCity;

    if (activeTrafficRefreshes.has(city.key)) {
        return;
    }

    activeTrafficRefreshes.add(city.key);

    const status = getElement("liveTrafficStatus");
    const updated = getElement("liveTrafficUpdated");

    try {

        if (status) {
            status.textContent =
                `Updating ${city.name} traffic...`;
        }

        // Discover roads only when necessary.

        if (!dashboardTrafficLocations.length) {

            await loadCityRoadLocations(generation);
        }

        if (generation !== cityGeneration) {
            return;
        }

        if (!dashboardTrafficLocations.length) {
            return;
        }

        // Fetch TomTom measurements for discovered roads.

        const results = await Promise.allSettled(

            dashboardTrafficLocations.map(async location => {

                const data = await fetchLiveTrafficPoint(
                    location.latitude,
                    location.longitude
                );

                return {
                    location,
                    ...data
                };
            })
        );

        if (generation !== cityGeneration) {
            return;
        }

        const successfulReadings = results
            .filter(result => result.status === "fulfilled")
            .map(result => result.value);

        if (!successfulReadings.length) {
            throw new Error("No traffic measurements were returned.");
        }

        trafficReadings = successfulReadings;

        successfulReadings.forEach((reading, index) => {

            updateLiveTrafficCard(reading, index);
        });

        updateTrafficAnalytics(successfulReadings);

        recordTrafficTrend(successfulReadings);

        // The fixed C Dijkstra network is a Hyderabad prototype only.

        await refreshLiveRoute();

        if (generation !== cityGeneration) {
            return;
        }

        const failedCount =
            results.length - successfulReadings.length;

        if (status) {

            status.textContent = failedCount
                ? `${successfulReadings.length} of ${results.length} road measurements updated. Some locations are unavailable.`
                : `Live traffic data connected successfully for ${city.name}.`;
        }

        if (updated) {

            updated.textContent =
                `Last updated: ${new Date().toLocaleTimeString("en-IN")}`;
        }

    } catch (error) {

        console.error("Live traffic error:", error);

        if (generation === cityGeneration) {

            if (status) {
                status.textContent =
                    `Unable to retrieve all traffic measurements for ${city.name}. Check the backend and try again.`;
            }
        }

    } finally {

        activeTrafficRefreshes.delete(city.key);
    }
}

// =============================================
// C DIJKSTRA ROUTE — HYDERABAD PROTOTYPE
// =============================================

async function refreshLiveRoute() {

    const pathElement = getElement("liveRoutePath");
    const timeElement = getElement("liveRouteTime");
    const statusElement = getElement("liveRouteStatus");

    if (selectedCity.key !== "hyderabad") {

        if (pathElement) {
            pathElement.textContent = "Not available";
        }

        if (timeElement) {
            timeElement.textContent = "-- min";
        }

        if (statusElement) {
            statusElement.textContent =
                "The C Dijkstra demonstration network currently contains Hyderabad prototype roads only.";
        }

        return;
    }

    try {

        if (statusElement) {
            statusElement.textContent =
                "Calculating route using the C Dijkstra algorithm...";
        }

        const response = await fetch(`${API}/live-route`, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("Live route request failed.");
        }

        const route = await response.json();

        if (route.found) {

            if (pathElement) {
                pathElement.textContent =
                    route.path.join(" → ");
            }

            if (timeElement) {
                timeElement.textContent =
                    `${route.travelTimeMinutes} min`;
            }

            if (statusElement) {
                statusElement.textContent =
                    "Route calculated using the Hyderabad C Dijkstra prototype network.";
            }

        } else {

            if (pathElement) {
                pathElement.textContent = "No route available";
            }

            if (timeElement) {
                timeElement.textContent = "-- min";
            }

            if (statusElement) {
                statusElement.textContent =
                    "No valid route found.";
            }
        }

    } catch (error) {

        console.error("Dijkstra route error:", error);

        if (statusElement) {
            statusElement.textContent =
                "Unable to calculate the Hyderabad prototype route.";
        }
    }
}

// =============================================
// DIGITAL CLOCK
// =============================================

function updateLiveClock() {

    const now = new Date();

    const timeElement = getElement("liveTime");
    const dateElement = getElement("liveDate");

    if (!timeElement || !dateElement) {
        return;
    }

    timeElement.textContent =
        now.toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true
        });

    dateElement.textContent =
        now.toLocaleDateString("en-IN", {
            weekday: "short",
            day: "2-digit",
            month: "short",
            year: "numeric"
        });
}

updateLiveClock();

setInterval(updateLiveClock, 1000);

// =============================================
// BACKEND CONNECTION MONITOR
// =============================================

async function checkBackendConnection() {

    const statusText = getElement("backendStatusText");
    const statusDot = getElement("backendStatusDot");

    if (!statusText || !statusDot) {
        return;
    }

    try {

        const response = await fetch(`${API}/state`, {
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("Backend unavailable.");
        }

        statusText.textContent = "BACKEND CONNECTED";

        statusDot.classList.remove("offline");
        statusDot.classList.add("online");

    } catch (error) {

        statusText.textContent = "BACKEND DISCONNECTED";

        statusDot.classList.remove("online");
        statusDot.classList.add("offline");
    }
}

checkBackendConnection();

setInterval(checkBackendConnection, 5000);

// =============================================
// PAGE NAVIGATION
// =============================================

const navigationButtons =
    document.querySelectorAll(".nav-item");

const pageViews =
    document.querySelectorAll(".page-view");

function updatePageDetails() {

    const activeButton =
        document.querySelector(".nav-item.active");

    const view = activeButton?.dataset.view || "dashboard";

    const city = selectedCity.name;

    const pageDetails = {

        dashboard: {
            title: `${city} Traffic Control Dashboard`,
            breadcrumb: `Dashboard / Live ${city} Traffic`
        },

        "city-map": {
            title: `${city} City Route Planner`,
            breadcrumb: `Dashboard / ${city} Route Planner`
        },

        buses: {
            title: `${city} Bus Services`,
            breadcrumb: `Dashboard / ${city} Public Transport`
        }
    };

    const details = pageDetails[view];

    if (details) {

        setText("currentPageTitle", details.title);
        setText("pageBreadcrumb", details.breadcrumb);
    }
}

navigationButtons.forEach(button => {

    button.addEventListener("click", () => {

        const selectedView = button.dataset.view;

        navigationButtons.forEach(item => {
            item.classList.remove("active");
        });

        button.classList.add("active");

        pageViews.forEach(view => {
            view.classList.remove("active-view");
        });

        const targetView =
            getElement(`view-${selectedView}`);

        if (targetView) {
            targetView.classList.add("active-view");
        }

        updatePageDetails();

        if (
            selectedView === "city-map" &&
            window.hyderabadMap
        ) {

            setTimeout(() => {
                window.hyderabadMap.invalidateSize(true);
            }, 300);
        }

        if (selectedView === "dashboard") {
            refreshDashboardMapSize();
        }

        if (selectedView === "buses") {
            notifyBusCityChange();
        }

        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    });
});

// =============================================
// COLLAPSIBLE SIDEBAR
// =============================================

const menuToggle = getElement("menuToggle");

const appLayout =
    document.querySelector(".app-layout");

if (menuToggle && appLayout) {

    appLayout.classList.add("sidebar-collapsed");

    menuToggle.addEventListener("click", () => {

        const isCollapsed =
            appLayout.classList.toggle("sidebar-collapsed");

        menuToggle.setAttribute(
            "aria-expanded",
            String(!isCollapsed)
        );

        refreshDashboardMapSize();
    });
}

// =============================================
// CITY ROUTE PLANNER
// =============================================

let sourcePlace = null;
let destinationPlace = null;

let cityPlannerMap = null;

let cityRouteLayers = [];
let cityRouteMarkers = [];

function initializeCityPlannerMap() {

    const mapElement = getElement("hyderabadMap");

    if (!mapElement || typeof L === "undefined") {
        console.error("Route planner map is unavailable.");
        return;
    }

    if (cityPlannerMap) {
        return;
    }

    cityPlannerMap = L.map(
        "hyderabadMap",
        {
            dragging: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            boxZoom: false,
            keyboard: true,
            touchZoom: true,
            zoomControl: true
        }
    ).setView(
        [
            selectedCity.latitude,
            selectedCity.longitude
        ],
        12
    );

    window.hyderabadMap = cityPlannerMap;

    L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        {
            maxZoom: 19,
            attribution: "&copy; OpenStreetMap contributors"
        }
    ).addTo(cityPlannerMap);

    window.addEventListener("resize", () => {

        setTimeout(() => {
            cityPlannerMap.invalidateSize(true);
        }, 200);
    });

    setTimeout(() => {
        cityPlannerMap.invalidateSize(true);
    }, 500);
}

function createCitySuggestionBox(input) {

    const box = document.createElement("div");

    box.className = "city-suggestions";
    box.style.display = "none";

    input.insertAdjacentElement("afterend", box);

    return box;
}

function getPlaceName(feature) {

    const properties = feature.properties || {};

    return [
        properties.name,
        properties.district,
        properties.city,
        properties.state
    ]
        .filter(Boolean)
        .filter((value, index, array) =>
            array.indexOf(value) === index
        )
        .join(", ");
}

async function searchPlaces(query) {

    const url =
        "https://photon.komoot.io/api/?" +
        new URLSearchParams({
            q: query,
            lat: String(selectedCity.latitude),
            lon: String(selectedCity.longitude),
            limit: "6",
            lang: "en"
        });

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("Location search failed.");
    }

    const data = await response.json();

    return data.features || [];
}

function clearCityPlanner() {

    sourcePlace = null;
    destinationPlace = null;

    const sourceInput = getElement("citySource");
    const destinationInput = getElement("cityDestination");

    if (sourceInput) {
        sourceInput.value = "";
    }

    if (destinationInput) {
        destinationInput.value = "";
    }

    clearCityRouteLayers();

    const options = getElement("cityRouteOptions");

    if (options) {
        options.remove();
    }

    setText("cityDistance", "--");
    setText("cityDuration", "--");
    setText("cityRouteType", "--");

    setText(
        "cityRouteStatus",
        `Enter your starting point and destination in ${selectedCity.name}.`
    );

    if (cityPlannerMap) {

        cityPlannerMap.setView(
            [
                selectedCity.latitude,
                selectedCity.longitude
            ],
            12
        );
    }
}

function clearCityRouteLayers() {

    cityRouteLayers.forEach(layer => {

        if (cityPlannerMap) {
            cityPlannerMap.removeLayer(layer);
        }
    });

    cityRouteMarkers.forEach(marker => {

        if (cityPlannerMap) {
            cityPlannerMap.removeLayer(marker);
        }
    });

    cityRouteLayers = [];
    cityRouteMarkers = [];
}

function setCityPlannerSource(place) {

    sourcePlace = place;

    const sourceInput = getElement("citySource");

    if (sourceInput) {
        sourceInput.value = place.name;
    }

    destinationPlace = null;

    const destinationInput = getElement("cityDestination");

    if (destinationInput) {
        destinationInput.value = "";
    }
}

window.setCityPlannerSource = setCityPlannerSource;

// =============================================
// ROUTE AUTOCOMPLETE
// =============================================

function setupRouteAutocomplete(input, box, type) {

    let timer = null;
    let searchVersion = 0;

    input.addEventListener("input", () => {

        clearTimeout(timer);

        searchVersion++;

        const currentVersion = searchVersion;

        if (type === "source") {
            sourcePlace = null;
        } else {
            destinationPlace = null;
        }

        const query = input.value.trim();

        box.innerHTML = "";
        box.style.display = "none";

        if (query.length < 3) {
            return;
        }

        timer = setTimeout(async () => {

            try {

                const results = await searchPlaces(query);

                if (currentVersion !== searchVersion) {
                    return;
                }

                box.innerHTML = "";

                const validResults = results.filter(feature => {

                    const coordinates =
                        feature.geometry?.coordinates;

                    return (
                        coordinates &&
                        coordinates.length >= 2
                    );
                });

                validResults.forEach(feature => {

                    const coordinates =
                        feature.geometry.coordinates;

                    const item = document.createElement("button");

                    item.type = "button";
                    item.className = "city-suggestion-item";

                    item.textContent =
                        getPlaceName(feature) || "Unnamed location";

                    item.addEventListener("click", () => {

                        const place = {
                            name: item.textContent,
                            lat: Number(coordinates[1]),
                            lon: Number(coordinates[0])
                        };

                        if (!isValidCoordinate(place.lat, place.lon)) {
                            return;
                        }

                        input.value = place.name;

                        if (type === "source") {
                            sourcePlace = place;
                        } else {
                            destinationPlace = place;
                        }

                        box.style.display = "none";
                    });

                    box.appendChild(item);
                });

                if (validResults.length) {

                    box.style.display = "block";

                } else {

                    const empty = document.createElement("div");

                    empty.className = "city-suggestion-empty";
                    empty.textContent = "No matching locations found.";

                    box.appendChild(empty);
                    box.style.display = "block";
                }

            } catch (error) {

                console.error("Route location search error:", error);

                setText(
                    "cityRouteStatus",
                    "Location search is temporarily unavailable."
                );
            }

        }, 450);
    });

    input.addEventListener("keydown", event => {

        if (event.key === "Escape") {
            box.style.display = "none";
        }
    });
}

function initializeRouteAutocomplete() {

    const sourceInput = getElement("citySource");
    const destinationInput = getElement("cityDestination");

    if (!sourceInput || !destinationInput) {
        return;
    }

    const sourceSuggestions =
        createCitySuggestionBox(sourceInput);

    const destinationSuggestions =
        createCitySuggestionBox(destinationInput);

    setupRouteAutocomplete(
        sourceInput,
        sourceSuggestions,
        "source"
    );

    setupRouteAutocomplete(
        destinationInput,
        destinationSuggestions,
        "destination"
    );

    document.addEventListener("click", event => {

        if (
            !sourceSuggestions.contains(event.target) &&
            event.target !== sourceInput
        ) {
            sourceSuggestions.style.display = "none";
        }

        if (
            !destinationSuggestions.contains(event.target) &&
            event.target !== destinationInput
        ) {
            destinationSuggestions.style.display = "none";
        }
    });
}

// =============================================
// ROUTE FORMATTING
// =============================================

function formatDistance(meters) {

    return (meters / 1000).toFixed(2) + " km";
}

function formatDuration(seconds) {

    const minutes = Math.round(seconds / 60);

    if (minutes < 60) {
        return minutes + " min";
    }

    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;

    return hours + " hr " + remaining + " min";
}

// =============================================
// DISPLAY SELECTED ROUTE
// =============================================

function displayCityRoute(route, routeType) {

    if (!cityPlannerMap || !sourcePlace || !destinationPlace) {
        return;
    }

    clearCityRouteLayers();

    const coordinates =
        route.geometry.coordinates.map(point => [
            point[1],
            point[0]
        ]);

    const layer = L.polyline(coordinates, {
        color: "#2563eb",
        weight: 6,
        opacity: 0.9
    }).addTo(cityPlannerMap);

    cityRouteLayers.push(layer);

    const startMarker = L.marker([
        sourcePlace.lat,
        sourcePlace.lon
    ])
        .addTo(cityPlannerMap)
        .bindPopup("Starting point: " + escapeHTML(sourcePlace.name));

    const endMarker = L.marker([
        destinationPlace.lat,
        destinationPlace.lon
    ])
        .addTo(cityPlannerMap)
        .bindPopup("Destination: " + escapeHTML(destinationPlace.name));

    cityRouteMarkers.push(startMarker, endMarker);

    cityPlannerMap.fitBounds(layer.getBounds(), {
        padding: [40, 40]
    });

    setText(
        "cityDistance",
        formatDistance(route.distance)
    );

    setText(
        "cityDuration",
        formatDuration(route.duration)
    );

    setText(
        "cityRouteType",
        routeType
    );

    setText(
        "cityRouteStatus",
        `${sourcePlace.name} → ${destinationPlace.name}`
    );
}

// =============================================
// ROUTE OPTIONS
// =============================================

function showRouteOptions(routes) {

    const summary = getElement("cityRouteSummary");

    if (!summary) {
        return;
    }

    let optionsContainer =
        getElement("cityRouteOptions");

    if (!optionsContainer) {

        optionsContainer = document.createElement("div");

        optionsContainer.id = "cityRouteOptions";
        optionsContainer.className = "city-route-options";

        summary.appendChild(optionsContainer);
    }

    optionsContainer.innerHTML = "<h3>Available Routes</h3>";

    const options = [

        {
            label: "Shortest Route",
            route: routes.reduce((a, b) =>
                a.distance < b.distance ? a : b
            )
        },

        {
            label: "Fastest Route",
            route: routes.reduce((a, b) =>
                a.duration < b.duration ? a : b
            )
        },

        {
            label: "Longest Alternative",
            route: routes.reduce((a, b) =>
                a.distance > b.distance ? a : b
            )
        }
    ];

    const uniqueOptions = [];

    options.forEach(option => {

        if (!uniqueOptions.some(existing =>
            existing.route === option.route
        )) {
            uniqueOptions.push(option);
        }
    });

    uniqueOptions.forEach(option => {

        const button = document.createElement("button");

        button.type = "button";
        button.className = "city-route-option";

        button.textContent =
            `${option.label} — ` +
            `${formatDistance(option.route.distance)} · ` +
            `${formatDuration(option.route.duration)}`;

        button.addEventListener("click", () => {

            displayCityRoute(
                option.route,
                option.label
            );
        });

        optionsContainer.appendChild(button);
    });

    const note = document.createElement("p");

    note.className = "demo-note";

    note.textContent = routes.length < 2
        ? "Only one route was returned by the routing service."
        : "The longest option is the longest among the returned alternatives.";

    optionsContainer.appendChild(note);
}

// =============================================
// CALCULATE CITY ROUTE
// =============================================

async function calculateCityRoute() {

    const findButton = getElement("findCityRoute");

    const status = getElement("cityRouteStatus");

    if (!sourcePlace || !destinationPlace) {

        if (status) {
            status.textContent =
                "Select both locations from the search suggestions.";
        }

        return;
    }

    if (
        sourcePlace.lat === destinationPlace.lat &&
        sourcePlace.lon === destinationPlace.lon
    ) {

        status.textContent =
            "Starting point and destination must be different.";

        return;
    }

    const generation = cityGeneration;

    if (findButton) {

        findButton.disabled = true;
        findButton.textContent = "Finding routes...";
    }

    setText(
        "cityRouteStatus",
        `Calculating available routes in ${selectedCity.name}...`
    );

    try {

        const url =
            "https://router.project-osrm.org/route/v1/driving/" +
            sourcePlace.lon + "," + sourcePlace.lat + ";" +
            destinationPlace.lon + "," + destinationPlace.lat +
            "?overview=full&geometries=geojson&alternatives=true&steps=true";

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error("Routing service request failed.");
        }

        const data = await response.json();

        if (generation !== cityGeneration) {
            return;
        }

        if (
            data.code !== "Ok" ||
            !data.routes ||
            data.routes.length === 0
        ) {
            throw new Error("No driving route was found.");
        }

        showRouteOptions(data.routes);

        const fastest = data.routes.reduce((a, b) =>
            a.duration < b.duration ? a : b
        );

        displayCityRoute(fastest, "Fastest Route");

    } catch (error) {

        console.error("City route calculation error:", error);

        if (generation === cityGeneration) {

            setText(
                "cityRouteStatus",
                "Unable to calculate this route. Please try again."
            );
        }

    } finally {

        if (findButton) {

            findButton.disabled = false;
            findButton.textContent = "Find Route →";
        }
    }
}

function initializeCityRoutePlanner() {

    const findButton = getElement("findCityRoute");
    const clearButton = getElement("clearCityRoute");

    if (findButton) {
        findButton.addEventListener(
            "click",
            calculateCityRoute
        );
    }

    if (clearButton) {
        clearButton.addEventListener(
            "click",
            clearCityPlanner
        );
    }

    initializeCityPlannerMap();
    initializeRouteAutocomplete();
}

// =============================================
// DASHBOARD GLOBAL SEARCH
// =============================================

const dashboardSearchInput =
    getElement("dashboardSearchInput");

const dashboardSearchButton =
    getElement("dashboardSearchButton");

const dashboardSearchResults =
    getElement("dashboardSearchResults");

// =============================================
// SEARCH PLACES IN SELECTED CITY
// =============================================

async function searchDashboardPlaces(query) {

    const features = await searchPlaces(query);

    return features.map(feature => {

        const coordinates =
            feature.geometry?.coordinates;

        if (!coordinates || coordinates.length < 2) {
            return null;
        }

        const latitude = Number(coordinates[1]);
        const longitude = Number(coordinates[0]);

        if (!isValidCoordinate(latitude, longitude)) {
            return null;
        }

        return {
            name: getPlaceName(feature) || "Unnamed location",
            latitude,
            longitude
        };

    }).filter(Boolean);
}

// =============================================
// TREND PLACE SEARCH — CITY SCOPED
// =============================================

async function searchTrendLocations() {

    const input = getElement("trendPlaceSearchInput");
    const status = getElement("trendPlaceSearchStatus");
    const results = getElement("trendPlaceSearchResults");

    const query = input?.value.trim();

    if (!query) {

        setText(
            "trendPlaceSearchStatus",
            "Please enter a location name."
        );

        return;
    }

    if (results) {
        results.innerHTML = "";
    }

    setText(
        "trendPlaceSearchStatus",
        `Searching for places in ${selectedCity.name}...`
    );

    try {

        const places = await searchDashboardPlaces(query);

        if (!places.length) {

            setText(
                "trendPlaceSearchStatus",
                "No matching places found."
            );

            return;
        }

        // This application tracks the selected city's road samples.
        // Searching for a place does not add another city or trend line.

        places.forEach(place => {

            const button = document.createElement("button");

            button.type = "button";
            button.className = "trend-place-result";

            button.textContent = `📍 ${place.name}`;

            button.addEventListener("click", () => {

                openLocationInCityPlanner(place);
            });

            if (results) {
                results.appendChild(button);
            }
        });

        setText(
            "trendPlaceSearchStatus",
            `${places.length} places found in ${selectedCity.name}. Select one to use in the Route Planner.`
        );

    } catch (error) {

        console.error("Place search error:", error);

        setText(
            "trendPlaceSearchStatus",
            "Unable to search locations. Please try again."
        );
    }
}

const trendSearchButton =
    getElement("trendPlaceSearchButton");

const trendSearchInput =
    getElement("trendPlaceSearchInput");

if (trendSearchButton) {

    trendSearchButton.addEventListener(
        "click",
        searchTrendLocations
    );
}

if (trendSearchInput) {

    trendSearchInput.addEventListener("keydown", event => {

        if (event.key === "Enter") {
            searchTrendLocations();
        }
    });
}

// =============================================
// DASHBOARD SEARCH RESULTS
// =============================================

function addDashboardSearchResult(title, description, onClick) {

    if (!dashboardSearchResults) {
        return;
    }

    const result = document.createElement("button");

    result.type = "button";
    result.className = "dashboard-search-result";

    const heading = document.createElement("strong");
    heading.textContent = title;

    const detail = document.createElement("span");
    detail.textContent = description;

    result.appendChild(heading);
    result.appendChild(detail);

    result.addEventListener("click", onClick);

    dashboardSearchResults.appendChild(result);
}

// =============================================
// OPEN TRAFFIC LOCATION ON MAP
// =============================================

function openDashboardTrafficLocation(index) {

    const location = dashboardTrafficLocations[index];

    if (!location || !dashboardTrafficMap) {

        setText(
            "dashboardSearchStatus",
            "Traffic map is unavailable."
        );

        return;
    }

    dashboardTrafficMap.setView(
        [
            location.latitude,
            location.longitude
        ],
        16
    );

    const marker = dashboardTrafficMarkers[index];

    if (marker) {
        marker.openPopup();
    }

    setText(
        "dashboardSearchStatus",
        `Showing ${location.name} in ${selectedCity.name}.`
    );
}

// =============================================
// OPEN LOCATION IN ROUTE PLANNER
// =============================================

function openLocationInCityPlanner(place) {

    const cityMapButton =
        document.querySelector('[data-view="city-map"]');

    if (cityMapButton) {
        cityMapButton.click();
    }

    if (typeof window.setCityPlannerSource === "function") {

        window.setCityPlannerSource({
            name: place.name,
            lat: place.latitude,
            lon: place.longitude
        });

        setText(
            "cityRouteStatus",
            "Starting point selected. Now enter your destination."
        );

        setText(
            "dashboardSearchStatus",
            "Location sent to the Route Planner."
        );

    } else {

        setText(
            "dashboardSearchStatus",
            "Route Planner is not ready."
        );
    }
}

// =============================================
// SEARCHED LOCATION TRAFFIC CARD
// =============================================

async function addDashboardTrafficCard(place) {

    if (!dashboardSearchResults) {
        return;
    }

    const generation = cityGeneration;

    const card = document.createElement("div");

    card.className = "dashboard-traffic-search-card";

    const heading = document.createElement("h3");
    heading.textContent = place.name + " Traffic Information";

    const loading = document.createElement("p");
    loading.textContent = "Fetching live traffic information...";

    card.appendChild(heading);
    card.appendChild(loading);

    dashboardSearchResults.appendChild(card);

    try {

        const data = await fetchLiveTrafficPoint(
            place.latitude,
            place.longitude
        );

        if (generation !== cityGeneration) {
            card.remove();
            return;
        }

        const speed = Number(data.currentSpeed);
        const travelTime = Number(data.currentTravelTime);
        const freeFlow = Number(data.freeFlowSpeed);
        const confidence = Number(data.confidence);

        const metrics = [
            ["Current Speed", `${speed} km/h`],
            ["Travel Time", `${Math.ceil(travelTime / 60)} min`],
            ["Free-flow Speed", `${freeFlow} km/h`],
            ["Confidence", `${Math.round(confidence * 100)}%`]
        ];

        loading.remove();

        const grid = document.createElement("div");
        grid.className = "dashboard-traffic-search-grid";

        metrics.forEach(([label, value]) => {

            const item = document.createElement("div");

            item.className = "dashboard-traffic-search-metric";

            const name = document.createElement("span");
            name.textContent = label;

            const result = document.createElement("strong");
            result.textContent = value;

            item.appendChild(name);
            item.appendChild(result);

            grid.appendChild(item);
        });

        card.appendChild(grid);

        const condition = getTrafficCondition(speed, freeFlow);

        const status = document.createElement("p");

        status.className = "dashboard-traffic-search-status";
        status.textContent = condition.label;
        status.style.color = condition.color;

        card.appendChild(status);

    } catch (error) {

        loading.textContent =
            "Live traffic data is unavailable for this location.";

        console.error("Searched traffic error:", error);
    }

    const plannerButton = document.createElement("button");

    plannerButton.type = "button";
    plannerButton.className = "dashboard-search-result";
    plannerButton.textContent = "Open in City Route Planner";

    plannerButton.addEventListener("click", () => {
        openLocationInCityPlanner(place);
    });

    card.appendChild(plannerButton);
}

// =============================================
// PERFORM DASHBOARD SEARCH
// =============================================

async function performDashboardSearch() {

    if (!dashboardSearchInput || !dashboardSearchResults) {
        return;
    }

    const generation = cityGeneration;

    const query = dashboardSearchInput.value.trim();

    dashboardSearchResults.innerHTML = "";

    if (!query) {

        setText(
            "dashboardSearchStatus",
            "Enter a traffic location, bus route, bus stop or place."
        );

        return;
    }

    setText(
        "dashboardSearchStatus",
        `Searching ${selectedCity.name} traffic locations, bus services and places...`
    );

    let totalResults = 0;

    // 1. Search actual discovered road locations.

    dashboardTrafficLocations.forEach((location, index) => {

        if (
            location.name.toLowerCase().includes(query.toLowerCase())
        ) {

            addDashboardSearchResult(
                "🚦 " + location.name,
                "Road traffic measurement location",
                () => openDashboardTrafficLocation(index)
            );

            totalResults++;
        }
    });

    // 2. Search supported bus feed.

    try {

        if (typeof window.searchBusRoutesFromDashboard === "function") {

            const busData =
                await window.searchBusRoutesFromDashboard(query);

            if (generation !== cityGeneration) {
                return;
            }

            if (busData.success) {

                busData.matches.slice(0, 8).forEach(bus => {

                    addDashboardSearchResult(
                        "🚌 Bus " + bus.number,
                        bus.name + " · " + bus.trips + " scheduled trips",
                        () => {

                            if (
                                typeof window.showDashboardBusResults === "function"
                            ) {
                                window.showDashboardBusResults(query);
                            }
                        }
                    );

                    totalResults++;
                });
            }
        }

    } catch (error) {

        console.error("Dashboard bus search error:", error);
    }

    if (generation !== cityGeneration) {
        return;
    }

    // 3. Search places within the selected city's area.

    try {

        const places = await searchDashboardPlaces(query);

        if (generation !== cityGeneration) {
            return;
        }

        places.forEach(place => {

            addDashboardSearchResult(
                "📍 " + place.name,
                `Open in ${selectedCity.name} Route Planner`,
                () => openLocationInCityPlanner(place)
            );

            totalResults++;
        });

    } catch (error) {

        console.error("Dashboard place search error:", error);
    }

    if (generation !== cityGeneration) {
        return;
    }

    if (totalResults === 0) {

        const message = document.createElement("p");

        message.textContent =
            `No matching traffic locations, bus routes or places found in ${selectedCity.name}.`;

        dashboardSearchResults.appendChild(message);

        setText(
            "dashboardSearchStatus",
            "No results found. Try another search."
        );

    } else {

        setText(
            "dashboardSearchStatus",
            `${totalResults} matching results found in ${selectedCity.name}.`
        );
    }
}

if (dashboardSearchButton) {

    dashboardSearchButton.addEventListener(
        "click",
        performDashboardSearch
    );
}

if (dashboardSearchInput) {

    dashboardSearchInput.addEventListener("keydown", event => {

        if (event.key === "Enter") {
            performDashboardSearch();
        }
    });
}

// =============================================
// INITIALIZE APPLICATION
// =============================================

function initializeTrafficFlow() {

    initializeDashboardTrafficMap();

    initializeCityRoutePlanner();

    updatePageDetails();

    // Display only the currently selected city's history.

    renderTrafficTrendChart(
        getTrafficTrendHistory()
    );

    // Tell the bus module which city is active.

    notifyBusCityChange();

    // Fetch traffic immediately.

    refreshLiveTraffic();

    // Refresh selected-city traffic every 60 seconds.

    setInterval(() => {
        refreshLiveTraffic();
    }, 60000);

    console.log(
        "TrafficFlow initialized for:",
        selectedCity.name
    );
}

initializeTrafficFlow();

// =============================================
// PUBLIC FUNCTIONS
// =============================================

window.selectTrafficFlowCity = selectCity;

window.refreshLiveTraffic = refreshLiveTraffic;

window.getSelectedTrafficCity = function() {
    return selectedCity;
};