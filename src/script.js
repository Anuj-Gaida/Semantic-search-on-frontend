import data from "./banepa.json"

console.log(data)

const emojisAndMessages = [
    { emoji: "🌍", message: "Loading the map interface..." },
    { emoji: "🔍", message: "Get ready to explore!" },
    { emoji: "✨", message: "Almost there! Mapping the data..." }
];

let filteredData = [];
let map;
let model;
let useFallback = true;
let embeddings = [];
let individualLayer;
let currentItemIndex = 0;  // Track the current item index for exploration
let currentBoundingBoxLayer;  // Store the current bounding box layer

async function processURLParams() {
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('query');
    const bbox = urlParams.get('bbox');

    if (query) {
        document.getElementById("queryInput").value = query;
        console.log("Search query from URL:", query);
        await performSearch(); // Perform search based on the query from the URL
    }

    if (bbox) {
        const bboxArray = bbox.split(',').map(Number);
        const bounds = L.latLngBounds(
            L.latLng(bboxArray[1], bboxArray[0]),  // SW corner
            L.latLng(bboxArray[3], bboxArray[2])   // NE corner
        );
        map.fitBounds(bounds); 
    }
}

window.onload = async function () {
    showLoader(); 

    try {
        await initializeMap(); 
        await new Promise(resolve => setTimeout(resolve, 1000));
        // await initializeSearch(); 
        hideLoader(); 

        await processURLParams();  
    } catch (error) {
        console.error("Error during page load initialization:", error);
        hideLoader(); 
    }
};


function showLoader() {
    let index = 0;
    const loaderEmoji = document.getElementById("loaderEmoji");
    const loaderMessage = document.getElementById("loaderMessage");

    const loaderInterval = setInterval(() => {
        loaderEmoji.textContent = emojisAndMessages[index].emoji;
        loaderMessage.textContent = emojisAndMessages[index].message;
        index = (index + 1) % emojisAndMessages.length;
    }, 1000);

    document.getElementById("loader").style.display = "flex";

    setTimeout(() => clearInterval(loaderInterval), 1000);
}

function hideLoader() {
    document.getElementById("loader").style.display = "none";
}

async function initializeSearch() {
    try {
        model = await use.load();
        console.log("Universal Sentence Encoder initialized.");
        embeddings = await Promise.all(
            data.map(async item => ({
                ...item,
                embedding: (await model.embed(item.description_from_model)).arraySync()[0]
            }))
        );
        useFallback = true;
    } catch (error) {
        console.warn("Error loading USE. Falling back to TF-IDF.", error);
        useFallback = true;
    }
}

async function initializeMap() {
    const initialBounds = [
        [27.6152, 85.5098], // Southwest corner
        [27.6512, 85.5457]  // Northeast corner
    ];
    

    map = L.map('map', {
        center: [27.65, 85.51],
        zoom: 14,
        maxBounds: initialBounds,
        maxBoundsViscosity: 0.2
    });

    map.on('zoomend', () => {
        const zoomLevel = map.getZoom();
        if (zoomLevel > 18) { // For very high zoom remove bounds, as map keeps coming back because of maxBoundsViscosity
            map.setMaxBounds(null);
        } else {
            map.setMaxBounds(initialBounds);
        }
    });

    L.tileLayer('https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.carto.com/">CartoDB</a>',
        subdomains: 'abcd',
        maxZoom: 21,
        minZoom: 14
    }).addTo(map);

    const aerialMapLayer = L.tileLayer('https://tiles.openaerialmap.org/62d85d11d8499800053796c1/0/62d85d11d8499800053796c2/{z}/{x}/{y}', {
        maxZoom: 21,  // Max zoom level
        minZoom: 14,  // Min zoom level
        attribution: '&copy; OpenAerialMap'
    }).addTo(map);
    
 
    

    setupKeyboardNavigation();
}


function updateURL(query) {

    const bounds = map.getBounds();
    const bbox = [
        bounds.getWest(),    // minLng
        bounds.getSouth(),   // minLat
        bounds.getEast(),    // maxLng
        bounds.getNorth()    // maxLat
    ].join(',');

    const newURL = `${window.location.pathname}?query=${encodeURIComponent(query)}&bbox=${encodeURIComponent(bbox)}`;
    history.pushState({ query, bbox }, '', newURL);
}

async function performSearch() {
    const query = document.getElementById("queryInput").value.trim().toLowerCase();

    console.log(query)
    
    if (!query) {
        alert("Please enter a question.");
        return;
    }

    let results;
    if (!useFallback) {
        try {
            const queryEmbedding = (await model.embed(query)).arraySync()[0];
            results = embeddings.map(item => ({
                ...item,
                similarity: cosineSimilarity(queryEmbedding, item.embedding)
            })).filter(item => item.similarity > 0);

            results.sort((a, b) => b.similarity - a.similarity);
        } catch (error) {
            console.warn("USE failed. Falling back to TF-IDF.", error);
            useFallback = true;
            results = tfidfSearch(query);
        }
    } else {
        
        results = tfidfSearch(query);
    }

    if (results.length === 0) {
        document.getElementById('resultsSummary').style.display = 'block';
        document.getElementById('resultsCount').textContent = '0';
      
        return;
    }
    filteredData = []
    filteredData = results;
    const geoJSON = generateGeoJSONFromResults(results);
    displayGeoJSONLayer(geoJSON);

    document.getElementById('resultsSummary').style.display = 'block';
    document.getElementById('resultsCount').textContent = results.length;
   
    updateURL(query);

    
}


function tfidfSearch(query) {
    
    const queryTerms = query.split(" ");
    const results = data.map(row => {
        const description = row.description_from_model.toLowerCase();
        let score = 0;
        queryTerms.forEach(term => {
            score += (description.split(term).length - 1);
        });
        return { ...row, score };
    }).filter(item => item.score > 0);

    results.sort((a, b) => b.score - a.score);
    return results;
}

function cosineSimilarity(vecA, vecB) {
    const dotProduct = vecA.reduce((sum, val, i) => sum + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((sum, val) => sum + val * val, 0));

    return dotProduct / (magnitudeA * magnitudeB);
}

function generateGeoJSONFromResults(results) {
    const features = results.map(result => {
        const bbox = result.bbox.match(/[-+]?\d*\.\d+/g).map(Number);

        return {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [bbox[0], bbox[1]],
                    [bbox[0], bbox[3]],
                    [bbox[2], bbox[3]],
                    [bbox[2], bbox[1]],
                    [bbox[0], bbox[1]]
                ]]
            },
            "properties": {
                "description": result.description_from_model,
                "score": result.similarity || result.score
            }
        };
    });

    return {
        "type": "FeatureCollection",
        "features": features
    };
}

function displayGeoJSONLayer(geoJSON) {
    if (individualLayer) {
        map.removeLayer(individualLayer);
    }

    individualLayer = L.geoJSON(geoJSON, {
        style: { color: "yellow", weight: 2 },
        onEachFeature: function (feature, layer) {
            if (feature.properties && feature.properties.description) {
                layer.bindPopup(feature.properties.description);
            }
        }
    });

    individualLayer.addTo(map);
    map.fitBounds(individualLayer.getBounds());
}

function setupKeyboardNavigation() {
    document.addEventListener('keydown', function (event) {
        const activeElement = document.activeElement;

        // Handle Enter key when the query input is active
        if (event.key === 'Enter' && activeElement.id === 'queryInput') {
            document.getElementById('searchButton').click();
            event.preventDefault(); // Prevent default form submission
        }
    });
}

function startExploration() {
    if (filteredData.length > 0) {
        const firstItem = filteredData[0];
        zoomToFirstItem(firstItem);
        openExplorePanel(firstItem);
    }
}

function zoomToFirstItem(item) {
   
    if (item && item.bbox) {
        let bbox;
        
        if (typeof item.bbox === 'string') {
          
            bbox = item.bbox
                .replace(/[()]/g, '')  // Remove parentheses
                .split(',')             // Split by commas
                .map(Number);           // Convert each part into a number
        } else if (Array.isArray(item.bbox)) {

            bbox = item.bbox;
        } else {
            console.error("Invalid bbox format:", item.bbox);
            return; 
        }

        // Validate that bbox has exactly 4 coordinates and that they are valid numbers
        if (bbox.length === 4 && bbox.every(coord => !isNaN(coord))) {
            const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];  
            map.fitBounds(bounds);  

       
            highlightBoundingBox(bounds);
        } else {
            console.error("Invalid bbox data:", bbox); 
        }
    } else {
        console.error("No valid bbox found for this item:", item);
    }
}

function highlightBoundingBox(bounds) {
    if (currentBoundingBoxLayer) {
        map.removeLayer(currentBoundingBoxLayer);
    }

    currentBoundingBoxLayer = L.rectangle(bounds, {
        color: 'green', 
        weight: 2,       
        fillOpacity: 0.2  
    }).addTo(map);
}

function openExplorePanel(item) {
    document.getElementById("explorePanel").style.display = "block";
    document.getElementById("description").textContent = item.description_from_model;
    currentItemIndex = 0; 
    updateNavigationButtons();
}

function navigate(direction) {
    if (direction === 'next' && currentItemIndex < filteredData.length - 1) {
        currentItemIndex++;
    } else if (direction === 'prev' && currentItemIndex > 0) {
        currentItemIndex--;
    }

    const item = filteredData[currentItemIndex];
    document.getElementById("description").textContent = item.description_from_model;
    zoomToFirstItem(item);
    updateNavigationButtons();
}

function updateNavigationButtons() {
    document.getElementById("prevButton").disabled = currentItemIndex === 0;
    document.getElementById("nextButton").disabled = currentItemIndex === filteredData.length - 1;
}

function closeExplore() {
    document.getElementById("explorePanel").style.display = "none";

    if (currentBoundingBoxLayer) {
        map.removeLayer(currentBoundingBoxLayer);
    }
}

let currentQueryIndex = 0;
function sequentialQuery() {
    const queries = ['river','bridge', 'blue roof','bridge', 'road', 'trees', 'buildings', 'farm', 'swimming pool' ];
    const currentQuery = queries[currentQueryIndex];
    document.getElementById("queryInput").value = currentQuery;
    performSearch();
    currentQueryIndex = (currentQueryIndex + 1) % queries.length;
}
