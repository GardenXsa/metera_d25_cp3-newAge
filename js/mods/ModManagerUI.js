/**
 * ModManagerUI.js
 * 
 * Управляет интерфейсом Менеджера Модификаций.
 */

document.addEventListener('DOMContentLoaded', () => {
    console.log('[ModManagerUI] DOMContentLoaded fired. Initializing...');

    const modsButton = document.getElementById('mods-button');
    const modsBackButton = document.getElementById('mods-back-button');
    const modsMenu = document.getElementById('mods-menu');
    const mainMenu = document.getElementById('main-menu');
    const openModsFolderButton = document.getElementById('open-mods-folder-button');

    console.log('[ModManagerUI] DOM Elements:', { modsButton, modsMenu, mainMenu });

    if (!modsButton || !modsMenu || !mainMenu) {
        console.error('[ModManagerUI] CRITICAL: Could not find essential menu elements. Mod menu will not function.');
        return;
    }

    const availableListContainer = document.getElementById('available-mods-list');
    const activeListContainer = document.getElementById('active-mods-list');
    const modDetailsContent = document.getElementById('mod-details-content');
    const modErrorsContainer = document.getElementById('mod-errors-container');
    const modErrorsList = document.getElementById('mod-errors-list');

    let allMods = [];
    let activeModIds = []; // Массив строк, строго определяющий порядок загрузки
    let selectedModId = null;

    // --- HTML Escaping utility (prevents XSS from mod metadata) ---
    function escapeHTML(str) {
        if (typeof str !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // --- Навигация и базовые события ---
    modsButton.addEventListener('click', () => {
        console.log('[ModManagerUI] "Mods" button clicked!');
        mainMenu.classList.remove('active-screen');
        modsMenu.style.display = 'flex';
        requestAnimationFrame(() => {
            modsMenu.classList.add('active-screen');
        });
        initializeModManager();
    });

    modsBackButton.addEventListener('click', () => {
        modsMenu.classList.remove('active-screen');
        setTimeout(() => {
            modsMenu.style.display = 'none';
            mainMenu.style.display = 'flex';
            mainMenu.classList.add('active-screen');
        }, 300);
    });

    openModsFolderButton.addEventListener('click', () => {
        window.electronAPI.modsOpenFolder();
    });

    // --- Основная логика ---
    async function initializeModManager() {
        console.log('[ModManagerUI] Initializing mod manager data...');
        const settings = await window.electronAPI.loadSettings();
        activeModIds = (settings && settings.mods && settings.mods.active) ? settings.mods.active : ['base_game'];
        
        // Гарантируем, что base_game всегда первый
        if (!activeModIds.includes('base_game')) activeModIds.unshift('base_game');
        if (activeModIds[0] !== 'base_game') {
            activeModIds = activeModIds.filter(id => id !== 'base_game');
            activeModIds.unshift('base_game');
        }

        const response = await window.electronAPI.modsGetList();
        if (response.success) {
            allMods = response.mods;
            // Добавляем фиктивный объект для Ядра игры, чтобы он отображался в списке
            if (!allMods.find(m => m.id === 'base_game')) {
                allMods.push({ id: 'base_game', name: 'Core (Ядро Игры)', author: 'MrKins', description: 'Базовые файлы игры. Должно загружаться первым.', version: '1.0' });
            }
            renderLists();
        } else {
            modErrorsContainer.style.display = 'block';
            modErrorsList.textContent = 'Критическая ошибка: не удалось прочитать папку модов.';
        }
    }

    function renderLists() {
        availableListContainer.innerHTML = '';
        activeListContainer.innerHTML = '';

        const validationErrors = validateLoadOrder();

        // Рендер Активных модов (строго по порядку activeModIds)
        activeModIds.forEach((id, index) => {
            const mod = allMods.find(m => m.id === id);
            if (!mod) return; // Мод удален с диска

            const el = createModElement(mod, true, index, validationErrors[id]);
            activeListContainer.appendChild(el);
        });

        // Рендер Доступных модов (те, которых нет в activeModIds)
        const availableMods = allMods.filter(m => !activeModIds.includes(m.id));
        availableMods.forEach(mod => {
            const el = createModElement(mod, false, -1, null);
            availableListContainer.appendChild(el);
        });

        if (selectedModId) {
            const mod = allMods.find(m => m.id === selectedModId);
            if (mod) renderModDetails(mod);
        }
    }

    function createModElement(mod, isActive, index, errorMsg) {
        const el = document.createElement('div');
        let classes = 'mm-card';
        if (mod.id === selectedModId) classes += ' selected';
        if (mod.id === 'base_game') classes += ' core-mod';
        if (errorMsg || mod.error) classes += ' has-error';
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
                upBtn.disabled = index <= 1; // Cannot move above base_game
                upBtn.addEventListener('click', (e) => { e.stopPropagation(); if(index > 1) moveModUp(index); });

                const downBtn = document.createElement('button');
                downBtn.className = 'mm-ctrl-btn';
                downBtn.title = 'Опустить приоритет';
                downBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
                downBtn.disabled = index === 0 || index >= activeModIds.length - 1;
                downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveModDown(index); });

                const removeBtn = document.createElement('button');
                removeBtn.className = 'mm-ctrl-btn danger';
                removeBtn.title = 'Отключить мод';
                removeBtn.innerHTML = '<i class="fas fa-minus"></i>';
                removeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMod(mod.id, false); });

                controlsDiv.appendChild(upBtn);
                controlsDiv.appendChild(downBtn);
                controlsDiv.appendChild(removeBtn);
            } else {
                const addBtn = document.createElement('button');
                addBtn.className = 'mm-ctrl-btn success';
                addBtn.title = 'Включить мод';
                addBtn.innerHTML = '<i class="fas fa-plus"></i>';
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

        el.addEventListener('click', () => {
            selectedModId = mod.id;
            renderLists();
        });

        return el;
    }

    async function moveModUp(index) {
        if (index <= 1) return; // Нельзя двигать выше base_game (индекс 0)
        const temp = activeModIds[index - 1];
        activeModIds[index - 1] = activeModIds[index];
        activeModIds[index] = temp;
        await saveModSettings();
        renderLists();
    }

    async function moveModDown(index) {
        if (index === 0 || index >= activeModIds.length - 1) return;
        const temp = activeModIds[index + 1];
        activeModIds[index + 1] = activeModIds[index];
        activeModIds[index] = temp;
        await saveModSettings();
        renderLists();
    }

    async function toggleMod(modId, enable) {
        if (enable) {
            if (!activeModIds.includes(modId)) activeModIds.push(modId);
        } else {
            activeModIds = activeModIds.filter(id => id !== modId);
        }
        await saveModSettings();
        renderLists();
    }

    function renderModDetails(mod) {
        modDetailsContent.innerHTML = '';

        if (mod.error) {
            const errBox = document.createElement('div');
            errBox.className = 'mm-details-error';
            errBox.innerHTML = `<h3><i class="fas fa-times-circle"></i> Ошибка загрузки</h3><p><strong>${escapeHTML(mod.name || mod.id)}:</strong> ${escapeHTML(mod.error)}</p><p class="mm-hint">Проверьте файл mod.json на синтаксические ошибки.</p>`;
            modDetailsContent.appendChild(errBox);
            return;
        }

        const headerDiv = document.createElement('div');
        headerDiv.className = 'mm-details-header';
        
        const h2 = document.createElement('h2');
        h2.textContent = mod.name;
        
        const badgesDiv = document.createElement('div');
        badgesDiv.className = 'mm-details-badges';
        badgesDiv.innerHTML = `<span class="mm-badge version">v${escapeHTML(mod.version || '1.0')}</span><span class="mm-badge author"><i class="fas fa-user"></i> ${escapeHTML(mod.author || 'Неизвестный')}</span>`;
        
        headerDiv.appendChild(h2);
        headerDiv.appendChild(badgesDiv);

        const idP = document.createElement('p');
        idP.className = 'mm-details-id';
        idP.innerHTML = `<code>ID: ${escapeHTML(mod.id)}</code>`;

        const descDiv = document.createElement('div');
        descDiv.className = 'mm-details-desc';
        descDiv.textContent = mod.description || 'Описание отсутствует.';

        const depsDiv = document.createElement('div');
        depsDiv.className = 'mm-dependencies';
        const depsTitle = document.createElement('h4');
        depsTitle.innerHTML = '<i class="fas fa-link"></i> Зависимости:';
        depsDiv.appendChild(depsTitle);

        const depsList = document.createElement('div');
        depsList.className = 'mm-deps-list';
        if (mod.dependencies && mod.dependencies.length > 0) {
            mod.dependencies.forEach(dep => {
                const badge = document.createElement('span');
                badge.className = 'mm-dep-badge';
                badge.textContent = dep;
                depsList.appendChild(badge);
            });
        } else {
            const badge = document.createElement('span');
            badge.className = 'mm-dep-badge empty';
            badge.textContent = 'Нет зависимостей';
            depsList.appendChild(badge);
        }
        depsDiv.appendChild(depsList);

        modDetailsContent.appendChild(headerDiv);
        modDetailsContent.appendChild(idP);
        modDetailsContent.appendChild(descDiv);
        modDetailsContent.appendChild(depsDiv);
    }

    async function saveModSettings() {
        const fullSettings = await window.electronAPI.loadSettings() || {};
        fullSettings.mods = { active: activeModIds };
        await window.electronAPI.saveSettings(fullSettings);
    }

    function validateLoadOrder() {
        const errors = {};

        // Проходим по списку активных модов СВЕРХУ ВНИЗ
        const loadedSoFar = new Set();

        // Clear and rebuild error list safely
        modErrorsList.innerHTML = '';
        let hasErrors = false;

        activeModIds.forEach(id => {
            const mod = allMods.find(m => m.id === id);
            if (!mod) return;

            if (mod.error) {
                errors[id] = mod.error;
                const errDiv = document.createElement('div');
                const bold = document.createElement('b');
                bold.textContent = mod.name + ':';
                errDiv.appendChild(bold);
                errDiv.appendChild(document.createTextNode(' Поврежденный файл mod.json'));
                modErrorsList.appendChild(errDiv);
                hasErrors = true;
            }

            if (mod.dependencies && Array.isArray(mod.dependencies)) {
                for (const dep of mod.dependencies) {
                    if (!loadedSoFar.has(dep)) {
                        // Ошибка: зависимость не загружена ДО этого мода
                        const errMsg = `Требует мод '${dep}', который должен быть загружен ДО него.`;
                        errors[id] = errMsg;
                        const errDiv = document.createElement('div');
                        const bold = document.createElement('b');
                        bold.textContent = mod.name + ':';
                        errDiv.appendChild(bold);
                        errDiv.appendChild(document.createTextNode(' ' + errMsg));
                        modErrorsList.appendChild(errDiv);
                        hasErrors = true;
                    }
                }
            }
            loadedSoFar.add(id);
        });

        if (hasErrors) {
            modErrorsContainer.style.display = 'block';
        } else {
            modErrorsContainer.style.display = 'none';
        }

        return errors;
    }
});
