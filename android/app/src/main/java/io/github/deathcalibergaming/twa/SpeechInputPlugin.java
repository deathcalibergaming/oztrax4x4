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

    @Override
    protected void handleOnDestroy() {
        main.post(() -> finish(null, "app closed", "cancelled"));
    }
}
