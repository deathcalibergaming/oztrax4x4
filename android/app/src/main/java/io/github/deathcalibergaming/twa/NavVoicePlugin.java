package io.github.deathcalibergaming.twa;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/*
 * The navigation voice, spoken by the phone rather than by the page.
 *
 * Android's WebView has no speechSynthesis at all - MDN lists it as never
 * supported there - so the voice that works in Chrome would be silent in the
 * app. This is the phone's own TextToSpeech, and the page reaches it through
 * a stand-in for speechSynthesis (see nativeSpeech in index.html), so the
 * Voice block there is unchanged: it still decides what is said and when,
 * and this only says it.
 *
 * Being native, it can do the two things the page could not.
 *
 * It asks for audio focus the way a navigation app does - transient, may
 * duck - with the attributes of navigation guidance, so Android turns the
 * music down under each line and back up after it. In Chrome that took a
 * second of silence played on a loop to trick the browser into asking; here
 * it is the request itself, held for exactly as long as the line.
 *
 * And the volume the buttons change is the one it speaks on: navigation
 * guidance plays on the media volume, and MainActivity points the buttons
 * there for as long as the app is in front.
 *
 * Only voices that are on the phone are offered - a voice needing the
 * network is reported as such and the page refuses it, exactly as it does in
 * Chrome, and one not yet downloaded is left out.
 */
@CapacitorPlugin(name = "NavVoice")
public class NavVoicePlugin extends Plugin {

    private static final AudioAttributes GUIDANCE = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build();

    private TextToSpeech tts;
    private boolean started = false; /* the engine has answered, one way or the other */
    private boolean ready = false;   /* and the answer was yes */
    private final List<PluginCall> waiting = new ArrayList<>();
    private AudioManager audio;
    private AudioFocusRequest focus;
    private final AudioManager.OnAudioFocusChangeListener ignore = change -> {};
    /* The line holding the focus. Starting a new line flushes the one before,
       and the engine reports that one stopped a moment after the new one has
       begun - which must not hand the music back under the new one. */
    private String talking = null;

    @Override
    public void load() {
        audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        tts = new TextToSpeech(getContext(), status -> {
            synchronized (waiting) {
                started = true;
                ready = status == TextToSpeech.SUCCESS;
                if (ready) {
                    tts.setAudioAttributes(GUIDANCE);
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String id) { tell("start", id); }
                        @Override public void onDone(String id) { finish(id); tell("end", id); }
                        @Override public void onError(String id) { finish(id); tell("error", id); }
                        @Override public void onStop(String id, boolean interrupted) { finish(id); tell("error", id); }
                    });
                }
                for (PluginCall c : waiting) answerVoices(c);
                waiting.clear();
            }
        });
    }

    /* The voices on the phone. Asked for before the engine has started, the
       answer waits for it rather than coming back empty - the same thing the
       page's voiceschanged was waiting for. */
    @PluginMethod
    public void voices(PluginCall call) {
        synchronized (waiting) {
            if (!started) { waiting.add(call); return; }
        }
        answerVoices(call);
    }

    private void answerVoices(PluginCall call) {
        JSArray list = new JSArray();
        if (ready) {
            Set<Voice> all = null;
            try { all = tts.getVoices(); } catch (Exception e) { /* an engine that will not list its voices lists none */ }
            if (all != null) {
                for (Voice v : all) {
                    Set<String> f = v.getFeatures();
                    if (f != null && f.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                    JSObject o = new JSObject();
                    o.put("id", v.getName());
                    o.put("lang", v.getLocale().toLanguageTag());
                    o.put("local", !v.isNetworkConnectionRequired());
                    list.put(o);
                }
            }
        }
        JSObject r = new JSObject();
        r.put("ready", ready);
        r.put("voices", list);
        call.resolve(r);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        String id = call.getString("id");
        String want = call.getString("voice");
        Float rate = call.getFloat("rate", 1f);
        if (!ready || text == null || id == null) { call.reject("the voice is not ready"); return; }
        if (want != null) {
            try {
                for (Voice v : tts.getVoices()) {
                    if (want.equals(v.getName())) { tts.setVoice(v); break; }
                }
            } catch (Exception e) { /* the engine's own voice, then */ }
        }
        tts.setSpeechRate(rate == null ? 1f : rate);
        synchronized (this) { talking = id; }
        hold();
        if (tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
            finish(id);
            call.reject("the engine would not say it");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (ready) tts.stop();
        synchronized (this) { talking = null; }
        letGo();
        call.resolve();
    }

    private void finish(String id) {
        synchronized (this) {
            if (id == null || !id.equals(talking)) return;
            talking = null;
        }
        letGo();
    }

    private void hold() {
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus == null) {
                focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(GUIDANCE)
                    .setOnAudioFocusChangeListener(ignore)
                    .build();
            }
            audio.requestAudioFocus(focus);
        } else {
            audio.requestAudioFocus(ignore, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
        }
    }

    private void letGo() {
        if (Build.VERSION.SDK_INT >= 26) {
            if (focus != null) audio.abandonAudioFocusRequest(focus);
        } else {
            audio.abandonAudioFocus(ignore);
        }
    }

    private void tell(String type, String id) {
        JSObject d = new JSObject();
        d.put("type", type);
        d.put("id", id);
        notifyListeners("speech", d);
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) { tts.stop(); tts.shutdown(); }
        letGo();
    }
}
