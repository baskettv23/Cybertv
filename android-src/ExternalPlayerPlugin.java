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

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
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


    // ===================== Pasar listas entre aparatos (misma red Wi‑Fi) =====================
    private static final int RECV_PORT = 8765;
    private ServerSocket recvServer;
    private volatile String recvPin = "";

    private static String ownIp() {
        try {
            Enumeration<NetworkInterface> ifs = NetworkInterface.getNetworkInterfaces();
            while (ifs.hasMoreElements()) {
                NetworkInterface ni = ifs.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                Enumeration<InetAddress> as = ni.getInetAddresses();
                while (as.hasMoreElements()) {
                    InetAddress a = as.nextElement();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) return a.getHostAddress();
                }
            }
        } catch (Exception ignored) {
        }
        return "";
    }

    @PluginMethod
    public void localIp(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ip", ownIp());
        call.resolve(ret);
    }

    private void stopRecv() {
        try {
            if (recvServer != null) recvServer.close();
        } catch (Exception ignored) {
        }
        recvServer = null;
    }

    @PluginMethod
    public void stopReceiver(PluginCall call) {
        stopRecv();
        call.resolve();
    }

    private static String readLine(InputStream in) throws Exception {
        ByteArrayOutputStream b = new ByteArrayOutputStream();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') b.write(c);
            if (b.size() > 8192) break;
        }
        return b.toString("UTF-8");
    }

    private static void respond(Socket s, int code, String body) {
        try {
            byte[] bytes = body.getBytes("UTF-8");
            OutputStream o = s.getOutputStream();
            o.write(("HTTP/1.1 " + code + " X\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: " + bytes.length + "\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
            o.write(bytes);
            o.flush();
        } catch (Exception ignored) {
        }
    }

    private void handleConn(final Socket s) {
        try {
            s.setSoTimeout(15000);
            InputStream in = new BufferedInputStream(s.getInputStream());
            String line = readLine(in);
            int len = 0;
            String h;
            while ((h = readLine(in)) != null && !h.isEmpty()) {
                if (h.toLowerCase().startsWith("content-length:")) len = Integer.parseInt(h.substring(15).trim());
            }
            String[] p = line.split(" ");
            if (p.length < 2) { respond(s, 400, "bad"); return; }
            String method = p[0], path = p[1];
            if (method.equals("GET") && path.startsWith("/hello")) {
                respond(s, 200, "DANNYTV|" + Build.MODEL);
            } else if (method.equals("POST") && path.startsWith("/send")) {
                String pin = "";
                int q = path.indexOf("pin=");
                if (q >= 0) pin = path.substring(q + 4).split("&")[0];
                if (recvPin.isEmpty() || !recvPin.equals(pin)) { respond(s, 403, "pin"); return; }
                if (len <= 0 || len > 3000000) { respond(s, 413, "size"); return; }
                byte[] body = new byte[len];
                int off = 0;
                while (off < len) {
                    int n = in.read(body, off, len - off);
                    if (n < 0) break;
                    off += n;
                }
                JSObject ev = new JSObject();
                ev.put("data", new String(body, 0, off, "UTF-8"));
                notifyListeners("received", ev);
                respond(s, 200, "ok");
            } else {
                respond(s, 404, "no");
            }
        } catch (Exception ignored) {
        } finally {
            try { s.close(); } catch (Exception ignored) { }
        }
    }

    @PluginMethod
    public void startReceiver(PluginCall call) {
        stopRecv();
        recvPin = call.getString("pin", "");
        try {
            recvServer = new ServerSocket();
            recvServer.setReuseAddress(true);
            recvServer.bind(new InetSocketAddress(RECV_PORT));
        } catch (Exception e) {
            call.reject("No se pudo abrir el puerto " + RECV_PORT);
            return;
        }
        final ServerSocket ss = recvServer;
        new Thread(new Runnable() {
            @Override
            public void run() {
                while (!ss.isClosed()) {
                    try {
                        final Socket s = ss.accept();
                        new Thread(new Runnable() {
                            @Override
                            public void run() {
                                handleConn(s);
                            }
                        }).start();
                    } catch (Exception e) {
                        break;
                    }
                }
            }
        }).start();
        JSObject ret = new JSObject();
        ret.put("ip", ownIp());
        ret.put("port", RECV_PORT);
        call.resolve(ret);
    }

    /** Busca en la red Wi‑Fi otros aparatos con DANNYTV esperando recibir listas. */
    @PluginMethod
    public void scanReceivers(final PluginCall call) {
        new Thread(new Runnable() {
            @Override
            public void run() {
                final JSArray found = new JSArray();
                String me = ownIp();
                if (me.isEmpty()) {
                    JSObject r = new JSObject();
                    r.put("devices", found);
                    r.put("noWifi", true);
                    call.resolve(r);
                    return;
                }
                final String prefix = me.substring(0, me.lastIndexOf('.') + 1);
                ExecutorService ex = Executors.newFixedThreadPool(48);
                for (int i = 1; i < 255; i++) {
                    final String ip = prefix + i;
                    if (ip.equals(me)) continue;
                    ex.submit(new Runnable() {
                        @Override
                        public void run() {
                            Socket s = new Socket();
                            try {
                                s.connect(new InetSocketAddress(ip, RECV_PORT), 600);
                                s.setSoTimeout(1500);
                                s.getOutputStream().write("GET /hello HTTP/1.0\r\n\r\n".getBytes("UTF-8"));
                                InputStream in = s.getInputStream();
                                byte[] buf = new byte[400];
                                int n = in.read(buf);
                                String t = n > 0 ? new String(buf, 0, n, "UTF-8") : "";
                                int k = t.indexOf("DANNYTV|");
                                if (k >= 0) {
                                    JSObject d = new JSObject();
                                    d.put("ip", ip);
                                    d.put("name", t.substring(k + 8).trim());
                                    synchronized (found) { found.put(d); }
                                }
                            } catch (Exception ignored) {
                            } finally {
                                try { s.close(); } catch (Exception ignored) { }
                            }
                        }
                    });
                }
                ex.shutdown();
                try { ex.awaitTermination(15, TimeUnit.SECONDS); } catch (Exception ignored) { }
                JSObject r = new JSObject();
                synchronized (found) { r.put("devices", found); }
                call.resolve(r);
            }
        }).start();
    }

    @PluginMethod
    public void sendToReceiver(final PluginCall call) {
        final String ip = call.getString("ip", "");
        final String pin = call.getString("pin", "");
        final String data = call.getString("data", "");
        if (ip.isEmpty() || data.isEmpty()) { call.reject("Faltan datos"); return; }
        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection c = null;
                try {
                    byte[] body = data.getBytes("UTF-8");
                    c = (HttpURLConnection) new URL("http://" + ip + ":" + RECV_PORT + "/send?pin=" + Uri.encode(pin)).openConnection();
                    c.setRequestMethod("POST");
                    c.setDoOutput(true);
                    c.setConnectTimeout(6000);
                    c.setReadTimeout(20000);
                    c.setFixedLengthStreamingMode(body.length);
                    OutputStream o = c.getOutputStream();
                    o.write(body);
                    o.flush();
                    o.close();
                    int code = c.getResponseCode();
                    if (code == 200) call.resolve();
                    else if (code == 403) call.reject("PIN incorrecto");
                    else call.reject("La TV respondió " + code);
                } catch (Exception e) {
                    call.reject("No se pudo conectar con la TV");
                } finally {
                    if (c != null) c.disconnect();
                }
            }
        }).start();
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
