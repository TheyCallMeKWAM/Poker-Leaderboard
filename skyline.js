// Draws the night-city skyline behind the header and scatters stars in the sky.
// Uses a fixed seed so the city looks the same on every visit.
(() => {
    const host = document.getElementById("skyline");
    const stars = document.querySelector(".stars");
    if (!host) {
        return;
    }

    let seed = 20240101;
    function rand() {
        seed = (seed * 1664525 + 1013904223) % 4294967296;
        return seed / 4294967296;
    }
    function between(min, max) {
        return min + rand() * (max - min);
    }

    const W = 1600;
    const H = 320;
    const windowColors = ["#ffd27a", "#ffb4f0", "#8ff3ff", "#ffe9b0", "#c4a6ff"];
    const signColors = ["#ff2bd6", "#22e8ff", "#ffb020", "#a855f7", "#39ff88"];
    const parts = [];

    function layer({ minW, maxW, minH, maxH, fill, windows, signs }) {
        let x = -20;
        while (x < W + 20) {
            const w = Math.round(between(minW, maxW));
            const h = Math.round(between(minH, maxH));
            const top = H - h;
            parts.push(`<rect x="${x}" y="${top}" width="${w}" height="${h}" fill="${fill}"/>`);

            // Rooftop details: antennas and stepped tops.
            if (rand() < 0.25) {
                const ax = x + w / 2;
                const ah = between(14, 40);
                parts.push(`<rect x="${ax - 1}" y="${top - ah}" width="2" height="${ah}" fill="${fill}"/>`);
                parts.push(`<circle class="blink" cx="${ax}" cy="${top - ah}" r="2.4" fill="#ff4d6d" style="animation-delay:${between(0, 3).toFixed(2)}s"/>`);
            } else if (rand() < 0.3) {
                const sw = w * between(0.4, 0.7);
                parts.push(`<rect x="${x + (w - sw) / 2}" y="${top - 14}" width="${sw}" height="14" fill="${fill}"/>`);
            }

            if (windows) {
                const cols = Math.max(1, Math.floor((w - 8) / 10));
                const rows = Math.floor((h - 16) / 13);
                for (let r = 0; r < rows; r += 1) {
                    for (let c = 0; c < cols; c += 1) {
                        if (rand() < windows) {
                            const color = windowColors[Math.floor(rand() * windowColors.length)];
                            const op = between(0.45, 0.95).toFixed(2);
                            parts.push(`<rect x="${x + 6 + c * 10}" y="${top + 10 + r * 13}" width="5" height="7" fill="${color}" opacity="${op}"/>`);
                        }
                    }
                }
            }

            // A few vertical neon signs on the near buildings.
            if (signs && w > 46 && h > 150 && rand() < signs) {
                const color = signColors[Math.floor(rand() * signColors.length)];
                const sy = top + between(20, 50);
                const sh = between(50, 90);
                parts.push(`<rect class="sign" x="${x + w - 12}" y="${sy}" width="6" height="${sh}" rx="3" fill="${color}" style="color:${color};animation-delay:${between(0, 6).toFixed(2)}s"/>`);
            }

            x += w + Math.round(between(0, 6));
        }
    }

    // Far, mid and near rows of buildings.
    layer({ minW: 40, maxW: 90, minH: 140, maxH: 290, fill: "#1a1240", windows: 0.08 });
    layer({ minW: 50, maxW: 110, minH: 90, maxH: 230, fill: "#120c2e", windows: 0.18, signs: 0.35 });
    layer({ minW: 60, maxW: 130, minH: 40, maxH: 150, fill: "#0a0720", windows: 0.22, signs: 0.2 });

    host.innerHTML = `
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg">
            ${parts.join("")}
        </svg>`;

    if (stars) {
        const dots = [];
        for (let i = 0; i < 90; i += 1) {
            const size = between(1, 2.4).toFixed(1);
            dots.push(`<span style="left:${between(0, 100).toFixed(2)}%;top:${between(0, 60).toFixed(2)}%;width:${size}px;height:${size}px;animation-delay:${between(0, 5).toFixed(2)}s"></span>`);
        }
        stars.innerHTML = dots.join("");
    }
})();
