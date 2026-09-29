package io.github.deathcalibergaming.twa;

import android.media.AudioManager;
import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

/*
 * The app is the page in docs/index.html, served from inside the APK. What is
 * here is what a page cannot do for itself.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        /* The launch theme's splash - the mark on the app's own near-black -
           handed over properly on every Android version, not only 12 on. */
        SplashScreen.installSplashScreen(this);
        registerPlugin(NavVoicePlugin.class);
        registerPlugin(SaveFilePlugin.class);
        registerPlugin(TrackerPlugin.class);
        super.onCreate(savedInstanceState);
        /* The volume buttons change the volume the navigation voice speaks
           on, whether or not anything is playing. Left to Android they change
           the ringer between lines on a Samsung, which is the phone this is
           driven with. */
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
        immersive();
    }

    /* The whole screen for the map, as the TWA had it: no status bar and no
       navigation buttons, either one back for a moment with a swipe from the
       edge. Put back each time the window regains focus, because a dialog or
       a swipe brings the bars back and Android leaves them there. */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    private void immersive() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.hide(WindowInsetsCompat.Type.systemBars());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
