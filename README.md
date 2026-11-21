# 📡 M3U Colorida

Gestor colorido de listas M3U para **Mac** (Electron) y **Android** (APK con Capacitor). Una sola base de código en `www/`.

## Funciones
- Agregar listas por **URL**, **archivo** o **pegando el texto**
- Menú de colores: Inicio, Agregar lista, Mis listas, Canales, Favoritos, Ajustes
- Búsqueda y filtro por lista y grupo
- Reproductor integrado (HLS con hls.js)
- Favoritos, actualizar lista desde su URL, copia de seguridad en JSON

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
**Automático (recomendado):** sube el proyecto a GitHub. En la pestaña **Actions** se ejecuta el workflow y, al terminar, descargas el APK (`M3U-Colorida-apk`) desde *Artifacts*.

**Manual** (requiere Android Studio / JDK 17):
```bash
npm install
npx cap add android
npm run apk
```
El APK queda en `android/app/build/outputs/apk/debug/app-debug.apk`.

> Nota: la app del Mac no está firmada; la primera vez, abre con clic derecho → Abrir.

Esta app solo gestiona y reproduce las listas que tú agregas; no incluye contenido.
