// --- ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ ДЛЯ НАСТРОЕК AI ---
let currentApiProvider = 'gemini'; // 'gemini', 'llmost', 'openrouter', 'local'
let usePromptCaching = true;
let useThinkingMode = false;
let thinkingBudget = 2048;
let reasoningEffort = 'medium';
let allowNSFW = false;


// Gemini
let geminiApiKeys = []; // Deduplication enforced via addGeminiKey / removeGeminiKey
let geminiApiKey = ''; // Единый активный ключ
let currentGeminiKeyIndex = 0;
let geminiModelId = 'gemini-3.1-flash-lite-preview';

// user-input
let lastUserPrompt = "";

// LLMost
let llmostApiKey = '';
let llmostModelId = 'openai/gpt-4';

// OpenRouter
let openrouterApiKey = '';
let openrouterModelId = 'anthropic/claude-3-haiku';
let deepseekApiKey = '';
let deepseekModelId = 'deepseek-chat';
let omnirouteApiKey = '';
let omnirouteModelId = 'anthropic/claude-3-sonnet';
let omnirouteBaseUrl = 'https://api.omniroute.ai/v1/chat/completions';

// Local (LM Studio)
let localApiUrl = 'http://localhost:1234/v1/chat/completions';
let localModelId = 'local-model';

// Image Generation Settings
let imgApiProvider = 'pollinations';
let imgApiKey = '';
let imgModelId = 'dall-e-3';
let enableImageGeneration = true;

let enableDeepSetup = false;
const enableWorldSim = true; // Ядро игры, всегда включено
let isSimulatingWorld = false;
let IS_PRE_SIMULATING = false;


let lowSpecMode = localStorage.getItem('lowSpecMode') === 'true';

// --- AI ИГРОК (АВТО-ТЕСТЕР) ---
let aiPlayerEnabled = false;
let aiPlayerProvider = 'openrouter';
let aiPlayerModelId = 'google/gemma-2-9b-it:free';
let aiPlayerApiKey = '';
let aiPlayerLocalUrl = 'http://localhost:1234/v1/chat/completions';
let isAutoTesting = false;
let aiPlayerTurnLimit = 20;
let aiPlayerCurrentTurns = 0;

// --- GEMINI KEY MANAGEMENT (deduplication-safe) ---
function addGeminiKey(key) {
    if (!key || typeof key !== 'string') return false;
    const trimmed = key.trim();
    if (!trimmed || geminiApiKeys.includes(trimmed)) return false;
    geminiApiKeys.push(trimmed);
    if (!geminiApiKey) geminiApiKey = trimmed;
    return true;
}

function removeGeminiKey(key) {
    const idx = geminiApiKeys.indexOf(key);
    if (idx === -1) return false;
    geminiApiKeys.splice(idx, 1);
    // If the active key was removed, switch to the first available
    if (geminiApiKey === key) {
        geminiApiKey = geminiApiKeys.length > 0 ? geminiApiKeys[currentGeminiKeyIndex % geminiApiKeys.length] : '';
    }
    return true;
}

function setGeminiKeys(keysArray) {
    if (!Array.isArray(keysArray)) return;
    // Deduplicate and filter empty strings
    const seen = new Set();
    geminiApiKeys = keysArray.filter(k => {
        if (!k || typeof k !== 'string') return false;
        const trimmed = k.trim();
        if (seen.has(trimmed)) return false;
        seen.add(trimmed);
        return true;
    });
    if (geminiApiKeys.length > 0 && !geminiApiKey) {
        geminiApiKey = geminiApiKeys[0];
    }
    currentGeminiKeyIndex = 0;
}
