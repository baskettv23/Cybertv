package com.m3u.colorida;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.widget.Toast;

import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.ui.PlayerView;

/** Pantalla completa con ExoPlayer (Media3). Prueba varias URLs en orden si una falla. */
public class PlayerActivity extends Activity {
    private ExoPlayer player;
    private PlayerView view;
    private String[] urls;
    private int idx = 0;

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

        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setUserAgent("VLC/3.0.18 LibVLC/3.0.18")
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000)
                .setReadTimeoutMs(15000);

        player = new ExoPlayer.Builder(this)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(http))
                .build();
        view.setPlayer(player);
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                tryNext(error);
            }
        });
        startCurrent();
    }

    private void startCurrent() {
        player.setMediaItem(MediaItem.fromUri(urls[idx]));
        player.prepare();
        player.setPlayWhenReady(true);
    }

    private void tryNext(PlaybackException error) {
        if (idx + 1 < urls.length) {
            idx++;
            startCurrent();
        } else {
            Toast.makeText(this,
                    "No se pudo reproducir (" + error.getErrorCodeName() + "). Prueba con VLC en Ajustes.",
                    Toast.LENGTH_LONG).show();
        }
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
