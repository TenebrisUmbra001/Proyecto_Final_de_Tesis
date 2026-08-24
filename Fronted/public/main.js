// Dibujos SVG listos para insertar
var eyeOpenSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
var eyeCloseSVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';

// Al cargar la página, mostramos el ojo abierto por defecto
document.getElementById('eyeIcon').innerHTML = eyeOpenSVG;

document.getElementById('ButtonLogin').addEventListener('click', function(event) {
    event.preventDefault();

    var user = document.getElementById('inputUser').value;
    var pass = document.getElementById('inputPass').value;

    if (user.length === 0) { 
        MensajeError("El Campo del Nombre de Usuario esta Vacio"); 
        return; 
    }
    if (pass.length === 0) { 
        MensajeError("El Campo de la Contraseña esta Vacio"); 
        return; 
    }

    fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: user, contrasena: pass })
    })
    .then(function(response) {
        return response.json();
    })
    .then(function(data) {
       if (data.exito) {
    window.location.href = '/private/mapa.html';
}
    })
    .catch(function(error) {
        MensajeError("Error de conexión con el servidor");
        console.error("Error:", error);
    });
});

function MensajeError(Causa) {
    document.getElementById('Mensaje_Error').textContent = Causa;
}

// Funciones de Hover: cambian el tipo de input y reemplazan el SVG
function showPass() {
    document.getElementById("inputPass").type = "text";
    document.getElementById("eyeIcon").innerHTML = eyeCloseSVG;
}

function hidePass() {
    document.getElementById("inputPass").type = "password";
    document.getElementById("eyeIcon").innerHTML = eyeOpenSVG;
}