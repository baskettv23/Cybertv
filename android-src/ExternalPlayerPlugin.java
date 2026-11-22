package com.m3u.colorida;

import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Abre un enlace de video en un reproductor externo (VLC, mpv, MX Player o el selector del sistema). */
@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {

    /** Devuelve el versionCode instalado (coincide con el número de build). */
    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
            JSObject ret = new JSObject();
            ret.put("code", code);
            ret.put("name", pi.versionName == null ? "" : pi.versionName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("No se pudo leer la versión");
        }
    }

    private static final String ALLOWED_UPDATE_URL = "https://github.com/baskettv23/cybertv/releases/download/";

    /** Descarga el APK desde las Releases del repo y abre el instalador de Android. */
    @PluginMethod
    public void installUpdate(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.toLowerCase().startsWith(ALLOWED_UPDATE_URL)) {
            call.reject("Enlace de actualización no permitido");
            return;
        }
        final Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= 26 && !ctx.getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent s = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + ctx.getPackageName()));
                s.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                ctx.startActivity(s);
            } catch (Exception ignored) {
            }
            call.reject("need_permission");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    File dir = new File(ctx.getCacheDir(), "updates");
                    dir.mkdirs();
                    File apk = new File(dir, "update.apk");
                    if (apk.exists()) apk.delete();

                    c = (HttpURLConnection) new URL(url).openConnection();
                    c.setConnectTimeout(20000);
                    c.setReadTimeout(30000);
                    c.setInstanceFollowRedirects(true);
                    int code = c.getResponseCode();
                    if (code != 200) {
                        call.reject("El servidor respondió HTTP " + code);
                        return;
                    }
                    InputStream in = c.getInputStream();
                    FileOutputStream out = new FileOutputStream(apk);
                    try {
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                        }
                    } finally {
                        out.close();
                        in.close();
                    }
                    if (apk.length() < 1000000L) {
                        call.reject("La descarga quedó incompleta");
                        return;
                    }
                    Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".updates", apk);
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(uri, "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(i);
                    call.resolve();
                } catch (Exception e) {
                    call.reject(e.getMessage() == null ? "No se pudo descargar la actualización" : e.getMessage());
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }).start();
    }

    /** Reproduce con ExoPlayer dentro de la app. Recibe una lista de URLs a probar en orden. */
    @PluginMethod
    public void playExo(PluginCall call) {
        try {
            JSArray arr = call.getArray("urls");
            if (arr == null || arr.length() == 0) {
                call.reject("Falta la URL");
                return;
            }
            String[] urls = new String[arr.length()];
            for (int i = 0; i < urls.length; i++) {
                urls[i] = arr.getString(i);
            }
            Intent intent = new Intent(getContext(), PlayerActivity.class);
            intent.putExtra("urls", urls);
            intent.putExtra("title", call.getString("title", ""));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "No se pudo abrir ExoPlayer" : e.getMessage());
        }
    }

    @PluginMethod
    public void play(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("Falta la URL");
            return;
        }
        String title = call.getString("title", "");
        String pkg = call.getString("pkg", "");
        Boolean fb = call.getBoolean("fallback", true);
        boolean fallback = fb == null || fb;

        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(Uri.parse(url), "video/*");
        intent.putExtra("title", title);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);

        try {
            if (pkg != null && !pkg.isEmpty()) {
                intent.setPackage(pkg);
            }
            getContext().startActivity(intent);
            JSObject ret = new JSObject();
            ret.put("opened", true);
            call.resolve(ret);
        } catch (ActivityNotFoundException e) {
            if (!fallback) {
                call.reject("El reproductor no está instalado");
                return;
            }
            try {
                intent.setPackage(null);
                Intent chooser = Intent.createChooser(intent, "Abrir con");
                chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(chooser);
                JSObject ret = new JSObject();
                ret.put("opened", true);
                ret.put("fallback", true);
                call.resolve(ret);
            } catch (Exception e2) {
                call.reject("No hay ningún reproductor disponible");
            }
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "Error al abrir el reproductor" : e.getMessage());
        }
    }
}
