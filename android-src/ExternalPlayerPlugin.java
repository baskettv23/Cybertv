package com.m3u.colorida;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Abre un enlace de video en un reproductor externo (VLC, mpv, MX Player o el selector del sistema). */
@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {

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
