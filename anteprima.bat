@echo off
REM ============================================================
REM  MUSICAL ATLAS - anteprima
REM  1) rifa' l'indice (atlas-index.json) rileggendo la cartella World
REM  2) apre il sito nel browser su http://localhost:8000/
REM  Per fermare l'anteprima: chiudi questa finestra.
REM ============================================================
chcp 65001 >nul
set PYTHONIOENCODING=utf-8
cd /d "%~dp0"

echo Creo l'indice...
py build_index.py
if errorlevel 1 (
  echo.
  echo L'indice NON e' stato creato: leggi il messaggio qui sopra.
  pause
  exit /b 1
)

echo.
echo Anteprima attiva su http://localhost:8000/
echo Chiudi questa finestra per fermarla.
echo.
start "" cmd /c "timeout /t 1 >nul & start http://localhost:8000/"
py server.py
pause
