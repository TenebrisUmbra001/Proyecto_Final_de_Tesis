@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

REM ══════════════ CONFIGURACIÓN ══════════════
set INST_DIR=C:\RIM
set DB_PASS=Rim2026!
set PUERTO=2054
REM ═══════════════════════════════════════════

echo.
echo ══════════════════════════════════════════════════
echo   🚀 INSTALANDO RIM EN EL SERVIDOR (OFFLINE)
echo ══════════════════════════════════════════════════
echo.

cd /d "%~dp0"

REM --- 1. Instalar Node.js ---
echo [1/6] Instalando Node.js...
msiexec /i node-v20.18.0-x64.msi /qn /norestart
timeout /t 5 /nobreak >nul
echo     [OK] Node instalado

REM --- 2. Instalar PostgreSQL (silencioso) ---
echo [2/6] Instalando PostgreSQL (tarda unos minutos)...
for %%f in (postgresql-*.exe) do (
    start /wait "" "%%f" --mode unattended --unattendedmodeui none --servicename postgresql-x64 --servicepassword "%DB_PASS%" --superpassword "%DB_PASS%" --prefix "C:\PostgreSQL"
)
echo     [OK] PostgreSQL instalado

REM --- 3. Copiar proyecto ---
echo [3/6] Copiando sistema a %INST_DIR%...
if not exist "%INST_DIR%" mkdir "%INST_DIR%"
robocopy Backend "%INST_DIR%\Backend" /E /NFL /NDL /NJH /NJS /NC /NS >nul
robocopy Fronted "%INST_DIR%\Fronted" /E /NFL /NDL /NJH /NJS /NC /NS >nul
if not exist "%INST_DIR%\Backups" mkdir "%INST_DIR%\Backups"
if not exist "%INST_DIR%\logs" mkdir "%INST_DIR%\logs"
echo     [OK] Sistema copiado

REM --- 4. Crear base de datos y usuario ---
echo [4/6] Creando base de datos...
set PSQL="C:\PostgreSQL\bin\psql.exe"
set PGADMIN="C:\PostgreSQL\bin\createdb.exe"
set PGPASSWORD=%DB_PASS%
%PSQL% -U postgres -h localhost -c "CREATE USER rim WITH PASSWORD '%DB_PASS%';" >nul 2>&1
%PSQL% -U postgres -h localhost -c "CREATE DATABASE rim OWNER rim;" >nul 2>&1
%PSQL% -U postgres -h localhost -c "GRANT ALL PRIVILEGES ON DATABASE rim TO rim;" >nul 2>&1
echo     [OK] BD 'rim' creada

REM --- 5. Crear .env de producción ---
echo [5/6] Configurando .env...
(
echo PORT=%PUERTO%
echo NODE_ENV=production
echo DB_HOST=localhost
echo DB_PORT=5432
echo DB_USER=rim
echo DB_PASS=%DB_PASS%
echo DB_NAME=rim
echo PG_DUMP_PATH=C:\PostgreSQL\bin\pg_dump.exe
echo SESSION_SECRET=rim_produccion_clave_super_larga_cambiar
echo SMTP_HOST=mail.das.pdr
echo SMTP_PORT=465
echo SMTP_USER=no-reply@das.pdr
echo SMTP_PASS=CAMBIAR_CONTRASENA_SMTP
echo ALERTAS_CORREO=admin@das.pdr
echo SSH_USER=CAMBIAR_USUARIO_SSH
echo SSH_PASS=CAMBIAR_PASS_SSH
echo MONITOR_INTERVALO_MIN=5
echo MONITOR_REINTENTO_MIN=2
echo DNS_DOMINIO_PRUEBA=das.pdr
) > "%INST_DIR%\Backend\.env"
echo     [OK] .env creado

REM --- 6. Registrar servicio Windows con NSSM ---
echo [6/6] Registrando servicio Windows...
copy nssm.exe "%INST_DIR%\nssm.exe" >nul
"%INST_DIR%\nssm.exe" install RIM_Backend "C:\Program Files\nodejs\node.exe" >nul 2>&1
"%INST_DIR%\nssm.exe" set RIM_Backend AppParameters "\"%INST_DIR%\Backend\node_modules\ts-node\dist\bin.js\" \"%INST_DIR%\Backend\server.ts\""
"%INST_DIR%\nssm.exe" set RIM_Backend AppDirectory "%INST_DIR%\Backend"
"%INST_DIR%\nssm.exe" set RIM_Backend AppStdout "%INST_DIR%\logs\rim.log"
"%INST_DIR%\nssm.exe" set RIM_Backend AppStderr "%INST_DIR%\logs\rim-error.log"
"%INST_DIR%\nssm.exe" set RIM_Backend AppRotateFiles 1
"%INST_DIR%\nssm.exe" set RIM_Backend Start SERVICE_AUTO_START

REM --- Firewall: abrir puerto ---
netsh advfirewall firewall delete rule name="RIM_Web" >nul 2>&1
netsh advfirewall firewall add rule name="RIM_Web" dir=in action=allow protocol=TCP localport=%PUERTO% >nul

REM --- Iniciar servicio ---
"%INST_DIR%\nssm.exe" start RIM_Backend

echo.
echo ══════════════════════════════════════════════════
echo   ✅ INSTALACIÓN COMPLETADA
echo ══════════════════════════════════════════════════
echo.
echo   ⚠️  EDITA AHORA: %INST_DIR%\Backend\.env
echo      - SMTP_PASS  (contraseña de Zimbra)
echo      - SSH_USER / SSH_PASS (backup de configs)
echo.
echo   Luego reinicia el servicio:
echo      %INST_DIR%\nssm.exe restart RIM_Backend
echo.
echo   Accede desde la red:  http://IP-DE-LA-VM:%PUERTO%
echo   Ver logs:             type %INST_DIR%\logs\rim.log
echo.
pause