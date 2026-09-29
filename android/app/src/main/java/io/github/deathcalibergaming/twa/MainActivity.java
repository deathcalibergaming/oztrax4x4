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
        bars();
    }

    /* The screen for the map, less the one strip a driver still wants: the
       status bar stays, so the time, the signal and the phone's own battery
       and notifications are there at a glance, as they are in every other
       app on the phone. The navigation buttons go, back for a moment with a
       swipe up from the bottom edge.

       The page is drawn under the status bar, not below it, and its top bar
       steps down by the bar's height (--safeT in index.html), so the strip
       is the top bar's own colour rather than a band of black. The icons in
       it are drawn light, for a dark app - capacitor.config.json, SystemBars.

       Put back each time the window regains focus, because a dialog or a
       swipe brings the navigation buttons back and Android leaves them. */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) bars();
    }

    private void bars() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.show(WindowInsetsCompat.Type.statusBars());
        bars.hide(WindowInsetsCompat.Type.navigationBars());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
