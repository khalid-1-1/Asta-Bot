// dashboard/public/charts.js
// -----------------------------------------------------------------------
// Stage 10 (Dashboard Redesign & Visualization) - tiny, dependency-free
// SVG chart renderer. No canvas, no chart library, no CDN: everything the
// Dashboard visualizes is built as plain inline SVG strings, in keeping
// with this project's own "no build step, no framework" convention
// (see dashboard/server.js's header comment, app.js's comment).
//
// Every function here is a pure renderer: it takes already-real data
// (numbers that came from an API response) and returns an SVG/HTML
// string. It never invents, smooths, or extrapolates data points - an
// empty series renders the shared "no data yet" empty state instead of a
// fabricated chart.
// -----------------------------------------------------------------------

const AstaCharts = (() => {
    const VB_W = 640; // fixed viewBox width; CSS scales it to the card's real width

    function esc(str) {
        return String(str ?? "").replace(/[&<>"']/g, (c) => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
        }[c]));
    }

    function niceMax(max) {
        if (max <= 0) return 4;
        const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
        const norm = max / magnitude;
        let step;
        if (norm <= 1) step = 1;
        else if (norm <= 2) step = 2;
        else if (norm <= 5) step = 5;
        else step = 10;
        return step * magnitude;
    }

    function emptyState(message) {
        return `<div class="state-box" style="padding:32px 16px;">
            <svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3v18h18M7 15l3.5-4.5 3 3L19 8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <div class="state-msg">${esc(message || "No data available yet.")}</div>
        </div>`;
    }

    function hasAnyData(series) {
        return series.some((s) => Array.isArray(s.data) && s.data.some((v) => typeof v === "number" && !Number.isNaN(v)));
    }

    /**
     * Multi-series line/area chart.
     * opts: { labels: string[], series: [{name, color, data:number[], area?:bool}], height, formatY }
     */
    function line(opts) {
        const { labels = [], series = [], height = 220, formatY } = opts;
        if (!series.length || !labels.length || !hasAnyData(series)) return emptyState(opts.emptyMessage);

        const padL = 34, padR = 12, padT = 14, padB = 26;
        const w = VB_W, h = height;
        const plotW = w - padL - padR;
        const plotH = h - padT - padB;

        const allVals = series.flatMap((s) => s.data || []).filter((v) => typeof v === "number");
        const rawMax = Math.max(0, ...allVals);
        const maxV = niceMax(rawMax || 1);
        const n = labels.length;
        const stepX = n > 1 ? plotW / (n - 1) : 0;

        const xAt = (i) => padL + stepX * i;
        const yAt = (v) => padT + plotH - (v / maxV) * plotH;

        const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
            const y = padT + plotH * (1 - f);
            const val = Math.round(maxV * f);
            return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border-soft)" stroke-width="1"/>
                    <text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="var(--muted-2)">${formatY ? esc(formatY(val)) : val}</text>`;
        }).join("");

        // Show at most ~7 x-axis labels to avoid crowding on mobile widths.
        const labelEvery = Math.max(1, Math.ceil(n / 7));
        const xLabels = labels.map((lab, i) => {
            if (i % labelEvery !== 0 && i !== n - 1) return "";
            return `<text x="${xAt(i)}" y="${h - 6}" text-anchor="middle" font-size="9.5" fill="var(--muted-2)">${esc(lab)}</text>`;
        }).join("");

        const seriesSvg = series.map((s) => {
            const data = s.data || [];
            const pts = data.map((v, i) => `${xAt(i)},${yAt(v || 0)}`).join(" ");
            const areaPath = s.area === false ? "" : `<polygon points="${pts} ${xAt(data.length - 1)},${yAt(0)} ${xAt(0)},${yAt(0)}" fill="url(#grad-${s.id})" opacity="0.5"/>`;
            const dots = data.map((v, i) => `<circle cx="${xAt(i)}" cy="${yAt(v || 0)}" r="2.6" fill="${s.color}" class="chart-dot"><title>${esc(s.name)}: ${esc(labels[i])} = ${v}</title></circle>`).join("");
            return `<defs>
                        <linearGradient id="grad-${s.id}" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="${s.color}" stop-opacity="0.45"/>
                            <stop offset="100%" stop-color="${s.color}" stop-opacity="0"/>
                        </linearGradient>
                    </defs>
                    ${areaPath}
                    <polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
                    ${dots}`;
        }).join("");

        return `<div class="chart-svg-wrap"><svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
            ${gridLines}
            ${seriesSvg}
            ${xLabels}
        </svg></div>`;
    }

    /**
     * Vertical bar chart. opts: { labels, series:[{name,color,data}], height, formatY, stacked }
     */
    function bar(opts) {
        const { labels = [], series = [], height = 220, formatY, horizontal = false } = opts;
        if (!series.length || !labels.length || !hasAnyData(series)) return emptyState(opts.emptyMessage);

        const padL = horizontal ? 92 : 34, padR = 12, padT = 10, padB = horizontal ? 10 : 30;
        const w = VB_W, h = Math.max(height, horizontal ? labels.length * 30 + 20 : height);
        const plotW = w - padL - padR;
        const plotH = h - padT - padB;
        const n = labels.length;
        const allVals = series.flatMap((s) => s.data || []);
        const maxV = niceMax(Math.max(0, ...allVals) || 1);

        if (horizontal) {
            const barH = Math.min(22, (plotH / n) - 10);
            const rows = labels.map((lab, i) => {
                const cy = padT + (plotH / n) * (i + 0.5);
                const val = series[0].data[i] || 0;
                const bw = (val / maxV) * plotW;
                return `<text x="${padL - 10}" y="${cy + 4}" text-anchor="end" font-size="10.5" fill="var(--text-dim)">${esc(lab)}</text>
                        <rect x="${padL}" y="${cy - barH / 2}" width="${plotW}" height="${barH}" rx="5" fill="var(--panel-3)"/>
                        <rect x="${padL}" y="${cy - barH / 2}" width="${Math.max(2, bw)}" height="${barH}" rx="5" fill="${series[0].color}"><title>${esc(lab)}: ${val}</title></rect>
                        <text x="${padL + Math.max(2, bw) + 8}" y="${cy + 4}" font-size="10.5" fill="var(--text)" font-weight="700">${val}</text>`;
            }).join("");
            return `<div class="chart-svg-wrap"><svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${rows}</svg></div>`;
        }

        const groupW = plotW / n;
        const barGap = 6;
        const barW = Math.min(30, (groupW - barGap) / series.length);

        const gridLines = [0, 0.5, 1].map((f) => {
            const y = padT + plotH * (1 - f);
            const val = Math.round(maxV * f);
            return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="var(--border-soft)" stroke-width="1"/>
                    <text x="${padL - 8}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="var(--muted-2)">${formatY ? esc(formatY(val)) : val}</text>`;
        }).join("");

        const bars = labels.map((lab, i) => {
            const groupX = padL + groupW * i + (groupW - barW * series.length) / 2;
            const seriesBars = series.map((s, si) => {
                const val = (s.data && s.data[i]) || 0;
                const bh = (val / maxV) * plotH;
                const x = groupX + si * barW;
                return `<rect x="${x}" y="${padT + plotH - bh}" width="${Math.max(1, barW - 2)}" height="${Math.max(0, bh)}" rx="3" fill="${s.color}"><title>${esc(s.name)} - ${esc(lab)}: ${val}</title></rect>`;
            }).join("");
            const labelEvery = Math.max(1, Math.ceil(n / 8));
            const showLabel = i % labelEvery === 0 || i === n - 1;
            return `${seriesBars}${showLabel ? `<text x="${padL + groupW * (i + 0.5)}" y="${h - 8}" text-anchor="middle" font-size="9.5" fill="var(--muted-2)">${esc(lab)}</text>` : ""}`;
        }).join("");

        return `<div class="chart-svg-wrap"><svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${gridLines}${bars}</svg></div>`;
    }

    /**
     * Donut chart. opts: { segments:[{label,value,color}], height, centerLabel, centerValue }
     */
    function donut(opts) {
        const { segments = [], height = 220, centerLabel, centerValue } = opts;
        const total = segments.reduce((s, seg) => s + (seg.value || 0), 0);
        if (!segments.length || total <= 0) return emptyState(opts.emptyMessage);

        const w = height;
        const cx = w / 2, cy = height / 2;
        const r = Math.min(w, height) / 2 - 14;
        const rInner = r * 0.62;
        let angle = -Math.PI / 2;

        const arcs = segments.map((seg) => {
            const frac = (seg.value || 0) / total;
            const start = angle;
            const end = angle + frac * Math.PI * 2;
            angle = end;
            const large = end - start > Math.PI ? 1 : 0;
            const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
            const x2 = cx + r * Math.cos(end), y2 = cy + r * Math.sin(end);
            const ix1 = cx + rInner * Math.cos(end), iy1 = cy + rInner * Math.sin(end);
            const ix2 = cx + rInner * Math.cos(start), iy2 = cy + rInner * Math.sin(start);
            const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${rInner} ${rInner} 0 ${large} 0 ${ix2} ${iy2} Z`;
            return `<path d="${path}" fill="${seg.color}"><title>${esc(seg.label)}: ${seg.value}</title></path>`;
        }).join("");

        const center = centerValue != null
            ? `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="20" font-weight="700" fill="var(--text)">${esc(centerValue)}</text>
               <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="10" fill="var(--muted)">${esc(centerLabel || "")}</text>`
            : "";

        return `<div class="chart-svg-wrap" style="max-width:${height}px;margin:0 auto;"><svg viewBox="0 0 ${w} ${height}" xmlns="http://www.w3.org/2000/svg">${arcs}${center}</svg></div>`;
    }

    /**
     * Tiny inline sparkline, no axes/labels - used for live-sampled
     * metrics (memory/CPU) where the point is the recent trend shape.
     */
    function sparkline(data, opts = {}) {
        const { color = "var(--accent)", height = 44, width = 220 } = opts;
        if (!Array.isArray(data) || data.length < 2) return `<div class="muted" style="font-size:11px;">Collecting samples…</div>`;
        const max = Math.max(...data, 1);
        const min = Math.min(...data, 0);
        const range = max - min || 1;
        const stepX = width / (data.length - 1);
        const pts = data.map((v, i) => `${i * stepX},${height - ((v - min) / range) * (height - 4) - 2}`).join(" ");
        return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
            <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>`;
    }

    return { line, bar, donut, sparkline, emptyState };
})();
