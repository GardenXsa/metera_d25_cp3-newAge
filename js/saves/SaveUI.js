// ---   ( ,  ) ---

function escapeHTML(str) {
    if (!str) return '';
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function showLoadGameScreen() {
    await populateLoadGameScreen();
    setActiveScreen('load-game-screen');
}

async function populateLoadGameScreen() {
    manualSaveSlotsList.innerHTML = '';
    autoSaveSlotsList.innerHTML = '';

    const allSavesMap = new Map();

    if (window.electronAPI && window.electronAPI.isElectron) {
        try {
            const fsSaves = await listSaveFilesFromFSA();
            for (const save of fsSaves) {
                const key = `${save.slotType}_${save.slotId}`;
                allSavesMap.set(key, save);
            }
        } catch (e) { console.error(e); }
    }

    try {
        const lsSavesContainer = getAllSavesFromLocalStorage();
        const allLsSaves = [...(lsSavesContainer.manual || []), ...(lsSavesContainer.auto || [])];
        for (const save of allLsSaves) {
            const key = `${save.slotType}_${save.slotId}`;
            if (!allSavesMap.has(key)) allSavesMap.set(key, save);
        }
    } catch (e) { console.error(e); }

    const finalSavesList = Array.from(allSavesMap.values());

    if (finalSavesList.length === 0) {
        manualSaveSlotsList.innerHTML = `<li>${t('loadGame.noManualSaves')}</li>`;
        autoSaveSlotsList.innerHTML = `<li>${t('loadGame.noAutoSaves')}</li>`;
        return;
    }

    const manualSaves = finalSavesList.filter(s => s.slotType === 'manual');
    const autoSaves = finalSavesList.filter(s => s.slotType === 'auto');

    manualSaves.sort((a, b) => a.slotId - b.slotId).forEach(save => manualSaveSlotsList.appendChild(createSaveListItem(save)));

    for (let i = 1; i <= MAX_MANUAL_SAVES; i++) {
        if (!manualSaves.some(s => s.slotId === i)) {
            const li = document.createElement('li');
            li.classList.add('empty-slot');
            li.innerHTML = `<div class="save-info"><span class="slot-name">${t('loadGame.manualSlot', { id: i })} - ${t('loadGame.emptySlot')}</span></div>`;
            manualSaveSlotsList.appendChild(li);
        }
    }

    if (autoSaves.length > 0) {
        autoSaves.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(save => autoSaveSlotsList.appendChild(createSaveListItem(save)));
    } else {
        autoSaveSlotsList.innerHTML = `<li>${t('loadGame.noAutoSaves')}</li>`;
    }
    updateDynamicUIText();
}

function createSaveListItem(saveData) {
    const li = document.createElement('li');
    const date = new Date(saveData.timestamp);
    const formattedDate = date.toLocaleString(currentLanguage, { dateStyle: 'short', timeStyle: 'short' });
    const playerName = saveData.playerData?.name || '???';
    const slotDesc = t(saveData.slotType === 'manual' ? 'loadGame.manualSlot' : 'loadGame.autoSlot', { id: saveData.slotId });
    const sourceInfo = saveData.fileName ? '()' : '(LS)';

    li.innerHTML = `
        <div class="save-info">
            <span class="slot-name">${escapeHTML(slotDesc)} - ${escapeHTML(playerName)} ${escapeHTML(sourceInfo)}</span>
            <span class="save-time">${escapeHTML(formattedDate)}</span>
        </div>
        <div class="save-actions">
            <button class="load-button" data-type="${escapeHTML(saveData.slotType)}" data-id="${escapeHTML(saveData.slotId)}">${t('loadGame.loadButton')}</button>
            <button class="delete-button" data-type="${escapeHTML(saveData.slotType)}" data-id="${escapeHTML(saveData.slotId)}">${t('loadGame.deleteButton')}</button>
        </div>
    `;

    li.querySelector('.load-button').addEventListener('click', () => loadGame(saveData.slotType, saveData.slotId));
    li.querySelector('.delete-button').addEventListener('click', () => deleteSave(saveData.slotType, saveData.slotId));
    return li;
}

async function promptManualSave() {
    if (!player) return;

    if (isWaitingForAI) {
        showCustomAlert("  ,     .");
        return;
    }

    const modal = document.getElementById('save-slot-modal');
    const container = document.getElementById('save-slots-container');
    const closeBtn = document.getElementById('close-save-modal-button');

    if (!modal || !container) {
        console.error("      HTML!");
        return;
    }

    //      ,     
    container.innerHTML = '<p style="text-align:center; color:#5dade2; padding: 20px; font-size: 1.2em;"><i class="fas fa-spinner fa-spin"></i>  ...</p>';
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('visible'), 10);

    //    (Electron  LocalStorage)
    let currentSaves = [];
    if (window.electronAPI && window.electronAPI.isElectron) {
        try {
            const allFiles = await window.electronAPI.listSaves();
            currentSaves = allFiles.filter(f => f.filename.includes('_manual_'));
        } catch (e) { console.error(e); }
    } else {
        const ls = getAllSavesFromLocalStorage();
        currentSaves = ls.manual || [];
    }

    //     ""
    container.innerHTML = '';

    //  5   
    for (let i = 1; i <= MAX_MANUAL_SAVES; i++) {
        const btn = document.createElement('button');
        btn.className = 'save-slot-btn';

        let existingInfo = null;

        if (window.electronAPI && window.electronAPI.isElectron) {
            const file = currentSaves.find(f => f.filename.includes(`_manual_${i}.json`));
            if (file) {
                const dateStr = file.timestamp ? new Date(file.timestamp).toLocaleString() : "";
                const name = escapeHTML(file.playerData?.name || "");
                const lvl = file.playerData?.stats?.level || "?";
                existingInfo = `${name} (.${lvl}) - ${escapeHTML(dateStr)}`;
            }
        } else {
            const save = currentSaves.find(s => s.slotId === i);
            if (save) {
                const dateStr = new Date(save.timestamp).toLocaleString();
                existingInfo = `${escapeHTML(save.playerData.name)} (.${save.playerData.stats.level}) - ${escapeHTML(dateStr)}`;
            }
        }

        const infoText = existingInfo || " ";

        btn.innerHTML = `
            <span class="save-slot-id"> ${i}</span>
            <span class="save-slot-info">${escapeHTML(infoText)}</span>
        `;

        btn.onclick = async () => {
            if (existingInfo) {
                const confirmMsg = `  ${i}?\n(${infoText})`;
                if (typeof showCustomConfirm === 'function') {
                    const confirmed = await new Promise(resolve => showCustomConfirm(confirmMsg, () => resolve(true)));
                    if (!confirmed) return;
                } else {
                    if (!confirm(confirmMsg)) return;
                }
            }

            btn.innerHTML = `<span class="save-slot-info" style="text-align:center; width:100%; color:#f1c40f;"><i class="fas fa-spinner fa-spin"></i> ...</span>`;
            btn.style.pointerEvents = 'none';

            const success = await saveGame('manual', i);

            if (success) {
                showCustomAlert(`     ${i}!`);
                modal.classList.remove('visible');
                setTimeout(() => modal.style.display = 'none', 300);
            } else {
                promptManualSave(); //   
            }
        };

        container.appendChild(btn);
    }

    //  
    const closeModal = () => {
        modal.classList.remove('visible');
        setTimeout(() => modal.style.display = 'none', 300);
    };

    const newCloseBtn = closeBtn.cloneNode(true);
    closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

    newCloseBtn.addEventListener('click', closeModal);
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };
}

