# Proyecto_Final_de_Tesis
Proyecto de Tesis Sistema de supervision y control de red
# Sistema de Gestión y Control de la Red (RIM)
## Documentación Técnica — Proyecto de Tesis

---

## 1. Introducción y Objetivo

Sistema web integral para la **gestión, monitoreo y control de la infraestructura de red** de una dirección territorial, que permite:

- Inventariar la topología de red de los 11 municipios (unidades, edificios, locales, equipos).
- Monitorear en tiempo real el estado de los recursos (switches, modems, servicios, PCs).
- Notificar incidencias por correo/SMS según prioridad.
- Gestionar accesos remotos (SSH, Web, Telnet) con auditoría.
- Respaldar automáticamente configuraciones y base de datos.

---

## 2. Arquitectura del Sistema

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Navegador)                 │
│  HTML5 + CSS3 + JavaScript ES5 (compatible Firefox 45)  │
│  xterm.js (terminal SSH) · Chart.js (estadísticas)      │
├─────────────────────────────────────────────────────────┤
│                    BACKEND (Node.js)                    │
│  Express (API REST) · Socket.IO (WebSocket SSH)         │
│  ssh2 (cliente SSH) · nodemailer (correo) · pg (BD)     │
├─────────────────────────────────────────────────────────┤
│                 PostgreSQL (Persistencia)               │
│  usuarios · topología · auditoría · configs · avisos    │
└─────────────────────────────────────────────────────────┘
```

**Patrón:** Cliente-servidor de 3 capas. El frontend consume una API REST protegida por sesiones; el backend orquesta monitoreo, notificaciones y persistencia.

---

## 3. Stack Tecnológico

| Capa | Tecnología | Justificación |
|---|---|---|
| Backend | Node.js + Express + TypeScript | Alto rendimiento I/O, tipado estático |
| BD | PostgreSQL | Relacional robusta, gratuita, soporta el esquema jerárquico |
| SSH | ssh2 + Socket.IO + xterm.js | Terminal interactiva en el navegador |
| Correo | nodemailer (SMTP Zimbra) | Integración con servidor corporativo |
| Frontend | JS ES5 puro + CSS | Compatibilidad con Firefox 45 (parque instalado) |
| Gráficos | Chart.js | Visualización de estadísticas |
| Servicio | NSSM / schtasks | Arranque automático como servicio |

---

## 4. Módulos del Sistema

### 4.1 Autenticación y Autorización
- Sesiones con `express-session` + cookies.
- Contraseñas hasheadas con **bcrypt** (costo 10).
- 3 roles: `superadmin`, `admin`, `operador` (solo lectura).
- Limitador de intentos de login (5 intentos → bloqueo 5 min) anti fuerza bruta.

### 4.2 Editor de Topología
- Jerarquía: Municipio › Unidad › Edificio › Local › Sub-local.
- Entidades: switches, modems, transceivers, servicios (BD/DNS/firewall/servidor), PCs.
- Conexiones FO/Ethernet con validaciones: puertos libres, misma subred, velocidad ≤ capacidad del switch.
- Persistencia transaccional en PostgreSQL (BEGIN/COMMIT/ROLLBACK).

### 4.3 Monitoreo de Salud
- Ciclo principal cada 5 min; reintento a los 2 min para confirmar caídas.
- Pruebas: ping TCP/ICMP, latencia, degradación.
- Estados: `online`, `offline`, `degradado`, `desconocido`.
- Detección indirecta: si todas las PCs tras un switch caen, se marca el switch.

### 4.4 Notificaciones por Prioridad
| Prioridad | Correo | SMS |
|---|---|---|
| alta | ✅ | ✅ |
| media | ✅ | ❌ |
| baja | ❌ | ❌ |
- Contactos configurables en el panel (canales y umbral de prioridad).
- Registro de cada aviso en `avisos_enviados`.

### 4.5 Acceso Remoto y Auditoría
- Terminal SSH embebida (proxy WebSocket → ssh2).
- Copiar/pegar en terminal (Ctrl+C/Ctrl+V con fallback).
- Cada sesión SSH se registra en `auditoria_ssh` (usuario, equipo, inicio, fin).

### 4.6 Respaldos
- **Configs de switches:** backup semanal automático por SSH (`display current-configuration` / `show running-config`), retención y visor/descarga en panel.
- **Base de datos:** `pg_dump` diario (02:00) con rotación de 7 días, descarga desde el panel.

---

## 5. Esquema de Base de Datos

| Tabla | Propósito |
|---|---|
| `usuarios` | Cuentas del sistema (bcrypt, roles) |
| `municipios` | Los 11 municipios |
| `unidades` / `edificios` / `locales` | Jerarquía física (FK en cascada) |
| `equipos` | Switches/modems/transceivers con ficha técnica |
| `servicios` | BD, DNS, firewall, servidor |
| `pcs` | Equipos de usuario final |
| `conexiones` | Enlaces FO/Ethernet con puertos |
| `historial_estados` | Evolución de estados para estadísticas |
| `contactos_notificacion` | Destinatarios de alertas |
| `avisos_enviados` | Log de notificaciones |
| `auditoria_ssh` | Sesiones SSH registradas |
| `configs_switch` | Respaldos de configuraciones |

---

## 6. Medidas de Seguridad Implementadas

| Amenaza | Mitigación |
|---|---|
| Inyección SQL | Consultas parametrizadas (`$1,$2...`) con `pg` |
| XSS | Escape de todo dato dinámico (`esc()`), cabecera CSP |
| Fuerza bruta | Bloqueo temporal por IP tras 5 intentos |
| Clickjacking | `X-Frame-Options: SAMEORIGIN` |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Credenciales | bcrypt (no se almacena texto plano) |
| Autorización | Middleware `requiereRol` en cada ruta sensible |
| Path traversal | Validación regex de nombres en descargas |
| Sesiones | Secret aleatorio, expiración 2h |

---

## 7. Despliegue

- **Desarrollo:** `deploy.bat` + `npm run dev`.
- **Producción (VM Windows offline):** paquete autocontenido generado por `preparar-paquete.bat` (incluye Node portable, proyecto y dependencias) e instalado por `instalar-servidor.bat` (PostgreSQL silencioso, BD creada, servicio de arranque automático, regla de firewall).
- El sistema opera **100% sin internet**: librerías frontend locales, SMTP interno.

---

## 8. Manual de Usuario (resumen por rol)

**Operador:** consulta mapa, topología, estados y panel (sin botones de edición ni acceso remoto).

**Administrador:** todo lo anterior + editar topología, abrir SSH/Web, gestionar contactos y notificaciones.

**Superadmin:** todo lo anterior + gestión de usuarios, backups de BD y configuración crítica.