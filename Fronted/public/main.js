document.getElementById('ButtonLogin').addEventListener('click', async function (event) {
    event.preventDefault();

    const user = document.getElementById('inputUser').value;
    const pass = document.getElementById('inputPass').value;

    if (user.length === 0) { MensajeError("El Campo del Nombre de Usuario esta Vacio"); return; }
    if (pass.length === 0) { MensajeError("El Campo de la Contraseña esta Vacio"); return; }

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ usuario: user, contrasena: pass })
        });

        const data = await response.json();

        if (data.exito) {
            MensajeError("");
            alert(data.mensaje);

            // 🔀 Redirigir según el rol
            if (data.rol === 'superadmin') {
                window.location.href = '/private/superadmin.html';
            } else if (data.rol === 'admin') {
                window.location.href = '/private/admin.html';
            } else if (data.rol === 'operador') {
                window.location.href = '/private/operador.html';
            }
        } else {
            MensajeError(data.mensaje);
        }
    } catch (error) {
        MensajeError("Error de conexión con el servidor");
    }
});

function MensajeError(Causa) {
    document.getElementById('Mensaje_Error').textContent = Causa;
}