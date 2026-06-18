@echo off
rem === Clip Maker — Klip Hazirlayici ===
rem Bu dosyaya cift tiklayinca uygulama acilir (CMD'ye gerek yok).
cd /d "%~dp0"

rem Konsolsuz baslat (pythonw varsa)
where pythonw >nul 2>nul
if %errorlevel%==0 (
    start "" pythonw -m clipmaker --gui
    exit /b
)

rem pythonw yoksa python ile dene
where python >nul 2>nul
if %errorlevel%==0 (
    python -m clipmaker --gui
    exit /b
)

echo.
echo Python bulunamadi. Lutfen https://python.org adresinden Python kurun
echo (kurulumda "Add Python to PATH" kutusunu isaretleyin), sonra tekrar deneyin.
echo.
pause
