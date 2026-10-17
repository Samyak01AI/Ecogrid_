# External map and geocoding sources

## Place search

EcoGrid's study-area search uses the public Nominatim Search API as a direct, user-submitted query. The current request shape is `https://nominatim.openstreetmap.org/search?q=...&format=jsonv2&addressdetails=1&limit=5`.

The public service's policy requires no more than **one request per second per application**, an identifying HTTP User-Agent or Referer, visible OpenStreetMap attribution, and caching where possible. Client-side autocomplete and periodic/bulk requests are prohibited. EcoGrid therefore submits only after the user presses Search, uses a server-side request queue and a 24-hour result cache, identifies the application in its User-Agent, and displays attribution beside search results. Search behavior must remain switchable if the provider's policy changes or access is withdrawn.

- Search API manual: https://nominatim.org/release-docs/latest/api/Search/
- Public service usage policy: https://operations.osmfoundation.org/policies/nominatim/
- OpenStreetMap attribution and licence: https://www.openstreetmap.org/copyright

## Basemap tiles

The main map uses the standard OpenStreetMap tile endpoint for Light and CSS-filtered Dark styles, and Esri World Imagery for Satellite. Each view displays its provider attribution. The public OSM raster tile service is capacity-limited and governed by its tile-use policy; deployments should switch to an appropriate hosted tile provider if application traffic exceeds casual interactive use.

- OSM tile usage policy: https://operations.osmfoundation.org/policies/tiles/
- OSM attribution: https://www.openstreetmap.org/copyright
- Esri World Imagery service: https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer
