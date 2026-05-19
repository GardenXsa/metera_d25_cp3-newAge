#!/bin/bash
# ============================================================
# METERA PRE-COMMIT TEST SUITE
# Запускается перед каждым пушем для проверки целостности кода
# ============================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

echo "============================================"
echo "  METERA D25 — PRE-COMMIT TEST SUITE"
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
    ((PASS++))
else
    echo -e "${RED}FAIL${NC}"
    echo -e "$JS_ERRORS"
    ((FAIL++))
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
    ((PASS++))
else
    echo -e "${RED}FAIL${NC}"
    echo -e "$PY_ERRORS"
    ((FAIL++))
fi

# ----------------------------------------------------------
# TEST 3: HTML Structure Check
# ----------------------------------------------------------
echo -n "[3] HTML Structure Check ... "
if [ -f "index.html" ]; then
    # Check for basic structure: doctype, html, head, body
    if grep -q "<!DOCTYPE" index.html && grep -q "</html>" index.html && grep -q "</head>" index.html && grep -q "</body>" index.html; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL (missing basic HTML structure)${NC}"
        ((FAIL++))
    fi
else
    echo -e "${YELLOW}SKIP (index.html not found)${NC}"
    ((WARN++))
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
    ((PASS++))
else
    echo -e "${RED}FAIL${NC}"
    echo -e "$JSON_ERRORS"
    ((FAIL++))
fi

# ----------------------------------------------------------
# TEST 5: CSS Syntax Check (basic)
# ----------------------------------------------------------
echo -n "[5] CSS Files Check ... "
CSS_OK=true
CSS_ERRORS=""
CSS_FILES=$(find . -name "*.css" -not -path "./.git/*" -not -path "./node_modules/*" 2>/dev/null)
for f in $CSS_FILES; do
    # Check for balanced braces
    OPEN=$(grep -o "{" "$f" | wc -l)
    CLOSE=$(grep -o "}" "$f" | wc -l)
    if [ "$OPEN" -ne "$CLOSE" ]; then
        CSS_OK=false
        CSS_ERRORS="$CSS_ERRORS  FAIL: $f (braces: $OPEN open, $CLOSE close)\n"
    fi
done

if $CSS_OK; then
    echo -e "${GREEN}PASS${NC}"
    ((PASS++))
else
    echo -e "${RED}FAIL${NC}"
    echo -e "$CSS_ERRORS"
    ((FAIL++))
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
        ((PASS++))
    else
        echo -e "${YELLOW}WARN (missing: $MISSING)${NC}"
        ((WARN++))
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    ((WARN++))
fi

# ----------------------------------------------------------
# TEST 7: Electron Main Process Check
# ----------------------------------------------------------
echo -n "[7] Electron Main Process ... "
if [ -f "main.js" ]; then
    # Check that main.js creates a BrowserWindow
    if grep -q "BrowserWindow" main.js && grep -q "loadFile\|loadURL" main.js; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL (missing BrowserWindow or loadFile/loadURL)${NC}"
        ((FAIL++))
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    ((WARN++))
fi

# ----------------------------------------------------------
# TEST 8: Script References Check
# ----------------------------------------------------------
echo -n "[8] Script References in HTML ... "
if [ -f "index.html" ]; then
    REF_OK=true
    REF_ERRORS=""
    # Extract script src attributes
    SCRIPTS=$(grep -oP 'src="([^"]+\.js)"' index.html | grep -oP '"[^"]+"' | tr -d '"')
    for s in $SCRIPTS; do
        # Skip CDN URLs (http/https)
        if [[ "$s" == http://* ]] || [[ "$s" == https://* ]]; then
            continue
        fi
        # Remove leading slash for local check
        local_path="${s#/}"
        if [ ! -f "$local_path" ]; then
            REF_OK=false
            REF_ERRORS="$REF_ERRORS  MISSING: $s\n"
        fi
    done
    if $REF_OK; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${RED}FAIL${NC}"
        echo -e "$REF_ERRORS"
        ((FAIL++))
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    ((WARN++))
fi

# ----------------------------------------------------------
# TEST 9: CSP Headers Check
# ----------------------------------------------------------
echo -n "[9] CSP Headers Check ... "
if [ -f "main.js" ]; then
    if grep -q "Content-Security-Policy" main.js; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${YELLOW}WARN (no CSP headers found)${NC}"
        ((WARN++))
    fi
else
    echo -e "${YELLOW}SKIP${NC}"
    ((WARN++))
fi

# ----------------------------------------------------------
# TEST 10: Engine Binary Check
# ----------------------------------------------------------
echo -n "[10] C++ Engine Binary ... "
if [ -f "engine/meterea_engine" ]; then
    if [ -x "engine/meterea_engine" ]; then
        echo -e "${GREEN}PASS${NC}"
        ((PASS++))
    else
        echo -e "${YELLOW}WARN (exists but not executable — chmod +x?)${NC}"
        ((WARN++))
    fi
else
    echo -e "${YELLOW}SKIP (engine not compiled)${NC}"
    ((WARN++))
fi

# ============================================================
# RESULTS
# ============================================================
echo ""
echo "============================================"
echo -e "  PASSED:  ${GREEN}$PASS${NC}"
echo -e "  FAILED:  ${RED}$FAIL${NC}"
echo -e "  WARNINGS: ${YELLOW}$WARN${NC}"
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
