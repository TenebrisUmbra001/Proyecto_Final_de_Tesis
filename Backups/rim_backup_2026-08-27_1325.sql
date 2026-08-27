--
-- PostgreSQL database dump
--

\restrict o3kfOzMwHoGFSLfa6yHOlRz7QPRqhjWimm2DeErTn5LNlLp8t0zsjTUODJ7J0ix

-- Dumped from database version 18.6
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: auditoria_ssh; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.auditoria_ssh (
    id integer NOT NULL,
    usuario_sistema character varying(50),
    usuario_ssh character varying(50),
    equipo_id character varying(50),
    equipo_ip character varying(45),
    inicio timestamp without time zone,
    fin timestamp without time zone
);


ALTER TABLE public.auditoria_ssh OWNER TO rim;

--
-- Name: auditoria_ssh_id_seq; Type: SEQUENCE; Schema: public; Owner: rim
--

CREATE SEQUENCE public.auditoria_ssh_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.auditoria_ssh_id_seq OWNER TO rim;

--
-- Name: auditoria_ssh_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: rim
--

ALTER SEQUENCE public.auditoria_ssh_id_seq OWNED BY public.auditoria_ssh.id;


--
-- Name: avisos_enviados; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.avisos_enviados (
    id integer NOT NULL,
    recurso_id character varying(50),
    recurso_nombre character varying(200),
    canal character varying(10),
    destinatario character varying(150),
    detalle text,
    prioridad character varying(10),
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.avisos_enviados OWNER TO rim;

--
-- Name: avisos_enviados_id_seq; Type: SEQUENCE; Schema: public; Owner: rim
--

CREATE SEQUENCE public.avisos_enviados_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.avisos_enviados_id_seq OWNER TO rim;

--
-- Name: avisos_enviados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: rim
--

ALTER SEQUENCE public.avisos_enviados_id_seq OWNED BY public.avisos_enviados.id;


--
-- Name: conexiones; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.conexiones (
    id character varying(50) NOT NULL,
    desde_id character varying(50) NOT NULL,
    hasta_id character varying(50) NOT NULL,
    tipo character varying(20),
    velocidad character varying(20),
    puerto_desde integer,
    puerto_hasta integer
);


ALTER TABLE public.conexiones OWNER TO rim;

--
-- Name: configs_switch; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.configs_switch (
    id integer NOT NULL,
    equipo_id character varying(50),
    equipo_nombre character varying(200),
    ip character varying(45),
    configuracion text,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.configs_switch OWNER TO rim;

--
-- Name: configs_switch_id_seq; Type: SEQUENCE; Schema: public; Owner: rim
--

CREATE SEQUENCE public.configs_switch_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.configs_switch_id_seq OWNER TO rim;

--
-- Name: configs_switch_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: rim
--

ALTER SEQUENCE public.configs_switch_id_seq OWNED BY public.configs_switch.id;


--
-- Name: contactos_notificacion; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.contactos_notificacion (
    id integer NOT NULL,
    nombre character varying(100) NOT NULL,
    correo character varying(150),
    telefono character varying(20),
    activo boolean DEFAULT true,
    canal_correo boolean DEFAULT true,
    canal_sms boolean DEFAULT false,
    prioridad_minima character varying(10) DEFAULT 'media'::character varying
);


ALTER TABLE public.contactos_notificacion OWNER TO rim;

--
-- Name: contactos_notificacion_id_seq; Type: SEQUENCE; Schema: public; Owner: rim
--

CREATE SEQUENCE public.contactos_notificacion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.contactos_notificacion_id_seq OWNER TO rim;

--
-- Name: contactos_notificacion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: rim
--

ALTER SEQUENCE public.contactos_notificacion_id_seq OWNED BY public.contactos_notificacion.id;


--
-- Name: edificios; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.edificios (
    id character varying(50) NOT NULL,
    unidad_id character varying(50),
    nombre character varying(200),
    descripcion character varying(200),
    x integer,
    y integer,
    width integer,
    height integer
);


ALTER TABLE public.edificios OWNER TO rim;

--
-- Name: equipos; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.equipos (
    id character varying(50) NOT NULL,
    local_id character varying(50),
    tipo character varying(20) NOT NULL,
    descripcion character varying(200),
    pr character varying(100),
    sello character varying(100),
    marca character varying(100),
    modelo character varying(100),
    fecha_instalacion timestamp without time zone,
    ubicacion text,
    ip character varying(45),
    tipo_gestion character varying(20),
    gestionable boolean,
    velocidad_enlace character varying(20),
    puertos_fibra integer,
    puertos_fibra_en_uso integer,
    puertos_ethernet integer,
    puertos_ethernet_en_uso integer,
    puerto_ethernet integer,
    puerto_ethernet_en_uso integer,
    usa_adsl boolean,
    prioridad character varying(10) DEFAULT 'baja'::character varying,
    x integer,
    y integer,
    width integer,
    height integer
);


ALTER TABLE public.equipos OWNER TO rim;

--
-- Name: historial_estados; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.historial_estados (
    id integer NOT NULL,
    recurso_id character varying(50) NOT NULL,
    estado character varying(20) NOT NULL,
    detalle text,
    latencia_ms integer,
    fecha timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.historial_estados OWNER TO rim;

--
-- Name: historial_estados_id_seq; Type: SEQUENCE; Schema: public; Owner: rim
--

CREATE SEQUENCE public.historial_estados_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.historial_estados_id_seq OWNER TO rim;

--
-- Name: historial_estados_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: rim
--

ALTER SEQUENCE public.historial_estados_id_seq OWNED BY public.historial_estados.id;


--
-- Name: locales; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.locales (
    id character varying(50) NOT NULL,
    edificio_id character varying(50),
    padre_local_id character varying(50),
    nombre character varying(200),
    descripcion character varying(200),
    x integer,
    y integer,
    width integer,
    height integer
);


ALTER TABLE public.locales OWNER TO rim;

--
-- Name: municipios; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.municipios (
    id character varying(50) NOT NULL,
    nombre character varying(100) NOT NULL
);


ALTER TABLE public.municipios OWNER TO rim;

--
-- Name: pcs; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.pcs (
    id character varying(50) NOT NULL,
    local_id character varying(50),
    descripcion character varying(200),
    pr character varying(100),
    ip character varying(45),
    sistemas_atiende text,
    prioridad character varying(10) DEFAULT 'baja'::character varying,
    x integer,
    y integer,
    width integer,
    height integer
);


ALTER TABLE public.pcs OWNER TO rim;

--
-- Name: servicios; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.servicios (
    id character varying(50) NOT NULL,
    local_id character varying(50),
    tipo character varying(20),
    descripcion character varying(200),
    ip character varying(45),
    prioridad character varying(10) DEFAULT 'baja'::character varying,
    x integer,
    y integer,
    width integer,
    height integer
);


ALTER TABLE public.servicios OWNER TO rim;

--
-- Name: unidades; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.unidades (
    id character varying(50) NOT NULL,
    municipio_id character varying(50),
    nombre character varying(200),
    descripcion character varying(200),
    x integer,
    y integer,
    width integer,
    height integer
);


ALTER TABLE public.unidades OWNER TO rim;

--
-- Name: usuarios; Type: TABLE; Schema: public; Owner: rim
--

CREATE TABLE public.usuarios (
    id integer NOT NULL,
    usuario character varying(50) NOT NULL,
    password_hash character varying(200) NOT NULL,
    nombre character varying(100),
    rol character varying(20) DEFAULT 'operador'::character varying NOT NULL,
    activo boolean DEFAULT true,
    creado_en timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    ultimo_login timestamp without time zone
);


ALTER TABLE public.usuarios OWNER TO rim;

--
-- Name: usuarios_id_seq; Type: SEQUENCE; Schema: public; Owner: rim
--

CREATE SEQUENCE public.usuarios_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.usuarios_id_seq OWNER TO rim;

--
-- Name: usuarios_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: rim
--

ALTER SEQUENCE public.usuarios_id_seq OWNED BY public.usuarios.id;


--
-- Name: auditoria_ssh id; Type: DEFAULT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.auditoria_ssh ALTER COLUMN id SET DEFAULT nextval('public.auditoria_ssh_id_seq'::regclass);


--
-- Name: avisos_enviados id; Type: DEFAULT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.avisos_enviados ALTER COLUMN id SET DEFAULT nextval('public.avisos_enviados_id_seq'::regclass);


--
-- Name: configs_switch id; Type: DEFAULT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.configs_switch ALTER COLUMN id SET DEFAULT nextval('public.configs_switch_id_seq'::regclass);


--
-- Name: contactos_notificacion id; Type: DEFAULT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.contactos_notificacion ALTER COLUMN id SET DEFAULT nextval('public.contactos_notificacion_id_seq'::regclass);


--
-- Name: historial_estados id; Type: DEFAULT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.historial_estados ALTER COLUMN id SET DEFAULT nextval('public.historial_estados_id_seq'::regclass);


--
-- Name: usuarios id; Type: DEFAULT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.usuarios ALTER COLUMN id SET DEFAULT nextval('public.usuarios_id_seq'::regclass);


--
-- Data for Name: auditoria_ssh; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.auditoria_ssh (id, usuario_sistema, usuario_ssh, equipo_id, equipo_ip, inicio, fin) FROM stdin;
\.


--
-- Data for Name: avisos_enviados; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.avisos_enviados (id, recurso_id, recurso_nombre, canal, destinatario, detalle, prioridad, fecha) FROM stdin;
1	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	ping OK pero SSH (22) no responde: problema de conectividad/configuración	media	2026-08-26 12:38:27.633287
2	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	ping OK pero SSH (22) no responde: problema de conectividad/configuración	media	2026-08-26 12:43:22.650929
3	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	media	2026-08-26 12:48:21.03041
4	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	media	2026-08-26 12:54:13.956812
5	switch-1787692816022	Switch frontera AG3	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 12:54:15.897964
6	switch-1787692816022	Switch frontera AG3	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 12:54:15.931674
7	switch-1787693306270	Switch de frontera	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 12:54:16.886148
8	switch-1787693306270	Switch de frontera	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 12:54:16.920124
9	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	ping OK pero SSH (22) no responde: problema de conectividad/configuración	media	2026-08-26 12:59:10.968905
10	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	ping OK pero SSH (22) no responde: problema de conectividad/configuración	media	2026-08-26 13:04:10.98948
11	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	ping OK pero SSH (22) no responde: problema de conectividad/configuración	media	2026-08-26 13:09:11.005987
12	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	media	2026-08-26 13:14:06.893488
13	switch-1787692816022	Switch frontera AG3	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 13:14:06.895863
14	switch-1787692816022	Switch frontera AG3	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 13:14:06.896662
15	switch-1787693306270	Switch de frontera	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 13:14:06.909605
16	switch-1787693306270	Switch de frontera	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 13:14:06.910478
17	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	media	2026-08-26 13:19:06.848453
18	switch-1787692816022	Switch frontera AG3	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 13:19:06.862388
19	switch-1787692816022	Switch frontera AG3	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 13:19:06.863677
20	switch-1787693306270	Switch de frontera	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 13:19:06.877555
21	switch-1787693306270	Switch de frontera	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 13:19:06.879009
22	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	media	2026-08-26 13:24:06.876651
23	switch-1787692816022	Switch frontera AG3	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 13:24:06.88207
24	switch-1787692816022	Switch frontera AG3	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 13:24:06.883322
25	switch-1787693306270	Switch de frontera	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 13:24:06.899172
26	switch-1787693306270	Switch de frontera	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 13:24:06.900333
27	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	media	2026-08-26 13:29:06.87806
28	switch-1787693306270	Switch de frontera	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 13:29:06.896146
29	switch-1787693306270	Switch de frontera	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 13:29:06.89694
30	switch-1787692816022	Switch frontera AG3	correo	jefe1@das.pdr,jefe2@das.pdr	sin respuesta a ping	alta	2026-08-26 13:29:06.899766
31	switch-1787692816022	Switch frontera AG3	sms	55555555,55555556	sin respuesta a ping	alta	2026-08-26 13:29:06.90117
32	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	ping OK pero SSH (22) no responde: problema de conectividad/configuración	media	2026-08-26 13:34:10.981267
33	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	ping OK pero SSH (22) no responde: problema de conectividad/configuración	media	2026-08-26 13:39:10.971149
34	switch-1787692526413	prueba switch web	correo	jefe1@das.pdr,jefe2@das.pdr	ping OK pero SSH (22) no responde: problema de conectividad/configuración	media	2026-08-26 13:44:10.951126
\.


--
-- Data for Name: conexiones; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.conexiones (id, desde_id, hasta_id, tipo, velocidad, puerto_desde, puerto_hasta) FROM stdin;
\.


--
-- Data for Name: configs_switch; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.configs_switch (id, equipo_id, equipo_nombre, ip, configuracion, fecha) FROM stdin;
\.


--
-- Data for Name: contactos_notificacion; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.contactos_notificacion (id, nombre, correo, telefono, activo, canal_correo, canal_sms, prioridad_minima) FROM stdin;
\.


--
-- Data for Name: edificios; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.edificios (id, unidad_id, nombre, descripcion, x, y, width, height) FROM stdin;
edificio-1787835682557	unidad-1787835675996	ICC	ICC	50	40	220	170
\.


--
-- Data for Name: equipos; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.equipos (id, local_id, tipo, descripcion, pr, sello, marca, modelo, fecha_instalacion, ubicacion, ip, tipo_gestion, gestionable, velocidad_enlace, puertos_fibra, puertos_fibra_en_uso, puertos_ethernet, puertos_ethernet_en_uso, puerto_ethernet, puerto_ethernet_en_uso, usa_adsl, prioridad, x, y, width, height) FROM stdin;
\.


--
-- Data for Name: historial_estados; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.historial_estados (id, recurso_id, estado, detalle, latencia_ms, fecha) FROM stdin;
\.


--
-- Data for Name: locales; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.locales (id, edificio_id, padre_local_id, nombre, descripcion, x, y, width, height) FROM stdin;
local-1787835688268	edificio-1787835682557	\N	CCR	CCR	50	40	160	120
\.


--
-- Data for Name: municipios; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.municipios (id, nombre) FROM stdin;
pinar	Nuevo municipio
\.


--
-- Data for Name: pcs; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.pcs (id, local_id, descripcion, pr, ip, sistemas_atiende, prioridad, x, y, width, height) FROM stdin;
\.


--
-- Data for Name: servicios; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.servicios (id, local_id, tipo, descripcion, ip, prioridad, x, y, width, height) FROM stdin;
\.


--
-- Data for Name: unidades; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.unidades (id, municipio_id, nombre, descripcion, x, y, width, height) FROM stdin;
unidad-1787835675996	pinar	jefatura	jefatura	40	40	320	240
\.


--
-- Data for Name: usuarios; Type: TABLE DATA; Schema: public; Owner: rim
--

COPY public.usuarios (id, usuario, password_hash, nombre, rol, activo, creado_en, ultimo_login) FROM stdin;
2	admin	$2b$10$X.MPL1A2eMhAeL3Zs9lNvumtOcxk6OfzoqwYNUHzuRJfEgx4zAUkW	Administrador	admin	t	2026-08-26 12:36:18.31048	\N
3	operador	$2b$10$F0FBoju1nkYBGRzha7ClyupWFATJZCYUPJTBPEDTOtnXUtHcuhscS	Operador	operador	t	2026-08-26 12:36:18.365818	2026-08-26 13:12:39.96926
1	Tenebris	$2b$10$.hj4nNnFTxR5PQh9tP8s3ORKvS76nHDviD.K7DvBCB5ZTUOibPE1S	Administrador Principal	superadmin	t	2026-08-26 12:36:18.246079	2026-08-27 13:25:03.005177
\.


--
-- Name: auditoria_ssh_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rim
--

SELECT pg_catalog.setval('public.auditoria_ssh_id_seq', 1, false);


--
-- Name: avisos_enviados_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rim
--

SELECT pg_catalog.setval('public.avisos_enviados_id_seq', 34, true);


--
-- Name: configs_switch_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rim
--

SELECT pg_catalog.setval('public.configs_switch_id_seq', 1, false);


--
-- Name: contactos_notificacion_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rim
--

SELECT pg_catalog.setval('public.contactos_notificacion_id_seq', 1, true);


--
-- Name: historial_estados_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rim
--

SELECT pg_catalog.setval('public.historial_estados_id_seq', 1, false);


--
-- Name: usuarios_id_seq; Type: SEQUENCE SET; Schema: public; Owner: rim
--

SELECT pg_catalog.setval('public.usuarios_id_seq', 3, true);


--
-- Name: auditoria_ssh auditoria_ssh_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.auditoria_ssh
    ADD CONSTRAINT auditoria_ssh_pkey PRIMARY KEY (id);


--
-- Name: avisos_enviados avisos_enviados_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.avisos_enviados
    ADD CONSTRAINT avisos_enviados_pkey PRIMARY KEY (id);


--
-- Name: conexiones conexiones_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.conexiones
    ADD CONSTRAINT conexiones_pkey PRIMARY KEY (id);


--
-- Name: configs_switch configs_switch_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.configs_switch
    ADD CONSTRAINT configs_switch_pkey PRIMARY KEY (id);


--
-- Name: contactos_notificacion contactos_notificacion_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.contactos_notificacion
    ADD CONSTRAINT contactos_notificacion_pkey PRIMARY KEY (id);


--
-- Name: edificios edificios_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.edificios
    ADD CONSTRAINT edificios_pkey PRIMARY KEY (id);


--
-- Name: equipos equipos_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.equipos
    ADD CONSTRAINT equipos_pkey PRIMARY KEY (id);


--
-- Name: historial_estados historial_estados_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.historial_estados
    ADD CONSTRAINT historial_estados_pkey PRIMARY KEY (id);


--
-- Name: locales locales_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.locales
    ADD CONSTRAINT locales_pkey PRIMARY KEY (id);


--
-- Name: municipios municipios_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.municipios
    ADD CONSTRAINT municipios_pkey PRIMARY KEY (id);


--
-- Name: pcs pcs_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.pcs
    ADD CONSTRAINT pcs_pkey PRIMARY KEY (id);


--
-- Name: servicios servicios_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_pkey PRIMARY KEY (id);


--
-- Name: unidades unidades_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.unidades
    ADD CONSTRAINT unidades_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_pkey; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_pkey PRIMARY KEY (id);


--
-- Name: usuarios usuarios_usuario_key; Type: CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.usuarios
    ADD CONSTRAINT usuarios_usuario_key UNIQUE (usuario);


--
-- Name: edificios edificios_unidad_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.edificios
    ADD CONSTRAINT edificios_unidad_id_fkey FOREIGN KEY (unidad_id) REFERENCES public.unidades(id) ON DELETE CASCADE;


--
-- Name: equipos equipos_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.equipos
    ADD CONSTRAINT equipos_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.locales(id) ON DELETE CASCADE;


--
-- Name: locales locales_edificio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.locales
    ADD CONSTRAINT locales_edificio_id_fkey FOREIGN KEY (edificio_id) REFERENCES public.edificios(id) ON DELETE CASCADE;


--
-- Name: locales locales_padre_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.locales
    ADD CONSTRAINT locales_padre_local_id_fkey FOREIGN KEY (padre_local_id) REFERENCES public.locales(id) ON DELETE CASCADE;


--
-- Name: pcs pcs_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.pcs
    ADD CONSTRAINT pcs_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.locales(id) ON DELETE CASCADE;


--
-- Name: servicios servicios_local_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.servicios
    ADD CONSTRAINT servicios_local_id_fkey FOREIGN KEY (local_id) REFERENCES public.locales(id) ON DELETE CASCADE;


--
-- Name: unidades unidades_municipio_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: rim
--

ALTER TABLE ONLY public.unidades
    ADD CONSTRAINT unidades_municipio_id_fkey FOREIGN KEY (municipio_id) REFERENCES public.municipios(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict o3kfOzMwHoGFSLfa6yHOlRz7QPRqhjWimm2DeErTn5LNlLp8t0zsjTUODJ7J0ix

