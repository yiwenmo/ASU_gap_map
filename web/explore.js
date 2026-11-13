
/* Explore Campus — ASU Gap Map */

(() => {
  "use strict";

  const exploreLayer = L.layerGroup();
  const exploreState = {
    category: "all",
    search: "",
    selectedId: null,
    locations: []
  };

  const categoryLabels = {
    coffee: "Coffee",
    food: "Food",
    study: "Study"
  };

  const categoryIcons = {
    coffee: "☕",
    food: "🍴",
    study: "📚"
  };

  function filteredLocations() {
    return exploreState.locations.filter(feature => {
      const p = feature.properties || {};
      const matchesCategory =
        exploreState.category === "all" ||
        p.category === exploreState.category;

      const matchesSearch = String(p.name || "")
        .toLowerCase()
        .includes(exploreState.search);

      return matchesCategory && matchesSearch;
    });
  }

  function makeMarker(feature) {
    const p = feature.properties;
    const [lon, lat] = feature.geometry.coordinates;
    const category = categoryLabels[p.category]
      ? p.category : "study";

    const icon = L.divIcon({
      className: "",
      html: `<div class="amenity-pin ${category}">
               ${categoryIcons[category]}
             </div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15]
    });

    const marker = L.marker([lat, lon], { icon });

    const hours = p.hours
      ? `<br>Hours: ${esc(p.hours)}`
      : "";

    marker.bindPopup(
      `<strong>${esc(p.name || "Unnamed location")}</strong>
       <br>${categoryLabels[category]}${hours}`
    );

    marker.on("click", () => {
      exploreState.selectedId = String(p.id);
      highlightSelected();
    });

    return marker;
  }

  function highlightSelected() {
    document.querySelectorAll(".explore-card")
      .forEach(card => {
        card.classList.toggle(
          "selected",
          card.dataset.id === exploreState.selectedId
        );
      });
  }

  function renderExplore() {
    const locations = filteredLocations();

    exploreLayer.clearLayers();

    $("explore-count").textContent =
      `${locations.length} location${locations.length === 1 ? "" : "s"} found`;

    $("explore-list").innerHTML = "";

    locations.forEach(feature => {
      const p = feature.properties;
      const category = categoryLabels[p.category] || "Location";
      const icon = categoryIcons[p.category] || "📍";

      const card = document.createElement("button");
      card.type = "button";
      card.className = "explore-card";
      card.dataset.id = String(p.id);

      const iconBox = document.createElement("span");
      iconBox.className = "explore-card-icon";
      iconBox.textContent = icon;

      const body = document.createElement("span");
      body.className = "explore-card-body";

      const name = document.createElement("span");
      name.className = "explore-card-name";
      name.textContent = p.name || "Unnamed location";

      const categoryText = document.createElement("span");
      categoryText.className = "explore-card-category";
      categoryText.textContent = category;

      body.append(name, categoryText);

      if (p.hours) {
        const hours = document.createElement("span");
        hours.className = "explore-card-hours";
        hours.textContent = `Hours: ${p.hours}`;
        body.appendChild(hours);
      }

      const arrow = document.createElement("span");
      arrow.className = "explore-card-arrow";
      arrow.textContent = "›";

      card.append(iconBox, body, arrow);

      const marker = makeMarker(feature);
      marker.addTo(exploreLayer);

      card.addEventListener("click", () => {
        const [lon, lat] = feature.geometry.coordinates;

        exploreState.selectedId = String(p.id);
        highlightSelected();

        map.setView([lat, lon], 18);
        marker.openPopup();
      });

      $("explore-list").appendChild(card);
    });

    highlightSelected();
  }

  function switchMode(mode) {
    const isExplore = mode === "explore";

    $("plan-view").hidden = isExplore;
    $("explore-view").hidden = !isExplore;

    $("tab-plan").classList.toggle("active", !isExplore);
    $("tab-explore").classList.toggle("active", isExplore);

    $("tab-plan").setAttribute(
      "aria-selected", String(!isExplore)
    );
    $("tab-explore").setAttribute(
      "aria-selected", String(isExplore)
    );

    if (isExplore) {
      markerLayer.remove();
      routeLayer.remove();
      exploreLayer.addTo(map);

      renderExplore();

      const markers = exploreLayer.getLayers();

      if (markers.length) {
        map.fitBounds(
          L.featureGroup(markers).getBounds(),
          { padding: [40, 40], maxZoom: 16 }
        );
      }

      hint.getContainer().textContent =
        "Select a location to view details";
    } else {
      exploreLayer.remove();
      markerLayer.addTo(map);
      routeLayer.addTo(map);

      hint.getContainer().textContent =
        "Drag A or B to move them";
    }

    map.invalidateSize();
  }

  async function loadExploreData() {
    try {
      const response = await fetch("../data/pois.geojson");

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const geojson = await response.json();

      if (
        geojson.type !== "FeatureCollection" ||
        !Array.isArray(geojson.features)
      ) {
        throw new Error("Invalid GeoJSON FeatureCollection");
      }

      exploreState.locations = geojson.features.filter(f =>
        f.geometry?.type === "Point" &&
        Array.isArray(f.geometry.coordinates) &&
        f.geometry.coordinates.length >= 2 &&
        Number.isFinite(f.geometry.coordinates[0]) &&
        Number.isFinite(f.geometry.coordinates[1]) &&
        ["coffee", "food", "study"].includes(f.properties?.category)
      );

      renderExplore();
    } catch (error) {
      console.error("Explore Campus:", error);
      $("explore-count").textContent =
        "Unable to load campus locations.";
      $("explore-list").textContent =
        "Check that data/pois.geojson exists and the site is running through Live Server.";
    }
  }

  $("tab-plan").addEventListener("click", () => {
    switchMode("plan");
  });

  $("tab-explore").addEventListener("click", () => {
    switchMode("explore");
  });

  $("explore-search").addEventListener("input", event => {
    exploreState.search = event.target.value
      .trim()
      .toLowerCase();

    renderExplore();
  });

  document.querySelectorAll(".explore-chip")
    .forEach(button => {
      button.addEventListener("click", () => {
        exploreState.category = button.dataset.category;
        exploreState.selectedId = null;

        document.querySelectorAll(".explore-chip")
          .forEach(chip => {
            chip.classList.toggle(
              "active",
              chip === button
            );
          });

        renderExplore();
      });
    });

  loadExploreData();
})();
