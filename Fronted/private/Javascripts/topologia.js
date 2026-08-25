var STORAGE_KEY = 'rim_topologia';
var SVGNS = 'http://www.w3.org/2000/svg';
var municipioId = localStorage.getItem('rim_municipio_actual');
var datos = null;
var ruta = [];
var seleccion = null;
var arrastre = null;
var redimension = null;
var esperandoConfirmarEliminar = false;

var modoConexion = false;
var conexionOrigen = null;
var conexionSeleccionada = null;

var ICONOS = {
    unidad: '🏢', edificio: '🏬', local: '🚪',
    'switch': '🔀', modem: '📶', transceiver: '🔌',
    bd: '🗄️', dns: '🌐', firewall: '🛡️', servidor: '💻',
    pc: '🖥️'
};

var VELOCIDADES = ['100 Mbps', '1 Gbps', '10 Gbps', '40 Gbps', '100 Gbps'];

var VEL_MBPS = {
    '100 Mbps': 100,
    '1 Gbps': 1000,
    '10 Gbps': 10000,
    '40 Gbps': 40000,
    '100 Gbps': 100000
};

var tiempoAnim = 0;

// ================= PERMISOS POR ROL =================
var rolUsuario = null;

function puedeEditar() {
    return rolUsuario === 'superadmin' || rolUsuario === 'admin';
}

function aplicarPermisos() {
    var btnCon = document.getElementById('btnConectar');
    if (btnCon) btnCon.style.display = puedeEditar() ? '' : 'none';

    var estado = document.getElementById('estadoConexion');
    if (estado && !puedeEditar()) estado.textContent = '👁️ Modo lectura (solo consulta)';

    actualizarBarraAgregar();
}

function iniciarAnimacionConexiones() {
    setInterval(function () {
        tiempoAnim += 0.012;
        if (tiempoAnim > 1) tiempoAnim = 0;

        var svg = document.getElementById('capa-conexiones');
        if (!svg) return;

        var lineas = svg.querySelectorAll('line.linea-conexion');
        for (var i = 0; i < lineas.length; i++) {
            var line = lineas[i];
            var id = line.getAttribute('data-con');
            var x1 = parseFloat(line.getAttribute('x1'));
            var y1 = parseFloat(line.getAttribute('y1'));
            var x2 = parseFloat(line.getAttribute('x2'));
            var y2 = parseFloat(line.getAttribute('y2'));

            var puntos = svg.querySelectorAll('circle.paquete[data-con="' + id + '"]');
            for (var p = 0; p < puntos.length; p++) {
                var t = tiempoAnim + parseFloat(puntos[p].getAttribute('data-offset'));
                if (t > 1) t -= 1;
                puntos[p].setAttribute('cx', x1 + (x2 - x1) * t);
                puntos[p].setAttribute('cy', y1 + (y2 - y1) * t);
            }
        }
    }, 50);
}

// ================= CARGA / GUARDADO =================
function cargar() {
    var raw = localStorage.getItem(STORAGE_KEY);
    var todo = raw ? JSON.parse(raw) : null;
    if (!municipioId || !todo || !todo.municipios[municipioId]) {
        window.location.href = '/private/mapa.html';
        return false;
    }
    datos = todo.municipios[municipioId];
    datos.conexiones = datos.conexiones || [];
    document.getElementById('tituloMunicipio').textContent = 'Información : ' + datos.nombre;
    migrarPCsAntiguas();
    return true;
}

function guardar() {
    var todo = JSON.parse(localStorage.getItem(STORAGE_KEY));
    todo.municipios[municipioId] = datos;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todo));

    fetch('/api/topologia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(todo)
    }).catch(function (e) {
        console.warn('No se pudo sincronizar con el monitor:', e);
    });

    var ind = document.getElementById('indicadorGuardado');
    ind.textContent = '✔ Guardado';
    setTimeout(function () { ind.textContent = ''; }, 1500);
}

// ================= MIGRACIÓN de PCs viejas =================
function migrarPCsAntiguas() {
    var cambios = false;

    function recorrer(obj, padre) {
        if (obj.tipo === 'switch' && obj.pcs_conectadas && obj.pcs_conectadas.length > 0) {
            if (padre) {
                padre.pcs = padre.pcs || [];
                for (var i = 0; i < obj.pcs_conectadas.length; i++) {
                    var old = obj.pcs_conectadas[i];
                    var pc = {
                        id: old.id,
                        tipo: 'pc',
                        descripcion: old.descripcion,
                        nombre: old.descripcion,
                        pr: old.pr,
                        ip: old.ip,
                        sistemas_atiende: old.sistemas_atiende,
                        prioridad: 'baja',
                        x: obj.x + obj.width + 50,
                        y: obj.y + (i * 90),
                        width: 80,
                        height: 60
                    };
                    padre.pcs.push(pc);
                    datos.conexiones.push({
                        id: 'con-' + Date.now() + '-' + i,
                        desde: obj.id,
                        hasta: pc.id,
                        tipo: 'Ethernet',
                        velocidad: '1 Gbps',
                        puertoDesde: old.puerto,
                        puertoHasta: null
                    });
                }
                cambios = true;
            }
            delete obj.pcs_conectadas;
            cambios = true;
        }
        var hijos = hijosDe(obj);
        for (var j = 0; j < hijos.length; j++) {
            recorrer(hijos[j], obj);
        }
    }

    for (var u = 0; u < datos.unidades.length; u++) {
        recorrer(datos.unidades[u], null);
    }

    if (cambios) guardar();
}

// ================= UTILIDADES =================
function esContenedor(tipo) { return tipo === 'unidad' || tipo === 'edificio' || tipo === 'local'; }
function esEquipo(tipo) { return tipo === 'switch' || tipo === 'modem' || tipo === 'transceiver'; }
function esServicio(tipo) { return tipo === 'bd' || tipo === 'dns' || tipo === 'firewall' || tipo === 'servidor'; }
function esPC(tipo) { return tipo === 'pc'; }

// 🧼 Escapa texto antes de inyectarlo en innerHTML (anti XSS almacenado)
function esc(txt) {
    return String(txt == null ? '' : txt)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// 📋 Copiar con fallback para Firefox viejo
function copiarTexto(txt) {
    if (!txt) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).catch(function () { fallbackCopiar(txt); });
    } else {
        fallbackCopiar(txt);
    }
}

function fallbackCopiar(txt) {
    var ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(ta);
}

// 📋 Pegar: usa la API si existe, si no abre un mini-modal
function pegarTexto(cb) {
    if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(cb).catch(function () { modalPegarManual(cb); });
    } else {
        modalPegarManual(cb);
    }
}

function modalPegarManual(cb) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;padding:20px;border-radius:8px;width:420px;">' +
        '<p style="margin-top:0;">Pega aquí el texto y pulsa Enviar:</p>' +
        '<textarea id="txtPegarManual" rows="4" style="width:100%;box-sizing:border-box;"></textarea>' +
        '<div style="display:flex;gap:10px;margin-top:10px;">' +
        '<button id="btnEnviarPegar" class="btn-add" style="flex:1;">Enviar al terminal</button>' +
        '<button id="btnCancelPegar" class="btn-del" style="flex:1;background:#555;">Cancelar</button></div></div>';
    document.body.appendChild(overlay);
    document.getElementById('btnEnviarPegar').addEventListener('click', function () {
        var t = document.getElementById('txtPegarManual').value;
        document.body.removeChild(overlay);
        cb(t);
    });
    document.getElementById('btnCancelPegar').addEventListener('click', function () {
        document.body.removeChild(overlay);
    });
    document.getElementById('txtPegarManual').focus();
}

// 🔐 Abre un cliente remoto (SSH, Web o Telnet) según el tipo de gestión
function abrirAccesoRemoto(tipo, ip, nombreSwitch) {
    if (!ip) return;

    if (tipo === 'web') {
        var htmlW = '<p style="margin-bottom:12px;">¿Por qué protocolo responde <strong>' + esc(nombreSwitch || ip) + '</strong>?</p>';
        htmlW += '<label>Puerto (opcional, ej: 8080)</label>';
        htmlW += '<input type="text" id="webPort" placeholder="vacío = puerto estándar">';
        htmlW += '<div style="display:flex;gap:10px;margin-top:14px;">';
        htmlW += '<button class="btn-add" id="btnWebHttps" style="flex:1;background:#27ae60;">🔒 Abrir HTTPS</button>';
        htmlW += '<button class="btn-add" id="btnWebHttp" style="flex:1;background:#2980b9;">🌐 Abrir HTTP</button>';
        htmlW += '</div>';
        htmlW += '<p style="margin-top:12px;color:#555;font-size:12px;">Si la pestaña queda en blanco o «Esperando…», ciérrala y prueba el otro protocolo.</p>';
        htmlW += '<button class="btn-del" id="btnCerrarWeb" style="margin-top:10px;background:#555;">Cerrar</button>';
        abrirModal('🌐 Admin Web de ' + esc(nombreSwitch || ip), htmlW);

        document.getElementById('btnWebHttps').addEventListener('click', function () {
            var p = val('webPort');
            window.open('https://' + ip + (p ? ':' + p : ''), '_blank');
        });
        document.getElementById('btnWebHttp').addEventListener('click', function () {
            var p = val('webPort');
            window.open('http://' + ip + (p ? ':' + p : ''), '_blank');
        });
        document.getElementById('btnCerrarWeb').addEventListener('click', cerrarModal);
        return;
    }

    if (tipo === 'ssh') {
        abrirConsolaSSH(ip, nombreSwitch || '');
        return;
    }

    if (tipo === 'telnet') {
        var cmdT = 'telnet ' + ip;
        var modalHtmlT = '<p>Copia este comando:</p>';
        modalHtmlT += '<div style="background:#1e1e1e;color:#0f0;padding:12px;font-family:monospace;border-radius:4px;user-select:all;">' + esc(cmdT) + '</div>';
        modalHtmlT += '<button class="btn-add" id="btnCopiarCmdT" style="margin-top:12px;">📋 Copiar</button>';
        modalHtmlT += '<button class="btn-del" id="btnCerrarCmdT" style="margin-top:8px;background:#555;">Cerrar</button>';
        abrirModal('📟 Telnet a ' + esc(nombreSwitch || ip), modalHtmlT);
        document.getElementById('btnCopiarCmdT').addEventListener('click', function () {
            copiarTexto(cmdT);
            this.textContent = '✔ Copiado';
        });
        document.getElementById('btnCerrarCmdT').addEventListener('click', cerrarModal);
    }
}

// 🔐 Modal de login SSH y apertura de terminal integrada
function abrirConsolaSSH(ip, nombreSwitch) {
    var loginHtml = '<div class="login-ssh">';
    loginHtml += '<h3 style="margin-top:0;">🔐 Acceso SSH a ' + esc(nombreSwitch) + '</h3>';
    loginHtml += '<p style="color:#555;font-size:12px;">IP: ' + esc(ip) + '</p>';
    loginHtml += '<label>Usuario:</label>';
    loginHtml += '<input type="text" id="sshUser" value="admin" autocomplete="off">';
    loginHtml += '<label>Contraseña:</label>';
    loginHtml += '<input type="password" id="sshPass" autocomplete="off">';
    loginHtml += '<p id="sshMsgErr" style="color:red;font-size:12px;margin-top:10px;"></p>';
    loginHtml += '<div style="display:flex;gap:10px;margin-top:18px;">';
    loginHtml += '<button class="btn-add" id="btnConectarSSH" style="flex:1;">Conectar</button>';
    loginHtml += '<button class="btn-del" id="btnCancelarSSH" style="flex:1;background:#555;">Cancelar</button>';
    loginHtml += '</div></div>';

    abrirModal('SSH — ' + esc(nombreSwitch), loginHtml);

    document.getElementById('btnCancelarSSH').addEventListener('click', cerrarModal);

    var btnConectar = document.getElementById('btnConectarSSH');
    btnConectar.addEventListener('click', function () {
        var user = document.getElementById('sshUser').value.trim();
        var pass = document.getElementById('sshPass').value;
        var err = document.getElementById('sshMsgErr');
        if (!user || !pass) { err.textContent = 'Usuario y contraseña obligatorios.'; return; }
        iniciarTerminalSSH(ip, user, pass, nombreSwitch);
    });

    document.getElementById('sshPass').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') btnConectar.click();
    });
    document.getElementById('sshUser').focus();
}

// 🖥️ Terminal xterm.js conectada al proxy SSH del backend
function iniciarTerminalSSH(ip, user, pass, nombreSwitch) {
    // 🔧 Expandir el modal a tamaño de terminal
    var caja = document.getElementById('modalCuerpo').parentElement;
    caja.style.width = '95vw';
    caja.style.maxWidth = '1400px';
    caja.style.height = '92vh';
    caja.style.maxHeight = '95vh';
    var cuerpo = document.getElementById('modalCuerpo');
    cuerpo.style.padding = '0';
    cuerpo.style.overflow = 'hidden';

    cuerpo.innerHTML =
        '<div class="modal-terminal">' +
        '<div class="barra-superior">' +
            '<span class="titulo">🔐 ' + esc(nombreSwitch) + ' — ' + esc(ip) + '</span>' +
            '<span class="hint-ssh">Selecciona + Ctrl+C copia · Ctrl+V pega</span>' +
            '<button id="btnCerrarTerm">✕ Cerrar</button>' +
        '</div>' +
        '<div id="xterm-container"></div>' +
        '</div>';

    var term = new Terminal({
        cursorBlink: true,
        fontSize: 15,
        fontFamily: 'Consolas, "Courier New", monospace',
        theme: { background: '#1e1e1e', foreground: '#0f0', cursor: '#0f0' },
        scrollback: 5000
    });
    var fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('xterm-container'));
    setTimeout(function () { fitAddon.fit(); term.focus(); }, 120);

    term.writeln('\x1b[36mConectando a ' + esc(ip) + '...\x1b[0m');

    var socket = io({ path: '/ssh-proxy', transports: ['websocket', 'polling'] });

    socket.on('connect', function () {
        socket.emit('ssh-connect', { host: ip, port: 22, user: user, pass: pass });
    });

    socket.on('ssh-ready', function () {
        term.writeln('\x1b[32m✔ Conexión establecida.\x1b[0m\r\n');
        term.focus();
    });

    socket.on('ssh-data', function (data) { term.write(data); });

    socket.on('ssh-error', function (msg) {
        term.writeln('\r\n\x1b[31m❌ ' + esc(msg) + '\x1b[0m');
        setTimeout(function () { cerrarModal(); socket.disconnect(); }, 3000);
    });

    socket.on('ssh-close', function (msg) {
        term.writeln('\r\n\x1b[33m' + esc(msg) + '\x1b[0m');
        setTimeout(function () {
            if (document.getElementById('modal').style.display === 'flex') {
                socket.disconnect();
                term.dispose();
                cerrarModal();
            }
        }, 2500);
    });

    term.onData(function (data) { socket.emit('ssh-input', data); });

    // 🔧 COPIAR / PEGAR
    term.attachCustomKeyEventHandler(function (ev) {
        if (ev.type !== 'keydown') return true;
        var k = (ev.key || '').toLowerCase();

        if (ev.ctrlKey && (k === 'c') && !ev.shiftKey) {
            if (term.hasSelection()) {
                copiarTexto(term.getSelection());
                ev.preventDefault();
                return false;
            }
            return true;
        }
        if (ev.ctrlKey && (k === 'v') && !ev.shiftKey) {
            pegarTexto(function (txt) { if (txt) socket.emit('ssh-input', txt); });
            ev.preventDefault();
            return false;
        }
        if (ev.ctrlKey && ev.shiftKey && k === 'c') {
            copiarTexto(term.getSelection());
            ev.preventDefault();
            return false;
        }
        if (ev.ctrlKey && ev.shiftKey && k === 'v') {
            pegarTexto(function (txt) { if (txt) socket.emit('ssh-input', txt); });
            ev.preventDefault();
            return false;
        }
        return true;
    });

    var onResize = function () {
        try {
            fitAddon.fit();
            socket.emit('ssh-resize', { cols: term.cols, rows: term.rows });
        } catch (e) {}
    };
    window.addEventListener('resize', onResize);

    document.getElementById('btnCerrarTerm').addEventListener('click', function () {
        window.removeEventListener('resize', onResize);
        socket.disconnect();
        try { term.dispose(); } catch (e) {}
        cerrarModal();
    });
}

function hijosDe(obj) {
    if (obj.tipo === 'unidad') return obj.edificios || [];
    if (obj.tipo === 'edificio') return obj.locales || [];
    if (obj.tipo === 'local') {
        return (obj.sublocales || []).concat(obj.equipos || []).concat(obj.servicios || []).concat(obj.pcs || []);
    }
    return [];
}

function tamanosPorTipo(tipo) {
    if (tipo === 'unidad') return { w: 320, h: 240 };
    if (tipo === 'edificio') return { w: 220, h: 170 };
    if (tipo === 'local') return { w: 160, h: 120 };
    if (tipo === 'pc') return { w: 80, h: 60 };
    return { w: 80, h: 80 };
}

function buscarObjPorId(id) {
    function rec(obj) {
        if (obj.id === id) return obj;
        var hijos = hijosDe(obj);
        for (var i = 0; i < hijos.length; i++) {
            var r = rec(hijos[i]);
            if (r) return r;
        }
        return null;
    }
    for (var u = 0; u < datos.unidades.length; u++) {
        var r = rec(datos.unidades[u]);
        if (r) return r;
    }
    return null;
}

function contieneId(obj, id) {
    var hijos = hijosDe(obj);
    for (var i = 0; i < hijos.length; i++) {
        if (hijos[i].id === id) return true;
        if (esContenedor(hijos[i].tipo) && contieneId(hijos[i], id)) return true;
    }
    return false;
}

function val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function validarIP(ip) {
    var partes = ip.split('.');
    if (partes.length !== 4) return false;
    for (var i = 0; i < 4; i++) {
        if (!/^\d{1,3}$/.test(partes[i])) return false;
        var n = parseInt(partes[i], 10);
        if (n < 0 || n > 255) return false;
    }
    return true;
}

function mismaSubred(ip1, ip2) {
    if (!ip1 || !ip2) return false;
    var p1 = ip1.split('.');
    var p2 = ip2.split('.');
    if (p1.length !== 4 || p2.length !== 4) return false;
    return p1[0] === p2[0] && p1[1] === p2[1] && p1[2] === p2[2];
}

function ipYaExiste(ip, excluirId) {
    function revisarObj(obj) {
        if (obj.id === excluirId) return false;
        if (obj.ip && obj.ip === ip) return true;
        var hijos = hijosDe(obj);
        for (var j = 0; j < hijos.length; j++) {
            if (revisarObj(hijos[j])) return true;
        }
        return false;
    }
    for (var u = 0; u < datos.unidades.length; u++) {
        if (revisarObj(datos.unidades[u])) return true;
    }
    return false;
}

function buscarConexionDe(id, excluirConId) {
    for (var i = 0; i < datos.conexiones.length; i++) {
        var c = datos.conexiones[i];
        if (c.id === excluirConId) continue;
        if (c.desde === id || c.hasta === id) return c;
    }
    return null;
}

function pcYaConectada(pcId, excluirConId) {
    return buscarConexionDe(pcId, excluirConId) !== null;
}

function puertoUsadoEnEquipo(equipoId, puerto, excluirConId) {
    if (puerto == null || isNaN(puerto)) return false;
    for (var i = 0; i < datos.conexiones.length; i++) {
        var c = datos.conexiones[i];
        if (c.id === excluirConId) continue;
        if (c.desde === equipoId && c.puertoDesde === puerto) return true;
        if (c.hasta === equipoId && c.puertoHasta === puerto) return true;
    }
    return false;
}

function ubicacionActual() {
    var partes = [datos.nombre];
    for (var i = 0; i < ruta.length; i++) partes.push(ruta[i].nombre);
    return partes.join(' > ');
}

function opcionesVel(sel) {
    var h = '';
    for (var i = 0; i < VELOCIDADES.length; i++) {
        h += '<option value="' + VELOCIDADES[i] + '"' + (VELOCIDADES[i] === sel ? ' selected' : '') + '>' + VELOCIDADES[i] + '</option>';
    }
    return h;
}

function opcionesVelFiltradas(velMaxima, sel) {
    var max = VEL_MBPS[velMaxima] || 100000;
    var h = '';
    for (var i = 0; i < VELOCIDADES.length; i++) {
        if (VEL_MBPS[VELOCIDADES[i]] <= max) {
            h += '<option value="' + VELOCIDADES[i] + '"' + (VELOCIDADES[i] === sel ? ' selected' : '') + '>' + VELOCIDADES[i] + '</option>';
        }
    }
    return h;
}

function opcionesPrioridad(sel) {
    var selVal = sel || 'baja';
    return ['alta', 'media', 'baja'].map(function (p) {
        return '<option value="' + p + '"' + (selVal === p ? ' selected' : '') + '>' + p + '</option>';
    }).join('');
}

function campo(label, nombreCampo, valor, tipo, readonly) {
    return '<label>' + label + '</label><input type="' + (tipo || 'text') + '" data-campo="' + nombreCampo + '" value="' + esc(valor == null ? '' : valor) + '"' + (readonly ? ' readonly' : '') + '>';
}

function sumarPuertoEnUso(obj, medio, delta) {
    if (!obj) return;
    if (obj.tipo === 'switch') {
        if (medio === 'FO') {
            obj.puertos_fibra_en_uso = Math.max(0, (parseInt(obj.puertos_fibra_en_uso, 10) || 0) + delta);
        } else {
            obj.puertos_ethernet_en_uso = Math.max(0, (parseInt(obj.puertos_ethernet_en_uso, 10) || 0) + delta);
        }
    }
    if (obj.tipo === 'modem') {
        obj.puerto_ethernet_en_uso = Math.max(0, (parseInt(obj.puerto_ethernet_en_uso, 10) || 0) + delta);
    }
}

function puertoDisponible(obj, medio, puerto) {
    if (!obj || puerto == null || isNaN(puerto)) return true;
    if (obj.tipo === 'switch') {
        if (medio === 'FO') return puerto <= (obj.puertos_fibra || 0);
        return puerto <= (obj.puertos_ethernet || 0);
    }
    if (obj.tipo === 'modem') return puerto <= (obj.puerto_ethernet || 0);
    return true;
}

function puertosUsadosReales(obj) {
    var res = { fibraMax: 0, ethMax: 0, fibraCount: 0, ethCount: 0 };
    for (var i = 0; i < datos.conexiones.length; i++) {
        var c = datos.conexiones[i];
        var puerto = null;
        if (c.desde === obj.id) puerto = c.puertoDesde;
        else if (c.hasta === obj.id) puerto = c.puertoHasta;
        else continue;
        if (c.tipo === 'FO') {
            res.fibraCount++;
            if (puerto && puerto > res.fibraMax) res.fibraMax = puerto;
        } else {
            res.ethCount++;
            if (puerto && puerto > res.ethMax) res.ethMax = puerto;
        }
    }
    return res;
}

function maxVelocidadConexiones(obj) {
    var max = 0;
    for (var i = 0; i < datos.conexiones.length; i++) {
        var c = datos.conexiones[i];
        if (c.desde === obj.id || c.hasta === obj.id) {
            var v = VEL_MBPS[c.velocidad] || 0;
            if (v > max) max = v;
        }
    }
    return max;
}

// ================= ESTADO DEL MONITOR =================
var estadosRemotos = {};

function estadoDe(id) {
    var e = estadosRemotos[id];
    return e ? e.estado : null;
}

function sincronizarTopologia() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    fetch('/api/topologia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: raw
    }).catch(function () { /* sin conexión con backend */ });
}

function cargarEstados() {
    fetch('/api/estados', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (data) {
            estadosRemotos = data || {};
            actualizarIndicadores();
            dibujarConexiones();
        })
        .catch(function () { /* el backend aún no tiene el monitor activo */ });
}

function actualizarIndicadores() {
    var lista = listaActual();
    for (var i = 0; i < lista.length; i++) {
        var obj = lista[i];
        var el = document.querySelector('.elemento[data-id="' + obj.id + '"]');
        if (!el) continue;
        var dot = el.querySelector('.estado-indicador');
        if (!dot) continue;
        var st = estadoDe(obj.id) || 'desconocido';
        dot.className = 'estado-indicador estado-' + st;
        dot.title = 'Estado: ' + st;
    }
}

// ================= NIVELES =================
function listaActual() {
    if (ruta.length === 0) return datos.unidades;
    if (ruta.length === 1) { ruta[0].edificios = ruta[0].edificios || []; return ruta[0].edificios; }
    if (ruta.length === 2) { ruta[1].locales = ruta[1].locales || []; return ruta[1].locales; }

    var actual = ruta[ruta.length - 1];
    return (actual.sublocales || []).concat(actual.equipos || []).concat(actual.servicios || []).concat(actual.pcs || []);
}

// ================= CONTADOR =================
function contarEquiposRed() {
    var c = { 'switch': 0, 'modem': 0, 'transceiver': 0 };

    function contarEnObj(obj) {
        var hijos = hijosDe(obj);
        for (var i = 0; i < hijos.length; i++) {
            var hijo = hijos[i];
            if (esEquipo(hijo.tipo) && c.hasOwnProperty(hijo.tipo)) c[hijo.tipo]++;
            if (esContenedor(hijo.tipo)) contarEnObj(hijo);
        }
    }

    for (var u = 0; u < datos.unidades.length; u++) contarEnObj(datos.unidades[u]);
    return c;
}

function actualizarContador() {
    var c = contarEquiposRed();
    var total = c['switch'] + c['modem'] + c['transceiver'];
    document.getElementById('contadorEquipos').textContent =
        'Equipos de red: ' + total + ' (' + c['switch'] + ' switch, ' + c['modem'] + ' modem, ' + c['transceiver'] + ' transceiver)';
}

// ================= RENDERIZADO =================
function renderizar() {
    var lienzo = document.getElementById('lienzo');
    lienzo.innerHTML = '';
    var lista = listaActual();
    for (var i = 0; i < lista.length; i++) {
        lienzo.appendChild(crearNodo(lista[i]));
    }

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.id = 'capa-conexiones';
    svg.setAttribute('width', '3000');
    svg.setAttribute('height', '2000');
    svg.setAttribute('pointer-events', 'none');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.zIndex = '5';
    lienzo.appendChild(svg);

    dibujarConexiones();
    actualizarMigas();
    actualizarBarraAgregar();
    actualizarContador();
    marcarSeleccion();
    marcarOrigen();
}

function crearNodo(obj) {
    var el = document.createElement('div');
    el.className = 'elemento ' + obj.tipo;
    el.setAttribute('data-id', obj.id);
    el.style.left = obj.x + 'px';
    el.style.top = obj.y + 'px';
    el.style.width = obj.width + 'px';
    el.style.height = obj.height + 'px';

    if (esContenedor(obj.tipo)) {
        el.title = '1 clic: seleccionar / arrastrar — Doble clic: entrar';
    }

    var label = document.createElement('span');
    label.className = 'etiqueta';
    label.textContent = (ICONOS[obj.tipo] || '') + ' ' + (obj.descripcion || obj.nombre || '');
    el.appendChild(label);

    if (obj.ip) {
        var ip = document.createElement('span');
        ip.className = 'ip';
        ip.textContent = obj.ip;
        el.appendChild(ip);
    }

    var handle = null;
    if (puedeEditar()) {
        handle = document.createElement('div');
        handle.className = 'handle';
        el.appendChild(handle);
    }

    // 🔴🟢 Indicador de estado del monitor
    if (esEquipo(obj.tipo) || esServicio(obj.tipo) || esPC(obj.tipo)) {
        var st = estadoDe(obj.id) || 'desconocido';
        var dot = document.createElement('span');
        dot.className = 'estado-indicador estado-' + st;
        dot.title = 'Estado: ' + st;
        el.appendChild(dot);
    }

    el.addEventListener('mousedown', function (e) {
        e.stopPropagation();

        if (modoConexion) {
            if (esContenedor(obj.tipo)) {
                document.getElementById('estadoConexion').textContent =
                    'Doble clic para entrar en ' + (obj.descripcion || obj.nombre) + ' y elegir un equipo o PC';
                return;
            }
            manejarClickConexion(obj);
            return;
        }

        if (handle && e.target === handle) {
            redimension = { obj: obj, el: el, startX: e.clientX, startY: e.clientY, w: obj.width, h: obj.height };
        } else {
            seleccionar(obj);
            if (puedeEditar()) {
                arrastre = { obj: obj, el: el, startX: e.clientX, startY: e.clientY, x: obj.x, y: obj.y, moved: false };
            }
        }
    });

    el.addEventListener('dblclick', function (e) {
        e.stopPropagation();
        if (esContenedor(obj.tipo)) {
            ruta.push(obj);
            seleccion = null;
            renderizar();
            panelVacio();
        }
    });

    return el;
}

function marcarSeleccion() {
    var els = document.querySelectorAll('.elemento');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('seleccionado');
    if (seleccion) {
        var el = document.querySelector('.elemento[data-id="' + seleccion.id + '"]');
        if (el) el.classList.add('seleccionado');
    }
}

function marcarOrigen() {
    var els = document.querySelectorAll('.elemento');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('origen-conexion');
    if (conexionOrigen) {
        var el = document.querySelector('.elemento[data-id="' + conexionOrigen.id + '"]');
        if (el) el.classList.add('origen-conexion');
    }
}

// ================= CONEXIONES =================
function toggleModoConexion() {
    modoConexion = !modoConexion;
    conexionOrigen = null;
    var btn = document.getElementById('btnConectar');
    var estado = document.getElementById('estadoConexion');
    if (modoConexion) {
        btn.classList.add('activo');
        estado.textContent = 'Modo conexión: selecciona el ORIGEN';
    } else {
        btn.classList.remove('activo');
        estado.textContent = '';
    }
    marcarOrigen();
}

function manejarClickConexion(obj) {
    var estado = document.getElementById('estadoConexion');
    if (!conexionOrigen) {
        conexionOrigen = obj;
        estado.textContent = 'Origen: ' + (obj.descripcion || obj.nombre) + ' — ahora selecciona el DESTINO';
    } else if (conexionOrigen.id === obj.id) {
        conexionOrigen = null;
        estado.textContent = 'Modo conexión: selecciona el ORIGEN';
    } else {
        var origen = conexionOrigen;
        conexionOrigen = null;
        estado.textContent = '';
        mostrarFormularioConexion(origen, obj);
    }
    marcarOrigen();
}

function representanteVisible(id) {
    var lista = listaActual();
    var i;
    for (i = 0; i < lista.length; i++) {
        if (lista[i].id === id) return lista[i];
    }
    for (i = 0; i < lista.length; i++) {
        if (esContenedor(lista[i].tipo) && contieneId(lista[i], id)) return lista[i];
    }
    return null;
}

function puntoCentro(rep) {
    if (!rep) return null;
    var el = document.querySelector('.elemento[data-id="' + rep.id + '"]');
    if (!el) return null;
    return {
        x: el.offsetLeft + el.offsetWidth / 2,
        y: el.offsetTop + el.offsetHeight / 2
    };
}

function puntoBorde(rep, cx, cy, tx, ty) {
    var el = document.querySelector('.elemento[data-id="' + rep.id + '"]');
    if (!el) return { x: cx, y: cy };

    var dx = tx - cx;
    var dy = ty - cy;
    var len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return { x: cx, y: cy };

    if (rep.tipo === 'switch' || rep.tipo === 'modem' || rep.tipo === 'transceiver') {
        var r = (el.offsetWidth / 2) + 2;
        return { x: cx + (dx / len) * r, y: cy + (dy / len) * r };
    }

    var w = (el.offsetWidth / 2) + 2;
    var h = (el.offsetHeight / 2) + 2;
    var sx = (dx !== 0) ? w / Math.abs(dx) : Infinity;
    var sy = (dy !== 0) ? h / Math.abs(dy) : Infinity;
    var t = Math.min(sx, sy, 1);
    return { x: cx + dx * t, y: cy + dy * t };
}

function dibujarConexiones() {
    var svg = document.getElementById('capa-conexiones');
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    var dibujadas = 0;

    for (var i = 0; i < datos.conexiones.length; i++) {
        (function (con) {
            try {
                var repA = representanteVisible(con.desde);
                var repB = representanteVisible(con.hasta);

                if (repA && repB && repA.id === repB.id) return;

                var pA = repA ? puntoCentro(repA) : null;
                var pB = repB ? puntoCentro(repB) : null;

                if (!pA && !pB) return;

                var extA = false, extB = false;
                if (!pA && pB) { pA = { x: 0, y: pB.y }; extA = true; }
                if (!pB && pA) { pB = { x: 0, y: pA.y }; extB = true; }
                if (!pA || !pB) return;

                var cA = { x: pA.x, y: pA.y };
                var cB = { x: pB.x, y: pB.y };
                if (repA) pA = puntoBorde(repA, cA.x, cA.y, cB.x, cB.y);
                if (repB) pB = puntoBorde(repB, cB.x, cB.y, cA.x, cA.y);

                var objA = buscarObjPorId(con.desde);
                var objB = buscarObjPorId(con.hasta);

                var stA = estadoDe(con.desde);
                var stB = estadoDe(con.hasta);
                var caido = (stA === 'offline' || stB === 'offline');
                var degradado = (!caido) && (stA === 'degradado' || stB === 'degradado');

                var color = con.tipo === 'FO' ? '#ff9f1c' : '#70e000';
                if (degradado) color = '#f39c12';
                if (caido) color = '#e74c3c';

                var grosor = (con.id === conexionSeleccionada) ? 8 : 6;

                var line = document.createElementNS(SVGNS, 'line');
                line.setAttribute('x1', pA.x); line.setAttribute('y1', pA.y);
                line.setAttribute('x2', pB.x); line.setAttribute('y2', pB.y);
                line.setAttribute('class', 'linea-conexion');
                line.setAttribute('data-con', con.id);
                line.setAttribute('stroke', color);
                line.setAttribute('stroke-width', grosor);
                line.setAttribute('stroke-linecap', 'round');
                line.setAttribute('pointer-events', 'none');
                if (extA || extB) line.setAttribute('opacity', '0.6');

                if (caido) line.setAttribute('stroke-dasharray', '6 8');
                else if (degradado) line.setAttribute('stroke-dasharray', '12 6');

                svg.appendChild(line);

                if (!caido) {
                    for (var p = 0; p < 3; p++) {
                        var c = document.createElementNS(SVGNS, 'circle');
                        c.setAttribute('r', '3.5');
                        c.setAttribute('class', 'paquete');
                        c.setAttribute('data-con', con.id);
                        c.setAttribute('data-offset', (p / 3).toFixed(2));
                        c.setAttribute('fill', '#ffffff');
                        c.setAttribute('pointer-events', 'none');
                        c.setAttribute('cx', pA.x);
                        c.setAttribute('cy', pA.y);
                        if (extA || extB) c.setAttribute('opacity', '0.6');
                        svg.appendChild(c);
                    }
                }

                if (caido) {
                    var mx = (pA.x + pB.x) / 2;
                    var my = (pA.y + pB.y) / 2;
                    var xmark = document.createElementNS(SVGNS, 'text');
                    xmark.setAttribute('x', mx);
                    xmark.setAttribute('y', my + 6);
                    xmark.setAttribute('text-anchor', 'middle');
                    xmark.setAttribute('fill', '#e74c3c');
                    xmark.setAttribute('font-size', '20');
                    xmark.setAttribute('font-weight', 'bold');
                    xmark.setAttribute('pointer-events', 'none');
                    xmark.textContent = '✕';
                    svg.appendChild(xmark);
                }

                var hit = document.createElementNS(SVGNS, 'line');
                hit.setAttribute('x1', pA.x); hit.setAttribute('y1', pA.y);
                hit.setAttribute('x2', pB.x); hit.setAttribute('y2', pB.y);
                hit.setAttribute('class', 'linea-hit');
                hit.setAttribute('stroke', 'transparent');
                hit.setAttribute('stroke-width', '16');
                hit.setAttribute('stroke-linecap', 'round');
                hit.setAttribute('pointer-events', 'stroke');

                var title = document.createElementNS(SVGNS, 'title');
                var pA_txt = (con.puertoDesde != null) ? ' [puerto ' + con.puertoDesde + ']' : '';
                var pB_txt = (con.puertoHasta != null) ? ' [puerto ' + con.puertoHasta + ']' : '';
                var nombreA = objA ? (objA.descripcion || objA.nombre || '?') : '?';
                var nombreB = objB ? (objB.descripcion || objB.nombre || '?') : '?';
                var nomA = nombreA + pA_txt + (extA ? ' (fuera de esta vista)' : '');
                var nomB = nombreB + pB_txt + (extB ? ' (fuera de esta vista)' : '');
                var estadoTxt = caido ? ' — ⚠️ CAÍDO' : (degradado ? ' — ⚠️ degradado' : '');
                title.textContent = nomA + ' ↔ ' + nomB + ' — ' + con.tipo + ' ' + con.velocidad + estadoTxt;
                hit.appendChild(title);

                hit.addEventListener('mousedown', function (e) {
                    e.stopPropagation();
                });

                hit.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (modoConexion) return;
                    conexionSeleccionada = con.id;
                    dibujarConexiones();
                    mostrarPanelConexion(con);
                });

                svg.appendChild(hit);
                dibujadas++;
            } catch (err) {
                console.error('Error dibujando conexión ' + con.id + ':', err);
            }
        })(datos.conexiones[i]);
    }
}

// ================= MODAL =================
function abrirModal(titulo, contenido) {
    var modal = document.getElementById('modal');
    var caja = document.getElementById('modalCuerpo').parentElement;
    var cuerpo = document.getElementById('modalCuerpo');

    // 🔧 Restaurar SIEMPRE el tamaño estándar (por si quedó expandido por la terminal SSH)
    caja.style.width = '500px';
    caja.style.maxWidth = '90%';
    caja.style.maxHeight = '90vh';
    caja.style.height = '';
    cuerpo.style.padding = '20px';
    cuerpo.style.overflowY = 'auto';

    document.getElementById('modalTitulo').textContent = titulo;
    cuerpo.innerHTML = contenido;
    modal.style.display = 'flex';
}

function cerrarModal() {
    document.getElementById('modal').style.display = 'none';
    var caja = document.getElementById('modalCuerpo').parentElement;
    caja.style.width = '500px';
    caja.style.maxWidth = '90%';
    caja.style.maxHeight = '90vh';
    caja.style.height = '';
    var cuerpo = document.getElementById('modalCuerpo');
    cuerpo.style.padding = '20px';
    cuerpo.style.overflowY = 'auto';
}

// ================= FORMULARIO DE CREACIÓN =================
function mostrarFormulario(tipo, padre) {
    var nombres = { 'unidad': 'UNIDAD', 'edificio': 'EDIFICIO', 'local': 'LOCAL', 'equipo': 'EQUIPO DE RED', 'servicio': 'SERVICIO', 'pc': 'PC' };

    var html = '<p id="msgError" style="color:red;font-size:12px;"></p>';

    if (tipo === 'equipo') {
        html += '<h4 style="border-bottom:2px solid #0f3460;padding-bottom:5px;margin-bottom:10px;">— Datos generales del equipo —</h4>';
        html += '<label>PR / Código *</label><input type="text" id="fPR" placeholder="Ej: SW-001">';
        html += '<label>Sello</label><input type="text" id="fSello">';
        html += '<label>Marca *</label><input type="text" id="fMarca" placeholder="Ej: Cisco, Huawei">';
        html += '<label>Modelo *</label><input type="text" id="fModelo" placeholder="Ej: Catalyst 2960">';
        html += '<label>Descripción *</label><input type="text" id="fDescripcion" placeholder="Nombre visible en el mapa">';
        html += '<label>Ubicación</label><input type="text" id="fUbic" value="' + ubicacionActual() + '" readonly>';

        html += '<h4 style="border-bottom:2px solid #0f3460;padding-bottom:5px;margin:15px 0 10px 0;">— Tipo de equipo —</h4>';
        html += '<label>Tipo</label><select id="fTipo">' +
            '<option value="switch">Switch</option>' +
            '<option value="modem">Modem</option>' +
            '<option value="transceiver">Transceiver</option></select>';

        html += '<div id="secSwitch" style="margin-top:10px;padding:10px;background:#f0f4f8;border-radius:6px;">';
        html += '<h4 style="margin-bottom:8px;color:#0f3460;">Datos del switch</h4>';
        html += '<label>IP *</label><input type="text" id="fIP" value="192.168.1.">';
        html += '<label>Tipo de gestión</label><select id="fTipoGestion">' +
            '<option>SSH</option><option>Telnet</option><option>Web</option><option>No gestionable</option></select>';
        html += '<label>Velocidad de enlace</label><select id="fVelEnlace">' + opcionesVel('1 Gbps') + '</select>';
        html += '<label>Puertos de fibra</label><input type="number" id="fPuertosFibra" value="0" min="0">';
        html += '<label>Puertos ethernet</label><input type="number" id="fPuertosEth" value="24" min="0">';
        html += '</div>';

        html += '<div id="secModem" style="display:none;margin-top:10px;padding:10px;background:#f0f4f8;border-radius:6px;">';
        html += '<h4 style="margin-bottom:8px;color:#0f3460;">Datos del modem</h4>';
        html += '<label>Puertos ethernet</label><input type="number" id="fPuertosEthModem" value="1" min="0">';
        html += '<label style="margin-top:8px;"><input type="checkbox" id="fAdsl"> Usa ADSL</label>';
        html += '</div>';

        html += '<div id="secTrans" style="display:none;margin-top:10px;padding:10px;background:#f0f4f8;border-radius:6px;">';
        html += '<p style="color:#555;">Los transceiver no requieren datos adicionales.</p>';
        html += '</div>';

        html += '<label>Prioridad de alertas</label><select id="fPrioridad">' + opcionesPrioridad('baja') + '</select>';
    }
    else if (tipo === 'servicio') {
        html += '<label>Tipo de servicio</label><select id="fTipoServ">' +
            '<option value="bd">Base de datos</option><option value="dns">DNS</option>' +
            '<option value="firewall">Firewall</option><option value="servidor">Servidor</option></select>';
        html += '<label>Descripción *</label><input type="text" id="fDescripcion">';
        html += '<label>IP *</label><input type="text" id="fIP" value="192.168.1.">';
        html += '<label>Prioridad de alertas</label><select id="fPrioridad">' + opcionesPrioridad('baja') + '</select>';
    }
    else if (tipo === 'pc') {
        html += '<h4 style="border-bottom:2px solid #0f3460;padding-bottom:5px;margin-bottom:10px;">— Datos de la PC —</h4>';
        html += '<label>PR / Código *</label><input type="text" id="fPR" placeholder="Ej: PC-001">';
        html += '<label>Descripción *</label><input type="text" id="fDescripcion" placeholder="Ej: PC Contabilidad">';
        html += '<label>IP *</label><input type="text" id="fIP" placeholder="Ej: 192.168.1.100">';
        html += '<label>Sistemas que atiende</label><textarea id="fSistemas" rows="3" placeholder="Ej: Sistema Contable, ERP"></textarea>';
        html += '<label>Prioridad de alertas</label><select id="fPrioridad">' + opcionesPrioridad('baja') + '</select>';
        html += '<p style="margin-top:10px;color:#555;font-size:12px;">Luego usa 🔌 Conectar para enlazarla a un switch.</p>';
    }
    else {
        html += '<label>Nombre *</label><input type="text" id="fDescripcion">';
    }

    abrirModal('Nuevo: ' + nombres[tipo], html);

    var selTipo = document.getElementById('fTipo');
    if (selTipo) {
        selTipo.addEventListener('change', function () {
            document.getElementById('secSwitch').style.display = (this.value === 'switch') ? 'block' : 'none';
            document.getElementById('secModem').style.display = (this.value === 'modem') ? 'block' : 'none';
            document.getElementById('secTrans').style.display = (this.value === 'transceiver') ? 'block' : 'none';
        });
    }

    var botones = '<div style="display:flex;gap:10px;margin-top:20px;">' +
        '<button class="btn-add" id="btnConfirmarCrear" style="flex:1;">Crear</button>' +
        '<button class="btn-del" id="btnCancelarCrear" style="flex:1;">Cancelar</button>' +
        '</div>';
    document.getElementById('modalCuerpo').innerHTML += botones;

    document.getElementById('btnCancelarCrear').addEventListener('click', cerrarModal);

    document.getElementById('btnConfirmarCrear').addEventListener('click', function () {
        var err = document.getElementById('msgError');
        err.textContent = '';

        var descripcion = val('fDescripcion');
        if (!descripcion) { err.textContent = 'La descripción es obligatoria.'; return; }

        var obj = null;
        var t = tamanosPorTipo(tipo);

        if (tipo === 'equipo') {
            var tipoFinal = document.getElementById('fTipo').value;
            var pr = val('fPR'), marca = val('fMarca'), modelo = val('fModelo');

            if (!pr || !marca || !modelo) {
                err.textContent = 'PR, marca y modelo son obligatorios (*).';
                return;
            }
            if (tipoFinal === 'switch' && !validarIP(val('fIP'))) {
                err.textContent = 'IP inválida. Formato esperado: 192.168.1.10';
                return;
            }
            if (tipoFinal === 'switch' && ipYaExiste(val('fIP'), null)) {
                err.textContent = 'La IP ' + val('fIP') + ' ya está en uso en este municipio.';
                return;
            }

            t = tamanosPorTipo(tipoFinal);
            obj = {
                id: tipoFinal + '-' + Date.now(),
                tipo: tipoFinal,
                descripcion: descripcion,
                nombre: descripcion,
                pr: pr,
                sello: val('fSello'),
                marca: marca,
                modelo: modelo,
                fecha_instalacion: new Date().toISOString(),
                ubicacion: val('fUbic'),
                prioridad: val('fPrioridad') || 'baja',
                x: 50 + Math.floor(Math.random() * 150),
                y: 50 + Math.floor(Math.random() * 100),
                width: t.w, height: t.h
            };

            if (tipoFinal === 'switch') {
                obj.ip = val('fIP');
                obj.tipo_gestion = val('fTipoGestion');
                obj.gestionable = (obj.tipo_gestion !== 'No gestionable');
                obj.velocidad_enlace = val('fVelEnlace');
                obj.puertos_fibra = parseInt(val('fPuertosFibra'), 10) || 0;
                obj.puertos_fibra_en_uso = 0;
                obj.puertos_ethernet = parseInt(val('fPuertosEth'), 10) || 0;
                obj.puertos_ethernet_en_uso = 0;
            }
            if (tipoFinal === 'modem') {
                obj.puerto_ethernet = parseInt(val('fPuertosEthModem'), 10) || 0;
                obj.puerto_ethernet_en_uso = 0;
                obj.usa_adsl = document.getElementById('fAdsl').checked;
            }
        }
        else if (tipo === 'servicio') {
            var tipoServ = document.getElementById('fTipoServ').value;
            if (!validarIP(val('fIP'))) {
                err.textContent = 'IP inválida. Formato esperado: 192.168.1.10';
                return;
            }
            if (ipYaExiste(val('fIP'), null)) {
                err.textContent = 'La IP ' + val('fIP') + ' ya está en uso en este municipio.';
                return;
            }
            t = tamanosPorTipo(tipoServ);
            obj = {
                id: tipoServ + '-' + Date.now(),
                tipo: tipoServ,
                descripcion: descripcion,
                nombre: descripcion,
                ip: val('fIP'),
                prioridad: val('fPrioridad') || 'baja',
                x: 50 + Math.floor(Math.random() * 150),
                y: 50 + Math.floor(Math.random() * 100),
                width: t.w, height: t.h
            };
        }
        else if (tipo === 'pc') {
            var prPC = val('fPR');
            var ipPC = val('fIP');
            if (!prPC) { err.textContent = 'El PR es obligatorio (*).'; return; }
            if (!validarIP(ipPC)) {
                err.textContent = 'IP inválida. Formato esperado: 192.168.1.100';
                return;
            }
            if (ipYaExiste(ipPC, null)) {
                err.textContent = 'La IP ' + ipPC + ' ya está en uso en este municipio.';
                return;
            }
            t = tamanosPorTipo('pc');
            obj = {
                id: 'pc-' + Date.now(),
                tipo: 'pc',
                descripcion: descripcion,
                nombre: descripcion,
                pr: prPC,
                ip: ipPC,
                sistemas_atiende: val('fSistemas'),
                prioridad: val('fPrioridad') || 'baja',
                x: 60 + Math.floor(Math.random() * 150),
                y: 60 + Math.floor(Math.random() * 100),
                width: t.w, height: t.h
            };
        }
        else {
            obj = {
                id: tipo + '-' + Date.now(),
                tipo: tipo,
                descripcion: descripcion,
                nombre: descripcion,
                x: (tipo === 'unidad') ? 40 : 50,
                y: 40,
                width: t.w, height: t.h
            };
        }

        pushEnPadre(padre, obj);
        cerrarModal();
        renderizar(); guardar();
        seleccionar(obj);
    });
}

// ================= FORMULARIO DE CONEXIÓN =================
function mostrarFormularioConexion(a, b) {
    var nombreA = a.descripcion || a.nombre;
    var nombreB = b.descripcion || b.nombre;
    var hayPC = esPC(a.tipo) || esPC(b.tipo);

    if (esPC(a.tipo) && esPC(b.tipo)) {
        abrirModal('🔌 CONEXIÓN INVÁLIDA', '<p style="color:red;">No se puede conectar una PC directamente con otra PC. Una PC se conecta a un switch o modem.</p><button class="btn-del" id="btnCerrarErr" style="margin-top:15px;">Cerrar</button>');
        document.getElementById('btnCerrarErr').addEventListener('click', cerrarModal);
        return;
    }

    var pc = null, otro = null;
    if (hayPC) {
        pc = esPC(a.tipo) ? a : b;
        otro = esPC(a.tipo) ? b : a;
        if (!esEquipo(otro.tipo)) {
            abrirModal('🔌 CONEXIÓN INVÁLIDA', '<p style="color:red;">La PC solo puede conectarse a un switch o un modem, no a: ' + esc(otro.descripcion || otro.nombre) + '.</p><button class="btn-del" id="btnCerrarErr" style="margin-top:15px;">Cerrar</button>');
            document.getElementById('btnCerrarErr').addEventListener('click', cerrarModal);
            return;
        }
        if (pcYaConectada(pc.id, null)) {
            abrirModal('🔌 CONEXIÓN INVÁLIDA', '<p style="color:red;">La PC "' + esc(pc.descripcion || pc.nombre) + '" ya tiene una conexión. Elimínala primero.</p><button class="btn-del" id="btnCerrarErr" style="margin-top:15px;">Cerrar</button>');
            document.getElementById('btnCerrarErr').addEventListener('click', cerrarModal);
            return;
        }
    }

    var html = '<p id="msgErrorCon" style="color:red;font-size:12px;"></p>';
    html += '<p><strong>Desde:</strong> ' + esc(nombreA) + '</p>';
    html += '<p><strong>Hasta:</strong> ' + esc(nombreB) + '</p>';

    if (hayPC) {
        html += '<label>Medio</label><select id="fTipoCon" disabled><option value="Ethernet" selected>Ethernet (obligatorio para PC)</option></select>';
        var velBasePC = (otro.tipo === 'switch') ? (otro.velocidad_enlace || '1 Gbps') : '100 Mbps';
        html += '<label>Velocidad</label><select id="fVelCon">' + opcionesVelFiltradas(velBasePC, '100 Mbps') + '</select>';
        html += '<label>Puerto en ' + esc(otro.descripcion || otro.nombre) + ' *</label><input type="number" id="fPuertoEq" min="1">';
    } else {
        html += '<label>Medio</label><select id="fTipoCon">' +
            '<option value="FO">Fibra óptica (FO)</option>' +
            '<option value="Ethernet">Ethernet</option></select>';
        var velMax = '100 Gbps';
        if (a.tipo === 'switch' && a.velocidad_enlace) velMax = a.velocidad_enlace;
        if (b.tipo === 'switch' && b.velocidad_enlace && VEL_MBPS[b.velocidad_enlace] < VEL_MBPS[velMax]) {
            velMax = b.velocidad_enlace;
        }
        html += '<label>Velocidad</label><select id="fVelCon">' + opcionesVelFiltradas(velMax, '1 Gbps') + '</select>';
        if (esEquipo(a.tipo)) html += '<label>Puerto en ' + esc(nombreA) + '</label><input type="number" id="fPuertoA" min="1">';
        if (esEquipo(b.tipo)) html += '<label>Puerto en ' + esc(nombreB) + '</label><input type="number" id="fPuertoB" min="1">';
    }

    abrirModal('🔌 NUEVA CONEXIÓN', html);

    var botones = '<div style="display:flex;gap:10px;margin-top:20px;">' +
        '<button class="btn-add" id="btnConfirmarCon" style="flex:1;">Crear conexión</button>' +
        '<button class="btn-del" id="btnCancelarCon" style="flex:1;">Cancelar</button>' +
        '</div>';
    document.getElementById('modalCuerpo').innerHTML += botones;

    document.getElementById('btnCancelarCon').addEventListener('click', cerrarModal);

    document.getElementById('btnConfirmarCon').addEventListener('click', function () {
        var err = document.getElementById('msgErrorCon');
        var medio = document.getElementById('fTipoCon').value;
        var vel = document.getElementById('fVelCon').value;

        if (hayPC) {
            medio = 'Ethernet';
            var puerto = parseInt(val('fPuertoEq'), 10);

            if (!puerto || !puertoDisponible(otro, medio, puerto)) {
                err.textContent = 'Puerto inválido en ' + (otro.descripcion || otro.nombre) + '.';
                return;
            }
            if (puertoUsadoEnEquipo(otro.id, puerto, null)) {
                err.textContent = 'El puerto ' + puerto + ' ya está ocupado por otra conexión en ' + (otro.descripcion || otro.nombre) + '.';
                return;
            }
            if (otro.tipo === 'switch' && !mismaSubred(pc.ip, otro.ip)) {
                err.textContent = 'La PC (' + pc.ip + ') no está en la misma subred que el switch (' + otro.ip + ').';
                return;
            }
            if (otro.tipo === 'switch' && VEL_MBPS[vel] > VEL_MBPS[otro.velocidad_enlace || '100 Gbps']) {
                err.textContent = 'Velocidad ' + vel + ' excede la del switch (' + otro.velocidad_enlace + ').';
                return;
            }

            var puertoDesde = esEquipo(a.tipo) ? puerto : null;
            var puertoHasta = esEquipo(b.tipo) ? puerto : null;

            datos.conexiones.push({
                id: 'con-' + Date.now(),
                desde: a.id,
                hasta: b.id,
                tipo: medio,
                velocidad: vel,
                puertoDesde: puertoDesde,
                puertoHasta: puertoHasta
            });

            sumarPuertoEnUso(otro, medio, 1);
            cerrarModal();
            guardar();
            renderizar();
            return;
        }

        var elA = document.getElementById('fPuertoA');
        var elB = document.getElementById('fPuertoB');
        var pA = elA ? parseInt(elA.value, 10) : null;
        var pB = elB ? parseInt(elB.value, 10) : null;

        if (!puertoDisponible(a, medio, pA)) {
            err.textContent = 'El puerto ' + pA + ' no existe en ' + nombreA + ' para ' + medio + '.';
            return;
        }
        if (!puertoDisponible(b, medio, pB)) {
            err.textContent = 'El puerto ' + pB + ' no existe en ' + nombreB + ' para ' + medio + '.';
            return;
        }
        if (puertoUsadoEnEquipo(a.id, pA, null)) {
            err.textContent = 'El puerto ' + pA + ' ya está ocupado por otra conexión en ' + nombreA + '.';
            return;
        }
        if (puertoUsadoEnEquipo(b.id, pB, null)) {
            err.textContent = 'El puerto ' + pB + ' ya está ocupado por otra conexión en ' + nombreB + '.';
            return;
        }
        if (a.tipo === 'switch' && VEL_MBPS[vel] > VEL_MBPS[a.velocidad_enlace || '100 Gbps']) {
            err.textContent = 'Velocidad ' + vel + ' excede la del switch ' + nombreA + ' (' + a.velocidad_enlace + ')';
            return;
        }
        if (b.tipo === 'switch' && VEL_MBPS[vel] > VEL_MBPS[b.velocidad_enlace || '100 Gbps']) {
            err.textContent = 'Velocidad ' + vel + ' excede la del switch ' + nombreB + ' (' + b.velocidad_enlace + ')';
            return;
        }

        datos.conexiones.push({
            id: 'con-' + Date.now(),
            desde: a.id,
            hasta: b.id,
            tipo: medio,
            velocidad: vel,
            puertoDesde: pA,
            puertoHasta: pB
        });

        sumarPuertoEnUso(a, medio, 1);
        sumarPuertoEnUso(b, medio, 1);

        cerrarModal();
        guardar();
        renderizar();
    });
}

function mostrarModalEdicion(obj) {
    var nombreActual = obj.descripcion || obj.nombre || '';
    var html = '<p id="msgErrorEdit" style="color:red;font-size:12px;"></p>';

    html += '<h4 style="border-bottom:2px solid #0f3460;padding-bottom:5px;margin-bottom:10px;">— Datos generales —</h4>';
    html += '<label>Descripción *</label><input type="text" id="eDescripcion" value="' + esc(nombreActual) + '">';
    html += '<label>PR / Código</label><input type="text" id="ePR" value="' + esc(obj.pr || '') + '">';

    if (esEquipo(obj.tipo)) {
        html += '<label>Sello</label><input type="text" id="eSello" value="' + esc(obj.sello || '') + '">';
        html += '<label>Marca *</label><input type="text" id="eMarca" value="' + esc(obj.marca || '') + '">';
        html += '<label>Modelo *</label><input type="text" id="eModelo" value="' + esc(obj.modelo || '') + '">';
        html += '<label>Fecha instalación</label><input type="text" readonly value="' + (obj.fecha_instalacion ? esc(obj.fecha_instalacion.substring(0, 10)) : '') + '">';
        html += '<label>Ubicación</label><input type="text" readonly value="' + esc(obj.ubicacion || '') + '">';
    }

    if (obj.tipo === 'switch') {
        var usados = puertosUsadosReales(obj);
        html += '<h4 style="border-bottom:2px solid #0f3460;padding-bottom:5px;margin:15px 0 10px 0;">— Datos del switch —</h4>';
        html += '<label>IP *</label><input type="text" id="eIP" value="' + esc(obj.ip || '') + '">';
        html += '<label>Tipo de gestión</label><select id="eTipoGestion">' +
            ['SSH', 'Telnet', 'Web', 'No gestionable'].map(function (g) {
                return '<option' + (obj.tipo_gestion === g ? ' selected' : '') + '>' + g + '</option>';
            }).join('') + '</select>';
        html += '<label>Velocidad de enlace</label><select id="eVelEnlace">' + opcionesVel(obj.velocidad_enlace) + '</select>';
        html += '<label>Puertos de fibra</label><input type="number" id="ePuertosFibra" value="' + (obj.puertos_fibra || 0) + '">';
        html += '<label>Puertos ethernet</label><input type="number" id="ePuertosEth" value="' + (obj.puertos_ethernet || 0) + '">';
        html += '<p style="font-size:11px;color:#555;">En uso: ' + usados.fibraCount + ' fibra / ' + usados.ethCount + ' ethernet. Puerto más alto usado: fibra ' + usados.fibraMax + ' / ethernet ' + usados.ethMax + '.</p>';
    }

    if (obj.tipo === 'modem') {
        var usadosM = puertosUsadosReales(obj);
        html += '<h4 style="border-bottom:2px solid #0f3460;padding-bottom:5px;margin:15px 0 10px 0;">— Datos del modem —</h4>';
        html += '<label>Puertos ethernet</label><input type="number" id="ePuertosEthModem" value="' + (obj.puerto_ethernet || 0) + '">';
        html += '<label style="margin-top:8px;"><input type="checkbox" id="eAdsl"' + (obj.usa_adsl ? ' checked' : '') + '> Usa ADSL</label>';
        html += '<p style="font-size:11px;color:#555;">Puerto más alto usado: ethernet ' + usadosM.ethMax + '.</p>';
    }

    if (esPC(obj.tipo) || esServicio(obj.tipo)) {
        html += '<label>IP *</label><input type="text" id="eIP" value="' + esc(obj.ip || '') + '">';
    }
    if (esPC(obj.tipo)) {
        html += '<label>Sistemas que atiende</label><textarea id="eSistemas" rows="3">' + esc(obj.sistemas_atiende || '') + '</textarea>';
    }

    if (esEquipo(obj.tipo) || esServicio(obj.tipo) || esPC(obj.tipo)) {
        html += '<label>Prioridad de alertas</label><select id="ePrioridad">' + opcionesPrioridad(obj.prioridad || 'baja') + '</select>';
    }

    html += '<div style="display:flex;gap:10px;margin-top:20px;">' +
        '<button class="btn-add" id="btnActualizar" style="flex:1;">💾 Actualizar</button>' +
        '<button class="btn-del" id="btnEliminarModal" style="flex:1;">🗑️ Eliminar</button>' +
        '</div>';
    html += '<button class="btn-del" id="btnCerrarModal" style="margin-top:10px;background:#555;">Cerrar sin guardar</button>';

    abrirModal('✏️ Editar: ' + esc(nombreActual), html);

    document.getElementById('btnCerrarModal').addEventListener('click', cerrarModal);

    document.getElementById('btnActualizar').addEventListener('click', function () {
        var err = document.getElementById('msgErrorEdit');
        err.textContent = '';
        var cambios = {};

        var nDesc = val('eDescripcion');
        if (!nDesc) { err.textContent = 'La descripción es obligatoria.'; return; }
        if (nDesc !== nombreActual) cambios.descripcion = nDesc;

        if (val('ePR') !== (obj.pr || '')) cambios.pr = val('ePR');

        if (esEquipo(obj.tipo)) {
            if (val('eSello') !== (obj.sello || '')) cambios.sello = val('eSello');
            var nMarca = val('eMarca'), nModelo = val('eModelo');
            if (!nMarca || !nModelo) { err.textContent = 'Marca y modelo son obligatorios.'; return; }
            if (nMarca !== (obj.marca || '')) cambios.marca = nMarca;
            if (nModelo !== (obj.modelo || '')) cambios.modelo = nModelo;
        }

        var eIP = document.getElementById('eIP');
        if (eIP) {
            var nIP = eIP.value.trim();
            if (nIP !== (obj.ip || '')) {
                if (!validarIP(nIP)) { err.textContent = 'IP inválida.'; return; }
                if (ipYaExiste(nIP, obj.id)) { err.textContent = 'La IP ' + nIP + ' ya está en uso.'; return; }
                if (obj.tipo === 'switch') {
                    for (var i = 0; i < datos.conexiones.length; i++) {
                        var cn = datos.conexiones[i];
                        if (cn.desde !== obj.id && cn.hasta !== obj.id) continue;
                        var pid = cn.desde === obj.id ? cn.hasta : cn.desde;
                        var pobj = buscarObjPorId(pid);
                        if (pobj && esPC(pobj.tipo) && pobj.ip && !mismaSubred(pobj.ip, nIP)) {
                            err.textContent = 'La PC "' + (pobj.descripcion || pobj.nombre) + '" (' + pobj.ip + ') quedaría fuera de subred.';
                            return;
                        }
                    }
                }
                if (esPC(obj.tipo)) {
                    var conPC = buscarConexionDe(obj.id, null);
                    if (conPC) {
                        var oid = conPC.desde === obj.id ? conPC.hasta : conPC.desde;
                        var sw = buscarObjPorId(oid);
                        if (sw && sw.tipo === 'switch' && sw.ip && !mismaSubred(nIP, sw.ip)) {
                            err.textContent = 'El switch al que está conectada (' + sw.ip + ') está en otra subred.';
                            return;
                        }
                    }
                }
                cambios.ip = nIP;
            }
        }

        if (obj.tipo === 'switch') {
            var usados2 = puertosUsadosReales(obj);
            var nFibra = parseInt(val('ePuertosFibra'), 10) || 0;
            var nEth = parseInt(val('ePuertosEth'), 10) || 0;

            if (nFibra !== (obj.puertos_fibra || 0)) {
                if (nFibra < usados2.fibraMax) { err.textContent = 'No puede reducir los puertos de fibra a ' + nFibra + ': hay una conexión usando el puerto ' + usados2.fibraMax + '.'; return; }
                if (nFibra < (obj.puertos_fibra_en_uso || 0)) { err.textContent = 'Hay ' + (obj.puertos_fibra_en_uso || 0) + ' puertos de fibra en uso.'; return; }
                cambios.puertos_fibra = nFibra;
            }
            if (nEth !== (obj.puertos_ethernet || 0)) {
                if (nEth < usados2.ethMax) { err.textContent = 'No puede reducir los puertos ethernet a ' + nEth + ': hay una conexión usando el puerto ' + usados2.ethMax + '.'; return; }
                if (nEth < (obj.puertos_ethernet_en_uso || 0)) { err.textContent = 'Hay ' + (obj.puertos_ethernet_en_uso || 0) + ' puertos ethernet en uso.'; return; }
                cambios.puertos_ethernet = nEth;
            }

            if (val('eTipoGestion') !== (obj.tipo_gestion || '')) {
                cambios.tipo_gestion = val('eTipoGestion');
                cambios.gestionable = (val('eTipoGestion') !== 'No gestionable');
            }

            var nVel = val('eVelEnlace');
            if (nVel !== (obj.velocidad_enlace || '')) {
                if (VEL_MBPS[nVel] < maxVelocidadConexiones(obj)) { err.textContent = 'No puede bajar la velocidad a ' + nVel + ': hay conexiones funcionando por encima de esa velocidad.'; return; }
                cambios.velocidad_enlace = nVel;
            }
        }

        if (obj.tipo === 'modem') {
            var usados3 = puertosUsadosReales(obj);
            var nEthM = parseInt(val('ePuertosEthModem'), 10) || 0;
            if (nEthM !== (obj.puerto_ethernet || 0)) {
                if (nEthM < usados3.ethMax) { err.textContent = 'No puede reducir los puertos a ' + nEthM + ': hay una conexión usando el puerto ' + usados3.ethMax + '.'; return; }
                cambios.puerto_ethernet = nEthM;
            }
            var nAdsl = document.getElementById('eAdsl').checked;
            if (nAdsl !== !!obj.usa_adsl) cambios.usa_adsl = nAdsl;
        }

        if (esPC(obj.tipo)) {
            if (val('eSistemas') !== (obj.sistemas_atiende || '')) cambios.sistemas_atiende = val('eSistemas');
        }

        var ePrio = document.getElementById('ePrioridad');
        if (ePrio && val('ePrioridad') !== (obj.prioridad || 'baja')) {
            cambios.prioridad = val('ePrioridad');
        }

        var hayCambios = false;
        for (var k in cambios) { hayCambios = true; break; }
        if (!hayCambios) { err.textContent = 'No hay cambios que actualizar.'; return; }

        if (!confirm('¿Desea actualizar los datos de "' + nombreActual + '"?')) return;

        for (var kk in cambios) obj[kk] = cambios[kk];
        if (cambios.descripcion) obj.nombre = cambios.descripcion;

        cerrarModal();
        guardar();
        renderizar();
        seleccionar(obj);
    });

    var btnDel = document.getElementById('btnEliminarModal');
    var confirmando = false;
    btnDel.addEventListener('click', function () {
        if (!confirmando) {
            confirmando = true;
            this.textContent = '¿Confirmar eliminación?';
            this.style.background = 'red';
            return;
        }
        for (var k2 = 0; k2 < datos.conexiones.length; k2++) {
            var cn2 = datos.conexiones[k2];
            if (cn2.desde === obj.id || cn2.hasta === obj.id) {
                var otroId = cn2.desde === obj.id ? cn2.hasta : cn2.desde;
                sumarPuertoEnUso(buscarObjPorId(otroId), cn2.tipo, -1);
            }
        }
        eliminarPorId(obj.id);
        datos.conexiones = datos.conexiones.filter(function (c) {
            return c.desde !== obj.id && c.hasta !== obj.id;
        });
        seleccion = null;
        cerrarModal();
        guardar();
        renderizar();
        panelVacio();
    });
}

function mostrarPanelConexion(con) {
    var a = buscarObjPorId(con.desde);
    var b = buscarObjPorId(con.hasta);
    var hayPC = (a && esPC(a.tipo)) || (b && esPC(b.tipo));

    var html = '<p><strong>Desde:</strong> ' + esc(a ? (a.descripcion || a.nombre) : '?') + '</p>';
    html += '<p><strong>Hasta:</strong> ' + esc(b ? (b.descripcion || b.nombre) : '?') + '</p>';

    if (hayPC) {
        html += '<label>Medio</label><select id="cTipo" disabled><option value="Ethernet" selected>Ethernet (PC)</option></select>';
    } else {
        html += '<label>Medio</label><select id="cTipo">' +
            '<option value="FO"' + (con.tipo === 'FO' ? ' selected' : '') + '>Fibra óptica (FO)</option>' +
            '<option value="Ethernet"' + (con.tipo === 'Ethernet' ? ' selected' : '') + '>Ethernet</option></select>';
    }

    var velMax = '100 Gbps';
    if (a && a.tipo === 'switch' && a.velocidad_enlace) velMax = a.velocidad_enlace;
    if (b && b.tipo === 'switch' && b.velocidad_enlace && VEL_MBPS[b.velocidad_enlace] < VEL_MBPS[velMax]) {
        velMax = b.velocidad_enlace;
    }
    if (hayPC) velMax = (a && a.tipo === 'switch') ? (a.velocidad_enlace || '1 Gbps') : ((b && b.tipo === 'switch') ? (b.velocidad_enlace || '1 Gbps') : '100 Mbps');
    html += '<label>Velocidad</label><select id="cVel">' + opcionesVelFiltradas(velMax, con.velocidad) + '</select>';

    if (a && esEquipo(a.tipo)) html += '<label>Puerto en ' + esc(a.descripcion || a.nombre) + '</label><input type="number" id="cPuertoA" value="' + (con.puertoDesde == null ? '' : con.puertoDesde) + '">';
    if (b && esEquipo(b.tipo)) html += '<label>Puerto en ' + esc(b.descripcion || b.nombre) + '</label><input type="number" id="cPuertoB" value="' + (con.puertoHasta == null ? '' : con.puertoHasta) + '">';

    document.getElementById('panel-contenido').innerHTML = html +
        '<button class="btn-del" id="btnEliminarCon" style="margin-top:15px;">Eliminar conexión</button>';

    var cTipo = document.getElementById('cTipo');
    if (cTipo && !cTipo.disabled) {
        cTipo.addEventListener('change', function () {
            con.tipo = this.value; guardar(); dibujarConexiones();
        });
    }
    document.getElementById('cVel').addEventListener('change', function () {
        con.velocidad = this.value; guardar(); dibujarConexiones();
    });
    var cA = document.getElementById('cPuertoA');
    if (cA) cA.addEventListener('change', function () {
        var v = this.value === '' ? null : parseInt(this.value, 10);
        if (v != null && (puertoUsadoEnEquipo(a.id, v, con.id) || !puertoDisponible(a, con.tipo, v))) {
            this.value = con.puertoDesde == null ? '' : con.puertoDesde;
            return;
        }
        con.puertoDesde = v;
        guardar(); dibujarConexiones();
    });
    var cB = document.getElementById('cPuertoB');
    if (cB) cB.addEventListener('change', function () {
        var v = this.value === '' ? null : parseInt(this.value, 10);
        if (v != null && (puertoUsadoEnEquipo(b.id, v, con.id) || !puertoDisponible(b, con.tipo, v))) {
            this.value = con.puertoHasta == null ? '' : con.puertoHasta;
            return;
        }
        con.puertoHasta = v;
        guardar(); dibujarConexiones();
    });

    var btnDel = document.getElementById('btnEliminarCon');
    var confirmando = false;
    btnDel.addEventListener('click', function () {
        if (!confirmando) {
            confirmando = true;
            this.textContent = '¿Confirmar eliminación?';
            this.style.background = 'red';
        } else {
            sumarPuertoEnUso(a, con.tipo, -1);
            sumarPuertoEnUso(b, con.tipo, -1);
            for (var i = 0; i < datos.conexiones.length; i++) {
                if (datos.conexiones[i].id === con.id) {
                    datos.conexiones.splice(i, 1);
                    break;
                }
            }
            conexionSeleccionada = null;
            guardar();
            renderizar();
            panelVacio();
        }
    });

    if (!puedeEditar()) {
        var soloCon = document.querySelectorAll('#panel-contenido input, #panel-contenido select, #panel-contenido button');
        for (var s2 = 0; s2 < soloCon.length; s2++) soloCon[s2].disabled = true;
    }
}

// ================= MIGAS / BARRA =================
function actualizarMigas() {
    var cont = document.getElementById('migas');
    var html = '<span class="miga" data-idx="-1">🗺️ ' + esc(datos.nombre) + '</span>';
    for (var i = 0; i < ruta.length; i++) {
        html += '<span class="sep">›</span><span class="miga" data-idx="' + i + '">' + (ICONOS[ruta[i].tipo] || '') + ' ' + esc(ruta[i].descripcion || ruta[i].nombre) + '</span>';
    }
    cont.innerHTML = html;

    var migas = cont.querySelectorAll('.miga');
    for (var j = 0; j < migas.length - 1; j++) {
        migas[j].addEventListener('click', function () {
            var idx = parseInt(this.getAttribute('data-idx'), 10);
            ruta = ruta.slice(0, idx + 1);
            seleccion = null;
            renderizar();
            panelVacio();
        });
    }
}

function actualizarBarraAgregar() {
    var barra = document.getElementById('barra-agregar');
    if (!puedeEditar()) {
        barra.innerHTML = '<p style="color:#555;font-size:12px;padding:10px;">👁️ Modo lectura: tu rol solo puede consultar.</p>';
        return;
    }

    var html = '';
    if (ruta.length === 0) html = '<button class="btn-add" data-crear="unidad">+ Unidad</button>';
    if (ruta.length === 1) html = '<button class="btn-add" data-crear="edificio">+ Edificio</button>';
    if (ruta.length === 2) html = '<button class="btn-add" data-crear="local">+ Local</button>';
    if (ruta.length >= 3) {
        html = '<button class="btn-add" data-crear="local">+ Sub-local</button>' +
            '<button class="btn-add" data-crear="equipo">+ Equipo de red</button>' +
            '<button class="btn-add" data-crear="servicio">+ Servicio</button>' +
            '<button class="btn-add" data-crear="pc">+ PC</button>';
    }
    barra.innerHTML = html;

    var btns = barra.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
        btns[i].addEventListener('click', function () {
            var tipo = this.getAttribute('data-crear');
            var padre = null;
            if (tipo === 'edificio') padre = ruta[0];
            if (tipo === 'local') padre = ruta.length >= 2 ? ruta[ruta.length - 1] : null;
            if (tipo === 'equipo' || tipo === 'servicio' || tipo === 'pc') padre = ruta.length >= 3 ? ruta[ruta.length - 1] : null;
            mostrarFormulario(tipo, padre);
        });
    }
}

// ================= ARRASTRE =================
document.addEventListener('mousemove', function (e) {
    if (arrastre) {
        var dx = e.clientX - arrastre.startX;
        var dy = e.clientY - arrastre.startY;
        if (!arrastre.moved && (Math.abs(dx) + Math.abs(dy)) > 4) arrastre.moved = true;
        if (arrastre.moved) {
            arrastre.obj.x = arrastre.x + dx;
            arrastre.obj.y = arrastre.y + dy;
            arrastre.el.style.left = arrastre.obj.x + 'px';
            arrastre.el.style.top = arrastre.obj.y + 'px';
            dibujarConexiones();
        }
    } else if (redimension) {
        var nw = Math.max(50, redimension.w + (e.clientX - redimension.startX));
        var nh = Math.max(40, redimension.h + (e.clientY - redimension.startY));
        redimension.obj.width = nw; redimension.obj.height = nh;
        redimension.el.style.width = nw + 'px';
        redimension.el.style.height = nh + 'px';
        dibujarConexiones();
    }
});

document.addEventListener('mouseup', function () {
    if (redimension) {
        redimension = null;
        guardar();
        return;
    }
    if (arrastre) {
        var a = arrastre;
        arrastre = null;
        if (a.moved) {
            guardar();
        } else if (puedeEditar() && (esEquipo(a.obj.tipo) || esServicio(a.obj.tipo) || esPC(a.obj.tipo))) {
            mostrarModalEdicion(a.obj);
        }
    }
});

// ================= PANEL =================
function seleccionar(obj) {
    seleccion = obj;
    esperandoConfirmarEliminar = false;
    marcarSeleccion();
    mostrarPanel(obj);
}

function panelVacio() {
    document.getElementById('panel-contenido').innerHTML =
        '<p class="aviso">Seleccione un elemento del lienzo</p>';
}

function mostrarPanel(obj) {
    var html = '<h3>' + (ICONOS[obj.tipo] || '') + ' ' + esc(obj.tipo.toUpperCase()) + '</h3>';

    if (esContenedor(obj.tipo)) {
        html += campo('Nombre', 'nombre', obj.nombre || obj.descripcion);
        html += '<p style="margin-top:10px;color:#555;font-size:12px;">Doble clic en el elemento para ver su contenido.</p>';
        if (puedeEditar()) {
            html += '<button class="btn-del" id="btnEliminar">Eliminar</button>';
        }
    }
    else if (esEquipo(obj.tipo) || esServicio(obj.tipo) || esPC(obj.tipo)) {
        html += '<p style="margin-top:8px;"><strong>' + esc(obj.descripcion || obj.nombre) + '</strong></p>';
        if (obj.ip) html += '<p>IP: ' + esc(obj.ip) + '</p>';
        if (obj.pr) html += '<p>PR: ' + esc(obj.pr) + '</p>';
        if (obj.tipo === 'switch') {
            html += '<p>Puertos fibra: ' + (obj.puertos_fibra_en_uso || 0) + '/' + (obj.puertos_fibra || 0) +
                ' — ethernet: ' + (obj.puertos_ethernet_en_uso || 0) + '/' + (obj.puertos_ethernet || 0) + '</p>';

            // 🔧 Botones de acceso remoto: aparecen si hay IP + tipo de gestión definido
            var tieneGestion = obj.ip && obj.tipo_gestion && obj.tipo_gestion !== 'No gestionable';
            if (tieneGestion) {
                var nombreSwitch = obj.descripcion || obj.nombre || '';
                html += '<div style="display:flex;gap:8px;margin-top:10px;">';
                if (obj.tipo_gestion === 'SSH') {
                    html += '<button class="btn-add" id="btnAbrirSSH" style="flex:1;background:#2c3e50;">🔐 Abrir SSH</button>';
                } else if (obj.tipo_gestion === 'Web') {
                    html += '<button class="btn-add" id="btnAbrirWeb" style="flex:1;background:#27ae60;">🌐 Abrir Admin Web</button>';
                } else if (obj.tipo_gestion === 'Telnet') {
                    html += '<button class="btn-add" id="btnAbrirTelnet" style="flex:1;background:#8e44ad;">📟 Abrir Telnet</button>';
                }
                html += '</div>';
            }
        }
        html += '<p style="margin-top:6px;"><strong>Prioridad de alertas:</strong> ' + esc(obj.prioridad || 'baja') + '</p>';
        html += '<p style="margin-top:10px;color:#555;font-size:12px;">Haz clic sobre el elemento (sin arrastrar) para editar sus datos.</p>';
        if (puedeEditar()) {
            html += '<button class="btn-add" id="btnEditarModal">✏️ Editar datos</button>';
        }
    }

    document.getElementById('panel-contenido').innerHTML = html;

    var btnEdit = document.getElementById('btnEditarModal');
    if (btnEdit) btnEdit.addEventListener('click', function () { mostrarModalEdicion(obj); });

    var nombreSwitch = obj.descripcion || obj.nombre || '';

    var btnSSH = document.getElementById('btnAbrirSSH');
    if (btnSSH) btnSSH.addEventListener('click', function () { abrirAccesoRemoto('ssh', obj.ip, nombreSwitch); });

    var btnWeb = document.getElementById('btnAbrirWeb');
    if (btnWeb) btnWeb.addEventListener('click', function () { abrirAccesoRemoto('web', obj.ip, nombreSwitch); });

    var btnTelnet = document.getElementById('btnAbrirTelnet');
    if (btnTelnet) btnTelnet.addEventListener('click', function () { abrirAccesoRemoto('telnet', obj.ip, nombreSwitch); });

    var campoNombre = document.querySelector('#panel-contenido [data-campo="nombre"]');
    if (campoNombre) {
        campoNombre.addEventListener('change', function () {
            obj.nombre = this.value;
            obj.descripcion = this.value;
            guardar();
            renderizar();
        });
    }

    var btnDel = document.getElementById('btnEliminar');
    if (btnDel) {
        var confirmando = false;
        btnDel.addEventListener('click', function () {
            if (!confirmando) {
                confirmando = true;
                this.textContent = '¿Confirmar eliminación?';
                this.style.background = 'red';
            } else {
                for (var k = 0; k < datos.conexiones.length; k++) {
                    var cn = datos.conexiones[k];
                    if (cn.desde === obj.id || cn.hasta === obj.id) {
                        var otroId = cn.desde === obj.id ? cn.hasta : cn.desde;
                        sumarPuertoEnUso(buscarObjPorId(otroId), cn.tipo, -1);
                    }
                }
                eliminarPorId(obj.id);
                datos.conexiones = datos.conexiones.filter(function (c) {
                    return c.desde !== obj.id && c.hasta !== obj.id;
                });
                seleccion = null;
                guardar();
                renderizar();
                panelVacio();
            }
        });
    }

    if (!puedeEditar()) {
        var solo = document.querySelectorAll('#panel-contenido input, #panel-contenido select, #panel-contenido textarea, #panel-contenido button');
        for (var s = 0; s < solo.length; s++) solo[s].disabled = true;
    }
}

function pushEnPadre(padre, obj) {
    if (!padre) { datos.unidades.push(obj); return; }
    if (obj.tipo === 'edificio') { padre.edificios = padre.edificios || []; padre.edificios.push(obj); return; }
    if (obj.tipo === 'local') {
        if (padre.tipo === 'local') {
            padre.sublocales = padre.sublocales || [];
            padre.sublocales.push(obj);
        } else {
            padre.locales = padre.locales || [];
            padre.locales.push(obj);
        }
        return;
    }
    if (esEquipo(obj.tipo)) { padre.equipos = padre.equipos || []; padre.equipos.push(obj); return; }
    if (esServicio(obj.tipo)) { padre.servicios = padre.servicios || []; padre.servicios.push(obj); return; }
    if (esPC(obj.tipo)) { padre.pcs = padre.pcs || []; padre.pcs.push(obj); return; }
}

function eliminarPorId(id) {
    function eliminarEnArray(arr, id) {
        for (var i = 0; i < arr.length; i++) {
            if (arr[i].id === id) {
                arr.splice(i, 1);
                return true;
            }
        }
        return false;
    }

    function eliminarRecursivo(obj, id) {
        if (obj.edificios && eliminarEnArray(obj.edificios, id)) return true;
        if (obj.locales && eliminarEnArray(obj.locales, id)) return true;
        if (obj.sublocales && eliminarEnArray(obj.sublocales, id)) return true;
        if (obj.equipos && eliminarEnArray(obj.equipos, id)) return true;
        if (obj.servicios && eliminarEnArray(obj.servicios, id)) return true;
        if (obj.pcs && eliminarEnArray(obj.pcs, id)) return true;

        var hijos = hijosDe(obj);
        for (var i = 0; i < hijos.length; i++) {
            if (esContenedor(hijos[i].tipo) && eliminarRecursivo(hijos[i], id)) return true;
        }
        return false;
    }

    if (eliminarEnArray(datos.unidades, id)) return;

    for (var u = 0; u < datos.unidades.length; u++) {
        if (eliminarRecursivo(datos.unidades[u], id)) return;
    }
}

// ================= INICIO =================
function iniciar() {
    if (!cargar()) return;
    renderizar();
    iniciarAnimacionConexiones();
    cargarEstados();
    setInterval(cargarEstados, 30000);

    fetch('/api/sesion', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (s) {
            rolUsuario = s.rol || 'operador';
            aplicarPermisos();
        })
        .catch(function () {
            rolUsuario = 'operador';
            aplicarPermisos();
        });

    document.getElementById('btnVolver').addEventListener('click', function () {
        window.location.href = '/private/mapa.html';
    });

    document.getElementById('btnConectar').addEventListener('click', toggleModoConexion);

    document.getElementById('btnSalir').addEventListener('click', function () {
        fetch('/api/logout', { method: 'POST' }).then(function () {
            window.location.href = '/';
        });
    });

    document.getElementById('lienzo').addEventListener('mousedown', function () {
        if (modoConexion) return;
        seleccion = null;
        conexionSeleccionada = null;
        esperandoConfirmarEliminar = false;
        marcarSeleccion();
        panelVacio();
        dibujarConexiones();
    });
}

document.addEventListener('DOMContentLoaded', iniciar);