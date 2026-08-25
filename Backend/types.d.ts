import 'express-session';

declare module 'express-session' {
    interface SessionData {
        usuario: {
            nombre: string;
            rol: string;
        };
    }
}
