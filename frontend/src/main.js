// ════════════════════════════════════════════════════════════════════════════
//  Miami-Dade houses — interactive map prototype
//  Plain HTML + D3 v7, same setup as Lab 2. Open index.html with Live Server.
// ════════════════════════════════════════════════════════════════════════════

import * as d3 from "d3";
import "./style.css";

// ── 0. Palette ──────────────────────────────────────────────────────────────
const COLORS = {
    blue: "#41b6e6",   // standard house
    pink: "#db3eb1",   // hovered / clicked house
    gray: "#d0d0d0",   // reserved for later (e.g. houses outside a selection) — not applied yet
};

// ── 1. Settings ─────────────────────────────────────────────────────────────
// Path is relative to this folder. Once the Flask backend is running, swap this
// for the API, e.g. "http://127.0.0.1:5001/api/houses" (and d3.json instead of d3.csv).
const DATA_URL = "http://127.0.0.1:5001/api/houses";

const WIDTH = 620;
const HEIGHT = 760;
const PADDING = 24;        // space between the outermost houses and the SVG edge
const RADIUS = 2.5;        // normal dot
const RADIUS_ACTIVE = 6;   // hovered / clicked dot
const HIT_RADIUS = 10;     // how close (px) the pointer must be to "hit" a house
const FADED_OPACITY = 0.15;  // houses outside the lasso (gray comes later)
const LASSO_MIN_MOVE = 5;    // px the pointer must travel before a drag counts as a lasso
const ZOOM_LIMITS = [1, 12]; // min / max zoom factor

const fmtPrice = d3.format("$,.0f");
const fmtInt = d3.format(",.0f");

// ── 2. SVG canvas (Lab 2, section 4) ────────────────────────────────────────
const svg = d3.select("#map-container")
    .append("svg")
    .attr("width", WIDTH)
    .attr("height", HEIGHT);

svg.append("rect")
    .attr("class", "map-bg")
    .attr("width", WIDTH)
    .attr("height", HEIGHT);

const dotLayer = svg.append("g").attr("class", "houses");

const tooltip = d3.select("#tooltip");
const statusEl = d3.select("#status");
const detailsEl = d3.select("#details");

// ── 3. Shared state — the one source of truth every update reads ────────────
const state = {
    hoveredId: null,
    clickedId: null,
    lassoIds: null,              // Set of lassoed house ids, or null when nothing is lassoed
    mode: "lasso",               // what a drag does: "lasso" or "pan"
    transform: d3.zoomIdentity,  // current zoom and pan
};

// ── 4. Load the data ────────────────────────────────────────────────────────
// The row function converts text to numbers but keeps PARCELNO as a string,
// so IDs match exactly (A1 hint). Works with the saved sample or the full CSV.
d3.json(DATA_URL).then(rows => rows.map(row => ({
    id: row.PARCELNO,
    lat: +row.LATITUDE,
    lon: +row.LONGITUDE,
    price: +row.SALE_PRC,
    area: +row.TOT_LVG_AREA,
    yearBuilt: row.year_built ? +row.year_built : 2016 - +row.age,
    waterDist: +row.WATER_DIST,
    oceanDist: +row.OCEAN_DIST,
})))
    .then(drawMap)
    .catch(error => {
        console.error(error);
        statusEl.text(`Could not load ${DATA_URL}. Check that the file exists and that ` +
                      `you opened the page with Live Server, not by double-clicking it.`);
    });

// ── 5. Draw the map ─────────────────────────────────────────────────────────
function drawMap(houses) {
    // Projection: Mercator, fitted so every house fits inside the padded canvas.
    // D3 takes [longitude, latitude] — the opposite order from Folium.
    const projection = d3.geoMercator().fitExtent(
        [[PADDING, PADDING], [WIDTH - PADDING, HEIGHT - PADDING]],
        { type: "MultiPoint", coordinates: houses.map(d => [d.lon, d.lat]) }
    );

    // Project every house once and keep its pixel position on the record
    houses.forEach(d => {
        [d.x, d.y] = projection([d.lon, d.lat]);
    });

    // Lookup table: id -> house record
    const byId = new Map(houses.map(d => [d.id, d]));

    // One circle per house; the key function keeps identity stable (A2 hint)
    const dots = dotLayer.selectAll("circle")
        .data(houses, d => d.id)
        .join("circle")
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
        .attr("r", RADIUS)
        .attr("fill", COLORS.blue)
        .attr("fill-opacity", 0.75)
        .attr("pointer-events", "none");   // the overlay below handles the mouse

    // Nearest-house finder: easier to hit than 2.5 px circles
    const delaunay = d3.Delaunay.from(houses, d => d.x, d => d.y);

    // Lasso outline. It lives inside the zoomed layer, in map coordinates, so it
    // stays on the right houses when you zoom or pan afterwards.
    const lassoPath = dotLayer.append("path").attr("class", "lasso");
    let lassoPoints = null;     // map-coordinate points while drawing; null otherwise
    let suppressClick = false;  // the click that ends a lasso drag is not a real click

    // Pointer position converted back to un-zoomed map coordinates
    function mapPoint(event) {
        return state.transform.invert(d3.pointer(event, svg.node()));
    }

    function houseAt(event) {
        const [mx, my] = mapPoint(event);
        const nearest = houses[delaunay.find(mx, my)];
        // distance in screen pixels, so the hit area feels the same at any zoom
        const distance = Math.hypot(nearest.x - mx, nearest.y - my) * state.transform.k;
        return distance <= HIT_RADIUS ? nearest : null;
    }

    // Transparent overlay on top of the dots catches every pointer event
    const overlay = svg.append("rect")
        .attr("class", "overlay")
        .attr("width", WIDTH)
        .attr("height", HEIGHT)
        .on("pointerdown", event => {
            if (state.mode !== "lasso" || event.button !== 0) return;
            lassoPath.interrupt().attr("opacity", 1);           // cancel a fade still running
            lassoPoints = [mapPoint(event)];
            overlay.node().setPointerCapture(event.pointerId);  // keep events if the drag leaves the map
        })
        .on("pointermove", event => {
            if (lassoPoints) {                                  // drawing a lasso (Lab 3, section 3)
                lassoPoints.push(mapPoint(event));
                lassoPath.attr("d", d3.line()(lassoPoints) + "Z");
                hideTooltip();
                return;
            }
            const house = houseAt(event);                       // otherwise: hover
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

                // Like Lab 3: the outline goes away after 1 second.
                // Like Lab 4: it fades out with a transition instead of vanishing.
                lassoPath.transition()
                    .delay(0)
                    .duration(400)
                    .ease(d3.easeCubicOut)
                    .attr("opacity", 0)
                    .on("end", () => lassoPath.attr("d", null).attr("opacity", 1));
            } else {
                lassoPath.attr("d", null);   // too short to be a lasso: treat it as a click
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
            // Clicking the pinned house again, or empty space, unpins it
            state.clickedId = house && house.id !== state.clickedId ? house.id : null;
            render();
        });

    // ── Zoom and pan (Lab 3, section 4) ─────────────────────────────────────
    // Scroll always zooms. Dragging pans only in Pan mode; in Lasso mode it draws.
    const zoom = d3.zoom()
        .scaleExtent(ZOOM_LIMITS)
        .translateExtent([[0, 0], [WIDTH, HEIGHT]])
        .filter(event => event.type === "wheel" ||
                         (state.mode === "pan" && event.type === "mousedown" && event.button === 0))
        .on("zoom", event => {
            state.transform = event.transform;
            dotLayer.attr("transform", event.transform);  // transform the group, never the SVG (A1 Task 6.4)
            hideTooltip();
            render();
        });

    overlay.call(zoom);

    // ── Buttons and keyboard ────────────────────────────────────────────────
    function setMode(mode) {
        state.mode = mode;
        d3.select("#mode-lasso").classed("active", mode === "lasso");
        d3.select("#mode-pan").classed("active", mode === "pan");
        overlay.style("cursor", mode === "pan" ? "grab" : "crosshair");
    }

    function eraseSelection() {
        state.lassoIds = null;
        state.clickedId = null;
        lassoPolygon = null;
        render();
    }

    d3.select("#mode-lasso").on("click", () => setMode("lasso"));
    d3.select("#mode-pan").on("click", () => setMode("pan"));
    d3.select("#erase-btn").on("click", eraseSelection);
    d3.select("#reset-zoom").on("click", () => {
        overlay.transition()                 // smooth reset (Lab 4 transitions)
            .duration(600)
            .ease(d3.easeCubicOut)
            .call(zoom.transform, d3.zoomIdentity);
    });

    d3.select(window).on("keydown", event => {
        if (event.key === "Escape") eraseSelection();
    });

    setMode("lasso");

    // ── 6. Render: restyle every dot from the shared state ──────────────────
    function render() {
        const k = state.transform.k;   // divide sizes by the zoom so dots stay the same size on screen
        const isActive = d => d.id === state.hoveredId || d.id === state.clickedId;
        const inLasso = d => !state.lassoIds || state.lassoIds.has(d.id);
        const isLassoed = d => state.lassoIds !== null && state.lassoIds.has(d.id);

        dots.attr("fill", d => isActive(d) || isLassoed(d) ? COLORS.pink : COLORS.blue)
            .attr("fill-opacity", d => isActive(d) ? 1 : inLasso(d) ? 0.75 : FADED_OPACITY)
            .attr("r", d => (isActive(d) ? RADIUS_ACTIVE : RADIUS) / k);

        // Draw pink dots on top so neighbours never cover them
        dots.filter(isActive).raise();

        statusEl.text(state.lassoIds
            ? `${fmtInt(state.lassoIds.size)} of ${fmtInt(houses.length)} houses selected`
            : `${fmtInt(houses.length)} houses`);
        d3.select("#erase-btn").property("disabled", !state.lassoIds && !state.clickedId);

        showDetails(byId.get(state.clickedId));
    }

    render();
}

// ── 7. Tooltip (Lab 2, section 7), flipped near the window edges ────────────
function showTooltip(event, d) {
    tooltip
        .html(`<strong>${fmtPrice(d.price)}</strong><br>
               ${fmtInt(d.area)} sq ft · built ${d.yearBuilt}<br>
               ${fmtInt(d.waterDist)} ft to water`)
        .style("opacity", 1);

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

// // ── 8. Details panel for the clicked house ──────────────────────────────────
// function showDetails(d) {
//     if (!d) {
//         detailsEl.html("Click a house on the map.");
//         return;
//     }
//     detailsEl.html(`
//         <b>Sale price</b>${fmtPrice(d.price)}<br>
//         <b>Living area</b>${fmtInt(d.area)} sq ft<br>
//         <b>Year built</b>${d.yearBuilt}<br>
//         <b>Distance to water</b>${fmtInt(d.waterDist)} ft<br>
//         <b>Distance to ocean</b>${fmtInt(d.oceanDist)} ft<br>
//         <b>Parcel no.</b>${d.id}<br>
//         <b>Lat / lon</b>${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}
//     `);
// }