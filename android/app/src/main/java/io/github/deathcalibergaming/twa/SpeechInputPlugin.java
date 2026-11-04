package io.github.deathcalibergaming.twa;

import android.Manifest;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/*
 * "Hey Recon": the app listening for its name and "cancel navigation", heard
 * on the phone.
 *
 * The WebView has no speech recognition of its own, so the page asks for it
 * here, and it is Vosk, which runs on the phone and sends nothing anywhere -
 * see below for why it is not Android's own.
 *
 * Saying where to go was here too - a microphone in Navigate To, and "Hey
 * Recon, navigate to" - heard by Android's on-device recogniser. Taken out at
 * Mick's word: it did not work properly. A route is chosen by hand; a voice
 * only stops one.
 */
@CapacitorPlugin(
    name = "SpeechInput",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class SpeechInputPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());

    /* Whether the microphone is allowed yet. Vosk is in the app, so there is
       always something to listen with. */
    @PluginMethod
    public void available(PluginCall call) {
        JSObject r = new JSObject();
        r.put("onDevice", true);
        r.put("permission", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(r);
    }

    /* Stop a training listen and throw it away - the box was closed. */
    @PluginMethod
    public void cancel(PluginCall call) {
        trainStop = true;
        call.resolve();
    }

    /* ---------- "Hey Recon" ----------

       Listening for the app's name for as long as the app is on the screen
       and the driver has it switched on. Everything heard is handed to the
       page as words (the "wake" event), and the page decides whether it
       began with "hey recon" and what to do about the rest. Nothing is kept
       here.

       Not Android's recogniser. Both on the S22 - the private on-device one
       and Google's Speech Services - are built to be asked once, end every
       listen after five to nine seconds of nobody speaking, and sound two
       tones on the notification volume each time they do, however the
       listen ends; and neither honours a request to listen on for longer.
       Measured: twelve tones a minute in a quiet car. So this is Vosk, an
       open-source recogniser that runs entirely on the phone and listens
       for as long as it is asked, without a sound.

       It listens for a fixed list of words (WORDS) rather than any word at
       all - the app's name and "cancel navigation". A short list is what
       makes it light enough to leave running and sure of the name, and
       anything else it hears comes out as [unk].

       The model is loaded once, the first time it is switched on, from the
       app's assets (model-en-us, Vosk's small US English model, 68 MB) - an
       unpacked copy is kept in the app's own storage for it. */
    private static final String WORDS = "[\"hey recon\", \"hey reckon\", \"hey\", \"recon\", \"reckon\", " +
        "\"cancel navigation\", \"stop navigation\", \"end navigation\", \"cancel\", \"stop\", " +
        "\"yes\", \"no\", \"[unk]\"]";

    private org.vosk.Model model;
    private org.vosk.android.SpeechService wake;
    private boolean wanted, front = true, loading, training;
    private volatile boolean trainStop;
    private final Runnable rewatch = this::startWake;

    /* The driver's own versions of the name and the commands, learned by
       training (see train) and handed over by the page: what Vosk hears
       when this voice says them. Added to the list, so they can be heard
       at all - a word not on the list never comes out. */
    private final ArrayList<String> mine = new ArrayList<>();

    private String grammar() {
        StringBuilder b = new StringBuilder(WORDS.substring(0, WORDS.length() - 1));
        for (String p : mine) b.append(", ").append(org.json.JSONObject.quote(p));
        return b.append("]").toString();
    }

    @PluginMethod
    public void watch(PluginCall call) {
        boolean on = call.getBoolean("on", false);
        JSArray extra = call.getArray("extra");
        ArrayList<String> got = new ArrayList<>();
        if (extra != null) {
            for (int k = 0; k < extra.length(); k++) {
                String p = extra.optString(k, "");
                if (p.matches("[a-z' ]{2,60}") && got.size() < 40) got.add(p);
            }
        }
        main.post(() -> {
            if (got.equals(mine)) return;
            mine.clear();
            mine.addAll(got);
            /* a new list: listen again with it */
            if (wake != null) { stopWake(); startWake(); }
        });
        if (on && getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "watchAsked");
            return;
        }
        setWatch(on);
        call.resolve();
    }

    @PermissionCallback
    private void watchAsked(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("microphone not allowed", "permission");
            return;
        }
        setWatch(true);
        call.resolve();
    }

    private void setWatch(boolean on) {
        main.post(() -> {
            wanted = on;
            if (on) startWake();
            else stopWake();
        });
    }

    private void startWake() {
        main.removeCallbacks(rewatch);
        if (!wanted || !front || wake != null || training) return;
        if (model == null) {
            if (loading) return;
            loading = true;
            org.vosk.android.StorageService.unpack(getContext(), "model-en-us", "model",
                (m) -> { model = m; loading = false; startWake(); },
                (e) -> { loading = false; stopped("model"); });
            return;
        }
        try {
            org.vosk.Recognizer r = new org.vosk.Recognizer(model, 16000.0f, grammar());
            /* how sure it is of each word - a short list makes every sound
               come out as one of its words, so the page wants to know */
            r.setWords(true);
            wake = new org.vosk.android.SpeechService(r, 16000.0f);
            wake.startListening(new org.vosk.android.RecognitionListener() {
                @Override public void onPartialResult(String json) { heard(json, "partial", false); }
                @Override public void onResult(String json) { heard(json, "text", true); }
                @Override public void onFinalResult(String json) { heard(json, "text", true); }
                @Override public void onError(Exception e) { stopWake(); again(5000); }
                @Override public void onTimeout() { stopWake(); again(100); }
            });
        } catch (Exception e) {
            stopWake();
            again(5000);
        }
    }

    /* What Vosk heard, as words for the page: "hearing" while the phrase
       is still being said, "heard" once it is over. [unk] - a word not on
       the list - is passed on as it is, so the page can tell "hey recon"
       followed by something it does not know from "hey recon" alone. */
    private void heard(String json, String key, boolean last) {
        String text;
        JSArray conf = new JSArray();
        try {
            org.json.JSONObject o = new org.json.JSONObject(json);
            text = o.optString(key, "");
            /* a finished phrase says how sure it is of each word, in order */
            org.json.JSONArray words = o.optJSONArray("result");
            if (words != null) {
                for (int k = 0; k < words.length(); k++) {
                    org.json.JSONObject w = words.optJSONObject(k);
                    if (w != null) conf.put(w.optDouble("conf", 0));
                }
            }
        } catch (Exception e) { return; }
        if (text.isEmpty() || text.equals("[unk]")) return;
        JSObject d = new JSObject();
        d.put("type", last ? "heard" : "hearing");
        d.put("text", text);
        if (last) d.put("conf", conf);
        notifyListeners("wake", d);
    }

    private void stopped(String why) {
        wanted = false;
        stopWake();
        JSObject d = new JSObject();
        d.put("type", "stopped");
        d.put("why", why);
        notifyListeners("wake", d);
    }

    private void again(int wait) {
        main.removeCallbacks(rewatch);
        if (wanted && front) main.postDelayed(rewatch, wait);
    }

    private void stopWake() {
        main.removeCallbacks(rewatch);
        if (wake != null) {
            try { wake.stop(); } catch (Exception e) { /* already stopped */ }
            try { wake.shutdown(); } catch (Exception e) { /* already gone */ }
            wake = null;
        }
    }

    /* ---------- training ----------

       One line said by the driver, heard twice over: once through the list
       "Hey Recon" listens with, and once with the whole of Vosk's 152,000
       words. The list says how sure it is that this voice said the name;
       the whole vocabulary says what this voice sounds like to it where the
       list does not fit - "hey rick on", say, for an Australian "Hey
       Recon". The page keeps both (see the page's VoiceTrain) and hands the
       second back through watch() as words of the driver's own.

       Text only. The sound is read a tenth of a second at a time, fed to
       the two recognisers and dropped; nothing of it is kept. */
    @PluginMethod
    public void train(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "trainAsked");
            return;
        }
        startTrain(call);
    }

    @PermissionCallback
    private void trainAsked(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) startTrain(call);
        else call.reject("microphone not allowed", "permission");
    }

    private void startTrain(PluginCall call) {
        main.post(() -> {
            if (training || loading) { call.reject("already listening", "busy"); return; }
            training = true;
            stopWake();
            if (model != null) { trainRun(call); return; }
            loading = true;
            org.vosk.android.StorageService.unpack(getContext(), "model-en-us", "model",
                (m) -> { model = m; loading = false; trainRun(call); },
                (e) -> { loading = false; training = false; call.reject("could not load the speech model", "model"); });
        });
    }

    private void trainRun(PluginCall call) {
        trainStop = false;
        final org.vosk.Model m = model;
        final String list = grammar();
        new Thread(() -> {
            JSObject out = new JSObject();
            String err = null;
            AudioRecord ar = null;
            org.vosk.Recognizer gram = null, free = null;
            try {
                int min = AudioRecord.getMinBufferSize(16000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
                ar = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, 16000,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, Math.max(min, 32000));
                gram = new org.vosk.Recognizer(m, 16000.0f, list);
                gram.setWords(true);
                free = new org.vosk.Recognizer(m, 16000.0f);
                free.setWords(true);
                ar.startRecording();
                main.post(() -> { JSObject d = new JSObject(); d.put("type", "listening"); notifyListeners("train", d); });
                short[] buf = new short[1600];
                String gj = null, fj = null;
                long t0 = SystemClock.elapsedRealtime();
                /* until the whole-vocabulary one has heard a phrase end, or
                   eight seconds of nothing */
                while (!trainStop && SystemClock.elapsedRealtime() - t0 < 8000) {
                    int n = ar.read(buf, 0, buf.length);
                    if (n <= 0) continue;
                    if (gram.acceptWaveForm(buf, n)) {
                        String r = gram.getResult();
                        if (gj == null && !text(r).isEmpty()) gj = r;
                    }
                    if (free.acceptWaveForm(buf, n)) {
                        String r = free.getResult();
                        if (!text(r).isEmpty()) { fj = r; break; }
                    }
                }
                if (fj == null) fj = free.getFinalResult();
                if (gj == null) gj = gram.getFinalResult();
                out.put("free", heardOf(fj));
                out.put("list", heardOf(gj));
            } catch (Exception e) {
                err = String.valueOf(e.getMessage());
            } finally {
                if (ar != null) { try { ar.stop(); } catch (Exception e) { /* never started */ } ar.release(); }
                if (gram != null) gram.close();
                if (free != null) free.close();
            }
            final String why = err;
            main.post(() -> {
                training = false;
                JSObject f = out.getJSObject("free");
                if (trainStop) call.reject("cancelled", "cancelled");
                else if (why != null) call.reject(why, "error");
                else if (f == null || f.getString("text", "").isEmpty()) call.reject("nothing heard", "nomatch");
                else call.resolve(out);
                again(400);
            });
        }).start();
    }

    private static String text(String json) {
        try { return new org.json.JSONObject(json).optString("text", ""); }
        catch (Exception e) { return ""; }
    }

    /* A Vosk result as the page reads one: the words, and how sure it was
       of each. */
    private static JSObject heardOf(String json) {
        JSObject o = new JSObject();
        JSArray conf = new JSArray();
        String t = "";
        try {
            org.json.JSONObject r = new org.json.JSONObject(json);
            t = r.optString("text", "");
            org.json.JSONArray w = r.optJSONArray("result");
            if (w != null) for (int k = 0; k < w.length(); k++) {
                org.json.JSONObject x = w.optJSONObject(k);
                if (x != null) conf.put(x.optDouble("conf", 0));
            }
        } catch (Exception e) { /* nothing heard */ }
        o.put("text", t);
        o.put("conf", conf);
        return o;
    }

    /* Only with the app on the screen. Behind another app, or with the
       screen off, Android would not let it hear anyway, and nobody would
       expect it to. */

    @Override
    protected void handleOnPause() {
        main.post(() -> { front = false; stopWake(); });
    }

    @Override
    protected void handleOnResume() {
        main.post(() -> { front = true; startWake(); });
    }

    @Override
    protected void handleOnDestroy() {
        main.post(() -> {
            wanted = false;
            stopWake();
            if (model != null) { try { model.close(); } catch (Exception e) { /* gone */ } model = null; }
        });
    }
}
