/**
 * ModManagerUI.js
 * RimWorld-style mod management:
 *  - Snapshot active mod list on open
 *  - Detect changes on back → prompt restart
 *  - Settings saved on every change, but game only reloads on restart
 *  - Session cache: if user reverts to original order → no restart needed
 */

document.addEventListener('DOMContentLoaded', () => {
    const modsButton        = document.getElementById('mods-button');
    const modsBackButton    = document.getElementById('mods-back-button');
    const modsMenu          = document.getElementById('mods-menu');
    const mainMenu          = document.getElementById('main-menu');
    const openModsFolderButton = document.getElementById('open-mods-folder-button');

    if (!modsButton || !modsMenu || !mainMenu) {
        console.error('[ModManagerUI] CRITICAL: Could not find essential menu elements.');
        return;
    }

    const availableListContainer = document.getElementById('available-mods-list');
    const activeListContainer    = document.getElementById('active-mods-list');
    const modDetailsContent      = document.getElementById('mod-details-content');
    const modErrorsContainer     = document.getElementById('mod-errors-container');
    const modErrorsList          = document.getElementById('mod-errors-list');

    let allMods       = [];
    let activeModIds  = [];   // current working list (may differ from saved)
    let selectedModId = null;

    // ── Session cache ─────────────────────────────────────────────────────────
    // Snapshot taken the moment the game launched (first call to initializeModManager).
    // Never overwritten mid-session.  Cleared only on actual relaunch.
    const SESSION_KEY = '__modmanager_launch_snapshot__';

    function getLaunchSnapshot() {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch(_) { return null; }
    }

    function setLaunchSnapshot(ids) {
        try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(ids)); } catch(_) {}
    }

    function snapshotEquals(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        return a.every((id, i) => id === b[i]);
    }

    // ── Utilities ─────────────────────────────────────────────────────────────
    function escapeHTML(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getDisabledMods(settings) {
        return settings && settings.mods && settings.mods.disabled && typeof settings.mods.disabled === 'object'
            ? settings.mods.disabled
            : {};
    }

    async function clearRuntimeDisabledMod(modId) {
        const fullSettings = await window.electronAPI.loadSettings() || {};
        if (!fullSettings.mods || typeof fullSettings.mods !== 'object') fullSettings.mods = {};
        if (fullSettings.mods.disabled && typeof fullSettings.mods.disabled === 'object') {
            delete fullSettings.mods.disabled[modId];
        }
        await window.electronAPI.saveSettings(fullSettings);
        allMods = allMods.map(mod => {
            if (mod.id !== modId) return mod;
            const copy = { ...mod };
            delete copy.runtimeDisabled;
            delete copy.disabledInfo;
            if (copy.error && String(copy.error).startsWith('Автоотключён:')) delete copy.error;
            return copy;
        });
        if (window.RuntimeLog) {
            window.RuntimeLog.info('ModManagerUI', `Сброшена runtime-блокировка мода ${modId}.`, { modId });
        }
    }



    // ── Navigation ────────────────────────────────────────────────────────────
    modsButton.addEventListener('click', () => {
        mainMenu.classList.remove('active-screen');
        modsMenu.style.display = 'flex';
        requestAnimationFrame(() => modsMenu.classList.add('active-screen'));
        initializeModManager();
    });

    modsBackButton.addEventListener('click', handleBack);
    openModsFolderButton.addEventListener('click', () => window.electronAPI.modsOpenFolder());

    // ── Back with change detection ────────────────────────────────────────────
    async function handleBack() {
        const snapshot = getLaunchSnapshot();
        if (!snapshot) {
            // First time — no snapshot yet, just go back
            goBackToMenu();
            return;
        }

        if (snapshotEquals(activeModIds, snapshot)) {
            // User reverted to original order — no restart needed
            goBackToMenu();
            return;
        }

        // Changes detected — show restart dialog
        showRestartDialog();
    }

    function goBackToMenu() {
        modsMenu.classList.remove('active-screen');
        setTimeout(() => {
            modsMenu.style.display = 'none';
            mainMenu.style.display = 'flex';
            mainMenu.classList.add('active-screen');
        }, 300);
    }

    function showRestartDialog() {
        // Remove any existing dialog
        const existing = document.getElementById('mods-restart-dialog');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'mods-restart-dialog';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 100000;
            background: rgba(0,0,0,0.75);
            display: flex; align-items: center; justify-content: center;
            animation: fadeIn 0.2s ease;
        `;

        const box = document.createElement('div');
        box.style.cssText = `
            background: rgba(12,16,22,0.98);
            border: 1px solid rgba(93,173,226,0.4);
            border-radius: 12px;
            padding: 32px 40px;
            max-width: 460px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.7);
            font-family: 'Segoe UI', sans-serif;
        `;

        box.innerHTML = `
            <div style="font-size:2em; margin-bottom:12px;">🔄</div>
            <h3 style="color:#5dade2; margin:0 0 12px; font-size:1.1em; letter-spacing:0.05em;">
                СПИСОК МОДОВ ИЗМЕНЁН
            </h3>
            <p style="color:#bdc3c7; line-height:1.6; margin:0 0 24px; font-size:0.95em;">
                Порядок загрузки или состав активных модов был изменён.<br>
                <strong style="color:#e8d5b4;">Для применения изменений требуется перезапуск игры.</strong>
            </p>
            <div style="display:flex; gap:12px; justify-content:center;">
                <button id="mods-restart-back" style="
                    padding: 10px 24px;
                    border-radius: 6px;
                    border: 1px solid rgba(93,173,226,0.4);
                    background: transparent;
                    color: #5dade2;
                    cursor: pointer;
                    font-size: 0.9em;
                    transition: all 0.2s;
                ">← Вернуться к модам</button>
                <button id="mods-restart-now" style="
                    padding: 10px 24px;
                    border-radius: 6px;
                    border: none;
                    background: linear-gradient(135deg, #2980b9, #1a5276);
                    color: #fff;
                    cursor: pointer;
                    font-size: 0.9em;
                    font-weight: bold;
                    transition: all 0.2s;
                ">Перезапустить →</button>
            </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        document.getElementById('mods-restart-back').addEventListener('click', () => {
            overlay.remove();
        });

        document.getElementById('mods-restart-now').addEventListener('click', async () => {
            // Save final settings before relaunch
            await saveModSettings();
            // Clear session cache so fresh snapshot is taken on next launch
            try { sessionStorage.removeItem(SESSION_KEY); } catch(_) {}
            // Relaunch
            if (window.electronAPI && window.electronAPI.appRelaunch) {
                window.electronAPI.appRelaunch();
            } else {
                location.reload();
            }
        });

        // Hover effects
        const backBtn    = document.getElementById('mods-restart-back');
        const restartBtn = document.getElementById('mods-restart-now');
        backBtn.addEventListener('mouseenter',    () => { backBtn.style.borderColor = '#5dade2'; backBtn.style.background = 'rgba(93,173,226,0.1)'; });
        backBtn.addEventListener('mouseleave',    () => { backBtn.style.borderColor = 'rgba(93,173,226,0.4)'; backBtn.style.background = 'transparent'; });
        restartBtn.addEventListener('mouseenter', () => { restartBtn.style.background = 'linear-gradient(135deg, #3498db, #2471a3)'; });
        restartBtn.addEventListener('mouseleave', () => { restartBtn.style.background = 'linear-gradient(135deg, #2980b9, #1a5276)'; });
    }

    // ── Core logic ────────────────────────────────────────────────────────────
    async function initializeModManager() {
        const settings = await window.electronAPI.loadSettings();
        const disabledMods = getDisabledMods(settings);
        activeModIds = (settings && settings.mods && settings.mods.active)
            ? [...settings.mods.active].filter(id => id === 'base_game' || !disabledMods[id])
            : ['base_game'];

        // Ensure base_game is always first
        if (!activeModIds.includes('base_game')) activeModIds.unshift('base_game');
        if (activeModIds[0] !== 'base_game') {
            activeModIds = activeModIds.filter(id => id !== 'base_game');
            activeModIds.unshift('base_game');
        }

        // Take session snapshot ONCE (first open after launch)
        if (!getLaunchSnapshot()) {
            setLaunchSnapshot([...activeModIds]);
        }

        const response = await window.electronAPI.modsGetList();
        if (response.success) {
            const disabledMods = getDisabledMods(settings);
            activeModIds = activeModIds.filter(id => id === 'base_game' || !disabledMods[id]);
            allMods = response.mods.map(mod => {
                if (!disabledMods[mod.id]) return mod;
                return {
                    ...mod,
                    runtimeDisabled: true,
                    error: `Автоотключён: ${disabledMods[mod.id].reason || 'runtime error'}`,
                    disabledInfo: disabledMods[mod.id]
                };
            });
            if (!allMods.find(m => m.id === 'base_game')) {
                allMods.push({
                    id: 'base_game', name: 'Core (Ядро Игры)',
                    author: 'MrKins', version: '1.0',
                    description: 'Базовые файлы игры. Должно загружаться первым.'
                });
            }
            renderLists();
        } else {
            modErrorsContainer.style.display = 'block';
            modErrorsList.textContent = 'Критическая ошибка: не удалось прочитать папку модов.';
        }
    }

    function renderLists() {
        availableListContainer.innerHTML = '';
        activeListContainer.innerHTML   = '';

        const snapshot = getLaunchSnapshot() || [];
        const validationErrors = validateLoadOrder();

        // Show "changes pending restart" banner if state differs from launch snapshot
        let pendingBanner = activeListContainer.previousElementSibling;
        if (pendingBanner && pendingBanner.id === 'mods-pending-banner') pendingBanner.remove();

        if (!snapshotEquals(activeModIds, snapshot)) {
            const banner = document.createElement('div');
            banner.id = 'mods-pending-banner';
            banner.style.cssText = `
                background: rgba(241,196,15,0.12);
                border: 1px solid rgba(241,196,15,0.4);
                border-radius: 6px;
                padding: 8px 14px;
                margin-bottom: 8px;
                color: #f1c40f;
                font-size: 0.82em;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
            banner.innerHTML = '<i class="fas fa-clock"></i> Изменения будут применены после перезапуска игры.';
            activeListContainer.parentNode.insertBefore(banner, activeListContainer);
        }

        // Render active mods (ordered)
        activeModIds.forEach((id, index) => {
            const mod = allMods.find(m => m.id === id);
            if (!mod) return;
            const changedFromSnapshot = !snapshotEquals(activeModIds, snapshot);
            activeListContainer.appendChild(createModElement(mod, true, index, validationErrors[id], changedFromSnapshot));
        });

        // Render available mods
        allMods.filter(m => !activeModIds.includes(m.id)).forEach(mod => {
            availableListContainer.appendChild(createModElement(mod, false, -1, null, false));
        });

        if (selectedModId) {
            const mod = allMods.find(m => m.id === selectedModId);
            if (mod) renderModDetails(mod);
        }
    }

    function createModElement(mod, isActive, index, errorMsg, _pendingChanges) {
        const el = document.createElement('div');
        let classes = 'mm-card';
        if (mod.id === selectedModId) classes += ' selected';
        if (mod.id === 'base_game')   classes += ' core-mod';
        if (errorMsg || mod.error)    classes += ' has-error';
        if (mod.runtimeDisabled)      classes += ' runtime-disabled';
        el.className = classes;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'mm-card-info';

        const titleSpan = document.createElement('div');
        titleSpan.className = 'mm-card-title';
        titleSpan.textContent = mod.name || mod.id;

        const versionSpan = document.createElement('span');
        versionSpan.className = 'mm-card-version';
        versionSpan.textContent = `v${mod.version || '1.0'}`;
        titleSpan.appendChild(versionSpan);

        const authorSpan = document.createElement('div');
        authorSpan.className = 'mm-card-author';
        authorSpan.textContent = `от ${mod.author || 'Неизвестно'}`;

        infoDiv.appendChild(titleSpan);
        infoDiv.appendChild(authorSpan);
        el.appendChild(infoDiv);

        if (mod.id !== 'base_game') {
            const controlsDiv = document.createElement('div');
            controlsDiv.className = 'mm-card-controls';

            if (isActive) {
                const upBtn = document.createElement('button');
                upBtn.className = 'mm-ctrl-btn';
                upBtn.title = 'Поднять приоритет';
                upBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
                upBtn.disabled = index <= 1;
                upBtn.addEventListener('click', (e) => { e.stopPropagation(); if (index > 1) moveModUp(index); });

                const downBtn = document.createElement('button');
                downBtn.className = 'mm-ctrl-btn';
                downBtn.title = 'Опустить приоритет';
                downBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
                downBtn.disabled = index >= activeModIds.length - 1;
                downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveModDown(index); });

                const removeBtn = document.createElement('button');
                removeBtn.className = 'mm-ctrl-btn danger';
                removeBtn.title = 'Отключить мод';
                removeBtn.innerHTML = '<i class="fas fa-minus"></i>';
                removeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMod(mod.id, false); });

                controlsDiv.append(upBtn, downBtn, removeBtn);
            } else {
                const addBtn = document.createElement('button');
                addBtn.className = 'mm-ctrl-btn success';
                addBtn.title = mod.runtimeDisabled ? 'Сбросить автоотключение и включить мод' : 'Включить мод';
                addBtn.innerHTML = mod.runtimeDisabled ? '<i class="fas fa-undo"></i>' : '<i class="fas fa-plus"></i>';
                addBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMod(mod.id, true); });
                controlsDiv.appendChild(addBtn);
            }
            el.appendChild(controlsDiv);
        } else {
            const coreBadge = document.createElement('div');
            coreBadge.className = 'mm-core-badge';
            coreBadge.textContent = 'ЯДРО';
            el.appendChild(coreBadge);
        }

        el.addEventListener('click', () => { selectedModId = mod.id; renderLists(); });
        return el;
    }

    // ── Mod order mutations ───────────────────────────────────────────────────
    async function moveModUp(index) {
        if (index <= 1) return;
        [activeModIds[index - 1], activeModIds[index]] = [activeModIds[index], activeModIds[index - 1]];
        await saveModSettings();
        renderLists();
    }

    async function moveModDown(index) {
        if (index === 0 || index >= activeModIds.length - 1) return;
        [activeModIds[index + 1], activeModIds[index]] = [activeModIds[index], activeModIds[index + 1]];
        await saveModSettings();
        renderLists();
    }

    async function toggleMod(modId, enable) {
        if (enable) {
            await clearRuntimeDisabledMod(modId);
            if (!activeModIds.includes(modId)) activeModIds.push(modId);
        } else {
            activeModIds = activeModIds.filter(id => id !== modId);
        }
        await saveModSettings();
        renderLists();
    }

    // ── Persistence ───────────────────────────────────────────────────────────
    async function saveModSettings() {
        const fullSettings = await window.electronAPI.loadSettings() || {};
        const existingModsSettings = fullSettings.mods && typeof fullSettings.mods === 'object' ? fullSettings.mods : {};
        fullSettings.mods = { ...existingModsSettings, active: activeModIds };
        await window.electronAPI.saveSettings(fullSettings);
    }

    // ── Mod details ───────────────────────────────────────────────────────────
    function renderModDetails(mod) {
        modDetailsContent.innerHTML = '';

        if (mod.error) {
            const errBox = document.createElement('div');
            errBox.className = 'mm-details-error';
            const disabledReason = mod.disabledInfo ? escapeHTML(mod.disabledInfo.reason || 'runtime error') : '';
            const disabledAt = mod.disabledInfo ? escapeHTML(mod.disabledInfo.disabled_at || '') : '';
            errBox.innerHTML = `<h3><i class="fas fa-times-circle"></i> ${mod.runtimeDisabled ? 'Мод автоотключён' : 'Ошибка загрузки'}</h3>
                <p><strong>${escapeHTML(mod.name || mod.id)}:</strong> ${escapeHTML(mod.error)}</p>
                ${mod.runtimeDisabled ? `<p class="mm-hint">Причина: ${disabledReason}<br>Время: ${disabledAt}</p><button id="mm-clear-disabled-mod" class="mm-ctrl-btn success" style="padding:8px 12px;">Сбросить блокировку и включить</button>` : '<p class="mm-hint">Проверьте файл mod.json на синтаксические ошибки.</p>'}`;
            modDetailsContent.appendChild(errBox);
            const clearBtn = document.getElementById('mm-clear-disabled-mod');
            if (clearBtn) {
                clearBtn.addEventListener('click', async () => {
                    await toggleMod(mod.id, true);
                    selectedModId = mod.id;
                    renderLists();
                });
            }
            return;
        }

        const snapshot = getLaunchSnapshot() || [];
        const isChanged = !snapshotEquals(activeModIds, snapshot);
        const isActive  = activeModIds.includes(mod.id);

        const headerDiv = document.createElement('div');
        headerDiv.className = 'mm-details-header';
        headerDiv.innerHTML = `<h2>${escapeHTML(mod.name)}</h2>
            <div class="mm-details-badges">
                <span class="mm-badge version">v${escapeHTML(mod.version || '1.0')}</span>
                <span class="mm-badge author"><i class="fas fa-user"></i> ${escapeHTML(mod.author || 'Неизвестный')}</span>
                ${isActive && isChanged ? '<span class="mm-badge" style="background:rgba(241,196,15,0.2);color:#f1c40f;border:1px solid rgba(241,196,15,0.4);">⏳ Ожидает перезапуска</span>' : ''}
            </div>`;

        const idP = document.createElement('p');
        idP.className = 'mm-details-id';
        idP.innerHTML = `<code>ID: ${escapeHTML(mod.id)}</code>`;

        const descDiv = document.createElement('div');
        descDiv.className = 'mm-details-desc';
        descDiv.textContent = mod.description || 'Описание отсутствует.';

        const depsDiv = document.createElement('div');
        depsDiv.className = 'mm-dependencies';
        depsDiv.innerHTML = '<h4><i class="fas fa-link"></i> Зависимости:</h4>';
        const depsList = document.createElement('div');
        depsList.className = 'mm-deps-list';
        (mod.dependencies?.length ? mod.dependencies : []).forEach(dep => {
            const badge = document.createElement('span');
            badge.className = 'mm-dep-badge';
            badge.textContent = dep;
            depsList.appendChild(badge);
        });
        if (!mod.dependencies?.length) {
            const empty = document.createElement('span');
            empty.className = 'mm-dep-badge empty';
            empty.textContent = 'Нет зависимостей';
            depsList.appendChild(empty);
        }
        depsDiv.appendChild(depsList);

        modDetailsContent.append(headerDiv, idP, descDiv, depsDiv);
    }

    // ── Validation ────────────────────────────────────────────────────────────
    function validateLoadOrder() {
        const errors = {};
        const loadedSoFar = new Set();
        modErrorsList.innerHTML = '';
        let hasErrors = false;

        activeModIds.forEach(id => {
            const mod = allMods.find(m => m.id === id);
            if (!mod) return;

            if (mod.error) {
                errors[id] = mod.error;
                const d = document.createElement('div');
                d.innerHTML = `<b>${escapeHTML(mod.name)}:</b> Повреждённый файл mod.json`;
                modErrorsList.appendChild(d);
                hasErrors = true;
            }

            (mod.dependencies || []).forEach(dep => {
                if (!loadedSoFar.has(dep)) {
                    const msg = `Требует мод '${dep}', который должен быть загружен ДО него.`;
                    errors[id] = msg;
                    const d = document.createElement('div');
                    d.innerHTML = `<b>${escapeHTML(mod.name)}:</b> ${escapeHTML(msg)}`;
                    modErrorsList.appendChild(d);
                    hasErrors = true;
                }
            });

            loadedSoFar.add(id);
        });

        modErrorsContainer.style.display = hasErrors ? 'block' : 'none';
        return errors;
    }
});
