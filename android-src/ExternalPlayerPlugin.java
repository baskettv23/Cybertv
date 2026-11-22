package com.m3u.colorida;

import android.app.Activity;
import android.app.UiModeManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Set;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Abre un enlace de video en un reproductor externo (VLC, mpv, MX Player o el selector del sistema). */
@CapacitorPlugin(name = "ExternalPlayer")
public class ExternalPlayerPlugin extends Plugin {

    private static String[] toStringArray(JSArray arr) {
        if (arr == null) return new String[0];
        String[] out = new String[arr.length()];
        try {
            for (int i = 0; i < out.length; i++) out[i] = arr.getString(i);
        } catch (Exception e) {
            return new String[0];
        }
        return out;
    }

    /** Lee (y borra) dónde se quedó ExoPlayer: último enlace, posición, duración y episodios terminados. */
    @PluginMethod
    public void getLastProgress(PluginCall call) {
        SharedPreferences sp = getContext().getSharedPreferences("m3u_progress", Context.MODE_PRIVATE);
        JSObject ret = new JSObject();
        String url = sp.getString("url", null);
        if (url != null) {
            ret.put("url", url);
            ret.put("pos", sp.getLong("pos", 0));
            ret.put("dur", sp.getLong("dur", 0));
            ret.put("t", sp.getLong("t", 0));
        }
        JSArray done = new JSArray();
        Set<String> set = sp.getStringSet("done", null);
        if (set != null) {
            for (String d : set) done.put(d);
        }
        ret.put("done", done);
        sp.edit().clear().apply();
        call.resolve(ret);
    }

    /** Revisa si unos canales responden. De uno en uno y leyendo solo 1 KB, para no saturar al proveedor. */
    @PluginMethod
    public void probe(final PluginCall call) {
        final JSArray arr = call.getArray("urls");
        if (arr == null || arr.length() == 0) {
            call.reject("Faltan enlaces");
            return;
        }
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSArray results = new JSArray();
                try {
                    for (int i = 0; i < arr.length(); i++) {
                        String u = arr.getString(i);
                        boolean ok = false;
                        int code = 0;
                        HttpURLConnection c = null;
                        try {
                            c = (HttpURLConnection) new URL(u).openConnection();
                            c.setConnectTimeout(6000);
                            c.setReadTimeout(6000);
                            c.setRequestProperty("User-Agent", "VLC/3.0.18 LibVLC/3.0.18");
                            code = c.getResponseCode();
                            if (code >= 200 && code < 300) {
                                InputStream in = c.getInputStream();
                                byte[] buf = new byte[1024];
                                ok = in.read(buf) > 0;
                                in.close();
                            }
                        } catch (Exception e) {
                            ok = false;
                        } finally {
                            if (c != null) c.disconnect();
                        }
                        JSObject o = new JSObject();
                        o.put("url", u);
                        o.put("ok", ok);
                        o.put("code", code);
                        results.put(o);
                    }
                    JSObject ret = new JSObject();
                    ret.put("results", results);
                    call.resolve(ret);
                } catch (Exception e) {
                    call.reject("No se pudo revisar");
                }
            }
        }).start();
    }

    /** Búsqueda por voz con el reconocimiento de Google del aparato. */
    @PluginMethod
    public void voice(PluginCall call) {
        try {
            Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "es-419");
            i.putExtra(RecognizerIntent.EXTRA_PROMPT, "Di el título o el canal");
            startActivityForResult(call, i, "voiceResult");
        } catch (Exception e) {
            call.reject("Este aparato no tiene reconocimiento de voz");
        }
    }

    @ActivityCallback
    private void voiceResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            ArrayList<String> list = result.getData().getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
            JSObject ret = new JSObject();
            ret.put("text", list != null && !list.isEmpty() ? list.get(0) : "");
            call.resolve(ret);
        } else {
            call.reject("cancelado");
        }
    }

    /** Dice si la app corre en un Android TV / Fire TV. */
    @PluginMethod
    public void isTv(PluginCall call) {
        boolean tv = false;
        try {
            UiModeManager um = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
            tv = um != null && um.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION;
            if (!tv) tv = getContext().getPackageManager().hasSystemFeature("android.software.leanback");
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("tv", tv);
        call.resolve(ret);
    }

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
            String key = call.getString("key", "");
            if (key != null && !key.isEmpty()) intent.putExtra("key", key);
            Double start = call.getDouble("start");
            if (start != null && start > 0) intent.putExtra("start", start.longValue());
            String[] queue = toStringArray(call.getArray("queue"));
            String[] queueTitles = toStringArray(call.getArray("queueTitles"));
            if (queue.length > 0) {
                intent.putExtra("queue", queue);
                intent.putExtra("queueTitles", queueTitles);
            }
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
