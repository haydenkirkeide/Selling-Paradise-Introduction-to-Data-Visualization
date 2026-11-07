// Ocean proximity view: scatterplot of distance to ocean (x) vs. sale price (y)

// NOTES:
// In-view interaction: hover over house for details (house also turns pink on map)
// Click dot to pin it
// Coordination: drag across the chart to brush a distance range (Lab 3)
// Brushed houses become the dashboard's selection
// Also highlights whatever is selected elsewhere (lasso, other views)

import * as d3 from "d3";

const FT_PER_MILE = 5280;
const MARGIN = { top: 12, right: 18, bottom: 42, left: 62 };
const RADIUS = 2;
const RADIUS_ACTIVE = 5;
const HIT_RADIUS = 8; // how close the pointer must be to hover over dot

const fmtAxisPrice = v => v >= 1e6 ? `$${v / 1e6}M` : `$${v / 1e3}k`;

/** Builds the view inside `container`, returns { update(state) }
 *
 * options:
 * colors   { blue, pink } (shared palette from main.js)
 * onBrush  (ids | null) => {} (brushed range = Set of house ids; null when cleared)
 * onHover  (house | null, event) => {}
 * onPin    (house | null) => {} (click on dot pins it; empty space unpins)
 */
export function createOceanView(container, houses, { colors, onBrush, onHover, onPin }) {
    // Size (measured once from the panel; the viewBox scales it afterwards)
    const box = container.node().getBoundingClientRect();
    const width = Math.max(320, Math.round(box.width));
    const height = Math.max(200, Math.round(box.height));
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", "100%")
        .attr("height", "100%");

    const plot = svg.append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // Scaleing (fixed: they never rescale when a selection changes)
    const miles = d => d.oceanDist / FT_PER_MILE;

    const x = d3.scaleLinear()
        .domain([0, d3.max(houses, miles)]).nice()
        .range([0, innerW]);

    // Log scale: a few $2M+ sales would otherwise squash everyone else
    const y = d3.scaleLog()
        .domain(d3.extent(houses, d => d.price)) // exact price range (no wasted space)
        .range([innerH, 0]);

    // Gridlines/axes
    const priceTicks = [100e3, 200e3, 500e3, 1e6, 2e6]
        .filter(v => v >= y.domain()[0] && v <= y.domain()[1]);

    plot.append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(y).tickValues(priceTicks).tickSize(-innerW).tickFormat(""));

    plot.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).ticks(6));

    plot.append("g")
        .attr("class", "axis")
        .call(d3.axisLeft(y).tickValues(priceTicks).tickFormat(fmtAxisPrice));

    plot.append("text")
        .attr("class", "axis-label")
        .attr("x", innerW / 2)
        .attr("y", innerH + 34)
        .attr("text-anchor", "middle")
        .text("Distance to ocean (miles)");

    plot.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -48)
        .attr("text-anchor", "middle")
        .text("Sale price (log scale)");

    // Dots (houses)
    const dots = plot.append("g")
        .selectAll("circle")
        .data(houses, d => d.id)
        .join("circle")
        .attr("cx", d => x(miles(d)))
        .attr("cy", d => y(d.price))
        .attr("r", RADIUS)
        .attr("fill", colors.blue)
        .attr("fill-opacity", 0.45)
        .attr("pointer-events", "none");

    // Brush on distance axis (Lab 3)
    const brush = d3.brushX()
        .extent([[0, 0], [innerW, innerH]])
        .on("brush end", event => {
            if (!event.sourceEvent) return; // ignore brush moves made by code
            if (!event.selection) { // click w/o dragging:
                onBrush(null); // clears brush
                onPin(houseAt(d3.pointer(event.sourceEvent, plot.node()))); // pins clicked house
                return;
            }
            const [m0, m1] = event.selection.map(x.invert);
            onBrush(new Set(
                houses.filter(d => miles(d) >= m0 && miles(d) <= m1).map(d => d.id)
            ));
        });

    const brushLayer = plot.append("g")
        .attr("class", "brush")
        .call(brush);

    // Hover: (nearest dot to pointer; works on top of brush)
    const delaunay = d3.Delaunay.from(houses, d => x(miles(d)), d => y(d.price));

    // House under pointer (null if no dot is close enough)
    function houseAt([mx, my]) {
        const inside = mx >= 0 && mx <= innerW && my >= 0 && my <= innerH;
        if (!inside) return null;
        const nearest = houses[delaunay.find(mx, my)];
        const close = Math.hypot(x(miles(nearest)) - mx, y(nearest.price) - my) <= HIT_RADIUS;
        return close ? nearest : null;
    }

    svg.on("pointermove", event => {
        onHover(houseAt(d3.pointer(event, plot.node())), event);
    });
    svg.on("pointerleave", event => onHover(null, event));

    // Restyle from shared state (called by main.js render)
    let lastSelection;

    function update(state) {
        const selection = state.lassoIds;
        const isActive = d => d.id === state.hoveredId || d.id === state.clickedId;
        const isSelected = d => selection !== null && selection.has(d.id);

        dots.attr("fill", d => isActive(d) || isSelected(d) ? colors.pink : colors.blue)
            .attr("fill-opacity", d =>
                isActive(d) ? 1 : selection ? (isSelected(d) ? 0.8 : 0.08) : 0.45)
            .attr("r", d => isActive(d) ? RADIUS_ACTIVE : RADIUS);

        // Bring dots forward only when selection changes (cheap hovers)
        if (selection !== lastSelection) {
            dots.filter(isSelected).raise();
            lastSelection = selection;
        }
        dots.filter(isActive).raise();

        // One selection at a time (something else now owns the selection --> delete view's brush rectangle)
        if (state.selectionSource !== "ocean" && d3.brushSelection(brushLayer.node())) {
            brushLayer.call(brush.move, null);
        }
    }

    return { update };
}