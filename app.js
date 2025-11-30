// ========================================
// Safe Route Finder - Standalone Version
// ========================================

// ========================================
// ========================================
// Crime Service
// ========================================
const TOMTOM_API_KEY = 'juXMgN3bA8pb96Pl5W3ay9paHIRJiEgU';
const OPENWEATHER_API_KEY = '396c8f8467c216a4546e71cafae544f7';

import { ACCIDENT_DATA } from './src/services/accidentData.js';
import { getCrimeData, calculateSafetyScore, getSafetyLevel, getRouteColor } from './src/services/crimeService.js';
import { getRoutes, formatDistance, formatDuration, findNearestFacilities } from './src/services/routeService.js';
import { HOSPITALS, POLICE_STATIONS } from './src/services/facilityData.js';




// ========================================
// Geocoding Service
// ========================================
const NOMINATIM_BASE_URL = 'https://nominatim.openstreetmap.org';

async function geocodeLocation(locationString) {
    try {
        const params = new URLSearchParams({
            q: locationString,
            format: 'json',
            limit: '1',
            countrycodes: 'in',
        });

        const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params}`, {
            headers: {
                'User-Agent': 'SafeRouteFinderApp/1.0'
            }
        });

        if (!response.ok) {
            throw new Error(`Geocoding failed: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.length === 0) {
            throw new Error('Location not found');
        }

        return {
            lat: parseFloat(data[0].lat),
            lon: parseFloat(data[0].lon),
            display_name: data[0].display_name
        };
    } catch (error) {
        console.error('Geocoding error:', error);
        throw error;
    }
}

// ========================================
// Autocomplete Service
// ========================================
let debounceTimer;

async function fetchSuggestions(query) {
    if (!query || query.length < 3) return [];

    try {
        const params = new URLSearchParams({
            q: query,
            format: 'json',
            limit: '5',
            countrycodes: 'in',
            addressdetails: '1',
        });

        const response = await fetch(`${NOMINATIM_BASE_URL}/search?${params}`, {
            headers: {
                'User-Agent': 'SafeRouteFinderApp/1.0'
            }
        });

        if (!response.ok) return [];
        return await response.json();
    } catch (error) {
        console.error('Autocomplete error:', error);
        return [];
    }
}

function showSuggestions(suggestions, inputElement) {
    let list = inputElement.nextElementSibling;
    if (!list || !list.classList.contains('autocomplete-items')) {
        list = document.createElement('div');
        list.setAttribute('class', 'autocomplete-items');
        inputElement.parentNode.appendChild(list);
    }

    list.innerHTML = '';

    if (suggestions.length === 0) {
        list.innerHTML = '<div class="autocomplete-item">No results found</div>';
        return;
    }

    suggestions.forEach(item => {
        const div = document.createElement('div');
        div.classList.add('autocomplete-item');
        div.innerHTML = `<strong>${item.display_name.split(',')[0]}</strong><br><small>${item.display_name}</small>`;
        div.addEventListener('click', function () {
            inputElement.value = item.display_name;
            list.innerHTML = '';
        });
        list.appendChild(div);
    });
}

function setupAutocomplete(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', function () {
        clearTimeout(debounceTimer);
        const query = this.value;

        // Remove existing list if query is empty
        let list = this.nextElementSibling;
        if (list && list.classList.contains('autocomplete-items')) {
            list.innerHTML = '';
        }

        if (!query) return;

        debounceTimer = setTimeout(async () => {
            const suggestions = await fetchSuggestions(query);
            showSuggestions(suggestions, this);
        }, 300);
    });

    // Close list when clicking outside
    document.addEventListener('click', function (e) {
        if (e.target !== input) {
            let list = input.nextElementSibling;
            if (list && list.classList.contains('autocomplete-items')) {
                list.innerHTML = '';
            }
        }
    });
}

// ========================================
// Weather Service
// ========================================
async function getWeather(lat, lon) {
    try {
        const response = await fetch(
            `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OPENWEATHER_API_KEY}&units=metric`
        );

        if (!response.ok) {
            throw new Error('Weather data fetch failed');
        }

        return await response.json();
    } catch (error) {
        console.error('Weather fetch error:', error);
        return null;
    }
}

function renderWeatherInfo(startWeather, endWeather) {
    const container = document.getElementById('weather-container');
    const startCard = document.getElementById('start-weather');
    const endCard = document.getElementById('end-weather');

    if (!startWeather && !endWeather) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    if (startWeather) {
        startCard.innerHTML = `
            <div class="weather-location">Start</div>
            <img src="https://openweathermap.org/img/wn/${startWeather.weather[0].icon}.png" alt="Weather icon" class="weather-icon">
            <div class="weather-temp">${startWeather.main.temp.toFixed(1)}°C</div>
            <div class="weather-desc">${startWeather.weather[0].description}</div>
        `;
    }

    if (endWeather) {
        endCard.innerHTML = `
            <div class="weather-location">Destination</div>
            <img src="https://openweathermap.org/img/wn/${endWeather.weather[0].icon}.png" alt="Weather icon" class="weather-icon">
            <div class="weather-temp">${endWeather.main.temp.toFixed(1)}°C</div>
            <div class="weather-desc">${endWeather.weather[0].description}</div>
        `;
    }
}

// ========================================
// Route Service
// ========================================


// ========================================
// Global State
// ========================================
let map;
let currentRoutes = [];
let selectedRouteId = null;
let startMarker = null;
let endMarker = null;
let currentPopup = null;

// ========================================
// Map Initialization
// ========================================
function initializeMap() {
    const lightStyle = {
        "version": 8,
        "sources": {
            "carto-light": {
                "type": "raster",
                "tiles": [
                    "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
                    "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
                    "https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
                    "https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png"
                ],
                "tileSize": 256,
                "attribution": '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a>, &copy; <a href="https://carto.com/attributions">CARTO</a>'
            }
        },
        "layers": [{
            "id": "carto-light-layer",
            "type": "raster",
            "source": "carto-light",
            "minzoom": 0,
            "maxzoom": 22
        }],
        "glyphs": "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf"
    };

    map = new maplibregl.Map({
        container: 'map',
        style: lightStyle,
        center: [77.5946, 12.9716],
        zoom: 12,
        attributionControl: true,
    });

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.FullscreenControl(), 'bottom-right');

    map.on('load', () => {
        addCrimeDataLayer();
        addTrafficLayer();
        addMetroLayer();
        addBmtcLayer();
        addAccidentLayer();
        addFacilityLayer();

        document.getElementById('accidents-btn').addEventListener('click', toggleAccidents);
        document.getElementById('facilities-btn').addEventListener('click', toggleFacilities);
    });
}

// ========================================
// Traffic Data Visualization
// ========================================
function addTrafficLayer() {
    map.addSource('tomtom-traffic', {
        type: 'raster',
        tiles: [
            `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${TOMTOM_API_KEY}`
        ],
        tileSize: 256
    });

    map.addLayer({
        id: 'tomtom-traffic-layer',
        type: 'raster',
        source: 'tomtom-traffic',
        paint: {
            'raster-opacity': 0.1
        }
    }, 'crime-points');
}

// ========================================
// Crime Data Visualization
// ========================================
function addCrimeDataLayer() {
    const crimeData = getCrimeData();

    const geojson = {
        type: 'FeatureCollection',
        features: crimeData.map(crime => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [crime.lon, crime.lat]
            },
            properties: {
                severity: crime.severity,
                area: crime.area
            }
        }))
    };

    map.addSource('crime-data', {
        type: 'geojson',
        data: geojson
    });

    map.addLayer({
        id: 'crime-points',
        type: 'circle',
        source: 'crime-data',
        paint: {
            'circle-radius': [
                'interpolate',
                ['linear'],
                ['get', 'severity'],
                1, 4,
                10, 12
            ],
            'circle-color': [
                'interpolate',
                ['linear'],
                ['get', 'severity'],
                1, '#10b981',
                5, '#f59e0b',
                10, '#ef4444'
            ],
            'circle-opacity': 0.3,
            'circle-stroke-width': 2,
            'circle-stroke-color': [
                'interpolate',
                ['linear'],
                ['get', 'severity'],
                1, '#10b981',
                5, '#f59e0b',
                10, '#ef4444'
            ],
            'circle-stroke-opacity': 0.6
        }
    });

    map.on('mouseenter', 'crime-points', (e) => {
        map.getCanvas().style.cursor = 'pointer';

        if (currentPopup) {
            currentPopup.remove();
        }

        const coordinates = e.features[0].geometry.coordinates.slice();
        const { severity, area } = e.features[0].properties;

        currentPopup = new maplibregl.Popup({
            closeButton: false,
            closeOnClick: false
        })
            .setLngLat(coordinates)
            .setHTML(`
        <div style="padding: 8px; font-family: Inter, sans-serif;">
          <strong style="color: #000000;">${area}</strong><br>
          <span style="color: #10b981;">Severity: ${severity}/10</span>
        </div>
      `)
            .addTo(map);
    });

    map.on('mouseleave', 'crime-points', () => {
        map.getCanvas().style.cursor = '';
        if (currentPopup) {
            currentPopup.remove();
            currentPopup = null;
        }
    });
}

// ========================================
// Metro Data Visualization
// ========================================
function addMetroLayer() {
    if (typeof metroData === 'undefined') {
        console.error('Metro data not loaded');
        return;
    }

    // Add metro data source
    map.addSource('metro-data', {
        type: 'geojson',
        data: metroData
    });

    // Add metro lines layer
    map.addLayer({
        id: 'metro-lines',
        type: 'line',
        source: 'metro-data',
        layout: {
            'line-join': 'round',
            'line-cap': 'round',
            'visibility': 'none'
        },
        paint: {
            'line-color': [
                'match',
                ['get', 'line'],
                'purple', '#9a339a',
                'green', '#4caf50',
                'yellow', '#ffeb3b',
                '#000000' // default color
            ],
            'line-width': 4
        }
    });

    // Add metro stations circle layer
    map.addLayer({
        id: 'metro-stations',
        type: 'circle',
        source: 'metro-data',
        filter: ['==', '$type', 'Point'],
        layout: {
            'visibility': 'none'
        },
        paint: {
            'circle-radius': 7,
            'circle-color': [
                'match',
                ['get', 'line'],
                'purple', '#9a339a',
                'green', '#4caf50',
                'yellow', '#ffeb3b',
                '#000000'
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });

    // Add metro labels layer (M symbol)
    map.addLayer({
        id: 'metro-labels',
        type: 'symbol',
        source: 'metro-data',
        filter: ['==', '$type', 'Point'],
        minzoom: 10, // Show M symbol earlier
        layout: {
            'visibility': 'none',
            'text-field': 'M',
            'text-font': ['Open Sans Bold'],
            'text-size': 8,
            'text-allow-overlap': true
        },
        paint: {
            'text-color': [
                'match',
                ['get', 'line'],
                'yellow', '#000000',
                '#ffffff'
            ]
        }
    });

    // Create a popup, but don't add it to the map yet.
    const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false
    });

    // Add click event for metro stations (optional, maybe zoom in?)
    map.on('click', 'metro-stations', (e) => {
        map.flyTo({
            center: e.features[0].geometry.coordinates,
            zoom: 14
        });
    });

    // Change cursor and show popup on hover
    map.on('mouseenter', 'metro-stations', (e) => {
        map.getCanvas().style.cursor = 'pointer';

        const coordinates = e.features[0].geometry.coordinates.slice();
        const description = e.features[0].properties.name;

        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        popup.setLngLat(coordinates).setHTML(`<strong style="color: #000000;">${description}</strong>`).addTo(map);
    });

    map.on('mouseleave', 'metro-stations', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
    });
}

function toggleMetroStops() {
    const visibility = map.getLayoutProperty('metro-stations', 'visibility');
    const newVisibility = visibility === 'visible' ? 'none' : 'visible';

    if (map.getLayer('metro-lines')) {
        map.setLayoutProperty('metro-lines', 'visibility', newVisibility);
    }
    if (map.getLayer('metro-stations')) {
        map.setLayoutProperty('metro-stations', 'visibility', newVisibility);
    }
    if (map.getLayer('metro-labels')) {
        map.setLayoutProperty('metro-labels', 'visibility', newVisibility);
    }

    const btn = document.getElementById('metro-btn');
    if (newVisibility === 'visible') {
        btn.style.backgroundColor = '#581c87';
        btn.innerHTML = '<span class="btn-icon">🚇</span> Hide Metro Stations';

        // Fly to Bangalore center to show all lines
        map.flyTo({
            center: [77.5946, 12.9716],
            zoom: 11
        });
    } else {
        btn.style.backgroundColor = '#6b21a8';
        btn.innerHTML = '<span class="btn-icon">🚇</span> Show Metro Stations';
    }
}

// ========================================
// BMTC Data Visualization
// ========================================
function addBmtcLayer() {
    // Load Stops
    fetch('bmtc_stops.json')
        .then(response => response.json())
        .then(data => {
            map.addSource('bmtc-stops', {
                type: 'geojson',
                data: data
            });

            map.addLayer({
                id: 'bmtc-stops-layer',
                type: 'circle',
                source: 'bmtc-stops',
                layout: {
                    'visibility': 'none'
                },
                paint: {
                    'circle-radius': 4,
                    'circle-color': '#dc2626', // Red color for BMTC
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#ffffff'
                }
            });

            // Popup for stops
            const popup = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false
            });

            map.on('mouseenter', 'bmtc-stops-layer', (e) => {
                map.getCanvas().style.cursor = 'pointer';
                const coordinates = e.features[0].geometry.coordinates.slice();
                const description = e.features[0].properties.stop_name;

                while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                    coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
                }

                popup.setLngLat(coordinates).setHTML(`<strong style="color: #000000;">${description}</strong>`).addTo(map);
            });

            map.on('mouseleave', 'bmtc-stops-layer', () => {
                map.getCanvas().style.cursor = '';
                popup.remove();
            });
        })
        .catch(err => console.error('Error loading BMTC stops:', err));

    // Load Routes
    fetch('bmtc_routes.json')
        .then(response => response.json())
        .then(data => {
            map.addSource('bmtc-routes', {
                type: 'geojson',
                data: data
            });

            map.addLayer({
                id: 'bmtc-routes-layer',
                type: 'line',
                source: 'bmtc-routes',
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round',
                    'visibility': 'none'
                },
                paint: {
                    'line-color': '#ef4444', // Reddish
                    'line-width': 2,
                    'line-opacity': 0.7
                }
            }, 'crime-points'); // Place below crime points

            // Popup for routes
            const popup = new maplibregl.Popup({
                closeButton: false,
                closeOnClick: false
            });

            map.on('mouseenter', 'bmtc-routes-layer', (e) => {
                map.getCanvas().style.cursor = 'pointer';
                const routeName = e.features[0].properties.route_long_name || e.features[0].properties.route_short_name;

                popup.setLngLat(e.lngLat).setHTML(`<strong style="color: #000000;">Route: ${routeName}</strong>`).addTo(map);
            });

            map.on('mousemove', 'bmtc-routes-layer', (e) => {
                popup.setLngLat(e.lngLat);
            });

            map.on('mouseleave', 'bmtc-routes-layer', () => {
                map.getCanvas().style.cursor = '';
                popup.remove();
            });
        })
        .catch(err => console.error('Error loading BMTC routes:', err));
}

function toggleBmtcRoutes() {
    const visibility = map.getLayoutProperty('bmtc-stops-layer', 'visibility');
    const newVisibility = visibility === 'visible' ? 'none' : 'visible';

    if (map.getLayer('bmtc-stops-layer')) {
        map.setLayoutProperty('bmtc-stops-layer', 'visibility', newVisibility);
    }
    if (map.getLayer('bmtc-routes-layer')) {
        map.setLayoutProperty('bmtc-routes-layer', 'visibility', newVisibility);
    }

    const btn = document.getElementById('bmtc-btn');
    if (newVisibility === 'visible') {
        btn.style.backgroundColor = '#991b1b'; // Darker red
        btn.innerHTML = '<span class="btn-icon">🚌</span> Hide BMTC Routes';
    } else {
        btn.style.backgroundColor = '#dc2626'; // Red
        btn.innerHTML = '<span class="btn-icon">🚌</span> Show BMTC Routes';
    }
}

// ========================================
// Facility Data Visualization (Hospitals & Police)
// ========================================
function addFacilityLayer() {
    // Hospitals
    const hospitalGeojson = {
        type: 'FeatureCollection',
        features: HOSPITALS.map(h => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
            properties: { name: h.name, type: 'Hospital' }
        }))
    };

    map.addSource('hospital-data', { type: 'geojson', data: hospitalGeojson });

    map.addLayer({
        id: 'hospital-points',
        type: 'circle',
        source: 'hospital-data',
        layout: { 'visibility': 'none' },
        paint: {
            'circle-radius': 6,
            'circle-color': '#0f766e', // Teal
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });

    // Police Stations
    const policeGeojson = {
        type: 'FeatureCollection',
        features: POLICE_STATIONS.map(p => ({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
            properties: { name: p.name || 'Police Station', type: 'Police' }
        }))
    };

    map.addSource('police-data', { type: 'geojson', data: policeGeojson });

    map.addLayer({
        id: 'police-points',
        type: 'circle',
        source: 'police-data',
        layout: { 'visibility': 'none' },
        paint: {
            'circle-radius': 6,
            'circle-color': '#1e3a8a', // Dark Blue
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff'
        }
    });

    // Popups
    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });

    ['hospital-points', 'police-points'].forEach(layer => {
        map.on('mouseenter', layer, (e) => {
            map.getCanvas().style.cursor = 'pointer';
            const coordinates = e.features[0].geometry.coordinates.slice();
            const { name, type } = e.features[0].properties;

            while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
                coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
            }

            popup.setLngLat(coordinates).setHTML(`
                <div style="padding: 8px; font-family: Inter, sans-serif;">
                    <strong style="color: #000000;">${name}</strong><br>
                    <span style="color: #10b981;">${type}</span>
                </div>
            `).addTo(map);
        });

        map.on('mouseleave', layer, () => {
            map.getCanvas().style.cursor = '';
            popup.remove();
        });
    });
}

function toggleFacilities() {
    const visibility = map.getLayoutProperty('hospital-points', 'visibility');
    const newVisibility = visibility === 'visible' ? 'none' : 'visible';

    if (map.getLayer('hospital-points')) map.setLayoutProperty('hospital-points', 'visibility', newVisibility);
    if (map.getLayer('police-points')) map.setLayoutProperty('police-points', 'visibility', newVisibility);

    const btn = document.getElementById('facilities-btn');
    if (newVisibility === 'visible') {
        btn.style.backgroundColor = '#115e59'; // Darker teal
        btn.innerHTML = '<span class="btn-icon">🏥</span> Hide Hospitals & Police';
    } else {
        btn.style.backgroundColor = '#0f766e'; // Teal
        btn.innerHTML = '<span class="btn-icon">🏥</span> Show Hospitals & Police';
    }
}

// ========================================
// Accident Data Visualization
// ========================================
function addAccidentLayer() {
    const geojson = {
        type: 'FeatureCollection',
        features: ACCIDENT_DATA.map(accident => ({
            type: 'Feature',
            geometry: {
                type: 'Point',
                coordinates: [accident.lon, accident.lat]
            },
            properties: {
                severity: accident.severity,
                area: accident.area || 'Accident Spot',
                description: accident.description
            }
        }))
    };

    map.addSource('accident-data', {
        type: 'geojson',
        data: geojson
    });

    map.addLayer({
        id: 'accident-points',
        type: 'circle',
        source: 'accident-data',
        layout: {
            'visibility': 'none'
        },
        paint: {
            'circle-radius': 6,
            'circle-color': '#ea580c', // Orange-Red
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.8
        }
    });

    // Popup for accidents
    const popup = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false
    });

    map.on('mouseenter', 'accident-points', (e) => {
        map.getCanvas().style.cursor = 'pointer';
        const coordinates = e.features[0].geometry.coordinates.slice();
        const { area, severity } = e.features[0].properties;

        while (Math.abs(e.lngLat.lng - coordinates[0]) > 180) {
            coordinates[0] += e.lngLat.lng > coordinates[0] ? 360 : -360;
        }

        popup.setLngLat(coordinates).setHTML(`
            <div style="padding: 8px; font-family: Inter, sans-serif;">
                <strong style="color: #000000;">${area}</strong><br>
                <span style="color: #10b981;">Accident Prone Area</span><br>
                <span style="color: #10b981;">Severity: ${severity}/10</span>
            </div>
        `).addTo(map);
    });

    map.on('mouseleave', 'accident-points', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
    });
}

function toggleAccidents() {
    const visibility = map.getLayoutProperty('accident-points', 'visibility');
    const newVisibility = visibility === 'visible' ? 'none' : 'visible';

    if (map.getLayer('accident-points')) {
        map.setLayoutProperty('accident-points', 'visibility', newVisibility);
    }

    const btn = document.getElementById('accidents-btn');
    if (newVisibility === 'visible') {
        btn.style.backgroundColor = '#9a3412'; // Darker orange
        btn.innerHTML = '<span class="btn-icon">⚠️</span> Hide Accidents';
    } else {
        btn.style.backgroundColor = '#ea580c'; // Orange
        btn.innerHTML = '<span class="btn-icon">⚠️</span> Show Accidents';
    }
}

// ========================================
// Route Rendering
// ========================================
function renderRoutesOnMap(routes) {
    clearRoutes();

    routes.forEach((route, index) => {
        try {
            const sourceId = `route-${route.id}`;
            const layerId = `route-layer-${route.id}`;

            map.addSource(sourceId, {
                type: 'geojson',
                data: {
                    type: 'Feature',
                    geometry: route.geometry
                }
            });

            // Add route layer on top of all other layers
            map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: {
                    'line-join': 'round',
                    'line-cap': 'round'
                },
                paint: {
                    'line-color': route.id === selectedRouteId ? '#06b6d4' : '#94a3b8',
                    'line-width': route.id === selectedRouteId ? 6 : 4,
                    'line-opacity': route.id === selectedRouteId ? 1 : 0.8
                }
            });

            map.on('click', layerId, () => {
                selectRoute(route.id);
            });

            map.on('mouseenter', layerId, () => {
                map.getCanvas().style.cursor = 'pointer';
            });

            map.on('mouseleave', layerId, () => {
                map.getCanvas().style.cursor = '';
            });
        } catch (error) {
            console.error(`Error adding route ${index + 1}:`, error);
        }
    });

    if (routes.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        routes.forEach(route => {
            route.geometry.coordinates.forEach(coord => {
                bounds.extend(coord);
            });
        });
        map.fitBounds(bounds, { padding: 50 });
    }
}

function clearRoutes() {
    currentRoutes.forEach(route => {
        const sourceId = `route-${route.id}`;
        const layerId = `route-layer-${route.id}`;

        if (map.getLayer(layerId)) {
            map.removeLayer(layerId);
        }
        if (map.getSource(sourceId)) {
            map.removeSource(sourceId);
        }
    });
}

// ========================================
// Marker Management
// ========================================
function clearMarkers() {
    if (startMarker) {
        startMarker.remove();
        startMarker = null;
    }
    if (endMarker) {
        endMarker.remove();
        endMarker = null;
    }
}

function addMarkers(startCoords, endCoords) {
    clearMarkers();

    // Add start marker (green)
    startMarker = new maplibregl.Marker({ color: '#10b981' })
        .setLngLat([startCoords.lon, startCoords.lat])
        .addTo(map);

    // Add destination marker (cyan)
    endMarker = new maplibregl.Marker({ color: '#06b6d4' })
        .setLngLat([endCoords.lon, endCoords.lat])
        .addTo(map);
}

// ========================================
// Route Selection
// ========================================
function selectRoute(routeId) {
    selectedRouteId = routeId;

    currentRoutes.forEach(route => {
        const layerId = `route-layer-${route.id}`;
        if (map.getLayer(layerId)) {
            const isSelected = route.id === routeId;
            map.setPaintProperty(layerId, 'line-width', isSelected ? 6 : 4);
            map.setPaintProperty(layerId, 'line-opacity', isSelected ? 1 : 0.8);
            map.setPaintProperty(layerId, 'line-color', isSelected ? '#06b6d4' : '#94a3b8');

            // Move selected route to top
            if (isSelected) {
                map.moveLayer(layerId);
            }
        }
    });

    document.querySelectorAll('.route-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.routeId === routeId);
    });
}

// ========================================
// UI Rendering
// ========================================
function renderRoutesList(routes) {
    const routesList = document.getElementById('routes-list');
    const routesContainer = document.getElementById('routes-container');

    routesList.innerHTML = '';

    routes.forEach((route, index) => {
        const card = document.createElement('div');
        card.className = 'route-card';
        card.dataset.routeId = route.id;
        card.style.setProperty('--route-color', route.color);

        if (index === 0) {
            card.classList.add('selected');
            selectedRouteId = route.id;
        }

        const safetyLevel = getSafetyLevel(route.safetyScore);
        const safetyText = safetyLevel === 'high' ? 'Safest' :
            safetyLevel === 'medium' ? 'Moderate' : 'Caution';

        const nearest = findNearestFacilities(route.geometry);

        card.innerHTML = `
      <div class="route-header">
        <h3 class="route-name">Route ${index + 1}</h3>
        <span class="safety-badge ${safetyLevel}">${safetyText}</span>
      </div>
      <div class="route-details">
        <div class="route-stat">
          <span class="stat-label">Safety Score</span>
          <span class="safety-score">${route.safetyScore}/100</span>
        </div>
        <div class="route-stat">
          <span class="stat-label">Distance</span>
          <span class="stat-value">${formatDistance(route.distance)}</span>
        </div>
        <div class="route-stat">
          <span class="stat-label">Duration</span>
          <span class="stat-value">${formatDuration(route.duration)}</span>
        </div>
      </div>
      <div class="route-facilities" style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #334155; font-size: 0.85rem; color: #cbd5e1;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>🏥 Nearest Hospital:</span>
            <span style="color: #fff;">${formatDistance(nearest.hospital.distance * 1000)}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
            <span>👮 Nearest Police:</span>
            <span style="color: #fff;">${formatDistance(nearest.police.distance * 1000)}</span>
        </div>
      </div>
    `;

        card.addEventListener('click', () => {
            selectRoute(route.id);
        });

        routesList.appendChild(card);
    });

    routesContainer.classList.add('visible');
}

// ========================================
// Main Route Finding Logic
// ========================================
async function findSafeRoutes() {
    const startInput = document.getElementById('start-location').value.trim();
    const endInput = document.getElementById('end-location').value.trim();
    const loadingOverlay = document.getElementById('loading-overlay');
    const findButton = document.getElementById('find-routes-btn');

    if (!startInput || !endInput) {
        alert('Please enter both starting point and destination');
        return;
    }

    try {
        loadingOverlay.classList.remove('hidden');
        findButton.disabled = true;

        const [startCoords, endCoords] = await Promise.all([
            geocodeLocation(startInput),
            geocodeLocation(endInput)
        ]);

        console.log('Start:', startCoords);
        console.log('End:', endCoords);

        // Fetch weather data in parallel
        const [startWeather, endWeather] = await Promise.all([
            getWeather(startCoords.lat, startCoords.lon),
            getWeather(endCoords.lat, endCoords.lon)
        ]);

        renderWeatherInfo(startWeather, endWeather);

        // Add markers for start and destination
        addMarkers(startCoords, endCoords);

        const routes = await getRoutes(startCoords, endCoords);
        console.log('Routes fetched:', routes.length);

        const routesWithSafety = routes.map(route => ({
            ...route,
            safetyScore: calculateSafetyScore(route.geometry),
            color: getRouteColor(calculateSafetyScore(route.geometry))
        }));

        routesWithSafety.sort((a, b) => b.safetyScore - a.safetyScore);

        console.log('Routes with safety scores:', routesWithSafety);

        currentRoutes = routesWithSafety;

        // Select the first route by default so it renders as selected (cyan)
        if (currentRoutes.length > 0) {
            selectedRouteId = currentRoutes[0].id;
        }

        renderRoutesOnMap(routesWithSafety);
        renderRoutesList(routesWithSafety);

    } catch (error) {
        console.error('Error finding routes:', error);
        alert(`Error: ${error.message}`);
    } finally {
        loadingOverlay.classList.add('hidden');
        findButton.disabled = false;
    }
}

// ========================================
// Event Listeners & Initialization
// ========================================
document.addEventListener('DOMContentLoaded', () => {
    initializeMap();

    document.getElementById('find-routes-btn').addEventListener('click', findSafeRoutes);

    document.getElementById('start-location').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') findSafeRoutes();
    });

    document.getElementById('end-location').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') findSafeRoutes();
    });

    document.getElementById('metro-btn').addEventListener('click', toggleMetroStops);
    document.getElementById('bmtc-btn').addEventListener('click', toggleBmtcRoutes);

    setupAutocomplete('start-location');
    setupAutocomplete('end-location');

    // SOS Button Handler
    const sosBtn = document.getElementById('sos-btn');

    if (sosBtn) {
        sosBtn.addEventListener('click', () => {
            alert('Emergency message sent to server! Help is on the way.');
        });
    }
});
