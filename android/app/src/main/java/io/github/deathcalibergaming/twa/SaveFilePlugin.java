package io.github.deathcalibergaming.twa;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/*
 * Saving a file the page made - a backup, a GPX track - where a browser would
 * have downloaded it.
 *
 * A WebView has nowhere to put a download: the page's download link goes
 * nowhere, and Back Up and GPX export saved nothing in the app. This is
 * Android's own Save dialog instead. The driver chooses where it goes -
 * Downloads to begin with - and the app needs no storage permission, because
 * it only ever writes the one file the driver just picked.
 *
 * The file arrives in pieces rather than as one string. A backup carries
 * every track, and a season of them is tens of megabytes; handed across the
 * bridge whole it would exist three times over in the phone's memory, and
 * memory is the ceiling this app has hit before. So: open, then as many
 * writes as it takes, then close.
 */
@CapacitorPlugin(name = "SaveFile")
public class SaveFilePlugin extends Plugin {

    private OutputStream out;

    @PluginMethod
    public void open(PluginCall call) {
        Intent pick = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.setType(call.getString("mime", "application/octet-stream"));
        pick.putExtra(Intent.EXTRA_TITLE, call.getString("name", "file"));
        startActivityForResult(call, pick, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        Intent data = result.getData();
        Uri where = data == null ? null : data.getData();
        if (result.getResultCode() != Activity.RESULT_OK || where == null) {
            r.put("saved", false);           /* the driver backed out: not an error */
            call.resolve(r);
            return;
        }
        try {
            shut();
            out = new BufferedOutputStream(getContext().getContentResolver().openOutputStream(where, "wt"));
            r.put("saved", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("could not open that file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        if (out == null) { call.reject("no file is open"); return; }
        try {
            out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            call.resolve();
        } catch (Exception e) {
            shut();
            call.reject("could not write: " + e.getMessage());
        }
    }

    @PluginMethod
    public void close(PluginCall call) {
        try {
            if (out != null) out.close();
            out = null;
            call.resolve();
        } catch (Exception e) {
            out = null;
            call.reject("could not finish the file: " + e.getMessage());
        }
    }

    private void shut() {
        try { if (out != null) out.close(); } catch (Exception e) { /* already gone */ }
        out = null;
    }
}
