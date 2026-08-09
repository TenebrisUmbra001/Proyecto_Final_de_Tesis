
//alert("Bienvenido de nuevo Ingrese Inicie Sesion para Empezar a Trabajar");

document.getElementById('Login').addEventListener('submit', function (event) {
    event.preventDefault()
    const user = String(document.getElementById('inputUser').value);
    const pass = String(document.getElementById('inputPass').value);
    if (user.length === 0 || pass.length === 0) {
        if (user.length === 0) {
            MensajeError("El Campo del Nombre de Usuario esta Vacio ");
        }
        if (pass.length === 0) {
            MensajeError("El Campo de la Contraseña esta Vacio");
        }
    } else {
        //Verificacion de la autenticidad 
       
        MensajeError("");
        Verificacion(user,pass)
    }


});



function MensajeError(Causa) {
    document.getElementById('Mensaje_Error').textContent = Causa;

}
function Verificacion(user,pass){
    

}