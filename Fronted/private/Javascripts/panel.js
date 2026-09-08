var equiposCache = [];
var usuariosCache = [];
var contactosCache = [];
var avisosCache = [];
var auditoriaCache = [];
var contactoEditId = null;
var usuarioEditId = null;
var rolActual = 'operador';
var nombreUsuario = '';

// 🔧 Paginación
var TAM_PAGINA = 15;
var paginaEquipos = 1;
var paginaAvisos = 1;
var paginaAuditoria = 1;

// 🔧 Gráficos (instancias para destruir al refrescar)
var chartTipo = null, chartEstado = null, chartMunicipio = null;

function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }
function abrirModal(t, c) { document.getElementById('modalTitulo').textContent = t; var cu = document.getElementById('modalCuerpo'); cu.style.padding = '20px'; cu.style.overflowY = 'auto'; cu.innerHTML = c; document.getElementById('modal').style.display = 'flex'; }
function cerrarModal() { document.getElementById('modal').style.display = 'none'; }

document.addEventListener('DOMContentLoaded', function () {
    fetch('/api/sesion', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (s) {
            rolActual = s.rol || 'operador';
            nombreUsuario = s.nombre || '';
            document.getElementById('userActual').textContent = '👤 ' + (s.nombre || '') + ' · ' + rolActual;
            if (rolActual === 'admin' || rolActual === 'superadmin') document.getElementById('tabUsuariosBtn').style.display = '';
            if (rolActual === 'superadmin') document.getElementById('btnNuevoUsuario').style.display = '';
        }).catch(function () { });

    document.getElementById('btnSalir').addEventListener('click', function () {
        fetch('/api/logout', { method: 'POST' }).then(function () { location.href = '/'; });
    });

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', function () {
            for (var j = 0; j < tabs.length; j++) tabs[j].classList.remove('activa');
            this.classList.add('activa');
            var t = this.getAttribute('data-tab');
            var secs = ['equipos', 'estadisticas', 'notificaciones', 'avisos', 'usuarios', 'auditoria', 'configs', 'backups', 'oracle']; // 🔧 NUEVO: oracle
            for (var k = 0; k < secs.length; k++)
                document.getElementById('tab-' + secs[k]).style.display = (secs[k] === t) ? '' : 'none';
            if (t === 'equipos') cargarEquipos();
            if (t === 'estadisticas') cargarStats();
            if (t === 'notificaciones') cargarContactos();
            if (t === 'avisos') { paginaAvisos = 1; cargarAvisos(); }
            if (t === 'usuarios') cargarUsuarios();
            if (t === 'auditoria') { paginaAuditoria = 1; cargarAuditoria(); }
            if (t === 'configs') cargarConfigs();
            if (t === 'backups') cargarBackups();
            if (t === 'oracle') cargarOracleAsm(); // 🔧 NUEVO
        });
    }

    // 🔧 Filtros de búsqueda
    document.getElementById('buscador').addEventListener('keyup', function () { paginaEquipos = 1; renderEquipos(); });
    document.getElementById('filtroMunicipio').addEventListener('change', function () { paginaEquipos = 1; renderEquipos(); });
    document.getElementById('filtroTipo').addEventListener('change', function () { paginaEquipos = 1; renderEquipos(); });
    document.getElementById('filtroEstado').addEventListener('change', function () { paginaEquipos = 1; renderEquipos(); });

    document.getElementById('btnNuevoContacto').addEventListener('click', function () { abrirModalContacto(null); });
    document.getElementById('btnNuevoUsuario').addEventListener('click', function () { abrirModalUsuario(null); });

    // 🔧 Backup manual de BD
    document.getElementById('btnBackupAhora').addEventListener('click', function () {
        this.disabled = true;
        this.textContent = '⏳ Respaldando...';
        var btn = this;
        fetch('/api/admin/backup-bd', { method: 'POST', credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                btn.disabled = false; btn.textContent = '💾 Respaldar ahora';
                if (d.error) alert('Error: ' + d.error);
                else { alert('Backup creado: ' + d.archivo); cargarBackups(); }
            })
            .catch(function () { btn.disabled = false; btn.textContent = '💾 Respaldar ahora'; });
    });

    // 🔧 Botones de exportación
    document.getElementById('btnExportXlsx').addEventListener('click', exportarExcel);
    document.getElementById('btnExportOracle').addEventListener('click', exportarOracle);
    document.getElementById('btnExportSql').addEventListener('click', exportarSql);

    // 🔧 NUEVO: Botón refrescar Oracle ASM
    document.getElementById('btnRefrescarAsm').addEventListener('click', function () {
        this.disabled = true; this.textContent = '⏳ Consultando...';
        var btn = this;
        fetch('/api/admin/oracle-asm/refrescar', { method: 'POST', credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function () { btn.disabled = false; btn.textContent = '🔄 Refrescar ahora'; cargarOracleAsm(); })
            .catch(function () { btn.disabled = false; btn.textContent = '🔄 Refrescar ahora'; });
    });

    cargarMunicipiosFiltro();
    cargarEquipos();
    setInterval(cargarEquipos, 30000);
});

// 🔧 Cargar municipios para el filtro
function cargarMunicipiosFiltro() {
    fetch('/api/municipios', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (lista) {
            var sel = document.getElementById('filtroMunicipio');
            for (var i = 0; i < lista.length; i++) {
                var op = document.createElement('option');
                op.value = lista[i].nombre;
                op.textContent = lista[i].nombre;
                sel.appendChild(op);
            }
        }).catch(function () { });
}

// ================= EQUIPOS (con filtros + paginación) =================
function cargarEquipos() {
    fetch('/api/admin/equipos', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (lista) {
        equiposCache = lista; renderEquipos();
    }).catch(function () { });
}

function filtrarEquipos() {
    var q = val('buscador').toLowerCase();
    var muni = val('filtroMunicipio');
    var tipo = val('filtroTipo');
    var estado = val('filtroEstado');
    var out = [];
    for (var i = 0; i < equiposCache.length; i++) {
        var e = equiposCache[i];
        if (q && (e.nombre + ' ' + e.ip + ' ' + e.municipio + ' ' + e.tipo).toLowerCase().indexOf(q) === -1) continue;
        if (muni && e.municipio !== muni) continue;
        if (tipo && e.tipo !== tipo) continue;
        if (estado && e.estado !== estado) continue;
        out.push(e);
    }
    return out;
}

function renderEquipos() {
    var filtrados = filtrarEquipos();
    var totalPaginas = Math.max(1, Math.ceil(filtrados.length / TAM_PAGINA));
    if (paginaEquipos > totalPaginas) paginaEquipos = totalPaginas;
    var inicio = (paginaEquipos - 1) * TAM_PAGINA;
    var pagina = filtrados.slice(inicio, inicio + TAM_PAGINA);

    var html = '<table><tr><th>Estado</th><th>Tipo</th><th>Descripción</th><th>IP</th><th>Municipio</th><th>Prioridad</th><th>Acciones</th></tr>';
    if (!pagina.length) html += '<tr><td colspan="7"><div class="vacio">Sin resultados</div></td></tr>';
    for (var i = 0; i < pagina.length; i++) {
        var e = pagina[i];
        html += '<tr><td><span class="dot estado-' + e.estado + '"></span> ' + e.estado + '</td>' +
            '<td>' + esc(e.tipo) + '</td><td><strong>' + esc(e.nombre) + '</strong></td><td>' + esc(e.ip) + '</td>' +
            '<td>' + esc(e.municipio) + '</td><td>' + esc(e.prioridad) + '</td>' +
            '<td><button class="btn b-azul" data-ver="' + e.id + '">👁️ Ver</button></td></tr>';
    }
    html += '</table>';
    document.getElementById('tablaEquipos').innerHTML = html;

    renderPaginacion('paginacionEquipos', paginaEquipos, totalPaginas, filtrados.length, function (p) { paginaEquipos = p; renderEquipos(); });

    var btns = document.querySelectorAll('#tablaEquipos [data-ver]');
    for (var b = 0; b < btns.length; b++) {
        btns[b].addEventListener('click', function (ev) {
            ev.stopPropagation();
            var id = this.getAttribute('data-ver');
            for (var x = 0; x < equiposCache.length; x++) if (equiposCache[x].id === id) { abrirModalEquipo(equiposCache[x]); break; }
        });
    }
}

// 🔧 Paginación genérica
function renderPaginacion(contId, pagina, totalPaginas, totalItems, cb) {
    var cont = document.getElementById(contId);
    if (totalPaginas <= 1) { cont.innerHTML = '<span class="pagina-info">' + totalItems + ' registro(s)</span>'; return; }
    cont.innerHTML = '';
    var ant = document.createElement('button');
    ant.className = 'btn b-gris'; ant.textContent = '◀ Anterior';
    ant.disabled = (pagina <= 1);
    ant.onclick = function () { cb(pagina - 1); };
    var info = document.createElement('span');
    info.className = 'pagina-info';
    info.textContent = 'Página ' + pagina + ' de ' + totalPaginas + ' (' + totalItems + ' registros)';
    var sig = document.createElement('button');
    sig.className = 'btn b-gris'; sig.textContent = 'Siguiente ▶';
    sig.disabled = (pagina >= totalPaginas);
    sig.onclick = function () { cb(pagina + 1); };
    cont.appendChild(ant); cont.appendChild(info); cont.appendChild(sig);
}

function abrirModalEquipo(e) {
    var html = '<div class="fila-datos"><span class="k">Estado</span><span class="v"><span class="dot estado-' + e.estado + '"></span> ' + e.estado + '</span></div>' +
        '<div class="fila-datos"><span class="k">Tipo</span><span class="v">' + esc(e.tipo) + '</span></div>' +
        '<div class="fila-datos"><span class="k">Descripción</span><span class="v">' + esc(e.nombre) + '</span></div>' +
        '<div class="fila-datos"><span class="k">IP</span><span class="v">' + esc(e.ip) + '</span></div>' +
        '<div class="fila-datos"><span class="k">Municipio</span><span class="v">' + esc(e.municipio) + '</span></div>' +
        '<div class="fila-datos"><span class="k">Prioridad de alertas</span><span class="v">' + esc(e.prioridad) + '</span></div>';
    html += '<div style="margin-top:18px;text-align:center;">';
    if (e.gestion === 'SSH') html += '<button class="btn b-oscuro" id="mSSH">🔐 Abrir SSH</button>';
    if (e.gestion === 'Web') html += '<button class="btn b-verde" id="mWeb">🌐 Admin Web</button>';
    if (e.gestion === 'Telnet') html += '<button class="btn b-gris" id="mTel">📟 Telnet</button>';
    html += '<button class="btn b-azul" id="mMapa">🗺️ Ver en mapa</button>';
    if (rolActual === 'admin' || rolActual === 'superadmin') html += '<button class="btn b-azul" id="mEditar">✏️ Editar</button>';
    if (rolActual === 'superadmin') html += '<button class="btn b-rojo" id="mEliminar">🗑️ Eliminar</button>';
    html += '<button class="btn b-rojo" id="mCerrar">Cerrar</button></div>';
    abrirModal('🖧 ' + e.nombre, html);

    var b;
    if ((b = document.getElementById('mSSH'))) b.onclick = function () { abrirConsolaSSH(e.ip, e.nombre, e.id); };
    if ((b = document.getElementById('mWeb'))) b.onclick = function () { abrirWeb(e.ip, e.nombre); };
    if ((b = document.getElementById('mTel'))) b.onclick = function () { abrirModal('📟 Telnet', '<p>Ejecuta:</p><div style="background:#1e1e1e;color:#0f0;padding:10px;font-family:monospace;">telnet ' + esc(e.ip) + '</div>'); };
    if ((b = document.getElementById('mMapa'))) b.onclick = function () {
        localStorage.setItem('rim_municipio_actual', e.municipioId);
        localStorage.setItem('rim_enfocar_equipo', e.id);
        window.open('/private/topologia.html', '_blank');
    };
    if ((b = document.getElementById('mEditar'))) b.onclick = function () { abrirModalEditarEquipo(e); };
    if ((b = document.getElementById('mEliminar'))) b.onclick = function () { eliminarEquipoDesdePanel(e); };
    document.getElementById('mCerrar').onclick = cerrarModal;
}

// ✏️ Modal de edición de datos de placa
function abrirModalEditarEquipo(e) {
    abrirModal('✏️ Editar: ' + esc(e.nombre),
        '<label>Descripción *</label><input id="eDesc" value="' + esc(e.nombre) + '">' +
        '<label>PR / Código</label><input id="ePR" value="' + esc(e.pr || '') + '">' +
        '<label>Sello</label><input id="eSello" value="' + esc(e.sello || '') + '">' +
        '<label>Marca</label><input id="eMarca" value="' + esc(e.marca || '') + '">' +
        '<label>Modelo</label><input id="eModelo" value="' + esc(e.modelo || '') + '">' +
        '<label>Prioridad</label><select id="ePrio">' +
            '<option value="alta"' + (e.prioridad === 'alta' ? ' selected' : '') + '>alta</option>' +
            '<option value="media"' + (e.prioridad === 'media' ? ' selected' : '') + '>media</option>' +
            '<option value="baja"' + ((!e.prioridad || e.prioridad === 'baja') ? ' selected' : '') + '>baja</option></select>' +
        '<div style="text-align:center;margin-top:18px;"><button class="btn b-verde" id="btnGuardarEdit">💾 Guardar</button>' +
        '<button class="btn b-gris" id="btnCancelEdit">Cancelar</button></div>');

    document.getElementById('btnCancelEdit').onclick = cerrarModal;
    document.getElementById('btnGuardarEdit').onclick = function () {
        var desc = val('eDesc');
        if (!desc) { alert('La descripción es obligatoria'); return; }
        var body = {
            municipioId: e.municipioId,
            descripcion: desc,
            pr: val('ePR'), sello: val('eSello'),
            marca: val('eMarca'), modelo: val('eModelo'),
            prioridad: document.getElementById('ePrio').value
        };
        fetch('/api/admin/equipos/' + e.id, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), credentials: 'same-origin'
        })
        .then(function (r) { return r.json(); })
        .then(function (d) {
            if (d.error) { alert('Error: ' + d.error); return; }
            cerrarModal();
            cargarEquipos();
            alert('Equipo actualizado correctamente');
        })
        .catch(function () { alert('Error al guardar'); });
    };
}

// 🗑️ Eliminar equipo desde el panel
function eliminarEquipoDesdePanel(e) {
    if (!confirm('¿Eliminar el equipo "' + e.nombre + '"?\nSe eliminarán también sus conexiones.')) return;
    if (!confirm('CONFIRMAR: esta acción no se puede deshacer. ¿Continuar?')) return;

    fetch('/api/admin/equipos/' + e.id + '?mun=' + encodeURIComponent(e.municipioId), {
        method: 'DELETE', credentials: 'same-origin'
    })
    .then(function (r) { return r.json(); })
    .then(function (d) {
        if (d.error) { alert('Error: ' + d.error); return; }
        cerrarModal();
        cargarEquipos();
        alert('Equipo eliminado correctamente');
    })
    .catch(function () { alert('Error al eliminar'); });
}

function abrirWeb(ip, nombre) {
    abrirModal('🌐 Admin Web de ' + esc(nombre),
        '<label>Puerto (opcional)</label><input type="text" id="webPort">' +
        '<div style="text-align:center;margin-top:14px;">' +
        '<button class="btn b-verde" id="wHttps">🔒 HTTPS</button><button class="btn b-azul" id="wHttp">🌐 HTTP</button></div>');
    document.getElementById('wHttps').onclick = function () { var p = val('webPort'); window.open('https://' + ip + (p ? ':' + p : ''), '_blank'); };
    document.getElementById('wHttp').onclick = function () { var p = val('webPort'); window.open('http://' + ip + (p ? ':' + p : ''), '_blank'); };
}

// ================= DASHBOARD CON GRÁFICOS + TOTALES =================
function cargarStats() {
    fetch('/api/admin/estadisticas', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (st) {
        // Total general de equipos
        var totalEquipos = 0;
        for (var t in st.porTipo) totalEquipos += st.porTipo[t];

        // Cards ampliadas
        document.getElementById('statsCards').innerHTML =
            '<div class="card"><div class="num">' + st.total + '</div><div class="lbl">Recursos totales</div></div>' +
            '<div class="card"><div class="num">' + totalEquipos + '</div><div class="lbl">Total equipos</div></div>' +
            '<div class="card verde"><div class="num" style="color:#21c063">' + st.porEstado.online + '</div><div class="lbl">En línea</div></div>' +
            '<div class="card rojo"><div class="num" style="color:#e74c3c">' + st.porEstado.offline + '</div><div class="lbl">Caídos</div></div>' +
            '<div class="card naranja"><div class="num" style="color:#f39c12">' + st.porEstado.degradado + '</div><div class="lbl">Degradados</div></div>' +
            '<div class="card gris"><div class="num">' + st.disponibilidad + '%</div><div class="lbl">Disponibilidad</div></div>';

        // Tabla de totales por tipo con barras
        var maxTipo = 0;
        for (var tt in st.porTipo) if (st.porTipo[tt] > maxTipo) maxTipo = st.porTipo[tt];
        var htmlTipos = '<table><tr><th>Tipo</th><th>Cantidad</th><th>% del total</th><th style="width:35%"></th></tr>';
        for (var tp in st.porTipo) {
            var cant = st.porTipo[tp];
            var pctTotal = totalEquipos ? Math.round(100 * cant / totalEquipos) : 0;
            var pctBarra = maxTipo ? Math.round(100 * cant / maxTipo) : 0;
            htmlTipos += '<tr><td><strong>' + esc(tp.toUpperCase()) + '</strong></td>' +
                '<td>' + cant + '</td><td>' + pctTotal + '%</td>' +
                '<td><div class="barra"><div class="relleno" style="width:' + pctBarra + '%;background:linear-gradient(90deg,#3498db,#21c063)"></div></div></td></tr>';
        }
        htmlTipos += '<tr style="background:#0f3460;color:#fff;"><td><strong>TOTAL</strong></td><td><strong>' + totalEquipos + '</strong></td><td>100%</td><td></td></tr>';
        htmlTipos += '</table>';
        document.getElementById('statsPorTipo').innerHTML = htmlTipos;

        dibujarGraficos(st);

        // Tabla de municipios
        var html = '<table><tr><th>Municipio</th><th>Recursos</th><th>Caídos</th><th style="width:35%">Impacto</th></tr>';
        for (var m in st.porMunicipio) {
            var d = st.porMunicipio[m];
            var pct = d.total ? Math.round(100 * d.offline / d.total) : 0;
            html += '<tr><td>' + esc(m) + '</td><td>' + d.total + '</td><td>' + (d.offline ? '<span class="badge bg-rojo">' + d.offline + '</span>' : '<span class="badge bg-verde">0</span>') + '</td>' +
                '<td><div class="barra"><div class="relleno" style="width:' + pct + '%"></div></div></td></tr>';
        }
        html += '</table>';
        document.getElementById('statsTabla').innerHTML = html;
    }).catch(function () { });
}

function dibujarGraficos(st) {
    if (chartTipo) { chartTipo.destroy(); chartTipo = null; }
    if (chartEstado) { chartEstado.destroy(); chartEstado = null; }
    if (chartMunicipio) { chartMunicipio.destroy(); chartMunicipio = null; }

    var colores = ['#3498db', '#21c063', '#e74c3c', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6'];
    Chart.defaults.color = '#9fb3c8';
    Chart.defaults.borderColor = 'rgba(255,255,255,0.08)';

    var tipos = Object.keys(st.porTipo);
    chartTipo = new Chart(document.getElementById('chartTipo'), {
        type: 'doughnut',
        data: {
            labels: tipos,
            datasets: [{ data: tipos.map(function (t) { return st.porTipo[t]; }), backgroundColor: colores, borderWidth: 2, borderColor: '#16283c' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });

    chartEstado = new Chart(document.getElementById('chartEstado'), {
        type: 'doughnut',
        data: {
            labels: ['En línea', 'Caídos', 'Degradados', 'Desconocidos'],
            datasets: [{ data: [st.porEstado.online, st.porEstado.offline, st.porEstado.degradado, st.porEstado.desconocido], backgroundColor: ['#21c063', '#e74c3c', '#f39c12', '#95a5a6'], borderWidth: 2, borderColor: '#16283c' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right' } } }
    });

    var munis = Object.keys(st.porMunicipio);
    chartMunicipio = new Chart(document.getElementById('chartMunicipio'), {
        type: 'bar',
        data: {
            labels: munis,
            datasets: [
                { label: 'Recursos', data: munis.map(function (m) { return st.porMunicipio[m].total; }), backgroundColor: '#3498db' },
                { label: 'Caídos', data: munis.map(function (m) { return st.porMunicipio[m].offline; }), backgroundColor: '#e74c3c' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    });
}

// ================= CONTACTOS (modal) =================
function abrirModalContacto(c) {
    contactoEditId = c ? c.id : null;
    abrirModal(c ? '✏️ Editar contacto' : '➕ Nuevo contacto',
        '<label>Nombre *</label><input id="cNombre" value="' + esc(c ? c.nombre : '') + '">' +
        '<label>Correo</label><input id="cCorreo" value="' + esc(c ? c.correo : '') + '">' +
        '<label>Teléfono SMS</label><input id="cTelefono" value="' + esc(c ? c.telefono : '') + '">' +
        '<label>Recibe alertas de prioridad</label><select id="cPrioMin">' +
        '<option value="media"' + (c && c.prioridad_minima === 'media' ? ' selected' : '') + '>media y alta</option>' +
        '<option value="alta"' + (c && c.prioridad_minima === 'alta' ? ' selected' : '') + '>solo alta</option></select>' +
        '<label style="margin-top:14px;"><input type="checkbox" id="cActivo" style="width:auto"' + (!c || c.activo ? ' checked' : '') + '> Activo</label>' +
        '<label><input type="checkbox" id="cCorreoCh" style="width:auto"' + (!c || c.canal_correo ? ' checked' : '') + '> Recibir por correo</label>' +
        '<label><input type="checkbox" id="cSms" style="width:auto"' + (c && c.canal_sms ? ' checked' : '') + '> Recibir por SMS</label>' +
        '<div style="text-align:center;margin-top:18px;"><button class="btn b-verde" id="btnGuardarContacto">💾 Guardar</button>' +
        '<button class="btn b-gris" id="btnCancelarContacto">Cancelar</button></div>');

    document.getElementById('btnCancelarContacto').onclick = cerrarModal;
    document.getElementById('btnGuardarContacto').onclick = function () {
        var body = {
            nombre: val('cNombre'), correo: val('cCorreo'), telefono: val('cTelefono'),
            activo: document.getElementById('cActivo').checked,
            canal_correo: document.getElementById('cCorreoCh').checked,
            canal_sms: document.getElementById('cSms').checked,
            prioridad_minima: document.getElementById('cPrioMin').value
        };
        if (!body.nombre) { alert('El nombre es obligatorio'); return; }
        var url = '/api/admin/contactos' + (contactoEditId ? '/' + contactoEditId : '');
        fetch(url, { method: contactoEditId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
            .then(function () { cerrarModal(); cargarContactos(); });
    };
}

function cargarContactos() {
    fetch('/api/admin/contactos', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (lista) {
        contactosCache = lista;
        var html = '<table><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Canales</th><th>Recibe</th><th>Estado</th><th>Acciones</th></tr>';
        if (!lista.length) html += '<tr><td colspan="7"><div class="vacio">No hay contactos. Crea uno con "➕ Nuevo contacto".</div></td></tr>';
        for (var i = 0; i < lista.length; i++) {
            var c = lista[i];
            html += '<tr><td><strong>' + esc(c.nombre) + '</strong></td><td>' + esc(c.correo) + '</td><td>' + esc(c.telefono) + '</td>' +
                '<td>' + (c.canal_correo ? '📧' : '') + (c.canal_sms ? ' 📱' : '') + '</td>' +
                '<td><span class="badge bg-azul">' + esc(c.prioridad_minima) + '+</span></td>' +
                '<td>' + (c.activo ? '<span class="badge bg-verde">Activo</span>' : '<span class="badge bg-rojo">Inactivo</span>') + '</td>' +
                '<td><button class="btn b-azul" data-edit="' + i + '">✏️</button>' +
                '<button class="btn b-rojo" data-del="' + c.id + '">🗑️</button>' +
                (c.correo ? '<button class="btn b-verde" data-probar="' + i + '">📨</button>' : '') + '</td></tr>';
        }
        html += '</table>';
        document.getElementById('tablaContactos').innerHTML = html;

        var btns = document.querySelectorAll('#tablaContactos button');
        for (var b = 0; b < btns.length; b++) {
            btns[b].addEventListener('click', function () {
                if (this.hasAttribute('data-edit')) abrirModalContacto(contactosCache[parseInt(this.getAttribute('data-edit'), 10)]);
                else if (this.hasAttribute('data-del')) {
                    if (confirm('¿Eliminar contacto?')) fetch('/api/admin/contactos/' + this.getAttribute('data-del'), { method: 'DELETE', credentials: 'same-origin' }).then(cargarContactos);
                } else if (this.hasAttribute('data-probar')) {
                    var cc = contactosCache[parseInt(this.getAttribute('data-probar'), 10)];
                    fetch('/api/admin/probar-correo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: cc.correo }), credentials: 'same-origin' })
                        .then(function () { alert('Correo de prueba enviado.'); });
                }
            });
        }
    }).catch(function () { });
}

// ================= AVISOS (paginado) =================
function cargarAvisos() {
    fetch('/api/admin/avisos', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (lista) {
        avisosCache = lista;
        renderAvisos();
    }).catch(function () { });
}
function renderAvisos() {
    var totalPaginas = Math.max(1, Math.ceil(avisosCache.length / TAM_PAGINA));
    if (paginaAvisos > totalPaginas) paginaAvisos = totalPaginas;
    var inicio = (paginaAvisos - 1) * TAM_PAGINA;
    var pagina = avisosCache.slice(inicio, inicio + TAM_PAGINA);

    var html = '<table><tr><th>Fecha</th><th>Recurso</th><th>Canal</th><th>Destinatario</th><th>Prioridad</th><th>Detalle</th></tr>';
    if (!pagina.length) html += '<tr><td colspan="6"><div class="vacio">Aún no se han enviado avisos.</div></td></tr>';
    for (var i = 0; i < pagina.length; i++) {
        var a = pagina[i];
        html += '<tr><td>' + esc(a.fecha) + '</td><td>' + esc(a.recurso_nombre) + '</td>' +
            '<td>' + (a.canal === 'correo' ? '📧' : '📱') + '</td><td>' + esc(a.destinatario) + '</td>' +
            '<td><span class="badge ' + (a.prioridad === 'alta' ? 'bg-rojo' : 'bg-azul') + '">' + esc(a.prioridad) + '</span></td>' +
            '<td>' + esc(a.detalle) + '</td></tr>';
    }
    html += '</table>';
    document.getElementById('tablaAvisos').innerHTML = html;
    renderPaginacion('paginacionAvisos', paginaAvisos, totalPaginas, avisosCache.length, function (p) { paginaAvisos = p; renderAvisos(); });
}

// ================= USUARIOS (modal) =================
function abrirModalUsuario(u) {
    usuarioEditId = u ? u.id : null;
    abrirModal(u ? '✏️ Editar usuario' : '➕ Nuevo usuario',
        '<label>Usuario *</label><input id="uUsuario" value="' + esc(u ? u.usuario : '') + '">' +
        '<label>Nombre completo</label><input id="uNombre" value="' + esc(u ? u.nombre : '') + '">' +
        '<label>Contraseña ' + (u ? '(vacío = no cambiar)' : '*') + '</label><input type="password" id="uPassword">' +
        '<label>Rol</label><select id="uRol">' +
        '<option value="operador"' + (u && u.rol === 'operador' ? ' selected' : '') + '>Operador</option>' +
        '<option value="admin"' + (u && u.rol === 'admin' ? ' selected' : '') + '>Administrador</option>' +
        '<option value="superadmin"' + (u && u.rol === 'superadmin' ? ' selected' : '') + '>Super Administrador</option></select>' +
        '<label style="margin-top:14px;"><input type="checkbox" id="uActivo" style="width:auto"' + (!u || u.activo ? ' checked' : '') + '> Activo</label>' +
        '<div style="text-align:center;margin-top:18px;"><button class="btn b-verde" id="btnGuardarUsuario">💾 Guardar</button>' +
        '<button class="btn b-gris" id="btnCancelarUsuario">Cancelar</button></div>');

    document.getElementById('btnCancelarUsuario').onclick = cerrarModal;
    document.getElementById('btnGuardarUsuario').onclick = function () {
        var body = {
            usuario: val('uUsuario'), nombre: val('uNombre'), password: val('uPassword'),
            rol: document.getElementById('uRol').value, activo: document.getElementById('uActivo').checked
        };
        if (!body.usuario) { alert('El usuario es obligatorio'); return; }
        if (!usuarioEditId && !body.password) { alert('La contraseña es obligatoria al crear'); return; }
        var url = '/api/admin/usuarios' + (usuarioEditId ? '/' + usuarioEditId : '');
        fetch(url, { method: usuarioEditId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' })
            .then(function (r) { if (!r.ok) return r.json().then(function (e) { throw new Error(e.error); }); return r.json(); })
            .then(function () { cerrarModal(); cargarUsuarios(); })
            .catch(function (e) { alert('Error: ' + e.message); });
    };
}

function cargarUsuarios() {
    fetch('/api/admin/usuarios', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (lista) {
        usuariosCache = lista;
        var html = '<table><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Último login</th><th>Acciones</th></tr>';
        for (var i = 0; i < lista.length; i++) {
            var u = lista[i];
            html += '<tr><td><strong>' + esc(u.usuario) + '</strong></td><td>' + esc(u.nombre) + '</td>' +
                '<td><span class="badge ' + (u.rol === 'superadmin' ? 'bg-rojo' : u.rol === 'admin' ? 'bg-azul' : 'bg-gris') + '">' + esc(u.rol) + '</span></td>' +
                '<td>' + (u.activo ? '<span class="badge bg-verde">Activo</span>' : '<span class="badge bg-rojo">Inactivo</span>') + '</td>' +
                '<td>' + (u.ultimo_login ? new Date(u.ultimo_login).toLocaleString() : '—') + '</td><td>';
            if (rolActual === 'superadmin') {
                html += '<button class="btn b-azul" data-uedit="' + i + '">✏️</button>' +
                    '<button class="btn b-rojo" data-udel="' + u.id + '">🗑️</button>';
            } else html += '<span style="color:#576574;font-size:12px;">solo lectura</span>';
            html += '</td></tr>';
        }
        html += '</table>';
        document.getElementById('tablaUsuarios').innerHTML = html;

        if (rolActual === 'superadmin') {
            var btns = document.querySelectorAll('#tablaUsuarios button');
            for (var b = 0; b < btns.length; b++) {
                btns[b].addEventListener('click', function () {
                    if (this.hasAttribute('data-uedit')) abrirModalUsuario(usuariosCache[parseInt(this.getAttribute('data-uedit'), 10)]);
                    else if (this.hasAttribute('data-udel')) {
                        if (confirm('¿Eliminar usuario?')) fetch('/api/admin/usuarios/' + this.getAttribute('data-udel'), { method: 'DELETE', credentials: 'same-origin' }).then(cargarUsuarios);
                    }
                });
            }
        }
    }).catch(function () { });
}

// ================= AUDITORÍA SSH (paginada) =================
function cargarAuditoria() {
    fetch('/api/admin/auditoria', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (lista) {
        auditoriaCache = lista;
        renderAuditoria();
    }).catch(function () { });
}
function renderAuditoria() {
    var totalPaginas = Math.max(1, Math.ceil(auditoriaCache.length / TAM_PAGINA));
    if (paginaAuditoria > totalPaginas) paginaAuditoria = totalPaginas;
    var inicio = (paginaAuditoria - 1) * TAM_PAGINA;
    var pagina = auditoriaCache.slice(inicio, inicio + TAM_PAGINA);

    var html = '<table><tr><th>Usuario sistema</th><th>Usuario SSH</th><th>Equipo</th><th>IP</th><th>Inicio</th><th>Fin</th></tr>';
    if (!pagina.length) html += '<tr><td colspan="6"><div class="vacio">Sin sesiones SSH registradas aún.</div></td></tr>';
    for (var i = 0; i < pagina.length; i++) {
        var a = pagina[i];
        html += '<tr><td><strong>' + esc(a.usuario_sistema) + '</strong></td><td>' + esc(a.usuario_ssh) + '</td><td>' + esc(a.equipo_id) + '</td>' +
            '<td>' + esc(a.equipo_ip) + '</td><td>' + new Date(a.inicio).toLocaleString() + '</td>' +
            '<td>' + (a.fin ? new Date(a.fin).toLocaleString() : '<span class="badge bg-verde">activa</span>') + '</td></tr>';
    }
    html += '</table>';
    document.getElementById('tablaAuditoria').innerHTML = html;
    renderPaginacion('paginacionAuditoria', paginaAuditoria, totalPaginas, auditoriaCache.length, function (p) { paginaAuditoria = p; renderAuditoria(); });
}

// ================= CONFIGS DE SWITCHES =================
function cargarConfigs() {
    fetch('/api/admin/configs', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (lista) {
        var html = '<table><tr><th>Equipo</th><th>IP</th><th>Fecha</th><th>Tamaño</th><th></th></tr>';
        if (!lista.length) html += '<tr><td colspan="5"><div class="vacio">Aún no hay configs respaldadas.</div></td></tr>';
        for (var i = 0; i < lista.length; i++) {
            var c = lista[i];
            html += '<tr><td><strong>' + esc(c.equipo_nombre) + '</strong></td><td>' + esc(c.ip) + '</td><td>' + new Date(c.fecha).toLocaleString() + '</td>' +
                '<td>' + c.tamanio + ' B</td><td>' +
                '<button class="btn b-azul" data-cfg="' + c.id + '">👁️ Ver</button>' +
                '<a class="btn b-verde" style="text-decoration:none;display:inline-block;" href="/api/admin/configs/' + c.id + '/descargar">⬇️ .cfg</a>' +
                '</td></tr>';
        }
        html += '</table>';
        document.getElementById('tablaConfigs').innerHTML = html;
        var btns = document.querySelectorAll('#tablaConfigs [data-cfg]');
        for (var b = 0; b < btns.length; b++) {
            btns[b].addEventListener('click', function () {
                fetch('/api/admin/configs/' + this.getAttribute('data-cfg'), { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (c) {
                    abrirModal('💾 Config de ' + c.equipo_nombre, '<pre style="background:#1e1e1e;color:#0f0;padding:12px;max-height:60vh;overflow:auto;font-size:12px;">' + esc(c.configuracion) + '</pre>');
                });
            });
        }
    }).catch(function () { });
}

// ================= BACKUPS DE BD =================
function cargarBackups() {
    fetch('/api/admin/backups-bd', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (lista) {
        var html = '<table><tr><th>Archivo</th><th>Fecha</th><th>Tamaño</th><th></th></tr>';
        if (!lista.length) html += '<tr><td colspan="4"><div class="vacio">Aún no hay respaldos. Pulsa "💾 Respaldar ahora".</div></td></tr>';
        for (var i = 0; i < lista.length; i++) {
            var b = lista[i];
            html += '<tr><td><strong>' + esc(b.archivo) + '</strong></td><td>' + new Date(b.fecha).toLocaleString() + '</td>' +
                '<td>' + Math.round(b.tamanio / 1024) + ' KB</td>' +
                '<td><a class="btn b-azul" style="text-decoration:none;display:inline-block;" href="/api/admin/backups-bd/' + encodeURIComponent(b.archivo) + '">⬇️ Descargar</a></td></tr>';
        }
        html += '</table>';
        document.getElementById('tablaBackups').innerHTML = html;
    }).catch(function () { });
}

// ================= EXPORTACIÓN (inventario físico) =================

// Helper: descargar archivo en navegador
function descargarArchivo(contenido, nombre, mime) {
    var blob = new Blob([contenido], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

// Helper: obtener inventario físico (solo datos de placa)
function obtenerDatosParaExportar(cb) {
    fetch('/api/admin/inventario-fisico', { credentials: 'same-origin' })
        .then(function (r) { return r.json(); })
        .then(function (lista) { cb(lista); })
        .catch(function () { alert('Error al cargar datos para exportar'); });
}

// 📥 1. Exportar a Excel (.xlsx)
function exportarExcel() {
    obtenerDatosParaExportar(function (lista) {
        var filas = lista.map(function (e) {
            var fecha = e.fecha_instalacion ? new Date(e.fecha_instalacion).toISOString().slice(0, 10) : '';
            return {
                'ID': e.id,
                'Tipo': e.tipo,
                'Descripción': e.descripcion,
                'PR / Código': e.pr,
                'Sello': e.sello,
                'Marca': e.marca,
                'Modelo': e.modelo,
                'Fecha instalación': fecha,
                'Ubicación': e.ubicacion,
                'Municipio': e.municipio
            };
        });
        var ws = XLSX.utils.json_to_sheet(filas);
        ws['!cols'] = [
            { wch: 22 }, { wch: 12 }, { wch: 30 }, { wch: 12 },
            { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 12 },
            { wch: 40 }, { wch: 20 }
        ];
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Inventario Físico');
        var fecha = new Date().toISOString().slice(0, 10);
        XLSX.writeFile(wb, 'inventario_fisico_rim_' + fecha + '.xlsx');
    });
}

// 🗄️ 2. Exportar formato Oracle (CSV + .ctl)
function exportarOracle() {
    obtenerDatosParaExportar(function (lista) {
        var lineas = [];
        lineas.push('\uFEFF"ID";"TIPO";"DESCRIPCION";"PR";"SELLO";"MARCA";"MODELO";"FECHA_INSTALACION";"UBICACION";"MUNICIPIO"');
        lista.forEach(function (e) {
            var fecha = e.fecha_instalacion ? new Date(e.fecha_instalacion).toISOString().slice(0, 10) : '';
            var row = [
                '"' + (e.id || '').replace(/"/g, '""') + '"',
                '"' + (e.tipo || '').replace(/"/g, '""') + '"',
                '"' + (e.descripcion || '').replace(/"/g, '""') + '"',
                '"' + (e.pr || '').replace(/"/g, '""') + '"',
                '"' + (e.sello || '').replace(/"/g, '""') + '"',
                '"' + (e.marca || '').replace(/"/g, '""') + '"',
                '"' + (e.modelo || '').replace(/"/g, '""') + '"',
                '"' + fecha.replace(/"/g, '""') + '"',
                '"' + (e.ubicacion || '').replace(/"/g, '""') + '"',
                '"' + (e.municipio || '').replace(/"/g, '""') + '"'
            ];
            lineas.push(row.join(';'));
        });
        var csv = lineas.join('\n');

        var ctl =
            '-- ============================================================\n' +
            '-- Archivo de control para SQL*Loader (Oracle)\n' +
            '-- Uso: sqlldr usuario/pass@db control=inventario_fisico.ctl\n' +
            '-- ============================================================\n' +
            'OPTIONS (SKIP=1, ROWS=1000)\n' +
            'LOAD DATA\n' +
            'CHARACTERSET UTF8\n' +
            "INFILE 'inventario_fisico_rim.dat'\n" +
            'INTO TABLE INVENTARIO_FISICO_RIM\n' +
            'FIELDS TERMINATED BY ";" OPTIONALLY ENCLOSED BY \'"\'' + '\n' +
            'TRAILING NULLCOLS\n' +
            '(\n' +
            '  ID,\n' +
            '  TIPO,\n' +
            '  DESCRIPCION,\n' +
            '  PR,\n' +
            '  SELLO,\n' +
            '  MARCA,\n' +
            '  MODELO,\n' +
            '  FECHA_INSTALACION DATE "YYYY-MM-DD",\n' +
            '  UBICACION,\n' +
            '  MUNICIPIO\n' +
            ')\n' +
            '\n' +
            '-- DDL sugerido para crear la tabla en Oracle:\n' +
            '-- CREATE TABLE INVENTARIO_FISICO_RIM (\n' +
            '--   ID VARCHAR2(100) PRIMARY KEY,\n' +
            '--   TIPO VARCHAR2(30),\n' +
            '--   DESCRIPCION VARCHAR2(200),\n' +
            '--   PR VARCHAR2(100),\n' +
            '--   SELLO VARCHAR2(100),\n' +
            '--   MARCA VARCHAR2(100),\n' +
            '--   MODELO VARCHAR2(150),\n' +
            '--   FECHA_INSTALACION DATE,\n' +
            '--   UBICACION VARCHAR2(300),\n' +
            '--   MUNICIPIO VARCHAR2(100),\n' +
            '--   FECHA_CARGA DATE DEFAULT SYSDATE\n' +
            '-- );\n';

        var fecha = new Date().toISOString().slice(0, 10);
        descargarArchivo(csv, 'inventario_fisico_rim_' + fecha + '.dat', 'text/csv;charset=utf-8');
        setTimeout(function () {
            descargarArchivo(ctl, 'inventario_fisico.ctl', 'text/plain;charset=utf-8');
        }, 300);
    });
}

// 📜 3. Exportar como SQL INSERTs
function exportarSql() {
    obtenerDatosParaExportar(function (lista) {
        var sql = '-- ============================================================\n';
        sql += '-- Inventario Físico RIM — Generado el ' + new Date().toISOString() + '\n';
        sql += '-- Solo datos de placa (sin IP, sin estado, sin prioridad)\n';
        sql += '-- Compatible con Oracle, PostgreSQL, MySQL\n';
        sql += '-- ============================================================\n\n';
        sql += '-- DDL sugerido:\n';
        sql += 'CREATE TABLE INVENTARIO_FISICO_RIM (\n';
        sql += '  ID VARCHAR2(100) PRIMARY KEY,\n';
        sql += '  TIPO VARCHAR2(30),\n';
        sql += '  DESCRIPCION VARCHAR2(200),\n';
        sql += '  PR VARCHAR2(100),\n';
        sql += '  SELLO VARCHAR2(100),\n';
        sql += '  MARCA VARCHAR2(100),\n';
        sql += '  MODELO VARCHAR2(150),\n';
        sql += '  FECHA_INSTALACION DATE,\n';
        sql += '  UBICACION VARCHAR2(300),\n';
        sql += '  MUNICIPIO VARCHAR2(100),\n';
        sql += '  FECHA_CARGA DATE DEFAULT SYSDATE\n';
        sql += ');\n\n';
        sql += '-- Truncar antes de cargar:\n';
        sql += 'TRUNCATE TABLE INVENTARIO_FISICO_RIM;\n\n';
        sql += '-- Datos:\n';

        lista.forEach(function (e) {
            var fecha = e.fecha_instalacion
                ? "TO_DATE('" + new Date(e.fecha_instalacion).toISOString().slice(0, 10) + "', 'YYYY-MM-DD')"
                : 'NULL';
            var vals = [
                "'" + (e.id || '').replace(/'/g, "''") + "'",
                "'" + (e.tipo || '').replace(/'/g, "''") + "'",
                "'" + (e.descripcion || '').replace(/'/g, "''") + "'",
                "'" + (e.pr || '').replace(/'/g, "''") + "'",
                "'" + (e.sello || '').replace(/'/g, "''") + "'",
                "'" + (e.marca || '').replace(/'/g, "''") + "'",
                "'" + (e.modelo || '').replace(/'/g, "''") + "'",
                fecha,
                "'" + (e.ubicacion || '').replace(/'/g, "''") + "'",
                "'" + (e.municipio || '').replace(/'/g, "''") + "'",
                'SYSDATE'
            ];
            sql += 'INSERT INTO INVENTARIO_FISICO_RIM (ID, TIPO, DESCRIPCION, PR, SELLO, MARCA, MODELO, FECHA_INSTALACION, UBICACION, MUNICIPIO, FECHA_CARGA) VALUES (' + vals.join(', ') + ');\n';
        });

        sql += '\nCOMMIT;\n';

        var fecha = new Date().toISOString().slice(0, 10);
        descargarArchivo(sql, 'inventario_fisico_rim_' + fecha + '.sql', 'text/plain;charset=utf-8');
    });
}

// ================= ORACLE ASM ================= // 🔧 NUEVO
function cargarOracleAsm() {
    fetch('/api/admin/oracle-asm', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (st) {
        var html = '<p style="color:#9fb3c8;font-size:12px;">Umbral de alerta: ' + st.umbral +
            '% de uso · Última consulta: ' + (st.ultimaEjecucion ? new Date(st.ultimaEjecucion).toLocaleString() : 'nunca') + '</p>';
        html += '<table><tr><th>Servidor</th><th>DiskGroup</th><th>Total MB</th><th>Libre MB</th><th>% Usado</th><th style="width:30%">Ocupación</th><th>Estado</th></tr>';
        if (!st.diskgroups || !st.diskgroups.length) html += '<tr><td colspan="7"><div class="vacio">Sin datos. Configura ASM_SERVIDORES en el .env o pulsa Refrescar.</div></td></tr>';
        for (var i = 0; i < st.diskgroups.length; i++) {
            var d = st.diskgroups[i];
            var color = d.pctUsado >= st.umbral ? '#e74c3c' : (d.pctUsado >= st.umbral - 10 ? '#f39c12' : '#21c063');
            html += '<tr><td>' + esc(d.servidor) + '</td><td><strong>' + esc(d.nombre) + '</strong></td>' +
                '<td>' + d.totalMB + '</td><td>' + d.libreMB + '</td><td>' + d.pctUsado + '%</td>' +
                '<td><div class="barra"><div class="relleno" style="width:' + Math.min(100, d.pctUsado) + '%;background:' + color + '"></div></div></td>' +
                '<td>' + (d.alerta ? '<span class="badge bg-rojo">CRÍTICO</span>' : '<span class="badge bg-verde">OK</span>') + '</td></tr>';
        }
        html += '</table>';
        document.getElementById('tablaAsm').innerHTML = html;
    }).catch(function () { });
}

// ================= TERMINAL SSH =================
function abrirConsolaSSH(ip, nombre, equipoId) {
    abrirModal('SSH — ' + esc(nombre),
        '<label>Usuario</label><input type="text" id="sshUser" value="admin">' +
        '<label>Contraseña</label><input type="password" id="sshPass">' +
        '<div style="text-align:center;margin-top:14px;"><button class="btn b-verde" id="btnConSSH">🔌 Conectar</button></div>');
    document.getElementById('btnConSSH').onclick = function () {
        iniciarTerminalSSH(ip, val('sshUser'), document.getElementById('sshPass').value, nombre, equipoId);
    };
}

function iniciarTerminalSSH(ip, user, pass, nombre, equipoId) {
    var caja = document.getElementById('modalCuerpo').parentElement;
    caja.style.width = '95vw'; caja.style.maxWidth = '1400px'; caja.style.height = '92vh';
    var cuerpo = document.getElementById('modalCuerpo');
    cuerpo.style.padding = '0'; cuerpo.style.overflow = 'hidden';
    cuerpo.innerHTML = '<div class="modal-terminal"><div class="barra-superior"><span>🔐 ' + esc(nombre) + ' — ' + esc(ip) + '</span><button class="btn b-rojo" id="btnCerrarTerm">✕ Cerrar</button></div><div id="xterm-container"></div></div>';

    var term = new Terminal({ cursorBlink: true, fontSize: 15, theme: { background: '#1e1e1e', foreground: '#0f0', cursor: '#0f0' }, scrollback: 5000 });
    var fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    term.open(document.getElementById('xterm-container'));
    setTimeout(function () { fit.fit(); term.focus(); }, 120);

    var socket = io({ path: '/ssh-proxy', transports: ['websocket', 'polling'] });
    socket.on('connect', function () {
        socket.emit('ssh-connect', {
            host: ip, port: 22, user: user, pass: pass,
            equipoId: equipoId || '',
            usuarioSistema: nombreUsuario || 'desconocido'
        });
    });
    socket.on('ssh-ready', function () { term.focus(); });
    socket.on('ssh-data', function (d) { term.write(d); });
    socket.on('ssh-error', function (m) { term.writeln('\r\n\x1b[31m❌ ' + m + '\x1b[0m'); });
    term.onData(function (d) { socket.emit('ssh-input', d); });

    document.getElementById('btnCerrarTerm').onclick = function () {
        socket.disconnect();
        try { term.dispose(); } catch (e) { }
        caja.style.width = '560px'; caja.style.maxWidth = '92%'; caja.style.height = '';
        cerrarModal();
    };
}