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
            modErrorsList.innerHTML = `Критическая ошибка: не удалось прочитать папку модов.`;
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

        let controlsHtml = '';
        if (mod.id !== 'base_game') {
            if (isActive) {
                controlsHtml = `
                    <div class="rw-mod-controls">
                        <div class="rw-btn" onclick="moveModUp(${index}, event)" title="Вверх"><i class="fas fa-chevron-up"></i></div>
                        <div class="rw-btn" onclick="moveModDown(${index}, event)" title="Вниз"><i class="fas fa-chevron-down"></i></div>
                        <div class="rw-btn rw-btn-remove" onclick="toggleMod('${mod.id}', false, event)" title="Отключить"><i class="fas fa-times"></i></div>
                    </div>
                `;
            } else {
                controlsHtml = `
                    <div class="rw-mod-controls">
                        <div class="rw-btn rw-btn-add" onclick="toggleMod('${mod.id}', true, event)" title="Включить"><i class="fas fa-plus"></i></div>
                    </div>
                `;
            }
        }

        el.innerHTML = `
            <div class="rw-mod-info">
                <span class="rw-mod-title">${mod.name || mod.id}</span>
                <span class="rw-mod-author">${mod.author || 'Неизвестно'}</span>
            </div>
            ${controlsHtml}
        `;

        el.addEventListener('click', () => {
            selectedModId = mod.id;
            renderLists();
        });

        return el;
    }

    window.moveModUp = async function(index, e) {
        e.stopPropagation();
        if (index <= 1) return; // Нельзя двигать выше base_game (индекс 0)
        const temp = activeModIds[index - 1];
        activeModIds[index - 1] = activeModIds[index];
        activeModIds[index] = temp;
        await saveModSettings();
        renderLists();
    };

    window.moveModDown = async function(index, e) {
        e.stopPropagation();
        if (index === 0 || index >= activeModIds.length - 1) return;
        const temp = activeModIds[index + 1];
        activeModIds[index + 1] = activeModIds[index];
        activeModIds[index] = temp;
        await saveModSettings();
        renderLists();
    };

    window.toggleMod = async function(modId, enable, e) {
        e.stopPropagation();
        if (enable) {
            if (!activeModIds.includes(modId)) activeModIds.push(modId);
        } else {
            activeModIds = activeModIds.filter(id => id !== modId);
        }
        await saveModSettings();
        renderLists();
    };

    function renderModDetails(mod) {
        if (mod.error) {
            modDetailsContent.innerHTML = `
                <h3>${mod.name || mod.id}</h3>
                <p class="error-text"><strong>Ошибка загрузки:</strong> ${mod.error}</p>
                <p>Этот мод не может быть загружен. Проверьте файл mod.json.</p>
            `;
            return;
        }

        modDetailsContent.innerHTML = `
            <h2 style="color: #5dade2; margin-top: 0; margin-bottom: 5px;">${mod.name}</h2>
            <p style="color: #7f8c8d; font-family: monospace; margin-top: 0;">ID: ${mod.id} | Версия: ${mod.version || '1.0'}</p>
            <p style="color: #f39c12; font-size: 0.9em;"><i class="fas fa-user"></i> Автор: ${mod.author || 'Неизвестный автор'}</p>
            <div style="background: rgba(0,0,0,0.4); padding: 10px; border-radius: 6px; border-left: 3px solid #3498db; margin: 15px 0;">
                <p style="margin: 0; color: #ecf0f1;">${mod.description || 'Описание отсутствует.'}</p>
            </div>
            <div class="mod-dependencies" style="margin-top: 15px;">
                <h4 style="color: #aeb6bf; margin-bottom: 5px;"><i class="fas fa-link"></i> Зависимости:</h4>
                <ul style="margin: 0; padding-left: 20px; color: #95a5a6;">
                    ${(mod.dependencies && mod.dependencies.length > 0) ? 
                        mod.dependencies.map(dep => `<li>${dep}</li>`).join('') : 
                        '<li><i>Нет зависимостей (только base_game)</i></li>'
                    }
                </ul>
            </div>
        `;
    }

    async function saveModSettings() {
        const fullSettings = await window.electronAPI.loadSettings() || {};
        fullSettings.mods = { active: activeModIds };
        await window.electronAPI.saveSettings(fullSettings);
    }

    function validateLoadOrder() {
        const errors = {};
        let globalErrorHtml = '';

        // Проходим по списку активных модов СВЕРХУ ВНИЗ
        const loadedSoFar = new Set();

        activeModIds.forEach(id => {
            const mod = allMods.find(m => m.id === id);
            if (!mod) return;

            if (mod.error) {
                errors[id] = mod.error;
                globalErrorHtml += `<div><b>${mod.name}:</b> Поврежденный файл mod.json</div>`;
            }

            if (mod.dependencies && Array.isArray(mod.dependencies)) {
                for (const dep of mod.dependencies) {
                    if (!loadedSoFar.has(dep)) {
                        // Ошибка: зависимость не загружена ДО этого мода
                        const errMsg = `Требует мод '${dep}', который должен быть загружен ДО него.`;
                        errors[id] = errMsg;
                        globalErrorHtml += `<div><b>${mod.name}:</b> ${errMsg}</div>`;
                    }
                }
            }
            loadedSoFar.add(id);
        });

        if (globalErrorHtml) {
            modErrorsContainer.style.display = 'block';
            modErrorsList.innerHTML = globalErrorHtml;
        } else {
            modErrorsContainer.style.display = 'none';
        }

        return errors;
    }
});
