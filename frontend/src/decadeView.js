//Building age view — bar chart of houses by decade built

// NOTES:
// In-view interaction: hover over a bar for its counts
// Coordination: click bar to select every house built in that decade (click again to clear)
// The map and the other views highlight them
// Selected houses from any view are drawn as pink bars on top
// Hovering over a house anywhere fades all other decades so that house's decade stands out
// Bars use staggered transition (Lab 4)

import * as d3 from "d3";

const SALE_YEAR = 2016;
const MARGIN = { top: 10, right: 12, bottom: 34, left: 48 };

/** Builds the view inside `container`, returns { update(state) }
 *
 * options:
 * colors     { blue, pink }
 * onSelect   (ids | null) => {} (houses in the clicked decade; null when cleared)
 * onBarHover (html | null, event) => {} (tooltip text for hovered bar)
 */
export function createDecadeView(container, houses, { colors, onSelect, onBarHover }) {
    const box = container.node().getBoundingClientRect();
    const width = Math.max(320, Math.round(box.width));
    const height = Math.max(180, Math.round(box.height));
    const innerW = width - MARGIN.left - MARGIN.right;
    const innerH = height - MARGIN.top - MARGIN.bottom;

    const svg = container.append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("width", "100%")
        .attr("height", "100%");

    const plot = svg.append("g")
        .attr("transform", `translate(${MARGIN.left},${MARGIN.top})`);

    // Group houses by decade chronologically ─────
    const decadeOf = d => Math.floor(d.yearBuilt / 10) * 10;
    const [first, last] = d3.extent(houses, decadeOf);
    const decades = d3.range(first, last + 10, 10);
    const idsByDecade = d3.group(houses, decadeOf);
    const bars = decades.map(decade => ({
        decade,
        ids: (idsByDecade.get(decade) || []).map(d => d.id),
    }));
    const decadeById = new Map(houses.map(d => [d.id, decadeOf(d)]));

    // Scales (never rescaled when selection changes)
    const x = d3.scaleBand()
        .domain(decades)
        .range([0, innerW])
        .padding(0.15);

    const y = d3.scaleLinear()
        .domain([0, d3.max(bars, b => b.ids.length)]).nice()
        .range([innerH, 0]);

    // Gridlines/axes
    plot.append("g")
        .attr("class", "grid")
        .call(d3.axisLeft(y).ticks(4).tickSize(-innerW).tickFormat(""));

    // Show every decade label if there is room, otherwise every other one
    const labelEvery = x.bandwidth() < 30 ? 2 : 1;
    plot.append("g")
        .attr("class", "axis")
        .attr("transform", `translate(0,${innerH})`)
        .call(d3.axisBottom(x)
            .tickValues(decades.filter((_, i) => i % labelEvery === 0))
            .tickFormat(d => `${d}s`));

    plot.append("g")
        .attr("class", "axis")
        .call(d3.axisLeft(y).ticks(4).tickFormat(d3.format(",")));

    plot.append("text")
        .attr("class", "axis-label")
        .attr("x", innerW / 2)
        .attr("y", innerH + 30)
        .attr("text-anchor", "middle")
        .text("Decade built");

    plot.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerH / 2)
        .attr("y", -38)
        .attr("text-anchor", "middle")
        .text("Houses");

    // Bars (blue = all houses; pink overlay = selected houses)
    const baseBars = plot.append("g")
        .selectAll("rect")
        .data(bars, b => b.decade)
        .join("rect")
        .attr("class", "bar")
        .attr("x", b => x(b.decade))
        .attr("width", x.bandwidth())
        .attr("y", innerH) // starts flat for animation
        .attr("height", 0)
        .attr("fill", colors.blue)
        .attr("fill-opacity", 0.75);

    const selectedBars = plot.append("g")
        .selectAll("rect")
        .data(bars, b => b.decade)
        .join("rect")
        .attr("x", b => x(b.decade))
        .attr("width", x.bandwidth())
        .attr("y", innerH)
        .attr("height", 0)
        .attr("fill", colors.pink)
        .attr("pointer-events", "none");

    // Lab 4: bars grow from the axis, left to right
    baseBars.transition()
        .duration(600)
        .delay((_, i) => i * 40)
        .ease(d3.easeCubicOut)
        .attr("y", b => y(b.ids.length))
        .attr("height", b => innerH - y(b.ids.length));

    // Hover/click 
    let activeDecade = null; // decade view selected
    let currentSelection = null; // latest shared selection (tooltip)

    baseBars
        .on("pointermove", (event, b) => {
            let html = `<strong>${b.decade}s</strong><br>${d3.format(",")(b.ids.length)} houses`;
            if (currentSelection) {
                const n = b.ids.filter(id => currentSelection.has(id)).length;
                html += `<br>${d3.format(",")(n)} selected`;
            }
            onBarHover(html, event);
        })
        .on("pointerleave", event => onBarHover(null, event))
        .on("click", (event, b) => {
            if (activeDecade === b.decade) { // second click unselects
                activeDecade = null;
                onSelect(null);
            } else {
                activeDecade = b.decade;
                onSelect(new Set(b.ids));
            }
        });

    // Restyle from shared state (called by main.js render)
    let lastSelection;
    let lastHoveredDecade; // decade of house hovered at the last update

    function update(state) {
        const selection = state.lassoIds;
        currentSelection = selection;

        // Other view took over the selection --> bar is no longer selected
        if (state.selectionSource !== "decade") activeDecade = null;

        // Outline bar of active decade and hovered/clicked house
        const hoveredDecade = decadeById.get(state.hoveredId);
        const focusDecade = hoveredDecade ?? decadeById.get(state.clickedId);
        baseBars
            .attr("stroke", b =>
                b.decade === activeDecade ? colors.pink :
                b.decade === focusDecade ? "#2b2b2b" : null)
            .attr("stroke-width", 1.5);

        // Hovering over house (fade every other decade --> decade stands out)
        // Moving off house brings all bars back
        const restOpacity = selection ? 0.25 : 0.75; // standard bar opacity
        if (hoveredDecade !== undefined) {
            baseBars.interrupt("fade")
                .attr("fill-opacity", b => b.decade === hoveredDecade ? 0.9 : 0.12);
            selectedBars.attr("fill-opacity", b => b.decade === hoveredDecade ? 1 : 0.25);
        } else if (lastHoveredDecade !== undefined) {
            baseBars.attr("fill-opacity", restOpacity);
            selectedBars.attr("fill-opacity", 1);
        }
        lastHoveredDecade = hoveredDecade;

        // Redraw pink overlay ONLY when selection changes
        if (selection === lastSelection) return;
        lastSelection = selection;

        if (hoveredDecade === undefined) {
            baseBars.transition("fade")
                .duration(300)
                .attr("fill-opacity", restOpacity);
        }

        selectedBars.transition()
            .duration(300)
            .ease(d3.easeCubicOut)
            .attr("y", b => y(selection ? b.ids.filter(id => selection.has(id)).length : 0))
            .attr("height", b =>
                innerH - y(selection ? b.ids.filter(id => selection.has(id)).length : 0));
    }

    return { update };
}