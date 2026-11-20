// "The Race": every player's running total on one neon line graph, with a
// timeline you can play, drag or swipe. Each player's dot rides the head of
// their line as you move through the season.
//
// Usage: NeonRace.render({ dates: ["2026-01-01", ...], series: [{ name, color, values, played }] })
//   values[i] = running total after night i (null before their first night)
//   played[i] = true when they played night i
(() => {
    const shell = document.getElementById("race-shell");
    const canvas = document.getElementById("race-canvas");
    const slider = document.getElementById("race-slider");
    const playButton = document.getElementById("race-play");
    const dateOut = document.getElementById("race-date");
    const nightOut = document.getElementById("race-night");
    const monthsOut = document.getElementById("race-months");
    const list = document.getElementById("race-list");
    const clearButton = document.getElementById("race-clear");
    if (!canvas || !shell) {
        return;
    }

    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ROW_H = 34;

    let dates = [];
    let series = [];
    let rows = new Map();
    let t = 0; // what is drawn (fractional night index)
    let target = 0; // where t is heading
    let playing = false;
    let selected = null;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let yMin = 0;
    let yMax = 0;
    let yStep = 50;
    let rafId = null;
    let lastTs = null;
    let labels = [];
    let multiYear = false;
    let heads = [];

    function money(value, signed) {
        const abs = Math.round(Math.abs(value));
        const text = `$${abs.toLocaleString("en-US")}`;
        if (value < -0.5) {
            return `-${text}`;
        }
        return signed && value > 0.5 ? `+${text}` : text;
    }

    function dateLabel(dateStr, withWeekday) {
        const d = new Date(`${dateStr}T12:00:00`);
        const opts = withWeekday
            ? { weekday: "short", month: "short", day: "numeric" }
            : { month: "short", day: "numeric" };
        if (multiYear) {
            opts.year = withWeekday ? "numeric" : "2-digit";
        }
        return d.toLocaleDateString("en-US", opts);
    }

    // Label for night i: a custom label if one was given (like "2024 season"), else its date.
    function nightLabel(i, withWeekday) {
        return labels[i] || dateLabel(dates[i], withWeekday);
    }

    // Axis ticks: months within one season, years across a career.
    function tickKey(d) {
        return multiYear ? d.slice(0, 4) : d.slice(0, 7);
    }

    function tickLabel(d, short) {
        if (multiYear) {
            return short ? `'${d.slice(2, 4)}` : d.slice(0, 4);
        }
        const month = new Date(`${d}T12:00:00`).toLocaleDateString("en-US", { month: "short" });
        return short ? month.charAt(0) : month;
    }

    function isNarrow() {
        return width < 560;
    }

    function padding() {
        return isNarrow()
            ? { left: 52, right: 58, top: 34, bottom: 26 }
            : { left: 56, right: 104, top: 38, bottom: 30 };
    }

    function niceStep(range) {
        const raw = range / (isNarrow() ? 5 : 7);
        const steps = [10, 25, 50, 100, 150, 200, 250, 500, 1000, 2000];
        return steps.find((s) => s >= raw) || 5000;
    }

    function xOf(i) {
        const p = padding();
        const plotW = width - p.left - p.right;
        if (dates.length <= 1) {
            return p.left + plotW / 2;
        }
        return p.left + (i / (dates.length - 1)) * plotW;
    }

    function yOf(v) {
        const p = padding();
        const plotH = height - p.top - p.bottom;
        return p.top + ((yMax - v) / (yMax - yMin)) * plotH;
    }

    function tFromX(x) {
        const p = padding();
        const plotW = width - p.left - p.right;
        const ratio = (x - p.left) / plotW;
        return Math.max(0, Math.min(dates.length - 1, ratio * (dates.length - 1)));
    }

    function valueAt(s, time) {
        if (time < s.first) {
            return null;
        }
        const i0 = Math.floor(time);
        const f = time - i0;
        const v0 = s.values[i0];
        const v1 = i0 + 1 < s.values.length ? s.values[i0 + 1] : null;
        if (v1 === null || f === 0) {
            return v0;
        }
        return v0 + (v1 - v0) * f;
    }

    function hexToRgba(hex, alpha) {
        const n = parseInt(hex.slice(1), 16);
        return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
    }

    function resize() {
        const rect = shell.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        computeScale();
        draw();
    }

    function computeScale() {
        let lo = 0;
        let hi = 0;
        series.forEach((s) => s.values.forEach((v) => {
            if (v !== null) {
                lo = Math.min(lo, v);
                hi = Math.max(hi, v);
            }
        }));
        yStep = niceStep(Math.max(1, hi - lo));
        yMin = Math.floor(lo / yStep) * yStep;
        yMax = Math.ceil(hi / yStep) * yStep;
        if (yMax === yMin) {
            yMax = yMin + yStep;
        }
        // Headroom so the top and bottom dots aren't cut off.
        if (hi > yMax - yStep * 0.15) {
            yMax += yStep;
        }
        if (lo < yMin + yStep * 0.15) {
            yMin -= yStep;
        }
    }

    function drawGrid() {
        const p = padding();
        ctx.font = `500 ${isNarrow() ? 10 : 11}px "Space Grotesk", sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = "right";
        for (let v = yMin; v <= yMax + 0.001; v += yStep) {
            const y = yOf(v);
            const isZero = Math.abs(v) < 0.001;
            ctx.strokeStyle = isZero ? "rgba(34, 232, 255, 0.55)" : "rgba(140, 120, 255, 0.12)";
            ctx.lineWidth = isZero ? 1.2 : 1;
            ctx.setLineDash(isZero ? [6, 6] : []);
            ctx.beginPath();
            ctx.moveTo(p.left, y);
            ctx.lineTo(width - p.right + 8, y);
            ctx.stroke();
            ctx.fillStyle = isZero ? "rgba(140, 240, 255, 0.95)" : "rgba(190, 180, 240, 0.6)";
            ctx.fillText(money(v), p.left - 8, y);
        }
        ctx.setLineDash([]);

        // Month labels along the bottom.
        ctx.textAlign = "left";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = "rgba(190, 180, 240, 0.6)";
        let lastMonth = null;
        let lastX = -Infinity;
        dates.forEach((d, i) => {
            const month = tickKey(d);
            if (labels[i] || month === lastMonth) {
                return;
            }
            lastMonth = month;
            const x = xOf(i);
            if (x - lastX < (isNarrow() ? 24 : 28)) {
                return;
            }
            lastX = x;
            ctx.strokeStyle = "rgba(140, 120, 255, 0.12)";
            ctx.beginPath();
            ctx.moveTo(x, p.top);
            ctx.lineTo(x, height - p.bottom);
            ctx.stroke();
            ctx.fillText(tickLabel(d, false), x + 3, height - p.bottom + 16);
        });
    }

    function drawScanline() {
        const p = padding();
        const x = xOf(t);
        const grad = ctx.createLinearGradient(0, p.top, 0, height - p.bottom);
        grad.addColorStop(0, "rgba(255, 43, 214, 0.0)");
        grad.addColorStop(0.15, "rgba(255, 43, 214, 0.55)");
        grad.addColorStop(1, "rgba(255, 43, 214, 0.15)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, p.top - 6);
        ctx.lineTo(x, height - p.bottom);
        ctx.stroke();

        // Date pill riding the top of the scanline.
        const idx = Math.round(t);
        const text = dates[idx] ? nightLabel(idx) : "";
        ctx.font = `700 ${isNarrow() ? 10 : 11}px "Orbitron", sans-serif`;
        const tw = ctx.measureText(text).width + 16;
        let px = x - tw / 2;
        px = Math.max(4, Math.min(width - tw - 4, px));
        const py = 6;
        ctx.fillStyle = "rgba(20, 8, 40, 0.9)";
        ctx.strokeStyle = "rgba(255, 43, 214, 0.9)";
        ctx.lineWidth = 1;
        roundRect(px, py, tw, 20, 10);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#ffd6f6";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, px + tw / 2, py + 10.5);
    }

    function roundRect(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function tracePath(s) {
        const end = Math.floor(t);
        ctx.beginPath();
        ctx.moveTo(xOf(s.first), yOf(s.values[s.first]));
        for (let i = s.first + 1; i <= end; i += 1) {
            ctx.lineTo(xOf(i), yOf(s.values[i]));
        }
        if (t > end && end + 1 < dates.length) {
            ctx.lineTo(xOf(t), yOf(valueAt(s, t)));
        }
    }

    function drawLines() {
        const dimOthers = selected !== null;
        const ordered = series.slice().sort((a, b) => (a.name === selected) - (b.name === selected));
        ordered.forEach((s) => {
            if (t < s.first) {
                return;
            }
            const isSel = s.name === selected;
            const alpha = dimOthers && !isSel ? 0.14 : 1;
            ctx.lineJoin = "round";
            ctx.lineCap = "round";
            // Soft glow underneath, then the bright core.
            ctx.strokeStyle = hexToRgba(s.color, 0.18 * alpha);
            ctx.lineWidth = isSel ? 9 : 6;
            tracePath(s);
            ctx.stroke();
            ctx.strokeStyle = hexToRgba(s.color, 0.95 * alpha);
            ctx.lineWidth = isSel ? 3 : 1.8;
            tracePath(s);
            ctx.stroke();
        });
    }

    function drawHeads() {
        heads = [];
        const nearest = Math.round(t);
        const nearNight = Math.abs(t - nearest) < 0.2;
        series.forEach((s) => {
            const v = valueAt(s, t);
            if (v === null) {
                return;
            }
            heads.push({ s, v, x: xOf(t), y: yOf(v), justPlayed: nearNight && s.played[nearest] });
        });

        const dimOthers = selected !== null;
        heads.forEach((h) => {
            const isSel = h.s.name === selected;
            const alpha = dimOthers && !isSel ? 0.2 : 1;
            const r = isSel ? 6 : (isNarrow() ? 3.6 : 4.4);
            const glow = ctx.createRadialGradient(h.x, h.y, 0, h.x, h.y, r * 4);
            glow.addColorStop(0, hexToRgba(h.s.color, 0.55 * alpha));
            glow.addColorStop(1, hexToRgba(h.s.color, 0));
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(h.x, h.y, r * 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = hexToRgba(h.s.color, alpha);
            ctx.beginPath();
            ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(255, 255, 255, ${0.85 * alpha})`;
            ctx.beginPath();
            ctx.arc(h.x, h.y, r * 0.4, 0, Math.PI * 2);
            ctx.fill();
            if (h.justPlayed && alpha === 1) {
                ctx.strokeStyle = hexToRgba(h.s.color, 0.6);
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(h.x, h.y, r + 4, 0, Math.PI * 2);
                ctx.stroke();
            }
        });

        drawLabels();
    }

    // Name tags next to the dots. Biggest totals (and the followed player)
    // get first claim on space; anything that would overlap is skipped.
    function drawLabels() {
        const narrow = isNarrow();
        const limit = selected ? 1 : (narrow ? 7 : 16);
        const fontSize = narrow ? 10 : 12;
        ctx.font = `600 ${fontSize}px "Space Grotesk", sans-serif`;
        ctx.textBaseline = "middle";
        const priority = heads.slice().sort((a, b) => {
            if (a.s.name === selected) return -1;
            if (b.s.name === selected) return 1;
            return Math.abs(b.v) - Math.abs(a.v);
        });
        const placed = [];
        let count = 0;
        priority.forEach((h) => {
            if (count >= limit) {
                return;
            }
            if (selected && h.s.name !== selected) {
                return;
            }
            const text = narrow ? h.s.name : `${h.s.name} ${money(h.v, true)}`;
            const w = ctx.measureText(text).width + 10;
            const lh = fontSize + 6;
            let x = h.x + 9;
            if (x + w > width - 2) {
                x = h.x - 9 - w;
            }
            const box = { x, y: h.y - lh / 2, w, h: lh };
            const hit = placed.some((b) => box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y);
            if (hit) {
                return;
            }
            placed.push(box);
            count += 1;
            ctx.fillStyle = "rgba(10, 6, 30, 0.78)";
            roundRect(box.x, box.y, box.w, box.h, 5);
            ctx.fill();
            ctx.strokeStyle = hexToRgba(h.s.color, 0.7);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = h.s.color;
            ctx.textAlign = "left";
            ctx.fillText(text, box.x + 5, h.y + 0.5);
        });
    }

    function draw() {
        if (!width || !height || dates.length === 0) {
            return;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);
        drawGrid();
        drawLines();
        drawScanline();
        drawHeads();
    }

    function updateReadout() {
        const idx = Math.round(t);
        if (!dates[idx]) {
            dateOut.textContent = "—";
            nightOut.textContent = "";
            return;
        }
        const nights = dates.length - labels.filter(Boolean).length;
        const nightNo = idx + 1 - labels.slice(0, idx + 1).filter(Boolean).length;
        dateOut.textContent = nightLabel(idx, true);
        nightOut.textContent = labels[idx] ? "Season totals" : `Night ${nightNo} of ${nights}`;
        slider.setAttribute("aria-valuetext", `${nightLabel(idx)}, ${nightOut.textContent}`);
    }

    function buildList() {
        list.innerHTML = "";
        rows = new Map();
        series.forEach((s) => {
            const li = document.createElement("li");
            li.className = "race-row";
            li.style.setProperty("--c", s.color);
            li.innerHTML = `
                <button type="button">
                    <span class="race-rank"></span>
                    <span class="race-swatch"></span>
                    <span class="race-name"></span>
                    <span class="race-delta"></span>
                    <span class="race-total"></span>
                </button>`;
            li.querySelector(".race-name").textContent = s.name;
            li.querySelector("button").addEventListener("click", () => toggleSelect(s.name));
            list.appendChild(li);
            rows.set(s.name, {
                li,
                rank: li.querySelector(".race-rank"),
                total: li.querySelector(".race-total"),
                delta: li.querySelector(".race-delta"),
                pos: -1,
                text: "",
                deltaText: ""
            });
        });
        list.style.height = `${series.length * ROW_H}px`;
    }

    function updateList() {
        const idx = Math.round(t);
        const standings = series
            .map((s) => ({ s, v: valueAt(s, t) }))
            .sort((a, b) => {
                if (a.v === null && b.v === null) return a.s.name.localeCompare(b.s.name);
                if (a.v === null) return 1;
                if (b.v === null) return -1;
                return b.v - a.v;
            });
        let rank = 0;
        standings.forEach((entry, pos) => {
            const row = rows.get(entry.s.name);
            if (!row) {
                return;
            }
            if (row.pos !== pos) {
                row.pos = pos;
                row.li.style.transform = `translateY(${pos * ROW_H}px)`;
            }
            const waiting = entry.v === null;
            row.li.classList.toggle("is-waiting", waiting);
            row.li.classList.toggle("is-selected", entry.s.name === selected);
            row.li.classList.toggle("is-dim", selected !== null && entry.s.name !== selected);
            if (!waiting) {
                rank += 1;
            }
            const rankText = waiting ? "·" : String(rank);
            if (row.rank.textContent !== rankText) {
                row.rank.textContent = rankText;
            }
            const text = waiting ? "—" : money(entry.v);
            if (row.text !== text) {
                row.text = text;
                row.total.textContent = text;
                row.li.classList.toggle("is-up", !waiting && entry.v > 0.5);
                row.li.classList.toggle("is-down", !waiting && entry.v < -0.5);
            }
            let deltaText = "";
            if (entry.s.played[idx]) {
                const prev = idx > 0 && entry.s.values[idx - 1] !== null ? entry.s.values[idx - 1] : 0;
                const d = entry.s.values[idx] - prev;
                deltaText = Math.abs(d) < 0.5 ? "±$0" : money(d, true);
            }
            if (row.deltaText !== deltaText) {
                row.deltaText = deltaText;
                row.delta.textContent = deltaText;
                row.delta.className = `race-delta${deltaText.startsWith("+") ? " up" : deltaText.startsWith("-") ? " down" : ""}`;
            }
        });
    }

    function toggleSelect(name) {
        selected = selected === name ? null : name;
        clearButton.hidden = selected === null;
        refresh();
    }

    function refresh() {
        draw();
        updateList();
        updateReadout();
    }

    function setPlaying(on) {
        playing = on && dates.length > 1;
        playButton.classList.toggle("is-playing", playing);
        playButton.setAttribute("aria-label", playing ? "Pause" : "Play");
        if (playing) {
            if (target >= dates.length - 1.001) {
                target = 0;
                t = 0;
            }
            kick();
        }
    }

    function kick() {
        if (rafId === null) {
            lastTs = null;
            rafId = requestAnimationFrame(tick);
        }
    }

    function tick(ts) {
        rafId = null;
        const dt = lastTs === null ? 16 : Math.min(64, ts - lastTs);
        lastTs = ts;
        if (playing) {
            // A relaxed pace: about a night a second, so a season takes ~35 seconds.
            // Long careers speed up a little so they finish in under a minute and a half.
            const speed = Math.max(1.1, (dates.length - 1) / 80);
            target = Math.min(dates.length - 1, target + (speed * dt) / 1000);
            t = target;
            if (target >= dates.length - 1) {
                setPlaying(false);
            }
            const snapped = String(Math.round(t));
            if (slider.value !== snapped) {
                slider.value = snapped;
            }
        } else {
            const diff = target - t;
            t = Math.abs(diff) < 0.002 ? target : t + diff * Math.min(1, dt / 70);
        }
        refresh();
        if (playing || t !== target) {
            rafId = requestAnimationFrame(tick);
        }
    }

    function moveTo(value, instant) {
        setPlaying(false);
        target = Math.max(0, Math.min(dates.length - 1, value));
        if (instant || reduceMotion) {
            t = target;
            refresh();
        } else {
            kick();
        }
    }

    function buildMonths() {
        monthsOut.innerHTML = "";
        let lastMonth = null;
        let lastPct = -100;
        dates.forEach((d, i) => {
            const month = tickKey(d);
            if (labels[i] || month === lastMonth) {
                return;
            }
            lastMonth = month;
            const pct = dates.length > 1 ? (i / (dates.length - 1)) * 100 : 0;
            if (pct - lastPct < 5) {
                return;
            }
            lastPct = pct;
            const span = document.createElement("span");
            span.style.left = `${pct}%`;
            span.textContent = tickLabel(d, true);
            span.title = month;
            monthsOut.appendChild(span);
        });
    }

    // Canvas gestures: a horizontal drag scrubs, a tap on a dot follows that player.
    let pointer = null;
    canvas.addEventListener("pointerdown", (event) => {
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, scrubbing: false };
    });
    canvas.addEventListener("pointermove", (event) => {
        if (!pointer || pointer.id !== event.pointerId) {
            return;
        }
        const dx = event.clientX - pointer.x;
        const dy = event.clientY - pointer.y;
        if (!pointer.scrubbing && Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy)) {
            pointer.scrubbing = true;
            canvas.setPointerCapture(event.pointerId);
        }
        if (pointer.scrubbing) {
            const rect = canvas.getBoundingClientRect();
            moveTo(tFromX(event.clientX - rect.left), true);
            slider.value = String(Math.round(target));
        }
    });
    function endPointer(event) {
        if (!pointer || pointer.id !== event.pointerId) {
            return;
        }
        const wasScrub = pointer.scrubbing;
        pointer = null;
        if (wasScrub || event.type === "pointercancel") {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        let best = null;
        heads.forEach((h) => {
            const d = Math.hypot(h.x - x, h.y - y);
            if (d < 22 && (!best || d < best.d)) {
                best = { d, name: h.s.name };
            }
        });
        if (best) {
            toggleSelect(best.name);
        } else {
            // Tap anywhere else on the graph jumps the timeline there.
            moveTo(Math.round(tFromX(x)));
            slider.value = String(Math.round(target));
        }
    }
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);

    slider.addEventListener("input", () => moveTo(Number(slider.value)));
    playButton.addEventListener("click", () => setPlaying(!playing));
    clearButton.addEventListener("click", () => toggleSelect(selected));

    if ("ResizeObserver" in window) {
        new ResizeObserver(() => resize()).observe(shell);
    } else {
        window.addEventListener("resize", resize);
    }

    window.NeonRace = {
        render(config) {
            dates = config.dates || [];
            labels = config.labels || [];
            multiYear = new Set(dates.filter((d, i) => !labels[i]).map((d) => d.slice(0, 4))).size > 1;
            series = (config.series || []).map((s) => ({
                ...s,
                first: s.values.findIndex((v) => v !== null)
            })).filter((s) => s.first !== -1);
            if (selected && !series.some((s) => s.name === selected)) {
                selected = null;
            }
            clearButton.hidden = selected === null;
            setPlaying(false);
            slider.max = String(Math.max(0, dates.length - 1));
            slider.step = "1";
            target = Math.max(0, dates.length - 1);
            t = target;
            slider.value = String(target);
            buildList();
            buildMonths();
            computeScale();
            resize();
            updateList();
            updateReadout();
        }
    };
})();
