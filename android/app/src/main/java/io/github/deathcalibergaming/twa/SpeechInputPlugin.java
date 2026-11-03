package io.github.deathcalibergaming.twa;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
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
 * Saying where to go: the microphone in Navigate To, heard by the phone.
 *
 * The WebView has no speech recognition of its own, so the page asks for it
 * here. Only ever the on-device recogniser - SpeechRecognizer's
 * createOnDeviceSpeechRecognizer, which runs on the phone and is not allowed
 * to send the audio anywhere. The phone's ordinary recogniser is Google's,
 * and Google's sends the voice to its servers whenever it likes; that is
 * not offered as a fallback, for the same reason the navigation voice uses
 * only voices on the phone. Where there is no on-device recogniser,
 * available() says so and the page shows no microphone at all.
 *
 * It also has to work with no signal, which is most of where this app is
 * used, and the on-device one does.
 *
 * One listen at a time. The page is sent what has been heard so far, as it
 * is heard, so the words fill the search box while they are spoken, and the
 * call itself answers with the finished words once the speaker stops.
 *
 * And "Hey Recon", the app listening for its name - below, on Vosk rather
 * than on Android's recogniser, and on the phone just the same. The two
 * share the one microphone: a listen here stops "Hey Recon" for as long as
 * it lasts, and it starts again after.
 */
@CapacitorPlugin(
    name = "SpeechInput",
    permissions = { @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO }) }
)
public class SpeechInputPlugin extends Plugin {

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer rec;
    private PluginCall pending;

    /* Whether there is a recogniser on the phone to listen with. API 31 is
       where the on-device one arrives. */
    @PluginMethod
    public void available(PluginCall call) {
        boolean on = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
        JSObject r = new JSObject();
        r.put("onDevice", on);
        r.put("permission", getPermissionState("microphone") == PermissionState.GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void listen(PluginCall call) {
        if (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) {
            call.reject("no recogniser on this phone", "unavailable");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "micAsked");
            return;
        }
        start(call);
    }

    @PermissionCallback
    private void micAsked(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) start(call);
        else call.reject("microphone not allowed", "permission");
    }

    /* Stop listening and take what was heard - the speaker has finished. */
    @PluginMethod
    public void stop(PluginCall call) {
        main.post(() -> { if (rec != null) rec.stopListening(); });
        call.resolve();
    }

    /* Stop listening and throw it away - the box was closed. */
    @PluginMethod
    public void cancel(PluginCall call) {
        main.post(() -> finish(null, "cancelled", "cancelled"));
        call.resolve();
    }

    private Intent intent() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        /* Australian English: the place names are Australian, and the
           phone's own language is the next best guess if it has no pack
           for it */
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-AU");
        i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5);
        return i;
    }

    private void start(PluginCall call) {
        main.post(() -> {
            finish(null, "replaced by another listen", "cancelled");
            /* one microphone: "Hey Recon" stands down while the button
               listens, and comes back when it is done (finish) */
            stopWake();
            pending = call;
            try {
                rec = SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
            } catch (Exception e) {
                finish(null, "could not start the recogniser: " + e.getMessage(), "unavailable");
                return;
            }
            rec.setRecognitionListener(new RecognitionListener() {
                @Override public void onReadyForSpeech(Bundle b) { say("ready", null); }
                @Override public void onBeginningOfSpeech() { say("speaking", null); }
                @Override public void onRmsChanged(float db) { }
                @Override public void onBufferReceived(byte[] buf) { }
                @Override public void onEndOfSpeech() { say("thinking", null); }
                @Override public void onEvent(int type, Bundle b) { }

                @Override public void onPartialResults(Bundle b) {
                    ArrayList<String> got = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    if (got != null && !got.isEmpty() && !got.get(0).isEmpty()) say("partial", got.get(0));
                }

                @Override public void onResults(Bundle b) {
                    ArrayList<String> got = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                    finish(got, null, null);
                }

                @Override public void onError(int err) {
                    /* The language pack is not on the phone yet. Asked for,
                       it downloads in the background, and the next listen
                       works. */
                    if ((err == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ||
                         err == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED) && Build.VERSION.SDK_INT >= 33) {
                        try { rec.triggerModelDownload(intent()); } catch (Exception e) { /* nothing more to do */ }
                        finish(null, "speech pack downloading", "download");
                        return;
                    }
                    String code;
                    switch (err) {
                        case SpeechRecognizer.ERROR_NO_MATCH:
                        case SpeechRecognizer.ERROR_SPEECH_TIMEOUT: code = "nomatch"; break;
                        case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS: code = "permission"; break;
                        case SpeechRecognizer.ERROR_RECOGNIZER_BUSY: code = "busy"; break;
                        case SpeechRecognizer.ERROR_AUDIO: code = "audio"; break;
                        default: code = "error";
                    }
                    finish(null, "recogniser error " + err, code);
                }
            });
            rec.startListening(intent());
        });
    }

    private void say(String type, String text) {
        JSObject d = new JSObject();
        d.put("type", type);
        if (text != null) d.put("text", text);
        notifyListeners("speech", d);
    }

    /* Answers the listen that is waiting, once, and lets the recogniser go. */
    private void finish(ArrayList<String> got, String why, String code) {
        PluginCall call = pending;
        pending = null;
        if (rec != null) {
            try { rec.destroy(); } catch (Exception e) { /* already gone */ }
            rec = null;
            if (wanted && front) { main.removeCallbacks(rewatch); main.postDelayed(rewatch, 400); }
        }
        if (call == null) return;
        if (got == null || got.isEmpty() || got.get(0).isEmpty()) {
            call.reject(why != null ? why : "nothing heard", code != null ? code : "nomatch");
            return;
        }
        JSObject r = new JSObject();
        r.put("text", got.get(0));
        JSArray alts = new JSArray();
        for (String s : got) alts.put(s);
        r.put("alts", alts);
        call.resolve(r);
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
       all - the app's name and its commands. A short list is what makes it
       light enough to leave running and sure of the name, and anything
       else it hears comes out as [unk]. A place to go to is not on any
       list: "Hey Recon, navigate to" hands the microphone to Android's
       recogniser, which is good at place names, for the one listen (see
       the page's HeyRecon).

       The model is loaded once, the first time it is switched on, from the
       app's assets (model-en-us, Vosk's small US English model, 68 MB) - an
       unpacked copy is kept in the app's own storage for it. */
    private static final String WORDS = "[\"hey recon\", \"hey reckon\", \"hey\", \"recon\", \"reckon\", " +
        "\"cancel navigation\", \"stop navigation\", \"end navigation\", \"cancel\", \"stop\", " +
        "\"take me home\", \"navigate home\", \"go home\", \"home\", " +
        "\"navigate to\", \"take me to\", \"go to\", \"drive to\", \"navigate\", " +
        "\"yes\", \"no\", \"[unk]\"]";

    private org.vosk.Model model;
    private org.vosk.android.SpeechService wake;
    private boolean wanted, front = true, loading;
    private final Runnable rewatch = this::startWake;

    @PluginMethod
    public void watch(PluginCall call) {
        boolean on = call.getBoolean("on", false);
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
        if (!wanted || !front || wake != null || pending != null) return;
        if (model == null) {
            if (loading) return;
            loading = true;
            org.vosk.android.StorageService.unpack(getContext(), "model-en-us", "model",
                (m) -> { model = m; loading = false; startWake(); },
                (e) -> { loading = false; stopped("model"); });
            return;
        }
        try {
            org.vosk.Recognizer r = new org.vosk.Recognizer(model, 16000.0f, WORDS);
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
            finish(null, "app closed", "cancelled");
            if (model != null) { try { model.close(); } catch (Exception e) { /* gone */ } model = null; }
        });
    }
}
