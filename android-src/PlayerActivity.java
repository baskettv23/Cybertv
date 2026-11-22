package com.m3u.colorida;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.PlayerView;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.Set;

/**
 * Pantalla completa con ExoPlayer (Media3).
 * - Prueba las URLs en orden y reintenta con otro User-Agent si el servidor responde 401/403/406.
 * - Retoma desde una posición (start) y pasa solo al siguiente episodio (queue).
 * - Guarda el progreso para que la app lo lea al volver.
 * - Imagen en imagen al salir con Inicio.
 */
public class PlayerActivity extends Activity {
    private static final String[] UAS = {
            "VLC/3.0.18 LibVLC/3.0.18",
            "Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    private ExoPlayer player;
    private PlayerView view;
    private String[] urls;
    private String[] queue = new String[0];
    private String[] queueTitles = new String[0];
    private int qi = 0;
    private String key;
    private long startMs = 0;
    private int idx = 0;
    private int uaIdx = 0;
    private int lastCode = -1;
    private String lastError = "";
    private final ArrayList<String> doneKeys = new ArrayList<String>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        urls = getIntent().getStringArrayExtra("urls");
        if (urls == null || urls.length == 0) {
            finish();
            return;
        }
        key = getIntent().getStringExtra("key");
        if (key == null || key.isEmpty()) key = urls[urls.length - 1];
        startMs = getIntent().getLongExtra("start", 0);
        String[] q = getIntent().getStringArrayExtra("queue");
        String[] qt = getIntent().getStringArrayExtra("queueTitles");
        if (q != null) queue = q;
        if (qt != null) queueTitles = qt;

        view = new PlayerView(this);
        view.setShowSubtitleButton(true);
        setContentView(view);
        hideSystemUi();

        // Empieza a reproducir con menos búfer (1 s en vez de 2.5 s) para que abra más rápido
        player = new ExoPlayer.Builder(this)
                .setLoadControl(new DefaultLoadControl.Builder().setBufferDurationsMs(15000, 50000, 1000, 2000).build())
                .build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                onFail(error);
            }

            @Override
            public void onPlaybackStateChanged(int state) {
                if (state == Player.STATE_ENDED) onEnded();
            }
        });
        startCurrent();
    }

    private MediaSource sourceFor(String url, String ua) {
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent(ua)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000);
        return new DefaultMediaSourceFactory(http).createMediaSource(MediaItem.fromUri(url));
    }

    private void startCurrent() {
        MediaSource src = sourceFor(urls[idx], UAS[uaIdx]);
        if (startMs > 0) {
            player.setMediaSource(src, startMs);
            startMs = 0;
        } else {
            player.setMediaSource(src);
        }
        player.prepare();
        player.setPlayWhenReady(true);
    }

    /** Termina el episodio: lo marca como visto y pasa al siguiente de la cola, si hay. */
    private void onEnded() {
        doneKeys.add(key);
        saveProgress();
        if (qi < queue.length) {
            key = queue[qi];
            urls = new String[]{queue[qi]};
            String title = qi < queueTitles.length ? queueTitles[qi] : "";
            qi++;
            idx = 0;
            uaIdx = 0;
            startMs = 0;
            Toast.makeText(this, "Siguiente: " + title, Toast.LENGTH_LONG).show();
            startCurrent();
        }
    }

    private int statusOf(Throwable t) {
        while (t != null) {
            if (t instanceof HttpDataSource.InvalidResponseCodeException) {
                return ((HttpDataSource.InvalidResponseCodeException) t).responseCode;
            }
            t = t.getCause();
        }
        return -1;
    }

    private void onFail(PlaybackException error) {
        lastCode = statusOf(error);
        lastError = error.getErrorCodeName();

        boolean retryOtherUa = (lastCode == 401 || lastCode == 403 || lastCode == 406) && uaIdx < UAS.length - 1;
        if (retryOtherUa) {
            uaIdx++;
        } else if (idx + 1 < urls.length) {
            idx++;
            uaIdx = 0;
        } else {
            showError();
            return;
        }
        player.stop();
        view.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (player != null) startCurrent();
            }
        }, 800);
    }

    private String hint(int code) {
        if (code == 401 || code == 403) {
            return "El servidor rechazó la conexión. Revisa que tu lista siga activa y que no tengas otra conexión abierta en otro aparato.";
        }
        if (code == 404) {
            return "Ese canal o archivo no existe en el servidor (puede estar caído).";
        }
        if (code >= 500 || code == 458 || code == 429) {
            return "El servidor está saturado o limitó las conexiones. Espera un momento y reintenta.";
        }
        return "Prueba con VLC en Ajustes.";
    }

    private void showError() {
        String host = null;
        try {
            host = Uri.parse(urls[urls.length - 1]).getHost();
        } catch (Exception ignored) {
        }
        String what = lastCode > 0 ? "El servidor respondió HTTP " + lastCode : lastError;
        String msg = "No se pudo reproducir.\n" + what + (host != null ? " (" + host + ")" : "") + "\n" + hint(lastCode);
        view.setCustomErrorMessage(msg);
    }

    /** Guarda dónde se quedó (solo películas y episodios, no canales en vivo). */
    private void saveProgress() {
        if (player == null || key == null) return;
        long pos = player.getCurrentPosition();
        long dur = player.getDuration();
        SharedPreferences sp = getSharedPreferences("m3u_progress", MODE_PRIVATE);
        Set<String> done = new HashSet<String>(sp.getStringSet("done", new HashSet<String>()));
        done.addAll(doneKeys);
        SharedPreferences.Editor ed = sp.edit();
        ed.putStringSet("done", done);
        if (dur > 0) {
            ed.putString("url", key);
            ed.putLong("pos", pos);
            ed.putLong("dur", dur);
            ed.putLong("t", System.currentTimeMillis());
        }
        ed.apply();
    }

    private void hideSystemUi() {
        view.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    private boolean inPip() {
        return Build.VERSION.SDK_INT >= 24 && isInPictureInPictureMode();
    }

    /** Al pulsar Inicio mientras se reproduce: seguir en una ventanita (imagen en imagen). */
    @Override
    protected void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= 26 && player != null && player.isPlaying()) {
            try {
                enterPictureInPictureMode(new PictureInPictureParams.Builder().build());
            } catch (Exception ignored) {
            }
        }
    }

    @Override
    public void onPictureInPictureModeChanged(boolean isInPictureInPictureMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig);
        if (view != null) view.setUseController(!isInPictureInPictureMode);
    }

    @Override
    protected void onPause() {
        super.onPause();
        saveProgress();
        if (player != null && !inPip()) player.pause();
    }

    @Override
    protected void onStop() {
        super.onStop();
        saveProgress();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (player != null) {
            saveProgress();
            player.release();
            player = null;
        }
    }
}
