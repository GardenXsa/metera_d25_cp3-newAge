let typeDictionary = {};
let cityGenDefaultRules = { default_tile: { type: "void", name: "Неизвестный тайл" }, rules: [] };

async function loadJsonData(path, fallbackValue) {
    try {
        const response = await fetch(path);
        if (!response.ok) return fallbackValue;
        return await response.json();
    } catch (error) {
        console.warn(`[CityGen] Не удалось загрузить ${path}:`, error.message);
        return fallbackValue;
    }
}

function normalizeTileDictionary(raw) {
    if (!raw) return {};
    if (Array.isArray(raw)) {
        return Object.fromEntries(raw.map(entry => [
            entry.id,
            entry.name || entry.title || entry.displayName || entry.label || entry.id
        ]).filter(([id]) => id));
    }
    if (raw.tiles) return normalizeTileDictionary(raw.tiles);
    return raw;
}

async function initCityGenData() {
    typeDictionary = normalizeTileDictionary(await loadJsonData("../../data/tile_dictionary.json", {}));
    cityGenDefaultRules = await loadJsonData("../../data/citygen_default_rules.json", cityGenDefaultRules);
}

async function loadInitialCityGenData() {
    if (window.INITIAL_DATA) return window.INITIAL_DATA;
    if (window.CITYGEN_SAMPLE_DATA_PATH) {
        return await loadJsonData(window.CITYGEN_SAMPLE_DATA_PATH, { command: "renderLocation", args: { size: "1x1", plots: [] } });
    }
    return { command: "renderLocation", args: { size: "1x1", plots: [] } };
}

function resolveDefaultTile(args) {
    const desc = (args.description || "").toLowerCase();
    for (const rule of cityGenDefaultRules.rules || []) {
        if ((rule.keywords || []).some(keyword => desc.includes(String(keyword).toLowerCase()))) {
            return { type: rule.type, name: rule.name || typeDictionary[rule.type] || rule.type };
        }
    }
    const fallback = cityGenDefaultRules.default_tile || {};
    return {
        type: fallback.type || "void",
        name: fallback.name || typeDictionary[fallback.type] || fallback.type || "Неизвестный тайл"
    };
}

let selectedElement = null;

window.onload = async () => {
    await initCityGenData();

    const initialData = await loadInitialCityGenData();
    window.INITIAL_DATA = initialData;

    document.getElementById('jsonInput').value = JSON.stringify(initialData, null, 2);
    document.getElementById('generateMapBtn')?.addEventListener('click', generateFromInput);
    buildMap(initialData);
};

function generateFromInput() {
    try {
        const data = JSON.parse(document.getElementById('jsonInput').value);
        buildMap(data);
    } catch (e) {
        alert("ОШИБКА АУГУРА: Искажение данных (Неверный JSON)\n" + e.message);
    }
}

function buildMap(data) {
    const args = data.args;
    const gridContainer = document.getElementById('mapGrid');
    const [width, height] = args.size.split('x').map(Number);

    gridContainer.style.gridTemplateColumns = `repeat(${width}, 48px)`;
    gridContainer.style.gridTemplateRows = `repeat(${height}, 48px)`;
    gridContainer.innerHTML = ''; 

    const defaultTile = resolveDefaultTile(args);
    let defaultType = defaultTile.type;
    let defaultName = defaultTile.name;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const plotData = args.plots.find(p => p.x === x && p.y === y);
            const cell = document.createElement('div');
            
            let typeClass = `type-${defaultType}`;
            let tileData = { name: defaultName, type: defaultType, x: x, y: y };

            if (plotData) {
                typeClass = `type-${plotData.type}`;
                tileData = plotData;
            }

            cell.className = `tile ${typeClass}`;
            cell.onclick = () => selectPlot(cell, tileData);
            
            gridContainer.appendChild(cell);
        }
    }
}

function selectPlot(element, data) {
    if (selectedElement) selectedElement.classList.remove('selected');
    
    element.classList.add('selected');
    selectedElement = element;

    document.getElementById('infoName').innerText = `[ ${data.name || "Неизвестно"} ]`;
    
    let detailsHtml = `
        <div class="info-row"><span class="info-label">Объект:</span> ${typeDictionary[data.type] || data.type}</div>
        <div class="info-row"><span class="info-label">Позиция:</span> [X:${data.x} | Y:${data.y}]</div>
    `;

    if (data.desc) detailsHtml += `<div class="info-row" style="margin-top: 10px; font-style: italic; color: #a0a0a0;">"${data.desc}"</div>`;
    if (data.loot) detailsHtml += `<div class="info-row" style="margin-top: 10px; color: #8b6b4a;"><span class="info-label">Замечено:</span> ${data.loot}</div>`;
    if (data.id) detailsHtml += `<div class="info-row" style="color: #444; margin-top: 15px; font-size: 10px;"><span class="info-label">SYS_ID:</span> ${data.id}</div>`;

    document.getElementById('infoDetails').innerHTML = detailsHtml;
}