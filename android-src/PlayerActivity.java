package com.m3u.colorida;

import android.app.Activity;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.source.MediaSource;
import androidx.media3.ui.PlayerView;

/**
 * Pantalla completa con ExoPlayer (Media3).
 * Prueba las URLs en orden. Si el servidor responde 401/403/406 reintenta con otra
 * identificación (User-Agent). Espera un poco entre intentos para no saturar al proveedor.
 */
public class PlayerActivity extends Activity {
    private static final String[] UAS = {
            "VLC/3.0.18 LibVLC/3.0.18",
            "Mozilla/5.0 (Linux; Android 13; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };

    private ExoPlayer player;
    private PlayerView view;
    private String[] urls;
    private int idx = 0;
    private int uaIdx = 0;
    private int lastCode = -1;
    private String lastError = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        urls = getIntent().getStringArrayExtra("urls");
        if (urls == null || urls.length == 0) {
            finish();
            return;
        }

        view = new PlayerView(this);
        setContentView(view);
        hideSystemUi();

        player = new ExoPlayer.Builder(this).build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                onFail(error);
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
        player.setMediaSource(sourceFor(urls[idx], UAS[uaIdx]));
        player.prepare();
        player.setPlayWhenReady(true);
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

    private void hideSystemUi() {
        view.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (player != null) {
            player.release();
            player = null;
        }
    }
}
