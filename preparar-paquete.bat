@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo.
echo ══════════════════════════════════════════════════
echo   📦 PREPARANDO PAQUETE OFFLINE PARA LA VM
echo ══════════════════════════════════════════════════
echo.

set PKG=PAQUETE_RIM

REM --- 1. Asegurar ts-node y typescript en node_modules ---
echo [1/5] Asegurando ts-node en el backend...
cd Backend
call npm i -D ts-node typescript @types/node --silent
cd ..

REM --- 2. Crear carpeta del paquete ---
echo [2/5] Copiando proyecto...
if exist "%PKG%" rmdir /s /q "%PKG%"
mkdir "%PKG%"
robocopy Backend "%PKG%\Backend" /E /NFL /NDL /NJH /NJS /NC /NS >nul
robocopy Fronted "%PKG%\Fronted" /E /NFL /NDL /NJH /NJS /NC /NS >nul
copy ecosystem.config.js "%PKG}\" >nul
copy .env.production.example "%PKG}\" >nul
copy tsconfig.json "%PKG%\Backend\" >nul 2>&1

REM --- 3. Descargar Node.js MSI (instalador offline) ---
echo [3/5] Descargando Node.js 20 LTS (msi offline)...
if not exist "%PKG%\node-v20.18.0-x64.msi" (
    curl -L -o "%PKG%\node-v20.18.0-x64.msi" https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi
)

REM --- 4. Descargar NSSM (para servicio Windows) ---
echo [4/5] Descargando NSSM...
if not exist "%PKG%\nssm.exe" (
    curl -L -o nssm.zip https://nssm.cc/release/nssm-2.24.zip
    powershell -Command "Expand-Archive -Path nssm.zip -DestinationPath nssm_tmp -Force"
    copy nssm_tmp\nssm-2.24\win64\nssm.exe "%PKG%\nssm.exe" >nul
    rmdir /s /q nssm_tmp
    del nssm.zip
)

REM --- 5. Copiar instalador ---
echo [5/5] Copiando instalador del servidor...
copy instalar-servidor.bat "%PKG}\" >nul

echo.
echo ══════════════════════════════════════════════════
echo   ✅ PAQUETE LISTO EN: %cd%\%PKG%
echo ══════════════════════════════════════════════════
echo.
echo   ⚠️  FALTA UNA COSA MANUAL:
echo   Copia a %PKG% el instalador de PostgreSQL que usaste
echo   en esta PC (ej: postgresql-16.x-windows-x64.exe)
echo   Lo tienes en Descargas o lo bajas una vez de:
echo   https://www.postgresql.org/download/windows/
echo.
echo   Luego copia TODA la carpeta %PKG% a un USB.
echo.
pause