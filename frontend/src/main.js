// Assignment #2: Miami housing prices

import * as d3 from "d3";
import "./style.css";
import { createOceanView } from "./oceanView.js";
import { createDecadeView } from "./decadeView.js";
import { createFeatureView } from "./featureView.js";

// Color palette
const COLORS = {
    blue: "#41b6e6", // standard house
    pink: "#db3eb1", // selected house
    gray: "#d0d0d0", // reserved for later (e.g. houses outside a selection) — not applied yet
};

// Backend path
const DATA_URL = "http://127.0.0.1:5001/api/houses";

// The map fills allotted space on page (measure once --> scaled by viewBox)
const mapBox = document.getElementById("map-container").getBoundingClientRect();
const WIDTH = Math.round(mapBox.width);
const HEIGHT = Math.round(mapBox.height);
const PADDING = 24; // space between the outermost houses and SVG edge
const RADIUS = 2.5; // standard dot
const RADIUS_ACTIVE = 6; // hovered vs. clicked dot
const HIT_RADIUS = 10; // how close pointer must be to select a house
const FADED_OPACITY = 0.15; // houses outside the lasso
const LASSO_MIN_MOVE = 5; // distance pointer has to travel before a drag counts as a lasso
const ZOOM_LIMITS = [1, 12]; // zoom factor

// Landmark labels, placed at real coordinates (approximate centers)
const LANDMARKS = [
    { name: "Atlantic Ocean", lat: 25.80, lon: -80.085, kind: "water", rotate: -72 },
    { name: "Biscayne Bay",   lat: 25.60, lon: -80.20,  kind: "water", rotate: -65 },
    { name: "Everglades",     lat: 25.70, lon: -80.62,  kind: "land",  rotate: 0 },
];

const fmtPrice = d3.format("$,.0f");
const fmtInt = d3.format(",.0f");

// SVG canvas
const svg = d3.select("#map-container")
    .append("svg")
    .attr("viewBox", `0 0 ${WIDTH} ${HEIGHT}`) // drawing units; scales w/ window
    .attr("width", "100%")
    .attr("height", "100%");

svg.append("rect")
    .attr("class", "map-bg")
    .attr("width", WIDTH)
    .attr("height", HEIGHT);

const dotLayer = svg.append("g").attr("class", "houses");

const tooltip = d3.select("#tooltip");
const statusEl = d3.select("#status");
const detailsEl = d3.select("#details");

// Shared state
const state = {
    hoveredId: null,
    clickedId: null,
    lassoIds: null, // set of selected house ids (lasso or brush) or null when nothing selected
    selectionSource: null, // which view made the selection: "lasso", "ocean", "decade", "feature", or null
    mode: "lasso", // differentiates what a drag does (i.e. lasso vs pan)
    transform: d3.zoomIdentity, // current zoom and pan
};

// Load data

// Keeps PARCELNO as a string; works w/ saved sample OR full CSV
d3.json(DATA_URL).then(rows => rows.map(row => ({
    id: row.PARCELNO,
    lat: +row.LATITUDE,
    lon: +row.LONGITUDE,
    price: +row.SALE_PRC,
    area: +row.TOT_LVG_AREA,
    yearBuilt: row.year_built ? +row.year_built : 2016 - +row.age,
    oceanDist: +row.OCEAN_DIST,
    featVal: +row.SPEC_FEAT_VAL,
})))
    .then(drawMap)
    .catch(error => {
        console.error(error);
        statusEl.text(`Could not load ${DATA_URL}. Check that the file exists and the connection is not broken.`);
    });

// Map
function drawMap(houses) {
    // Projection: Mercator
    const projection = d3.geoMercator().fitExtent(
        [[PADDING, PADDING], [WIDTH - PADDING, HEIGHT - PADDING]],
        { type: "MultiPoint", coordinates: houses.map(d => [d.lon, d.lat]) }
    );

    // Project every house once
    houses.forEach(d => {
        [d.x, d.y] = projection([d.lon, d.lat]);
    });

    // Edge of development: a dashed line through the westernmost houses.
    // The map is cut into thin north-south bands; in each band the line passes the
    // point only 2% of houses lie west of, so one stray house can't make a spike.
    const BANDS = 24;
    const [yMin, yMax] = d3.extent(houses, d => d.y);
    const bandOf = d => Math.min(BANDS - 1, Math.floor((d.y - yMin) / (yMax - yMin) * BANDS));
    const edgePoints = d3.groups(houses, bandOf)
        .filter(([, band]) => band.length >= 4)               // skip near-empty bands
        .map(([, band]) => [
            d3.quantile(band.map(d => d.x).sort(d3.ascending), 0.02),
            d3.mean(band, d => d.y),
        ])
        .sort((a, b) => a[1] - b[1]);                        // north to south

    dotLayer.insert("path", "circle")                        // under the houses, zooms with them
        .attr("class", "edge-line")
        .attr("d", d3.line().curve(d3.curveBasis)(edgePoints));

    // Its label sits just west of the line's middle, turned to follow the line
    const mid = Math.floor(edgePoints.length / 2);
    const [ax, ay] = edgePoints[mid + 1];                     // a bit further south
    const [bx, by] = edgePoints[mid - 1];                     // a bit further north
    const len = Math.hypot(bx - ax, by - ay);
    const edgeLabel = {
        name: "Edge of development",
        kind: "edge",
        lat: null,                                            // placed from the line, not lat/lon
        lon: null,
        px: edgePoints[mid][0] + (by - ay) / len * 14,       // 14 px to the west of the line
        py: edgePoints[mid][1] - (bx - ax) / len * 14,
        rotate: Math.atan2(by - ay, bx - ax) * 180 / Math.PI,
    };

    // Landmark labels: same projection as the houses, drawn underneath them.
    // Kept inside the map's edges so they stay visible on narrower screens.
    LANDMARKS.forEach(d => {
        const [px, py] = projection([d.lon, d.lat]);
        d.x = Math.max(70, Math.min(WIDTH - 70, px));
        d.y = Math.max(70, Math.min(HEIGHT - 70, py));
    });

    edgeLabel.x = edgeLabel.px;
    edgeLabel.y = edgeLabel.py;

    const landmarkLabels = svg.insert("g", ".houses")
        .attr("class", "landmarks")
        .selectAll("text")
        .data([...LANDMARKS, edgeLabel])
        .join("text")
        .attr("class", d => `landmark ${d.kind}`)
        .attr("text-anchor", "middle")
        .text(d => d.name);

    // Labels move with zoom/pan but keep the same text size on screen
    function placeLandmarks() {
        landmarkLabels.attr("transform", d => {
            const [sx, sy] = state.transform.apply([d.x, d.y]);
            return `translate(${sx},${sy}) rotate(${d.rotate})`;
        });
    }

    // Lookup table
    const byId = new Map(houses.map(d => [d.id, d]));

    // One circle per house
    const dots = dotLayer.selectAll("circle")
        .data(houses, d => d.id)
        .join("circle")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", RADIUS)
        .attr("fill", COLORS.blue)
        .attr("fill-opacity", 0.75)
        .attr("pointer-events", "none"); // overlay handles mouse

    // Nearest-house finder
    const delaunay = d3.Delaunay.from(houses, d => d.x, d => d.y);

    // Lasso outline (resides inside zoomed layer in map coordinates --> stays on the right houses when you zoom or pan afterwards
    const lassoPath = dotLayer.append("path").attr("class", "lasso");
    let lassoPoints = null; // map-coordinate points while drawing; null otherwise
    let suppressClick = false; // click that ends a lasso drag =/= real click

    // Pointer position converted back to un-zoomed map coordinates
    function mapPoint(event) {
        return state.transform.invert(d3.pointer(event, svg.node()));
    }

    function houseAt(event) {
        const [mx, my] = mapPoint(event);
        const nearest = houses[delaunay.find(mx, my)];

        // Rescales circle size for zooming
        const distance = Math.hypot(nearest.x - mx, nearest.y - my) * state.transform.k;
        return distance <= HIT_RADIUS ? nearest : null;
    }

    // Transparent overlay catches every pointer event
    const overlay = svg.append("rect")
        .attr("class", "overlay")
        .attr("width", WIDTH)
        .attr("height", HEIGHT)
        .on("pointerdown", event => {
            if (state.mode !== "lasso" || event.button !== 0) return;
            lassoPath.interrupt().attr("opacity", 1); // cancel currently running fade
            lassoPoints = [mapPoint(event)];
            overlay.node().setPointerCapture(event.pointerId); // keep current lasso event
        })
        .on("pointermove", event => {
            if (lassoPoints) { // Lab 3
                lassoPoints.push(mapPoint(event));
                lassoPath.attr("d", d3.line()(lassoPoints) + "Z");
                hideTooltip();
                return;
            }
            const house = houseAt(event);
            const id = house ? house.id : null;
            if (id !== state.hoveredId) {
                state.hoveredId = id;
                render();
            }
            if (house) showTooltip(event, house);
            else hideTooltip();
        })
        .on("pointerup", () => {
            if (!lassoPoints) return;
            const [x0, y0] = lassoPoints[0];
            const movedPx = d3.max(lassoPoints, ([x, y]) => Math.hypot(x - x0, y - y0)) * state.transform.k;

            if (movedPx >= LASSO_MIN_MOVE) {
                state.lassoIds = new Set(
                    houses.filter(d => d3.polygonContains(lassoPoints, [d.x, d.y])).map(d => d.id)
                );
                suppressClick = true;
                state.selectionSource = "lasso";

                // Lab 3 and 4 transitions
                lassoPath.transition()
                    .delay(0)
                    .duration(400)
                    .ease(d3.easeCubicOut)
                    .attr("opacity", 0)
                    .on("end", () => lassoPath.attr("d", null).attr("opacity", 1));
            } else {
                lassoPath.attr("d", null); // click vs. lasso distinction
            }
            lassoPoints = null;
            render();
        })
        .on("pointerleave", () => {
            state.hoveredId = null;
            hideTooltip();
            render();
        })
        .on("click", event => {
            if (suppressClick) {
                suppressClick = false;
                return;
            }
            const house = houseAt(event);
            // Reclicking pinned house or empty space unselects it
            state.clickedId = house && house.id !== state.clickedId ? house.id : null;
            render();
        });

    // Zoom and pan
    // Scroll ALWAYS zooms; dragging pans only in Pan mode
    const zoom = d3.zoom()
        .scaleExtent(ZOOM_LIMITS)
        .translateExtent([[0, 0], [WIDTH, HEIGHT]])
        .filter(event => event.type === "wheel" ||
                         (state.mode === "pan" && event.type === "mousedown" && event.button === 0))
        .on("zoom", event => {
            state.transform = event.transform;
            dotLayer.attr("transform", event.transform); // transform group, NOT SVG
            hideTooltip();
            render();
        });

    overlay.call(zoom);

    //  Buttons and keyboard
    function setMode(mode) {
        state.mode = mode;
        d3.select("#mode-lasso").classed("active", mode === "lasso");
        d3.select("#mode-pan").classed("active", mode === "pan");
        overlay.style("cursor", mode === "pan" ? "grab" : "crosshair");
    }

    function eraseSelection() {
        state.lassoIds = null;
        state.selectionSource = null;
        state.clickedId = null;
        lassoPath.interrupt().attr("d", null).attr("opacity", 1); // also cancels a fade in progress
        render();
    }

    d3.select("#mode-lasso").on("click", () => setMode("lasso"));
    d3.select("#mode-pan").on("click", () => setMode("pan"));
    d3.select("#erase-btn").on("click", eraseSelection);
    d3.select("#reset-zoom").on("click", () => {
        overlay.transition() // smooth reset from Lab 4
            .duration(600)
            .ease(d3.easeCubicOut)
            .call(zoom.transform, d3.zoomIdentity);
    });

    d3.select(window).on("keydown", event => {
        if (event.key === "Escape") eraseSelection();
    });

    setMode("lasso");

    // Restyle every dot from shared state
    function render() {
        const k = state.transform.k; // dots remain same size onscreen
        const isActive = d => d.id === state.hoveredId || d.id === state.clickedId;
        const inLasso = d => !state.lassoIds || state.lassoIds.has(d.id);
        const isLassoed = d => state.lassoIds !== null && state.lassoIds.has(d.id);

        dots.attr("fill", d => isActive(d) || isLassoed(d) ? COLORS.pink : COLORS.blue)
            .attr("fill-opacity", d => isActive(d) ? 1 : inLasso(d) ? 0.75 : FADED_OPACITY)
            .attr("r", d => (isActive(d) ? RADIUS_ACTIVE : RADIUS) / k);

        // Draw pink dots on top --> neighbors are never covered
        dots.filter(isActive).raise();

        placeLandmarks();

        if (state.lassoIds) {
            const selected = houses.filter(d => state.lassoIds.has(d.id));
            statusEl.text(selected.length
                ? `Average price ${fmtPrice(d3.mean(selected, d => d.price))} • ` +
                  `Average age ${Math.round(d3.mean(selected, d => 2016 - d.yearBuilt))} years • ` +
                  `${fmtInt(selected.length)} of ${fmtInt(houses.length)} houses selected`
                : "No houses in this selection");
        } else {
            statusEl.text(`${fmtInt(houses.length)} houses`);
        }
        d3.select("#erase-btn").property("disabled", !state.lassoIds && !state.clickedId);

        decade.update(state);
        ocean.update(state);
        feature.update(state);
        showDetails(byId.get(state.clickedId));
    }

    // Selection made in a smaller view (brush or bar click) replaces any lasso
    function selectFromView(source, ids) {
        if (ids) {
            state.lassoIds = ids;
            state.selectionSource = source;
            lassoPath.interrupt().attr("d", null).attr("opacity", 1);
        } else if (state.selectionSource === source) {
            state.lassoIds = null;
            state.selectionSource = null;
        }
        render();
    }

    // Hovering on house in inset view highlights it everywhere
    function hoverFromView(house, event) {
        const id = house ? house.id : null;
        if (id !== state.hoveredId) {
            state.hoveredId = id;
            render();
        }
        if (house) showTooltip(event, house);
        else hideTooltip();
    }

    // Clicking house in a smaller view pins that house like clicking it on map (click it or empty space to unpin)
    function pinFromView(house) {
        state.clickedId = house && house.id !== state.clickedId ? house.id : null;
        render();
    }

    // Age progression view: 
    const decade = createDecadeView(d3.select("#decade-view"), houses, {
        colors: COLORS,
        onSelect: ids => selectFromView("decade", ids),
        onBarHover: (html, event) => html ? showTooltipHtml(event, html) : hideTooltip(),
    });

    const ocean = createOceanView(d3.select("#ocean-view"), houses, {
        colors: COLORS,
        onBrush: ids => selectFromView("ocean", ids),
        onHover: hoverFromView,
        onPin: pinFromView,
    });

    const feature = createFeatureView(d3.select("#feature-view"), houses, {
        colors: COLORS,
        onSelect: ids => selectFromView("feature", ids),
        onHover: hoverFromView,
        onPin: pinFromView,
    });

    render();
}

// ── 7. Tooltip (Lab 2, section 7), flipped near the window edges ────────────
function showTooltip(event, d) {
    showTooltipHtml(event, `<strong>${fmtPrice(d.price)}</strong><br>
               ${fmtInt(d.area)} sq ft • built ${d.yearBuilt}<br>
               ${(d.oceanDist / 5280).toFixed(1)} mi to the ocean<br>
               ${fmtPrice(d.featVal)} in special features`);
}

// Shows any text in the tooltip (also used by the decade bars)
function showTooltipHtml(event, html) {
    tooltip.html(html).style("opacity", 1);

    const box = tooltip.node().getBoundingClientRect();
    const rightEdge = window.scrollX + window.innerWidth;
    const bottomEdge = window.scrollY + window.innerHeight;

    let left = event.pageX + 14;
    let top = event.pageY - 28;
    if (left + box.width > rightEdge - 8) left = event.pageX - box.width - 14;
    if (top + box.height > bottomEdge - 8) top = event.pageY - box.height - 14;

    tooltip.style("left", left + "px").style("top", top + "px");
}

function hideTooltip() {
    tooltip.style("opacity", 0);
}

// Clicked-house details (the water-distance line was removed with WATER_DIST)
function showDetails(d) {
    if (!d) {
        detailsEl.html("Click a house on the map.");
        return;
    }
    detailsEl.html(`
        <b>Sale price</b>${fmtPrice(d.price)}<br>
        <b>Living area</b>${fmtInt(d.area)} sq ft<br>
        <b>Year built</b>${d.yearBuilt}<br>
        <b>Distance to ocean</b>${(d.oceanDist / 5280).toFixed(1)} mi<br>
        <b>Special features</b>${fmtPrice(d.featVal)}<br>
        <b>Parcel no.</b>${d.id}<br>
        <b>Lat / lon</b>${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}
    `);
}