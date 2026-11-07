// Special features view: scatterplot of special features as a % of the sale; price (x) vs. sale price (y), circle size = living area

// NOTES:
// Houses w/ $0 in special features sit in "None" strip on the left (don't pile up on a single line)
// In-view interaction: hover over a dot for details (house also turns pink on the map); click dot to pin it
// Coordination: drag a lasso around dots (Lab 3) to select houses in all views
// Also highlights whatever is selected elsewhere (map lasso, ocean brush, decade bar)

import * as d3 from "d3";

const MARGIN = { top: 10, right: 16, bottom: 40, left: 62 };
const STRIP_W = 34; // width of "None" strip (px)
const STRIP_GAP = 12; // space between strip and main plot
const HIT_RADIUS = 7; // minimum hover distance
const LASSO_MIN_MOVE = 5; // px pointer must travel before drag = lasso

const fmtAxisPrice = v => v >= 1e6 ? `$${v / 1e6}M` : `$${v / 1e3}k`;
const fmtPct = v => `${v}%`;

/** Builds view inside `container`, returns { update(state) }
 *
 * options:
 * colors   { blue, pink }
 * onSelect (ids | null) => {} (lassoed houses; null when cleared)
 * onHover  (house | null, event) => {}
 * onPin    (house | null) => {} (click on dot pins it; on empty space unpins)
 */
export function createFeatureView(container, houses, { colors, onSelect, onHover, onPin }) {
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

    // Data calculation: share of price + which houses have no features
    const share = d => 100 * d.featVal / d.price;
    const withFeatures = houses.filter(d => d.featVal > 0);

    // Scaling
    // Log x: most houses' features are ~1% of the price, a few are much more
    const x = d3.scaleLog()
        .domain(d3.extent(withFeatures, share))
        .range([STRIP_W + STRIP_GAP, innerW]);

    const y = d3.scaleLog()
        .domain(d3.extent(houses, d => d.price))
        .range([innerH, 0]);

    // Circle AREA proportional to living area
    const r = d3.scaleSqrt()
        .domain(d3.extent(houses, d => d.area))
        .range([2, 8]);

    // Fixed random sideways spread inside the "None" strip (seeded = same every load)
    const jitter = d3.randomUniform.source(d3.randomLcg(0.81))(4, STRIP_W - 4);
    houses.forEach(d => {
        d.fx = d.featVal > 0 ? x(share(d)) : jitter();
        d.fy = y(d.price);
    });

    // Gridlines ("None" strip and axes)
    const priceTicks = [100e3, 200e3, 500e3, 1e6, 2e6]
        .filter(v => v >= y.domain()[0] && v <= y.domain()[1]);
    const shareTicks = [0.01, 0.1, 1, 10, 100]
        .filter(v => v >= x.domain()[0] && v <= x.domain()[1]);

    plot.append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(y).tickValues(priceTicks).tickSize(-innerW).tickFormat(""));

    plot.append("rect")
        .attr("class", "none-strip")
        .attr("width", STRIP_W)
        .attr("height", innerH);

    plot.append("text")
        .attr("class", "axis-label")
        .attr("x", STRIP_W / 2)
        .attr("y", innerH + 15)
        .attr("text-anchor", "middle")
        .text("None");

    plot.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x).tickValues(shareTicks).tickFormat(fmtPct));

    plot.append("g")
        .attr("class", "axis")
        .call(d3.axisLeft(y).tickValues(priceTicks).tickFormat(fmtAxisPrice));

    plot.append("text")
        .attr("class", "axis-label")
        .attr("x", (STRIP_W + STRIP_GAP + innerW) / 2)
        .attr("y", innerH + 34)
        .attr("text-anchor", "middle")
        .text("Special features as % of sale price (log scale)");

    plot.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -48)
        .attr("text-anchor", "middle")
        .text("Sale price (log scale)");

    // Houses (dots; big houses drawn first so small ones stay visible on top)
    const dots = plot.append("g")
        .selectAll("circle")
        .data(houses.slice().sort((a, b) => b.area - a.area), d => d.id)
        .join("circle")
        .attr("cx", d => d.fx)
        .attr("cy", d => d.fy)
        .attr("r", d => r(d.area))
        .attr("fill", colors.blue)
        .attr("fill-opacity", 0.35)
        .attr("pointer-events", "none");

    // Lasso outline (drawn above dots)
    const lassoPath = plot.append("path").attr("class", "lasso");
    let lassoPoints = null; // plot-coordinate points while drawing; null otherwise

    // Transparent overlay over plot catches mouse
    const delaunay = d3.Delaunay.from(houses, d => d.fx, d => d.fy);

    // House under the pointer (null if no dot is close enough)
    function houseAt([mx, my]) {
        const nearest = houses[delaunay.find(mx, my)];
        const close = Math.hypot(nearest.fx - mx, nearest.fy - my) <=
            Math.max(HIT_RADIUS, r(nearest.area));
        return close ? nearest : null;
    }

    const overlay = plot.append("rect")
        .attr("class", "overlay")
        .attr("width", innerW)
        .attr("height", innerH)
        .on("pointerdown", event => {
            if (event.button !== 0) return;
            lassoPath.interrupt().attr("opacity", 1); // cancel a fade still running
            lassoPoints = [d3.pointer(event, plot.node())];
            overlay.node().setPointerCapture(event.pointerId); // keep events if the drag leaves
        })
        .on("pointermove", event => {
            const [mx, my] = d3.pointer(event, plot.node());
            if (lassoPoints) {  // lasso (Lab 3)
                lassoPoints.push([mx, my]);
                lassoPath.attr("d", d3.line()(lassoPoints) + "Z");
                onHover(null, event);
                return;
            }
            onHover(houseAt([mx, my]), event);// hover otherwise
        })
        .on("pointerup", () => {
            if (!lassoPoints) return;
            const [x0, y0] = lassoPoints[0];
            const moved = d3.max(lassoPoints, ([px, py]) => Math.hypot(px - x0, py - y0));

            if (moved >= LASSO_MIN_MOVE) {
                const polygon = lassoPoints;
                onSelect(new Set(
                    houses.filter(d => d3.polygonContains(polygon, [d.fx, d.fy])).map(d => d.id)
                ));
                // Outline fades out right after selection (Labs 3 and 4)
                lassoPath.transition()
                    .duration(400)
                    .ease(d3.easeCubicOut)
                    .attr("opacity", 0)
                    .on("end", () => lassoPath.attr("d", null).attr("opacity", 1));
            } else {
                // Click not a lasso --> pins house under pointer
                // Clicking empty space unpins/clears lasso selection
                lassoPath.attr("d", null);
                const house = houseAt(lassoPoints[0]);
                if (!house) onSelect(null);
                onPin(house);
            }
            lassoPoints = null;
        })
        .on("pointerleave", event => {
            if (!lassoPoints) onHover(null, event);
        });

    // Restyle from shared state (called by main.js render)
    let lastSelection;

    function update(state) {
        const selection = state.lassoIds;
        const isActive = d => d.id === state.hoveredId || d.id === state.clickedId;
        const isSelected = d => selection !== null && selection.has(d.id);

        dots.attr("fill", d => isActive(d) || isSelected(d) ? colors.pink : colors.blue)
            .attr("fill-opacity", d =>
                isActive(d) ? 1 : selection ? (isSelected(d) ? 0.7 : 0.06) : 0.35)
            .attr("stroke", d => isActive(d) ? "#2b2b2b" : null);

        if (selection !== lastSelection) {
            dots.filter(isSelected).raise();
            lastSelection = selection;
        }
        dots.filter(isActive).raise();
    }

    return { update };
}