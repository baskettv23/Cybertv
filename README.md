# 📡 DANNYTV

Gestor colorido de listas M3U para **Mac** (Electron) y **Android** (APK con Capacitor). Una sola base de código en `www/`.

## Funciones
- Agregar listas por **URL**, **archivo** o **pegando el texto**
- Menú de colores: Inicio, Agregar lista, Mis listas, Canales, Favoritos, Ajustes
- Búsqueda y filtro por lista y grupo
- Reproductor integrado (HLS con hls.js)
- Favoritos, actualizar lista desde su URL, copia de seguridad en JSON
- **Buscador general** en todas las listas (canales, películas y series)
- **TMDB**: ficha con póster, sinopsis y puntuación (necesita tu clave gratis de themoviedb.org)
- **Menú de reproductor** (Ajustes): Automático, ExoPlayer, Integrado, VLC, mpv, MX Player o Sistema (en Android)
- Real-Debrid y TorBox: ver y reproducir lo que ya tienes en tus cuentas
- **Actualizar desde la app** (Ajustes → Actualizaciones, Android): descarga e instala la última versión
- **Continuar viendo**, historial y marcar como visto (también con ExoPlayer)
- **Siguiente episodio automático** (integrado y ExoPlayer)
- **Inicio con filas**: continuar viendo, últimas películas, tendencias y recomendados de TMDB
- **Guía de programación (EPG)** XMLTV: "ahora" en cada canal
- **Cambio de canal** con ▲▼, flechas o deslizando; calidad 4K/FHD/HD, sin duplicados, revisor de canales caídos
- **Perfiles** (con perfil infantil), temas de color, resumen de uso, búsqueda por voz
- **Imagen en imagen** y botón de subtítulos/audio en ExoPlayer; tráiler y recomendadas en la ficha de TMDB
- Conexión **Xtream** con servidor, usuario y clave
- **Control parental** con PIN: oculta canales, películas y series para adultos (Ajustes)

*Este producto usa la API de TMDB pero no está avalado ni certificado por TMDB.*

## Correr en Mac
```bash
npm install
npm start
```
Crear el instalador `.dmg`:
```bash
npm run dist:mac
```

## Generar el APK
**Automático (recomendado):** sube el proyecto a GitHub. En la pestaña **Actions** se ejecuta el workflow y, al terminar, descargas el APK (`DANNYTV-apk`) desde *Artifacts*.

**Manual** (requiere Android Studio / JDK 17):
```bash
npm install
npx cap add android
npm run apk
```
El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

> Nota: la app del Mac no está firmada; la primera vez, abre con clic derecho → Abrir.

Esta app solo gestiona y reproduce las listas que tú agregas; no incluye contenido.

## Actualizar sin desinstalar
Cada compilación se firma con la misma llave (`cybertv.keystore`) y sube su número de versión, así que el APK nuevo se instala **encima** del anterior y conserva tus listas. El APK más reciente siempre está en **Releases → Última versión**.

## 📺 Modo TV (Android TV / Fire TV)
El APK aparece en el menú de apps de la tele con su banner. Se maneja con el control remoto: flechas para moverte, OK para elegir, Atrás para volver. En el reproductor: ▲/▼ cambia de canal, ◀/▶ salta 10 s en películas. Se activa solo en TV; también puedes forzarlo en Ajustes → Modo TV.

## 🏆 Zona Deportes
Marcadores en vivo (NFL, NBA, MLB, Liga MX, MLS, Champions, LaLiga, Premier, NHL) con el feed público de ESPN, y tus canales de deportes agrupados: Sports USA, Sports MX, PPV, Fútbol, Americano, Básquetbol y Béisbol. Al tocar un partido te muestra los canales de tus listas donde podría estar.

## 🎞️ Por plataforma
En Películas y Series aparecen botones por plataforma (Netflix, Disney+, Prime Video, HBO Max, Apple TV+, Paramount+, Hulu, Star+, Peacock, Crunchyroll) según el grupo o la etiqueta del título en tus listas.

## 🍅 Calificaciones
Con una clave gratis de OMDb (Ajustes → Calificaciones), la ficha de cada película o serie muestra Rotten Tomatoes, IMDb y Metacritic.

## 🖼️ Fondo de pósters
Detrás de la app van cambiando solos pósters de las películas de tus listas. Se apaga en Ajustes → Fondo de pósters.
