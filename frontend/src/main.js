// Assignment #2: Miami housing prices

import * as d3 from "d3";
import "./style.css";

// Color palette 
const COLORS = {
    blue: "#41b6e6", // standard house
    pink: "#db3eb1", // selected house
    gray: "#d0d0d0", // reserved for later (e.g. houses outside a selection) — not applied yet
};

// Backend path
const DATA_URL = "http://127.0.0.1:5001/api/houses";

const WIDTH = 620;
const HEIGHT = 760;
const PADDING = 24; // space between the outermost houses and SVG edge
const RADIUS = 2.5; // standard dot
const RADIUS_ACTIVE = 6; // hovered vs. clicked dot
const HIT_RADIUS = 10; // how close pointer must be to select a house
const FADED_OPACITY = 0.15; // houses outside the lasso
const LASSO_MIN_MOVE = 5; // distance pointer has to travel before a drag counts as a lasso
const ZOOM_LIMITS = [1, 12]; // zoom factor

const fmtPrice = d3.format("$,.0f");
const fmtInt = d3.format(",.0f");

// SVG canvas
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

// Shared state
const state = {
    hoveredId: null,
    clickedId: null,
    lassoIds: null, // Set of lassoed house ids or null when nothing lassoed
    mode: "lasso", // Differentiates what a drag does (i.e. lasso vs pan)
    transform: d3.zoomIdentity, // Current zoom and pan
};

// Load data

// Keeps PARCELNO as a string; works with the saved sample or the full CSV.
d3.json(DATA_URL).then(rows => rows.map(row => ({
    id: row.PARCELNO,
    lat: +row.LATITUDE,
    lon: +row.LONGITUDE,
    price: +row.SALE_PRC,
    area: +row.TOT_LVG_AREA,
    yearBuilt: row.year_built ? +row.year_built : 2016 - +row.age,
    oceanDist: +row.OCEAN_DIST,
})))
    .then(drawMap)
    .catch(error => {
        console.error(error);
        statusEl.text(`Could not load ${DATA_URL}. Check that the file exists and that ` +
                      `you opened the page with Live Server, not by double-clicking it.`);
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
        state.clickedId = null;
        lassoPolygon = null;
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

    // Restyle every dot from the shared state ──────────────────
    function render() {
        const k = state.transform.k;   //  dots stay same size onscreen
        const isActive = d => d.id === state.hoveredId || d.id === state.clickedId;
        const inLasso = d => !state.lassoIds || state.lassoIds.has(d.id);
        const isLassoed = d => state.lassoIds !== null && state.lassoIds.has(d.id);

        dots.attr("fill", d => isActive(d) || isLassoed(d) ? COLORS.pink : COLORS.blue)
            .attr("fill-opacity", d => isActive(d) ? 1 : inLasso(d) ? 0.75 : FADED_OPACITY)
            .attr("r", d => (isActive(d) ? RADIUS_ACTIVE : RADIUS) / k);

        // Draw pink dots on top so neighbors are never covered
        dots.filter(isActive).raise();

        if (state.lassoIds) {
            const selected = houses.filter(d => state.lassoIds.has(d.id));
            statusEl.text(selected.length
                ? `Average price ${fmtPrice(d3.mean(selected, d => d.price))} • ` +
                  `${fmtInt(selected.length)} of ${fmtInt(houses.length)} houses selected`
                : "No houses inside this lasso");
        } else {
            statusEl.text(`${fmtInt(houses.length)} houses`);
        }
        d3.select("#erase-btn").property("disabled", !state.lassoIds && !state.clickedId);

        showDetails(byId.get(state.clickedId));
    }

    render();
}

// ── 7. Tooltip (Lab 2, section 7), flipped near the window edges ────────────
function showTooltip(event, d) {
    tooltip
        .html(`<strong>${fmtPrice(d.price)}</strong><br>
               ${fmtInt(d.area)} sq ft • built ${d.yearBuilt}<br>
               ${fmtInt(d.oceanDist)} ft to the ocean`)
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

// Left over house details from defunct scaffolding

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