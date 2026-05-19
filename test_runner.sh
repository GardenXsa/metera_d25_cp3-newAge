#!/bin/bash
# ============================================================
# METERA PRE-COMMIT TEST SUITE
# Флаги:
#   --quick    = только синтаксис/структура (по умолчанию)
#   --full     = синтаксис + интеграционные тесты (stub provider)
#   --game     = полный запуск игры через stub provider
#   --verbose  = подробный вывод
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0
VERBOSE=false

# Parse flags
MODE="quick"
for arg in "$@"; do
    case "$arg" in
        --quick)   MODE="quick" ;;
        --full)    MODE="full" ;;
        --game)    MODE="game" ;;
        --verbose) VERBOSE=true ;;
    esac
done

echo "============================================"
echo -e "  METERA D25 — PRE-COMMIT TEST SUITE"
echo -e "  Mode: ${CYAN}${MODE}${NC}"
echo "============================================"
echo ""

# ----------------------------------------------------------
# TEST 1: JavaScript Syntax Validation
# ----------------------------------------------------------
echo -n "[1] JS Syntax Check ... "
JS_FILES=(
    "js/cartographer/globalMap.js"
    "js/mods/ModLoader.js"
    "js/mods/ModManagerUI.js"
    "js/mods/ModLoaderIntegration.js"
    "js/core/dom_elements.js"
    "js/core/globals.js"
    "js/core/constants.js"
    "js/core/ai_config.js"
    "js/saves/SaveUI.js"
    "js/saves/SaveManager.js"
    "js/saves/StorageProvider.js"
    "script.js"
    "main.js"
)

JS_OK=true
JS_ERRORS=""
for f in "${JS_FILES[@]}"; do
    if [ -f "$f" ]; then
        if ! node -c "$f" 2>/dev/null; then
            JS_OK=false
            JS_ERRORS="$JS_ERRORS  FAIL: $f\n"
        fi
    else
        JS_ERRORS="$JS_ERRORS  SKIP: $f (not found)\n"
    fi
done

if $JS_OK; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS+1))
else
    echo -e "${RED}FAIL${NC}"
    echo -e "$JS_ERRORS"
    FAIL=$((FAIL+1))
fi

# ----------------------------------------------------------
# TEST 2: Python Syntax Validation
# ----------------------------------------------------------
echo -n "[2] Python Syntax Check ... "
PY_OK=true
PY_ERRORS=""
PY_FILES=$(find . -name "*.py" -not -path "./.git/*" -not -path "./node_modules/*" 2>/dev/null)
for f in $PY_FILES; do
    if ! python3 -c "import py_compile; py_compile.compile('$f', doraise=True)" 2>/dev/null; then
        PY_OK=false
        PY_ERRORS="$PY_ERRORS  FAIL: $f\n"
    fi
done

if $PY_OK; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS+1))
else
    echo -e "${RED}FAIL${NC}"
    echo -e "$PY_ERRORS"
    FAIL=$((FAIL+1))
fi

# ----------------------------------------------------------
# TEST 3: HTML Structure Check
# ----------------------------------------------------------
echo -n "[3] HTML Structure Check ... "
if [ -f "index.html" ]; then
    if grep -q "<!DOCTYPE" index.html && grep -q "</html>" index.html && grep -q "</head>" index.html && grep -q "</body>" index.html; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS+1))
    else
        echo -e "${RED}FAIL (missing basic HTML structure)${NC}"
        FAIL=$((FAIL+1))
    fi
else
    echo -e "${YELLOW}SKIP (index.html not found)${NC}"
    WARN=$((WARN+1))
fi

# ----------------------------------------------------------
# TEST 4: JSON Validity Check
# ----------------------------------------------------------
echo -n "[4] JSON Files Check ... "
JSON_OK=true
JSON_ERRORS=""
JSON_FILES=$(find . -name "*.json" -not -path "./.git/*" -not -path "./node_modules/*" -not -path "./package-lock.json" 2>/dev/null)
for f in $JSON_FILES; do
    if ! python3 -c "import json; json.load(open('$f'))" 2>/dev/null; then
        JSON_OK=false
        JSON_ERRORS="$JSON_ERRORS  FAIL: $f\n"
    fi
done

if $JSON_OK; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS+1))
else
    echo -e "${RED}FAIL${NC}"
    echo -e "$JSON_ERRORS"
    FAIL=$((FAIL+1))
fi

# ----------------------------------------------------------
# TEST 5: CSS Syntax Check (basic)
# ----------------------------------------------------------
echo -n "[5] CSS Files Check ... "
CSS_OK=true
CSS_ERRORS=""
CSS_FILES=$(find . -name "*.css" -not -path "./.git/*" -not -path "./node_modules/*" 2>/dev/null)
for f in $CSS_FILES; do
    OPEN=$(grep -o "{" "$f" | wc -l)
    CLOSE=$(grep -o "}" "$f" | wc -l)
    if [ "$OPEN" -ne "$CLOSE" ]; then
        CSS_OK=false
        CSS_ERRORS="$CSS_ERRORS  FAIL: $f (braces: $OPEN open, $CLOSE close)\n"
    fi
done

if $CSS_OK; then
    echo -e "${GREEN}PASS${NC}"
    PASS=$((PASS+1))
else
    echo -e "${RED}FAIL${NC}"
    echo -e "$CSS_ERRORS"
    FAIL=$((FAIL+1))
fi

# ----------------------------------------------------------
# TEST 6: Dependency Check (package.json → node_modules)
# ----------------------------------------------------------
echo -n "[6] Dependencies Check ... "
if [ -f "package.json" ] && command -v node &>/dev/null; then
    MISSING=$(node -e "
        const pkg = require('./package.json');
        const deps = {...(pkg.dependencies || {}), ...(pkg.devDependencies || {})};
        const missing = Object.keys(deps).filter(d => {
            try { require.resolve(d); return false; } catch { return true; }
        });
        if (missing.length) { console.log(missing.join(', ')); process.exit(1); }
    " 2>/dev/null)
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS+1))
    else
        echo -e "${YELLOW}WARN (missing: $MISSING)${NC}"
        WARN=$((WARN+1))
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    WARN=$((WARN+1))
fi

# ----------------------------------------------------------
# TEST 7: Electron Main Process Check
# ----------------------------------------------------------
echo -n "[7] Electron Main Process ... "
if [ -f "main.js" ]; then
    if grep -q "BrowserWindow" main.js && grep -q "loadFile\|loadURL" main.js; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS+1))
    else
        echo -e "${RED}FAIL (missing BrowserWindow or loadFile/loadURL)${NC}"
        FAIL=$((FAIL+1))
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    WARN=$((WARN+1))
fi

# ----------------------------------------------------------
# TEST 8: Script References Check
# ----------------------------------------------------------
echo -n "[8] Script References in HTML ... "
if [ -f "index.html" ]; then
    REF_OK=true
    REF_ERRORS=""
    SCRIPTS=$(grep -oP 'src="([^"]+\.js)"' index.html | grep -oP '"[^"]+"' | tr -d '"')
    for s in $SCRIPTS; do
        if [[ "$s" == http://* ]] || [[ "$s" == https://* ]]; then
            continue
        fi
        local_path="${s#/}"
        if [ ! -f "$local_path" ]; then
            REF_OK=false
            REF_ERRORS="$REF_ERRORS  MISSING: $s\n"
        fi
    done
    if $REF_OK; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS+1))
    else
        echo -e "${RED}FAIL${NC}"
        echo -e "$REF_ERRORS"
        FAIL=$((FAIL+1))
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    WARN=$((WARN+1))
fi

# ----------------------------------------------------------
# TEST 9: CSP Headers Check
# ----------------------------------------------------------
echo -n "[9] CSP Headers Check ... "
if [ -f "main.js" ]; then
    if grep -q "Content-Security-Policy" main.js; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS+1))
    else
        echo -e "${YELLOW}WARN (no CSP headers found)${NC}"
        WARN=$((WARN+1))
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    WARN=$((WARN+1))
fi

# ----------------------------------------------------------
# TEST 10: Engine Binary Check
# ----------------------------------------------------------
echo -n "[10] C++ Engine Binary ... "
if [ -f "engine/meterea_engine" ]; then
    if [ -x "engine/meterea_engine" ]; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS+1))
    else
        echo -e "${YELLOW}WARN (exists but not executable — chmod +x?)${NC}"
        WARN=$((WARN+1))
    fi
else
    echo -e "${YELLOW}SKIP (engine not compiled)${NC}"
    WARN=$((WARN+1))
fi

# ============================================================
# INTEGRATION TESTS (--full and --game modes)
# ============================================================

if [ "$MODE" = "full" ] || [ "$MODE" = "game" ]; then
    echo ""
    echo "──────────────────────────────────────────────"
    echo -e "  ${CYAN}INTEGRATION TESTS (Stub Provider)${NC}"
    echo "──────────────────────────────────────────────"

    # ----------------------------------------------------------
    # TEST 11: Stub Provider Game Logic Test
    # ----------------------------------------------------------
    echo -n "[11] Stub Provider Game Logic ... "
    if [ -f "tests/test_stub_game.js" ]; then
        VERBOSE_FLAG=""
        $VERBOSE && VERBOSE_FLAG="--verbose"
        GAME_OUTPUT=$(node tests/test_stub_game.js $VERBOSE_FLAG 2>&1)
        GAME_EXIT=$?

        if $VERBOSE; then
            echo ""
            echo "$GAME_OUTPUT" | tail -30
        fi

        if [ $GAME_EXIT -eq 0 ]; then
            # Count passed tests from output
            GAME_PASS=$(echo "$GAME_OUTPUT" | grep -oP 'PASSED:\s+\K\d+' || echo "?")
            echo -e "${GREEN}PASS${NC} (${GAME_PASS} assertions)"
            PASS=$((PASS+1))
        else
            echo -e "${RED}FAIL${NC}"
            echo "$GAME_OUTPUT" | grep -E "FAIL:|FATAL" | head -10
            FAIL=$((FAIL+1))
        fi
    else
        echo -e "${YELLOW}SKIP (tests/test_stub_game.js not found)${NC}"
        WARN=$((WARN+1))
    fi

    # ----------------------------------------------------------
    # TEST 12: Inventory Async/Sync Mismatch Detection
    # ----------------------------------------------------------
    echo -n "[12] Async/Sync Mismatch Check ... "
    if [ -f "script.js" ]; then
        # Find calls to CoreInventorySystemAsync methods without await
        MISMATCH_COUNT=$(grep -cP '(?<!await\s)CoreInventorySystemAsync\.\w+\(' script.js 2>/dev/null || echo "0")
        # Also check for missing await on sendInventoryCommand
        MISMATCH_COUNT2=$(grep -cP '(?<!await\s)sendInventoryCommand\(' script.js 2>/dev/null || echo "0")
        TOTAL_MISMATCH=$((MISMATCH_COUNT + MISMATCH_COUNT2))
        if [ "$TOTAL_MISMATCH" -le 5 ]; then
            echo -e "${GREEN}PASS${NC} (potential mismatches: $TOTAL_MISMATCH — review if >5)"
            PASS=$((PASS+1))
        else
            echo -e "${YELLOW}WARN${NC} (potential async/sync mismatches: $TOTAL_MISMATCH)"
            WARN=$((WARN+1))
        fi
    else
        echo -e "${YELLOW}SKIP${NC}"
        WARN=$((WARN+1))
    fi

    # ----------------------------------------------------------
    # TEST 13: Container Registry Integrity
    # ----------------------------------------------------------
    echo -n "[13] Container/Item System Integrity ... "
    if [ -f "script.js" ]; then
        # Check that OldCoreInventorySystem has all required methods
        REQUIRED_METHODS="createContainer createItem moveItem removeItem destroyContainer getContainerWeight findItemByPrototype"
        MISSING_METHODS=""
        for m in $REQUIRED_METHODS; do
            if ! grep -q "${m}:" script.js 2>/dev/null && ! grep -q "${m}:" script.js 2>/dev/null; then
                MISSING_METHODS="$MISSING_METHODS $m"
            fi
        done
        if [ -z "$MISSING_METHODS" ]; then
            echo -e "${GREEN}PASS${NC} (all inventory methods present)"
            PASS=$((PASS+1))
        else
            echo -e "${RED}FAIL${NC} (missing methods:$MISSING_METHODS)"
            FAIL=$((FAIL+1))
        fi
    else
        echo -e "${YELLOW}SKIP${NC}"
        WARN=$((WARN+1))
    fi
fi

# ============================================================
# FULL GAME SIMULATION (--game mode only)
# ============================================================

if [ "$MODE" = "game" ]; then
    echo ""
    echo "──────────────────────────────────────────────"
    echo -e "  ${CYAN}FULL GAME SIMULATION (via Stub Provider)${NC}"
    echo "──────────────────────────────────────────────"

    # ----------------------------------------------------------
    # TEST 14: Full Game Init Simulation
    # ----------------------------------------------------------
    echo -n "[14] Full Game Init Simulation ... "
    if [ -f "tests/test_stub_game.js" ]; then
        # Run the test with verbose output and capture full results
        SIM_OUTPUT=$(node tests/test_stub_game.js --verbose 2>&1)
        SIM_EXIT=$?

        # Check for specific test sections
        HAS_CONTAINER=$(echo "$SIM_OUTPUT" | grep -c "Container Creation" || echo "0")
        HAS_ITEM=$(echo "$SIM_OUTPUT" | grep -c "Item Creation" || echo "0")
        HAS_GOLD=$(echo "$SIM_OUTPUT" | grep -c "Gold System" || echo "0")
        HAS_FLOW=$(echo "$SIM_OUTPUT" | grep -c "Full Game Flow" || echo "0")
        HAS_ENSURE=$(echo "$SIM_OUTPUT" | grep -c "ensurePlayerContainers" || echo "0")

        if [ $SIM_EXIT -eq 0 ] && [ "$HAS_FLOW" -ge 1 ]; then
            TOTAL_ASSERTIONS=$(echo "$SIM_OUTPUT" | grep -oP 'PASSED:\s+\K\d+' || echo "?")
            echo -e "${GREEN}PASS${NC} (full game flow completed, ${TOTAL_ASSERTIONS} assertions)"
            PASS=$((PASS+1))
        else
            echo -e "${RED}FAIL${NC}"
            echo "$SIM_OUTPUT" | grep -E "FAIL:|ERROR" | head -10
            FAIL=$((FAIL+1))
        fi
    else
        echo -e "${YELLOW}SKIP${NC}"
        WARN=$((WARN+1))
    fi

    # ----------------------------------------------------------
    # TEST 15: Game Provider Routing Check
    # ----------------------------------------------------------
    echo -n "[15] Provider Routing (IPC → Stub fallback) ... "
    if [ -f "script.js" ]; then
        # Verify sendInventoryCommand has fallback to local
        if grep -q "Falling back to local" script.js && grep -q "executeLocalInventoryCommand" script.js; then
            echo -e "${GREEN}PASS${NC} (IPC→Stub fallback exists)"
            PASS=$((PASS+1))
        else
            echo -e "${RED}FAIL${NC} (no IPC→Stub fallback found in sendInventoryCommand)"
            FAIL=$((FAIL+1))
        fi
    else
        echo -e "${YELLOW}SKIP${NC}"
        WARN=$((WARN+1))
    fi

    # ----------------------------------------------------------
    # TEST 16: Gold Sync Verification
    # ----------------------------------------------------------
    echo -n "[16] Gold Sync (stats ↔ inventory) ... "
    if [ -f "script.js" ]; then
        # Check syncPlayerGoldFromInventory updates player.stats.gold
        if grep -q "player.stats.gold = totalGold" script.js && grep -q "syncPlayerGoldFromInventory" script.js; then
            echo -e "${GREEN}PASS${NC} (gold sync function exists and updates stats)"
            PASS=$((PASS+1))
        else
            echo -e "${RED}FAIL${NC} (gold sync broken or missing)"
            FAIL=$((FAIL+1))
        fi
    else
        echo -e "${YELLOW}SKIP${NC}"
        WARN=$((WARN+1))
    fi
fi

# ============================================================
# RESULTS
# ============================================================
echo ""
echo "============================================"
echo -e "  PASSED:    ${GREEN}$PASS${NC}"
echo -e "  FAILED:    ${RED}$FAIL${NC}"
echo -e "  WARNINGS:  ${YELLOW}$WARN${NC}"
echo -e "  Mode:      ${CYAN}$MODE${NC}"
echo "============================================"

if [ $FAIL -gt 0 ]; then
    echo ""
    echo -e "${RED}COMMIT BLOCKED: Fix the failing tests before pushing!${NC}"
    exit 1
else
    echo ""
    echo -e "${GREEN}All tests passed. Safe to commit.${NC}"
    exit 0
fi
