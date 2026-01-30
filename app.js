(() => {
    const data = window.POKER_DATA || {};
    const currentYear = new Date().getFullYear().toString();

    const yearButtons = document.getElementById("year-buttons");
    const yearLabel = document.getElementById("year-label");
    const leaderboardBody = document.getElementById("leaderboard-body");
    const emptyState = document.getElementById("empty-state");
    const statSessions = document.getElementById("stat-sessions");
    const statPlayers = document.getElementById("stat-players");
    const allPlayersSection = document.getElementById("all-players-graph-section");
    const dateSelect = document.getElementById("date-select");
    const dateResultsBody = document.getElementById("date-results-body");
    const dateEmpty = document.getElementById("date-empty");
    const funStatsBody = document.getElementById("fun-stats-body");

    let players = [];
    let games = [];
    let activeDates = [];
    let gamesByNameDate = new Map();
    let gamesByDate = new Map();
    let activeYear = null;

    let allPlayersChart = null;
    const playerCharts = new Map();

    const currency = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    function formatCurrency(value) {
        const absValue = Math.abs(value);
        return value < 0 ? `-${currency.format(absValue)}` : currency.format(absValue);
    }

    function formatDateLabel(dateStr) {
        const date = new Date(`${dateStr}T12:00:00`);
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    }

    function getYears() {
        const yearSet = new Set(Object.keys(data));
        yearSet.add(currentYear);
        return Array.from(yearSet).sort((a, b) => Number(b) - Number(a));
    }

    function buildYearButtons(years) {
        yearButtons.innerHTML = "";
        years.forEach((year) => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "year-button";
            button.textContent = year;
            button.dataset.year = year;
            button.addEventListener("click", () => setActiveYear(year));
            yearButtons.appendChild(button);
        });
    }

    function setActiveYear(year) {
        if (activeYear === year) {
            return;
        }
        activeYear = year;
        yearLabel.textContent = year;

        Array.from(yearButtons.children).forEach((button) => {
            const isActive = button.dataset.year === year;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", isActive ? "true" : "false");
        });

        const yearGames = (data[year] || []).slice().sort((a, b) => a.date.localeCompare(b.date));
        resetData();
        yearGames.forEach((game) => addGame(game.date, game.results));
        activeDates = yearGames.map((game) => game.date);
        gamesByNameDate = new Map();
        gamesByDate = new Map();
        games.forEach((game) => {
            gamesByNameDate.set(`${game.date}|${game.name}`, game.result);
            if (!gamesByDate.has(game.date)) {
                gamesByDate.set(game.date, []);
            }
            gamesByDate.get(game.date).push({ name: game.name, result: game.result });
        });

        renderStats(yearGames);
        populateLeaderboard();
        plotAllPlayersGraph();
        populateDateSelect(activeDates);
        if (activeDates.length > 0) {
            dateSelect.value = activeDates[activeDates.length - 1];
        }
        renderDateResults(dateSelect.value || null);
        renderFunStats();
        updateEmptyState(yearGames.length === 0);
    }

    function resetData() {
        players = [];
        games = [];
        playerCharts.forEach((chart) => chart.destroy());
        playerCharts.clear();
    }

    function addGame(date, results) {
        results.forEach(({ name, result }) => {
            games.push({ date, name, result });
            let player = players.find((p) => p.name === name);
            if (!player) {
                player = { name, id: slugify(name), total: 0, games: 0 };
                players.push(player);
            }
            player.total += result;
            player.games += 1;
        });
    }

    function slugify(value) {
        return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    }

    function renderStats(yearGames) {
        statSessions.textContent = yearGames.length.toString();
        statPlayers.textContent = players.length.toString();
    }

    function renderFunStats() {
        funStatsBody.innerHTML = "";

        if (games.length === 0) {
            funStatsBody.innerHTML = "<p>No stats yet. Add games to see highlights.</p>";
            return;
        }

        let biggestWin = null;
        let biggestLoss = null;

        games.forEach((game) => {
            if (!biggestWin || game.result > biggestWin.result) {
                biggestWin = game;
            }
            if (!biggestLoss || game.result < biggestLoss.result) {
                biggestLoss = game;
            }
        });

        const streaks = getLongestStreaks();
        const mostSessions = getMostSessionsPlayed();
        const bestAverage = getBestAverageNight();

        const items = [
            {
                title: "Biggest single night win",
                value: biggestWin ? `${formatCurrency(biggestWin.result)} · ${biggestWin.name}` : "N/A",
                detail: biggestWin ? formatDateLabel(biggestWin.date) : ""
            },
            {
                title: "Biggest single night loss",
                value: biggestLoss ? `${formatCurrency(biggestLoss.result)} · ${biggestLoss.name}` : "N/A",
                detail: biggestLoss ? formatDateLabel(biggestLoss.date) : ""
            },
            {
                title: "Longest win streak",
                value: streaks.win.length > 0 ? `${streaks.win.length} sessions · ${streaks.win.name}` : "N/A",
                detail: streaks.win.range
            },
            {
                title: "Longest loss streak",
                value: streaks.loss.length > 0 ? `${streaks.loss.length} sessions · ${streaks.loss.name}` : "N/A",
                detail: streaks.loss.range
            },
            {
                title: "Most sessions played",
                value: mostSessions ? `${mostSessions.games} sessions · ${mostSessions.name}` : "N/A",
                detail: mostSessions ? "All season" : ""
            },
            {
                title: "Best average night",
                value: bestAverage ? `${formatCurrency(bestAverage.average)} · ${bestAverage.name}` : "N/A",
                detail: bestAverage ? "All season" : ""
            }
        ];

        items.forEach((item) => {
            const card = document.createElement("div");
            card.className = "stat-item";
            card.innerHTML = `
                <h3>${item.title}</h3>
                <p>${item.value}</p>
                ${item.detail ? `<p>${item.detail}</p>` : ""}
            `;
            funStatsBody.appendChild(card);
        });
    }

    function getLongestStreaks() {
        const result = {
            win: { length: 0, name: "", range: "" },
            loss: { length: 0, name: "", range: "" }
        };

        const playerNames = players.map((player) => player.name);

        playerNames.forEach((name) => {
            const playedGames = games
                .filter((game) => game.name === name)
                .sort((a, b) => a.date.localeCompare(b.date));

            let winCount = 0;
            let lossCount = 0;
            let winStart = null;
            let lossStart = null;
            let lastWinDate = null;
            let lastLossDate = null;

            playedGames.forEach((game) => {
                const value = game.result;
                if (value > 0) {
                    if (winCount === 0) {
                        winStart = game.date;
                    }
                    winCount += 1;
                    lastWinDate = game.date;
                    if (lossCount > result.loss.length) {
                        result.loss.length = lossCount;
                        result.loss.name = name;
                        result.loss.range = buildRange(lossStart, lastLossDate);
                    }
                    lossCount = 0;
                    lossStart = null;
                    lastLossDate = null;
                } else if (value < 0) {
                    if (lossCount === 0) {
                        lossStart = game.date;
                    }
                    lossCount += 1;
                    lastLossDate = game.date;
                    if (winCount > result.win.length) {
                        result.win.length = winCount;
                        result.win.name = name;
                        result.win.range = buildRange(winStart, lastWinDate);
                    }
                    winCount = 0;
                    winStart = null;
                    lastWinDate = null;
                } else {
                    if (winCount > result.win.length) {
                        result.win.length = winCount;
                        result.win.name = name;
                        result.win.range = buildRange(winStart, lastWinDate);
                    }
                    if (lossCount > result.loss.length) {
                        result.loss.length = lossCount;
                        result.loss.name = name;
                        result.loss.range = buildRange(lossStart, lastLossDate);
                    }
                    winCount = 0;
                    lossCount = 0;
                    winStart = null;
                    lossStart = null;
                    lastWinDate = null;
                    lastLossDate = null;
                }
            });

            if (winCount > result.win.length) {
                result.win.length = winCount;
                result.win.name = name;
                result.win.range = buildRange(winStart, lastWinDate);
            }
            if (lossCount > result.loss.length) {
                result.loss.length = lossCount;
                result.loss.name = name;
                result.loss.range = buildRange(lossStart, lastLossDate);
            }
        });

        if (result.win.length === 0) {
            result.win.range = "";
        }
        if (result.loss.length === 0) {
            result.loss.range = "";
        }

        return result;
    }

    function getMostSessionsPlayed() {
        if (players.length === 0) {
            return null;
        }
        return players.reduce((best, player) => {
            if (!best || player.games > best.games) {
                return { name: player.name, games: player.games };
            }
            return best;
        }, null);
    }

    function getBestAverageNight() {
        if (players.length === 0) {
            return null;
        }
        return players.reduce((best, player) => {
            if (player.games === 0) {
                return best;
            }
            const avg = player.total / player.games;
            if (!best || avg > best.average) {
                return { name: player.name, average: avg };
            }
            return best;
        }, null);
    }

    function buildRange(start, end) {
        if (!start || !end) {
            return "";
        }
        if (start === end) {
            return formatDateLabel(start);
        }
        return `${formatDateLabel(start)} → ${formatDateLabel(end)}`;
    }

    function populateLeaderboard() {
        leaderboardBody.innerHTML = "";
        const sortedPlayers = [...players].sort((a, b) => b.total - a.total);

        sortedPlayers.forEach((player, index) => {
            const row = document.createElement("tr");
            row.classList.add("player-row");
            row.dataset.playerId = player.id;
            row.dataset.playerName = player.name;
            row.innerHTML = `
                <td data-label="Rank">${index + 1}</td>
                <td data-label="Player">${player.name}</td>
                <td data-label="Total">${formatCurrency(player.total)}</td>
                <td data-label="Games">${player.games}</td>
            `;

            const dropdownRow = document.createElement("tr");
            dropdownRow.classList.add("dropdown-row");
            dropdownRow.style.display = "none";
            dropdownRow.innerHTML = `
                <td colspan="4" id="dropdown-${player.id}" class="dropdown-content"></td>
            `;

            row.addEventListener("click", () => toggleDropdown(player.id, player.name));

            leaderboardBody.appendChild(row);
            leaderboardBody.appendChild(dropdownRow);
        });
    }

    function toggleDropdown(playerId, playerName) {
        const dropdownCell = document.getElementById(`dropdown-${playerId}`);
        if (!dropdownCell) {
            return;
        }

        const dropdownRow = dropdownCell.parentElement;
        const isOpen = dropdownRow.style.display === "table-row";

        document.querySelectorAll(".dropdown-row").forEach((row) => {
            row.style.display = "none";
        });

        if (isOpen) {
            return;
        }

        const entries = activeDates.map((date) => {
            const key = `${date}|${playerName}`;
            if (!gamesByNameDate.has(key)) {
                return null;
            }
            const result = gamesByNameDate.get(key);
            return `<p>${formatDateLabel(date)}: ${formatCurrency(result)}</p>`;
        }).filter(Boolean);

        dropdownCell.innerHTML = entries.join("");
        plotPlayerGraph(playerId, playerName);
        dropdownRow.style.display = "table-row";
    }

    function populateDateSelect(dates) {
        dateSelect.innerHTML = "";
        if (dates.length === 0) {
            dateSelect.disabled = true;
            return;
        }
        dateSelect.disabled = false;
        dates.forEach((date) => {
            const option = document.createElement("option");
            option.value = date;
            option.textContent = formatDateLabel(date);
            dateSelect.appendChild(option);
        });
    }

    function renderDateResults(date) {
        dateResultsBody.innerHTML = "";
        if (!date || !gamesByDate.has(date)) {
            dateEmpty.hidden = false;
            return;
        }
        dateEmpty.hidden = true;
        const results = gamesByDate.get(date).slice().sort((a, b) => b.result - a.result);
        results.forEach((entry) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td data-label="Player">${entry.name}</td>
                <td data-label="Result">${formatCurrency(entry.result)}</td>
            `;
            dateResultsBody.appendChild(row);
        });
    }

    function plotPlayerGraph(playerId, playerName) {
        const dropdownCell = document.getElementById(`dropdown-${playerId}`);
        const canvasId = `graph-${playerId}`;
        let canvas = document.getElementById(canvasId);
        let chartShell = dropdownCell.querySelector(".player-chart-shell");

        if (!chartShell) {
            chartShell = document.createElement("div");
            chartShell.className = "player-chart-shell";
            dropdownCell.appendChild(chartShell);
        }

        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.id = canvasId;
            chartShell.appendChild(canvas);
        }

        if (playerCharts.has(canvasId)) {
            playerCharts.get(canvasId).destroy();
        }

        let cumulativeTotal = 0;
        let lastKnownTotal = null;
        const dataPoints = activeDates.map((date) => {
            const key = `${date}|${playerName}`;
            if (gamesByNameDate.has(key)) {
                cumulativeTotal += gamesByNameDate.get(key);
                lastKnownTotal = cumulativeTotal;
                return cumulativeTotal;
            }
            return lastKnownTotal;
        });

        const chartWidth = Math.max(600, activeDates.length * 70);
        canvas.style.width = `${chartWidth}px`;
        canvas.width = chartWidth;

        const chart = new Chart(canvas, {
            type: "line",
            data: {
                labels: activeDates.map(formatDateLabel),
                datasets: [
                    {
                        label: playerName,
                        data: dataPoints,
                        borderColor: "#2563eb",
                        backgroundColor: "rgba(37, 99, 235, 0.2)",
                        borderWidth: 2,
                        pointRadius: 2,
                        pointHoverRadius: 4,
                        tension: 0.35,
                        spanGaps: true
                    }
                ]
            },
            options: getLineChartOptions({ compact: true, hideLegend: true, showAllLabels: true })
        });

        playerCharts.set(canvasId, chart);
    }

    function plotAllPlayersGraph() {
        if (allPlayersChart) {
            allPlayersChart.destroy();
            allPlayersChart = null;
        }

        if (activeDates.length === 0) {
            allPlayersSection.hidden = true;
            return;
        }

        allPlayersSection.hidden = false;
        const datasets = players.map((player, index) => {
            let cumulativeTotal = 0;
            const dataPoints = activeDates.map((date) => {
                const key = `${date}|${player.name}`;
                if (gamesByNameDate.has(key)) {
                    cumulativeTotal += gamesByNameDate.get(key);
                    return cumulativeTotal;
                }
                return null;
            });

            return {
                label: player.name,
                data: dataPoints,
                borderColor: getPaletteColor(index),
                backgroundColor: "transparent",
                tension: 0.35,
                spanGaps: true
            };
        });

        const allData = datasets.flatMap((set) => set.data).filter((value) => value !== null);
        const allMin = allData.length ? Math.min(...allData) : 0;
        const allMax = allData.length ? Math.max(...allData) : 0;
        const minWithZero = Math.min(0, allMin);
        const maxWithZero = Math.max(0, allMax);
        const range = Math.max(1, maxWithZero - minWithZero);
        const stepSize = Math.max(25, Math.round(range / 12 / 25) * 25);

        allPlayersChart = new Chart(document.getElementById("all-players-graph"), {
            type: "line",
            data: {
                labels: activeDates.map(formatDateLabel),
                datasets
            },
            options: getLineChartOptions({
                wide: true,
                ySuggestedMin: minWithZero,
                ySuggestedMax: maxWithZero,
                yStepSize: stepSize
            })
        });
    }

    function getPaletteColor(index) {
        const palette = [
            "#ef4444",
            "#f97316",
            "#facc15",
            "#22c55e",
            "#06b6d4",
            "#2563eb",
            "#8b5cf6",
            "#ec4899",
            "#14b8a6",
            "#84cc16",
            "#0ea5e9",
            "#f43f5e"
        ];
        return palette[index % palette.length];
    }

    function updateEmptyState(isEmpty) {
        emptyState.hidden = !isEmpty;
    }

    function getLineChartOptions({
        wide = false,
        compact = false,
        hideLegend = false,
        showAllLabels = false,
        ySuggestedMin,
        ySuggestedMax,
        yStepSize
    } = {}) {
        return {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    top: 20,
                    right: wide ? 20 : 24,
                    bottom: compact ? 8 : 20,
                    left: 10
                }
            },
            plugins: {
                legend: {
                    display: !hideLegend,
                    labels: {
                        color: "#1f2937",
                        font: {
                            family: "Space Grotesk",
                            size: compact ? 10 : 12
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#475569",
                        autoSkip: !showAllLabels,
                        maxTicksLimit: showAllLabels ? undefined : (compact ? 8 : 12),
                        maxRotation: showAllLabels ? 50 : 0,
                        minRotation: showAllLabels ? 50 : 0,
                        font: {
                            size: compact ? 10 : 12
                        }
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.25)"
                    }
                },
                y: {
                    beginAtZero: true,
                    suggestedMin: ySuggestedMin,
                    suggestedMax: ySuggestedMax,
                    ticks: {
                        color: "#475569",
                        stepSize: yStepSize,
                        font: {
                            size: compact ? 10 : 12
                        },
                        callback: (value) => {
                            if (compact) {
                                return value;
                            }
                            return value;
                        }
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.25)"
                    }
                }
            }
        };
    }

    const years = getYears();
    buildYearButtons(years);
    setActiveYear(currentYear);

    dateSelect.addEventListener("change", (event) => {
        renderDateResults(event.target.value);
    });
})();
