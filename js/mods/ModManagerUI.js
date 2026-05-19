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
        let classes = 'rw-mod-item';
        if (mod.id === selectedModId) classes += ' selected';
        if (mod.id === 'base_game') classes += ' core-mod';
        if (errorMsg || mod.error) classes += ' has-error';
        el.className = classes;

        // Build info section using safe DOM API (no innerHTML with user data)
        const infoDiv = document.createElement('div');
        infoDiv.className = 'rw-mod-info';

        const titleSpan = document.createElement('span');
        titleSpan.className = 'rw-mod-title';
        titleSpan.textContent = mod.name || mod.id; // textContent = auto-escaped

        const authorSpan = document.createElement('span');
        authorSpan.className = 'rw-mod-author';
        authorSpan.textContent = mod.author || 'Неизвестно'; // textContent = auto-escaped

        infoDiv.appendChild(titleSpan);
        infoDiv.appendChild(authorSpan);
        el.appendChild(infoDiv);

        // Controls (only onclick handlers with escaped mod.id)
        const safeModId = escapeHTML(mod.id);
        if (mod.id !== 'base_game') {
            const controlsDiv = document.createElement('div');
            controlsDiv.className = 'rw-mod-controls';
            if (isActive) {
                const upBtn = document.createElement('div');
                upBtn.className = 'rw-btn';
                upBtn.title = 'Вверх';
                upBtn.innerHTML = '<i class="fas fa-chevron-up"></i>';
                upBtn.addEventListener('click', (e) => { e.stopPropagation(); moveModUp(index); });

                const downBtn = document.createElement('div');
                downBtn.className = 'rw-btn';
                downBtn.title = 'Вниз';
                downBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
                downBtn.addEventListener('click', (e) => { e.stopPropagation(); moveModDown(index); });

                const removeBtn = document.createElement('div');
                removeBtn.className = 'rw-btn rw-btn-remove';
                removeBtn.title = 'Отключить';
                removeBtn.innerHTML = '<i class="fas fa-times"></i>';
                removeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMod(mod.id, false); });

                controlsDiv.appendChild(upBtn);
                controlsDiv.appendChild(downBtn);
                controlsDiv.appendChild(removeBtn);
            } else {
                const addBtn = document.createElement('div');
                addBtn.className = 'rw-btn rw-btn-add';
                addBtn.title = 'Включить';
                addBtn.innerHTML = '<i class="fas fa-plus"></i>';
                addBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleMod(mod.id, true); });

                controlsDiv.appendChild(addBtn);
            }
            el.appendChild(controlsDiv);
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
        // Use safe DOM API — textContent auto-escapes, prevents XSS from mod metadata
        modDetailsContent.innerHTML = '';

        if (mod.error) {
            const h3 = document.createElement('h3');
            h3.textContent = mod.name || mod.id;

            const errP = document.createElement('p');
            errP.className = 'error-text';
            const strong = document.createElement('strong');
            strong.textContent = 'Ошибка загрузки: ';
            errP.appendChild(strong);
            errP.appendChild(document.createTextNode(mod.error));

            const hintP = document.createElement('p');
            hintP.textContent = 'Этот мод не может быть загружен. Проверьте файл mod.json.';

            modDetailsContent.appendChild(h3);
            modDetailsContent.appendChild(errP);
            modDetailsContent.appendChild(hintP);
            return;
        }

        const h2 = document.createElement('h2');
        h2.style.cssText = 'color: #5dade2; margin-top: 0; margin-bottom: 5px;';
        h2.textContent = mod.name;

        const idP = document.createElement('p');
        idP.style.cssText = 'color: #7f8c8d; font-family: monospace; margin-top: 0;';
        idP.textContent = `ID: ${mod.id} | Версия: ${mod.version || '1.0'}`;

        const authorP = document.createElement('p');
        authorP.style.cssText = 'color: #f39c12; font-size: 0.9em;';
        const authorIcon = document.createElement('i');
        authorIcon.className = 'fas fa-user';
        authorP.appendChild(authorIcon);
        authorP.appendChild(document.createTextNode(` Автор: ${mod.author || 'Неизвестный автор'}`));

        const descDiv = document.createElement('div');
        descDiv.style.cssText = 'background: rgba(0,0,0,0.4); padding: 10px; border-radius: 6px; border-left: 3px solid #3498db; margin: 15px 0;';
        const descP = document.createElement('p');
        descP.style.cssText = 'margin: 0; color: #ecf0f1;';
        descP.textContent = mod.description || 'Описание отсутствует.';
        descDiv.appendChild(descP);

        const depsDiv = document.createElement('div');
        depsDiv.className = 'mod-dependencies';
        depsDiv.style.cssText = 'margin-top: 15px;';
        const depsH4 = document.createElement('h4');
        depsH4.style.cssText = 'color: #aeb6bf; margin-bottom: 5px;';
        const depsIcon = document.createElement('i');
        depsIcon.className = 'fas fa-link';
        depsH4.appendChild(depsIcon);
        depsH4.appendChild(document.createTextNode(' Зависимости:'));
        depsDiv.appendChild(depsH4);

        const depsUl = document.createElement('ul');
        depsUl.style.cssText = 'margin: 0; padding-left: 20px; color: #95a5a6;';
        if (mod.dependencies && mod.dependencies.length > 0) {
            for (const dep of mod.dependencies) {
                const li = document.createElement('li');
                li.textContent = dep; // auto-escaped
                depsUl.appendChild(li);
            }
        } else {
            const li = document.createElement('li');
            const em = document.createElement('i');
            em.textContent = 'Нет зависимостей (только base_game)';
            li.appendChild(em);
            depsUl.appendChild(li);
        }
        depsDiv.appendChild(depsUl);

        modDetailsContent.appendChild(h2);
        modDetailsContent.appendChild(idP);
        modDetailsContent.appendChild(authorP);
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
