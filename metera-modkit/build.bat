@echo off
REM Build a standalone modkit.exe via PyInstaller.
REM Usage: build.bat [--clean]
REM
REM Requires Python 3.10+ and `pip install pyinstaller`.

setlocal

set "ROOT=%~dp0"
pushd "%ROOT%"

where pyinstaller >NUL 2>&1
if errorlevel 1 (
    echo [build] pyinstaller not found, installing into the current Python...
    python -m pip install --upgrade pyinstaller
    if errorlevel 1 (
        echo [build] failed to install pyinstaller
        popd
        exit /b 1
    )
)

echo [build] installing project dependencies...
python -m pip install .
if errorlevel 1 (
    echo [build] failed to install dependencies
    popd
    exit /b 1
)


echo [build] removing previous build artefacts...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [build] running PyInstaller...
pyinstaller --noconfirm build.spec
if errorlevel 1 (
    echo [build] PyInstaller failed
    popd
    exit /b 1
)

echo.
echo [build] done -^> dist\modkit.exe
echo.

popd
endlocal
