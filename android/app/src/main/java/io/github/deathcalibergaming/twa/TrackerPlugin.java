package io.github.deathcalibergaming.twa;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;

/*
 * The page's handle on TrackService: start it when a recording starts or
 * resumes, stop it when it pauses or stops, and ask it for the fixes the page
 * missed while the screen was off.
 *
 * Starting asks once for permission to post notifications, which Android 13
 * wants for the recording notice. Refused, the recording still carries on -
 * Android keeps the service running and simply does not show the notice.
 */
@CapacitorPlugin(
    name = "Tracker",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class TrackerPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "asked");
            return;
        }
        launch(call);
    }

    @PermissionCallback
    private void asked(PluginCall call) { launch(call); }

    private void launch(PluginCall call) {
        try {
            ContextCompat.startForegroundService(getContext(), new Intent(getContext(), TrackService.class));
            call.resolve();
        } catch (Exception e) {
            call.reject("could not start recording in the background: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), TrackService.class));
        call.resolve();
    }

    /* The fixes after a time, oldest first - the page pages through them. */
    @PluginMethod
    public void since(PluginCall call) {
        double after = call.getDouble("after", 0.0);
        int max = call.getInt("max", 2000);
        List<double[]> got = TrackService.since(after, max);
        JSArray list = new JSArray();
        for (double[] f : got) {
            JSObject o = new JSObject();
            o.put("t", (long) f[0]);
            o.put("lat", f[1]);
            o.put("lng", f[2]);
            if (!Double.isNaN(f[3])) o.put("alt", f[3]);
            if (!Double.isNaN(f[4])) o.put("acc", f[4]);
            if (!Double.isNaN(f[5])) o.put("spd", f[5]);
            if (!Double.isNaN(f[6])) o.put("hdg", f[6]);
            list.put(o);
        }
        JSObject r = new JSObject();
        r.put("running", TrackService.isRunning());
        r.put("fixes", list);
        call.resolve(r);
    }
}
