import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import data from '../banepa.json';

const emojisAndMessages = [
  { emoji: "🌍", message: "Loading the map interface..." },
  { emoji: "🔍", message: "Get ready to explore!" },
  { emoji: "✨", message: "Almost there! Mapping the data..." }
];

export default function MapExplorer() {
  const [map, setMap] = useState(null);
  const [filteredData, setFilteredData] = useState([]);
  const [currentItemIndex, setCurrentItemIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [resultsCount, setResultsCount] = useState(0);
  const [query, setQuery] = useState('');
  const [loaderState, setLoaderState] = useState(emojisAndMessages[0]);
  const [isShowDescription, setIsShowDescription] =useState(false);
  
  const mapRef = useRef(null);
  const individualLayerRef = useRef(null);
  const currentBoundingBoxLayerRef = useRef(null);

  useEffect(() => {
    initializeMap();
    processURLParams();
    return () => {
      if (map) map.remove();
    };
  }, []);

  const initializeMap = () => {
    const initialBounds = [
      [27.6152, 85.5098],
      [27.6512, 85.5457]
    ];

    const mapInstance = L.map(mapRef.current, {
      center: [27.65, 85.51],
      zoom: 14,
      maxBounds: initialBounds,
      maxBoundsViscosity: 0.2
    });

    mapInstance.on('zoomend', () => {
      const zoomLevel = mapInstance.getZoom();
      if (zoomLevel > 18) {
        mapInstance.setMaxBounds(null);
      } else {
        mapInstance.setMaxBounds(initialBounds);
      }
    });

    L.tileLayer('https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.carto.com/">CartoDB</a>',
      subdomains: 'abcd',
      maxZoom: 21,
      minZoom: 14
    }).addTo(mapInstance);

    L.tileLayer('https://tiles.openaerialmap.org/62d85d11d8499800053796c1/0/62d85d11d8499800053796c2/{z}/{x}/{y}', {
      maxZoom: 21,
      minZoom: 14,
      attribution: '&copy; OpenAerialMap'
    }).addTo(mapInstance);

    setMap(mapInstance);
    setLoading(false);
  };

  const processURLParams = () => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlQuery = urlParams.get('query');
    const bbox = urlParams.get('bbox');

    if (urlQuery) {
      setQuery(urlQuery);
      performSearch(urlQuery);
    }

    if (bbox && map) {
      const bboxArray = bbox.split(',').map(Number);
      const bounds = L.latLngBounds(
        L.latLng(bboxArray[1], bboxArray[0]),
        L.latLng(bboxArray[3], bboxArray[2])
      );
      map.fitBounds(bounds);
    }
  };

  const updateURL = (searchQuery) => {
    if (!map) return;
    
    const bounds = map.getBounds();
    const bbox = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth()
    ].join(',');

    const newURL = `${window.location.pathname}?query=${encodeURIComponent(searchQuery)}&bbox=${encodeURIComponent(bbox)}`;
    history.pushState({ query: searchQuery, bbox }, '', newURL);
  };

  const tfidfSearch = (searchQuery) => {
    const queryTerms = searchQuery.toLowerCase().split(" ");
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
  };

  const performSearch = (searchQuery = query) => {
    if (!searchQuery.trim()) {
      alert("Please enter a question.");
      return;
    }

    const results = tfidfSearch(searchQuery);
    setFilteredData(results);
    setResultsCount(results.length);

    if (results.length > 0) {
      const geoJSON = generateGeoJSONFromResults(results);
      displayGeoJSONLayer(geoJSON);
    }

    updateURL(searchQuery);
  };

  const generateGeoJSONFromResults = (results) => {
    const features = results.map(result => {
      const bbox = result.bbox.match(/[-+]?\d*\.\d+/g).map(Number);
      
      return {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [[
            [bbox[0], bbox[1]],
            [bbox[0], bbox[3]],
            [bbox[2], bbox[3]],
            [bbox[2], bbox[1]],
            [bbox[0], bbox[1]]
          ]]
        },
        properties: {
          description: result.description_from_model,
          score: result.score
        }
      };
    });

    return {
      type: "FeatureCollection",
      features: features
    };
  };

  const displayGeoJSONLayer = (geoJSON) => {
    if (!map) return;

    if (individualLayerRef.current) {
      map.removeLayer(individualLayerRef.current);
    }

    individualLayerRef.current = L.geoJSON(geoJSON, {
      style: { color: "yellow", weight: 2 },
      onEachFeature: (feature, layer) => {
        if (feature.properties?.description) {
          layer.bindPopup(feature.properties.description);
        }
      }
    }).addTo(map);

    map.fitBounds(individualLayerRef.current.getBounds());
  };

  const startExploration = () => {
    if (filteredData.length > 0) {
      const firstItem = filteredData[0];
      zoomToItem(firstItem);
      setCurrentItemIndex(0);
    }
  };

  const zoomToItem = (item) => {
    if (!item?.bbox || !map) return;

    let bbox;
    if (typeof item.bbox === 'string') {
      bbox = item.bbox
        .replace(/[()]/g, '')
        .split(',')
        .map(Number);
    } else if (Array.isArray(item.bbox)) {
      bbox = item.bbox;
    } else {
      console.error("Invalid bbox format:", item.bbox);
      return;
    }

    if (bbox.length === 4 && bbox.every(coord => !isNaN(coord))) {
      const bounds = [[bbox[1], bbox[0]], [bbox[3], bbox[2]]];
      map.fitBounds(bounds);
      highlightBoundingBox(bounds);
    }
  };

  const highlightBoundingBox = (bounds) => {
    if (!map) return;

    if (currentBoundingBoxLayerRef.current) {
      map.removeLayer(currentBoundingBoxLayerRef.current);
    }

    currentBoundingBoxLayerRef.current = L.rectangle(bounds, {
      color: 'green',
      weight: 2,
      fillOpacity: 0.2
    }).addTo(map);
  };

  const navigate = (direction) => {
    let newIndex = currentItemIndex;
    if (direction === 'next' && currentItemIndex < filteredData.length - 1) {
      newIndex++;
    } else if (direction === 'prev' && currentItemIndex > 0) {
      newIndex--;
    }

    setCurrentItemIndex(newIndex);
    const item = filteredData[newIndex];
    zoomToItem(item);
  };

  const closeExplore = () => {
    if (currentBoundingBoxLayerRef.current && map) {
      map.removeLayer(currentBoundingBoxLayerRef.current);
    }
    setIsShowDescription(false)
  };

  return (
    <div className="relative h-screen">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white bg-opacity-90 z-50">
          <div className="text-center">
            <div className="text-4xl mb-2">{loaderState.emoji}</div>
            <div>{loaderState.message}</div>
          </div>
        </div>
      )}
      
      <div className="absolute top-4 right-4 z-[10000] bg-white p-4 rounded shadow">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && performSearch()}
          placeholder="Enter your question..."
          className="p-2 border rounded mr-2 bg-white text-gray-800"
        />
        <button
          onClick={() => performSearch()}
          className="bg-blue-500 text-white px-4 py-2 rounded"
        >
          Search
        </button>
        <button
      onClick={() => {
        setIsShowDescription(true)
        navigate('explore')}}
      
      disabled={currentItemIndex === filteredData.length - 1}
      className="ml-2 bg-gray-500 text-white px-4 py-2 rounded disabled:opacity-50"
    >
      Explore 
    </button>
      </div>

      {resultsCount > 0 && (
        <div className="absolute top-32 right-4 z-[999] bg-white p-4 rounded shadow">
          <p className='text-gray-800'>{resultsCount} results found</p>
          <button
            onClick={startExploration}
            className="bg-green-500 text-white px-4 py-2 rounded mt-2 "
          >
            Start Exploration
          </button>
        </div>
      )}

      {currentItemIndex !== null && filteredData.length > 0 && isShowDescription && (
        <div className="absolute w-96 top-[55%] right-4 z-[999] bg-white  p-3 rounded "> 
          <p className='text-gray-800'>{filteredData[currentItemIndex]?.description_from_model}</p>
          <div className="flex justify-between mt-4">
            <button
              onClick={() => navigate('prev')}
              disabled={currentItemIndex === 0}
              className="bg-gray-500 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={closeExplore}
              className="bg-red-500 text-white px-4 py-2 rounded"
            >
              Close
            </button>
            <button
              onClick={() => navigate('next')}
              disabled={currentItemIndex === filteredData.length - 1}
              className="bg-gray-500 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}


      <div ref={mapRef} id="map" className="h-full w-full" />
    </div>
  );
}