(() => {
    const data = window.POKER_DATA || {};
    // Years where only season totals were tracked (no per-game results).
    const summaryData = window.POKER_SUMMARY || {};
    const currentYear = new Date().getFullYear().toString();

    const yearButtons = document.getElementById("year-buttons");
    const yearLabel = document.getElementById("year-label");
    const leaderboardBody = document.getElementById("leaderboard-body");
    const emptyState = document.getElementById("empty-state");
    const allPlayersSection = document.getElementById("all-players-graph-section");
    const dateSelect = document.getElementById("date-select");
    const dateResultsBody = document.getElementById("date-results-body");
    const dateEmpty = document.getElementById("date-empty");
    const funStatsBody = document.getElementById("fun-stats-body");
    const funStatsSection = document.getElementById("fun-stats");
    const dateResultsSection = document.getElementById("date-results");
    const summaryNote = document.getElementById("summary-note");
    const heroYear = document.getElementById("hero-year");
    const funStatsNote = document.getElementById("fun-stats-note");
    // The "All years" tab: every season combined into one career.
    const ALL_YEARS = "all";

    let players = [];
    let games = [];
    let activeDates = [];
    let gamesByNameDate = new Map();
    let gamesByDate = new Map();
    let activeYear = null;
    // All-years view only: season totals from years without per-night results.
    let careerSummary = new Map();
    let summaryYears = [];

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
        const options = { month: "short", day: "numeric" };
        if (activeYear === ALL_YEARS) {
            options.year = "numeric";
        }
        return date.toLocaleDateString("en-US", options);
    }

    function getYears() {
        const yearSet = new Set([...Object.keys(data), ...Object.keys(summaryData)]);
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
        const allButton = document.createElement("button");
        allButton.type = "button";
        allButton.className = "year-button year-button-all";
        allButton.textContent = "All years";
        allButton.dataset.year = ALL_YEARS;
        allButton.addEventListener("click", () => setActiveYear(ALL_YEARS));
        yearButtons.appendChild(allButton);
    }

    function setActiveYear(year) {
        if (activeYear === year) {
            return;
        }
        activeYear = year;
        const isAll = year === ALL_YEARS;
        yearLabel.textContent = isAll ? "every year combined" : year;
        heroYear.textContent = isAll ? "All years" : `${year} season`;

        Array.from(yearButtons.children).forEach((button) => {
            const isActive = button.dataset.year === year;
            button.classList.toggle("is-active", isActive);
            button.setAttribute("aria-pressed", isActive ? "true" : "false");
        });

        const isSummaryYear = !data[year] && Array.isArray(summaryData[year]);
        funStatsSection.hidden = isSummaryYear;
        dateResultsSection.hidden = isSummaryYear;
        summaryNote.hidden = !isSummaryYear;
        if (isSummaryYear) {
            renderSummaryYear(summaryData[year]);
            return;
        }

        const sourceGames = isAll ? Object.values(data).flat() : (data[year] || []);
        const yearGames = sourceGames.slice().sort((a, b) => a.date.localeCompare(b.date));
        resetData();
        yearGames.forEach((game) => addGame(game.date, game.results));
        if (isAll) {
            addCareerSummaries();
        }
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

        populateLeaderboard();
        plotAllPlayersGraph();
        populateDateSelect(activeDates);
        if (activeDates.length > 0) {
            dateSelect.value = activeDates[activeDates.length - 1];
        }
        renderDateResults(dateSelect.value || null);
        renderFunStats();
        updateEmptyState(yearGames.length === 0 && players.length === 0);

        if (isAll) {
            const nightYears = Object.keys(data).sort();
            const nightRange = nightYears.length > 1 ? `${nightYears[0]}–${nightYears[nightYears.length - 1]}` : nightYears[0];
            funStatsNote.textContent = summaryYears.length
                ? `All-time highlights from every night on record (${nightRange}). ${summaryYears.join(", ")} only has season totals, so it counts toward the leaderboard and the race but not these.`
                : "All-time highlights from every night on record.";
        } else {
            funStatsNote.textContent = "Highlights for this season.";
        }
    }

    // Adds season-total-only years (like 2024) into the career leaderboard.
    function addCareerSummaries() {
        careerSummary = new Map();
        summaryYears = Object.keys(summaryData).filter((y) => !data[y]).sort();
        summaryYears.forEach((y) => {
            summaryData[y].forEach(({ name, total, games: played }) => {
                let player = players.find((p) => p.name === name);
                if (!player) {
                    player = { name, id: slugify(name), total: 0, games: 0, color: getPaletteColor(players.length) };
                    players.push(player);
                }
                player.total += total;
                player.games += played;
                if (!careerSummary.has(name)) {
                    careerSummary.set(name, []);
                }
                careerSummary.get(name).push({ year: y, total, games: played });
            });
        });
    }

    // What a player carried in from season-total-only years.
    function careerStart(name) {
        if (activeYear !== ALL_YEARS || !careerSummary.has(name)) {
            return null;
        }
        return careerSummary.get(name).reduce((sum, entry) => sum + entry.total, 0);
    }

    function rankCell(index) {
        const rank = index + 1;
        const medal = rank <= 3 ? ` rank-${rank}` : "";
        return `<td data-label="Rank"><span class="rank-badge${medal}">${rank}</span></td>`;
    }

    function moneyCell(label, value) {
        const tone = value > 0.004 ? "is-up" : value < -0.004 ? "is-down" : "is-even";
        return `<td data-label="${label}"><span class="money ${tone}">${formatCurrency(roundCents(value))}</span></td>`;
    }

    function renderSummaryYear(entries) {
        resetData();
        activeDates = [];
        gamesByNameDate = new Map();
        gamesByDate = new Map();
        plotAllPlayersGraph();
        leaderboardBody.innerHTML = "";
        const sorted = entries.slice().sort((a, b) => b.total - a.total);
        sorted.forEach((player, index) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                ${rankCell(index)}
                <td data-label="Player" class="player-name">${player.name}</td>
                ${moneyCell("Total", player.total)}
                <td data-label="Games">${player.games}</td>
            `;
            leaderboardBody.appendChild(row);
        });
        updateEmptyState(sorted.length === 0);
    }

    function resetData() {
        players = [];
        games = [];
        careerSummary = new Map();
        summaryYears = [];
        playerCharts.forEach((chart) => chart.destroy());
        playerCharts.clear();
    }

    function addGame(date, results) {
        results.forEach(({ name, result }) => {
            games.push({ date, name, result });
            let player = players.find((p) => p.name === name);
            if (!player) {
                player = { name, id: slugify(name), total: 0, games: 0, color: getPaletteColor(players.length) };
                players.push(player);
            }
            player.total += result;
            player.games += 1;
        });
    }

    function slugify(value) {
        return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
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
        const bestMonth = getBestMonthByPlayer();
        const mostConsistent = getMostConsistentPlayer();
        const hotHand = getHotHand(4);
        const biggestNight = getBiggestNight();
        const comeback = getBiggestComeback();
        const winRate = getBestWinRate();
        const wildest = getWildestSwings();

        const items = [
            {
                icon: "🔥",
                title: "Hot right now",
                value: hotHand ? `${formatCurrency(hotHand.total)} · ${hotHand.name}` : "N/A",
                detail: hotHand ? `Last ${hotHand.nights} nights · ${hotHand.range}` : "",
                featured: true
            },
            {
                icon: "💰",
                title: "Biggest single night win",
                value: biggestWin ? `${formatCurrency(biggestWin.result)} · ${biggestWin.name}` : "N/A",
                detail: biggestWin ? formatDateLabel(biggestWin.date) : ""
            },
            {
                icon: "💸",
                title: "Biggest single night loss",
                value: biggestLoss ? `${formatCurrency(biggestLoss.result)} · ${biggestLoss.name}` : "N/A",
                detail: biggestLoss ? formatDateLabel(biggestLoss.date) : ""
            },
            {
                icon: "🎰",
                title: "Biggest night ever",
                value: biggestNight ? `${formatCurrency(Math.round(biggestNight.pot))} changed hands` : "N/A",
                detail: biggestNight ? `${formatDateLabel(biggestNight.date)} · ${biggestNight.players} players` : ""
            },
            {
                icon: "📈",
                title: "Longest win streak",
                value: streaks.win.length > 0 ? `${streaks.win.length} sessions · ${streaks.win.name}` : "N/A",
                detail: streaks.win.range
            },
            {
                icon: "🥶",
                title: "Longest loss streak",
                value: streaks.loss.length > 0 ? `${streaks.loss.length} sessions · ${streaks.loss.name}` : "N/A",
                detail: streaks.loss.range
            },
            {
                icon: "🚀",
                title: activeYear === ALL_YEARS ? "Biggest comeback" : "Comeback of the year",
                value: comeback ? `+${formatCurrency(comeback.climb)} · ${comeback.name}` : "N/A",
                detail: comeback
                    ? `${formatCurrency(comeback.low)} on ${formatDateLabel(comeback.lowDate)} → ${formatCurrency(comeback.high)} on ${formatDateLabel(comeback.highDate)}`
                    : "Nobody has climbed out of a hole yet"
            },
            {
                icon: "🏆",
                title: "Best month",
                value: bestMonth ? `${formatCurrency(bestMonth.total)} · ${bestMonth.name}` : "N/A",
                detail: bestMonth ? bestMonth.label : ""
            },
            {
                icon: "🎯",
                title: "Best win rate",
                value: winRate ? `${Math.round(winRate.rate * 100)}% · ${winRate.name}` : "N/A",
                detail: winRate ? `Up ${winRate.wins} of ${winRate.played} nights · ${winRate.minGames}+ to qualify` : ""
            },
            {
                icon: "🎢",
                title: "Wildest swings",
                value: wildest ? `±${formatCurrency(Math.round(wildest.deviation))} · ${wildest.name}` : "N/A",
                detail: wildest ? "Typical night-to-night swing" : ""
            },
            {
                icon: "🧊",
                title: "Most consistent player",
                value: mostConsistent ? `±${formatCurrency(Math.round(mostConsistent.deviation))} · ${mostConsistent.name}` : "N/A",
                detail: mostConsistent ? `Smallest swings (${MIN_GAMES_FOR_RATES}+ nights)` : ""
            }
        ];

        items.forEach((item) => {
            const card = document.createElement("div");
            card.className = item.featured ? "stat-item stat-item-featured" : "stat-item";
            card.innerHTML = `
                <h3><span class="stat-icon" aria-hidden="true">${item.icon}</span>${item.title}</h3>
                <p class="stat-item-value">${item.value}</p>
                ${item.detail ? `<p class="stat-item-detail">${item.detail}</p>` : ""}
            `;
            funStatsBody.appendChild(card);
        });
    }

    // Round to cents so decimal buy-ins don't leave float noise.
    function roundCents(value) {
        return Math.round(value * 100) / 100;
    }

    function getPlayerGames(name) {
        return games
            .filter((game) => game.name === name)
            .sort((a, b) => a.date.localeCompare(b.date));
    }

    // Best combined result over the most recent `count` nights of the season.
    function getHotHand(count) {
        const recentDates = activeDates.slice(-count);
        if (recentDates.length === 0) {
            return null;
        }
        const recentSet = new Set(recentDates);
        const totals = new Map();
        games.forEach((game) => {
            if (recentSet.has(game.date)) {
                totals.set(game.name, (totals.get(game.name) || 0) + game.result);
            }
        });
        let best = null;
        totals.forEach((total, name) => {
            if (!best || total > best.total) {
                best = { name, total: roundCents(total) };
            }
        });
        if (!best) {
            return null;
        }
        return {
            ...best,
            nights: recentDates.length,
            range: buildRange(recentDates[0], recentDates[recentDates.length - 1])
        };
    }

    // The night with the most money won. Uses the winners' side only, so a
    // night that doesn't quite sum to zero still counts.
    function getBiggestNight() {
        let best = null;
        gamesByDate.forEach((results, date) => {
            const pot = roundCents(results.reduce((sum, r) => sum + Math.max(0, r.result), 0));
            if (!best || pot > best.pot) {
                best = { date, pot, players: results.length };
            }
        });
        return best;
    }

    // Deepest hole a player climbed out of: their running total fell below
    // zero and later got back above it. Reports the low and the best total after.
    function getBiggestComeback() {
        let best = null;
        players.forEach((player) => {
            let running = 0;
            let low = 0;
            let lowDate = null;
            let candidate = null;
            getPlayerGames(player.name).forEach((game) => {
                running += game.result;
                if (running < low) {
                    low = running;
                    lowDate = game.date;
                    candidate = null;
                }
                if (lowDate && running > 0 && (!candidate || running > candidate.high)) {
                    candidate = { name: player.name, low, lowDate, high: running, highDate: game.date };
                }
            });
            if (candidate && (!best || candidate.low < best.low)) {
                best = candidate;
            }
        });
        if (!best) {
            return null;
        }
        return {
            ...best,
            low: Math.round(best.low),
            high: Math.round(best.high),
            climb: Math.round(best.high - best.low)
        };
    }

    // Win rate and most consistent only count players with more than 5 nights.
    const MIN_GAMES_FOR_RATES = 6;

    // Share of nights finished up, for players with more than 5 nights.
    function getBestWinRate() {
        const minGames = MIN_GAMES_FOR_RATES;
        let best = null;
        players.forEach((player) => {
            const playerGames = games.filter((game) => game.name === player.name);
            if (playerGames.length < minGames) {
                return;
            }
            const wins = playerGames.filter((game) => game.result > 0).length;
            const rate = wins / playerGames.length;
            if (!best || rate > best.rate || (rate === best.rate && playerGames.length > best.played)) {
                best = { name: player.name, rate, wins, played: playerGames.length, minGames };
            }
        });
        return best;
    }

    function getDeviations(minGames = 3) {
        return players
            .map((player) => {
                const playerGames = games.filter((game) => game.name === player.name);
                if (playerGames.length < minGames) {
                    return null;
                }
                const mean = playerGames.reduce((sum, game) => sum + game.result, 0) / playerGames.length;
                const variance = playerGames.reduce((sum, game) => sum + (game.result - mean) ** 2, 0) / playerGames.length;
                return { name: player.name, deviation: Math.sqrt(variance) };
            })
            .filter(Boolean);
    }

    function getWildestSwings() {
        return getDeviations().reduce((best, entry) => (!best || entry.deviation > best.deviation ? entry : best), null);
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

    function getBestMonthByPlayer() {
        if (games.length === 0) {
            return null;
        }
        const totals = new Map();
        games.forEach((game) => {
            const monthKey = game.date.slice(0, 7);
            const key = `${game.name}|${monthKey}`;
            totals.set(key, (totals.get(key) || 0) + game.result);
        });

        let bestKey = null;
        let bestTotal = -Infinity;
        totals.forEach((total, key) => {
            if (total > bestTotal) {
                bestTotal = total;
                bestKey = key;
            }
        });

        if (!bestKey) {
            return null;
        }

        const [name, monthKey] = bestKey.split("|");
        const labelDate = new Date(`${monthKey}-01T12:00:00`);
        const label = labelDate.toLocaleDateString("en-US", { month: "short", year: "numeric" });
        return { name, label, total: bestTotal };
    }

    function getMostConsistentPlayer() {
        return getDeviations(MIN_GAMES_FOR_RATES).reduce((best, entry) => (!best || entry.deviation < best.deviation ? entry : best), null);
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
            row.style.setProperty("--player-color", player.color);
            row.innerHTML = `
                ${rankCell(index)}
                <td data-label="Player" class="player-name"><span><span class="player-dot" aria-hidden="true"></span>${player.name}</span></td>
                ${moneyCell("Total", player.total)}
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
        const isOpen = dropdownRow.style.display !== "none";

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
            const tone = result > 0 ? "is-up" : result < 0 ? "is-down" : "is-even";
            return `<li><span>${formatDateLabel(date)}</span><span class="money ${tone}">${formatCurrency(result)}</span></li>`;
        }).filter(Boolean);

        if (activeYear === ALL_YEARS && careerSummary.has(playerName)) {
            careerSummary.get(playerName).forEach((entry) => {
                const tone = entry.total > 0 ? "is-up" : entry.total < 0 ? "is-down" : "is-even";
                entries.unshift(`<li><span>${entry.year} season (${entry.games} games)</span><span class="money ${tone}">${formatCurrency(entry.total)}</span></li>`);
            });
        }
        dropdownCell.innerHTML = entries.length
            ? `<ul class="night-list">${entries.join("")}</ul>`
            : "<p>No nightly results for this player.</p>";
        // Show the row before drawing so the chart can measure its width.
        // Clearing the inline style lets the stylesheet pick the display
        // (table-row on desktop, block on phones).
        dropdownRow.style.display = "";
        plotPlayerGraph(playerId, playerName);
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
                <td data-label="Player" class="player-name">${entry.name}</td>
                ${moneyCell("Result", entry.result)}
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

        const start = careerStart(playerName);
        let cumulativeTotal = start || 0;
        let lastKnownTotal = start;
        const dataPoints = activeDates.map((date) => {
            const key = `${date}|${playerName}`;
            if (gamesByNameDate.has(key)) {
                cumulativeTotal += gamesByNameDate.get(key);
                lastKnownTotal = cumulativeTotal;
                return cumulativeTotal;
            }
            return lastKnownTotal;
        });

        const color = (players.find((p) => p.name === playerName) || {}).color || "#22e8ff";
        const chart = new Chart(canvas, {
            type: "line",
            data: {
                labels: activeDates.map(formatDateLabel),
                datasets: [
                    {
                        label: playerName,
                        data: dataPoints,
                        borderColor: color,
                        backgroundColor: color,
                        borderWidth: 2.5,
                        pointRadius: 2.5,
                        pointHoverRadius: 5,
                        tension: 0.35,
                        spanGaps: true
                    }
                ]
            },
            options: getLineChartOptions({ compact: true, hideLegend: true, showAllLabels: !isNarrowScreen() })
        });

        playerCharts.set(canvasId, chart);
    }

    // Hands the season to the neon race graph (race.js): every player's
    // running total per night, carried forward on nights they sat out.
    function plotAllPlayersGraph() {
        if ((activeDates.length === 0 && careerSummary.size === 0) || !window.NeonRace) {
            allPlayersSection.hidden = true;
            return;
        }

        allPlayersSection.hidden = false;
        // In the all-years view, careers start from the season-total-only years
        // (one "2024 season" point), then go night by night.
        const leadIn = activeYear === ALL_YEARS && summaryYears.length > 0;
        const dates = leadIn ? [`${summaryYears[summaryYears.length - 1]}-12-31`, ...activeDates] : activeDates;
        const labels = leadIn ? [`${summaryYears.join(" + ")} season${summaryYears.length > 1 ? "s" : ""}`] : [];
        const series = players.map((player) => {
            let running = null;
            const values = [];
            const played = [];
            if (leadIn) {
                running = careerStart(player.name);
                values.push(running === null ? null : roundCents(running));
                played.push(false);
            }
            activeDates.forEach((date) => {
                const key = `${date}|${player.name}`;
                const didPlay = gamesByNameDate.has(key);
                if (didPlay) {
                    running = roundCents((running || 0) + gamesByNameDate.get(key));
                }
                values.push(running);
                played.push(didPlay);
            });
            return { name: player.name, color: player.color, values, played };
        });

        window.NeonRace.render({ dates, labels, series });
    }

    function isNarrowScreen() {
        return window.matchMedia("(max-width: 700px)").matches;
    }

    // Neon sign colors. Past the hand-picked set, keep spinning the hue wheel.
    function getPaletteColor(index) {
        const palette = [
            "#ff2bd6",
            "#22e8ff",
            "#ffb020",
            "#39ff88",
            "#b26bff",
            "#ff4d6d",
            "#4d8dff",
            "#f9f871",
            "#ff7a1a",
            "#00ffc8",
            "#ff9cf2",
            "#a3ff3a"
        ];
        if (index < palette.length) {
            return palette[index];
        }
        const hue = Math.round((index * 137.508 + 200) % 360);
        return hslToHex(hue, 95, 64);
    }

    function hslToHex(h, s, l) {
        const sat = s / 100;
        const light = l / 100;
        const k = (n) => (n + h / 30) % 12;
        const a = sat * Math.min(light, 1 - light);
        const f = (n) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        const hex = (x) => Math.round(x * 255).toString(16).padStart(2, "0");
        return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
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
        const narrow = isNarrowScreen();
        return {
            responsive: true,
            maintainAspectRatio: false,
            elements: narrow && wide ? { point: { radius: 1.5, hoverRadius: 4 } } : {},
            layout: {
                padding: narrow ? { top: 8, right: 8, bottom: 4, left: 0 } : {
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
                        color: "#e9e4ff",
                        boxWidth: narrow ? 10 : 40,
                        boxHeight: narrow ? 10 : 12,
                        padding: narrow ? 6 : 10,
                        font: {
                            family: "Space Grotesk",
                            size: compact || narrow ? 10 : 12
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: {
                        color: "#a79fd6",
                        autoSkip: !showAllLabels,
                        maxTicksLimit: showAllLabels ? undefined : (compact ? 6 : 12),
                        maxRotation: showAllLabels ? 50 : (compact ? 45 : 0),
                        minRotation: showAllLabels ? 50 : 0,
                        font: {
                            size: compact ? 10 : 12
                        }
                    },
                    grid: {
                        color: "rgba(140, 120, 255, 0.14)"
                    }
                },
                y: {
                    beginAtZero: true,
                    suggestedMin: ySuggestedMin,
                    suggestedMax: ySuggestedMax,
                    ticks: {
                        color: "#a79fd6",
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
                        color: "rgba(140, 120, 255, 0.14)"
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
