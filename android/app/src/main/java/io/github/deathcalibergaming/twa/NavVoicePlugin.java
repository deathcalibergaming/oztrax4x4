package io.github.deathcalibergaming.twa;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.audiofx.LoudnessEnhancer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

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
 * Being native, it can do the things the page could not.
 *
 * It asks for audio focus the way a navigation app does, with the attributes
 * of navigation guidance, held for exactly as long as the line: transient and
 * may-duck, so Android turns the music down under each line and back up
 * after it - or, if the driver chose it, plain transient, which music apps
 * answer by pausing until the line is over. Turned down was not enough in a
 * car: music is mastered loud and a synthesised voice is not, and the
 * lowered music still came out over the words.
 *
 * It can speak louder than the media volume allows. Asked for a boost, the
 * line is written to a file and played back through Android's
 * LoudnessEnhancer, which lifts it by the gain asked for and limits the
 * peaks so it does not clip. The price is the time to write the file - a
 * fraction of a second for a line this long - which is why it is a choice
 * and not the only way.
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
    private int focusGain = 0;       /* what focus was asked for with */
    private boolean pauseMusic = false;
    private final AudioManager.OnAudioFocusChangeListener ignore = change -> {};
    /* The line holding the focus. Starting a new line flushes the one before,
       and the engine reports that one stopped a moment after the new one has
       begun - which must not hand the music back under the new one. */
    private String talking = null;

    /* Lines being written to a file to be played louder, and the gain each
       asked for in millibels. The engine's callbacks come on its own thread,
       so this is a map that can be read from any of them. */
    private final Map<String, Integer> boosted = new ConcurrentHashMap<>();
    /* The line being played back, and what is playing it. Touched on the
       main thread only - every change to them is posted there. */
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private LoudnessEnhancer louder;
    private String playing;

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
                        /* A line being written to a file has not started as
                           far as anyone listening is concerned; it starts when
                           it is played. */
                        @Override public void onStart(String id) { if (!boosted.containsKey(id)) tell("start", id); }
                        @Override public void onDone(String id) {
                            Integer gain = boosted.remove(id);
                            if (gain != null) { main.post(() -> play(id, gain)); return; }
                            finish(id);
                            tell("end", id);
                        }
                        @Override public void onError(String id) { dropped(id); }
                        @Override public void onStop(String id, boolean interrupted) { dropped(id); }
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

    /* text, id, voice, rate - and boost, in millibels over the media volume
       (0 speaks as the engine does), and pause, to stop the music for the
       line rather than turn it down. */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        String id = call.getString("id");
        String want = call.getString("voice");
        Float rate = call.getFloat("rate", 1f);
        Integer boost = call.getInt("boost", 0);
        Boolean pause = call.getBoolean("pause", false);
        if (!ready || text == null || id == null) { call.reject("the voice is not ready"); return; }
        if (want != null) {
            try {
                for (Voice v : tts.getVoices()) {
                    if (want.equals(v.getName())) { tts.setVoice(v); break; }
                }
            } catch (Exception e) { /* the engine's own voice, then */ }
        }
        tts.setSpeechRate(rate == null ? 1f : rate);
        synchronized (this) {
            talking = id;
            pauseMusic = pause != null && pause;
        }
        /* A louder line still playing from before is cut off, as the engine
           cuts off its own when told to flush. */
        main.post(this::silence);
        hold();
        int said;
        if (boost != null && boost > 0) {
            boosted.put(id, boost);
            /* Written to a file, which goes to the back of the engine's queue
               rather than flushing it - so whatever it is still saying or
               writing is stopped first. */
            tts.stop();
            said = tts.synthesizeToFile(text, new Bundle(), clip(id), id);
            if (said != TextToSpeech.SUCCESS) boosted.remove(id);
        } else {
            said = tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, id);
        }
        if (said != TextToSpeech.SUCCESS) {
            finish(id);
            call.reject("the engine would not say it");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (ready) tts.stop();
        main.post(this::silence);
        synchronized (this) { talking = null; }
        letGo();
        call.resolve();
    }

    /* The file a boosted line is written to. One per line, because the line
       before can still be finishing when the next is begun. */
    private File clip(String id) {
        return new File(getContext().getCacheDir(), "navvoice-" + id + ".wav");
    }

    /* A line that will not be heard: stopped, flushed or failed. */
    private void dropped(String id) {
        boosted.remove(id);
        clip(id).delete();
        finish(id);
        tell("error", id);
    }

    /* Main thread. Plays a line the engine has written, louder. */
    private void play(String id, int gain) {
        File f = clip(id);
        synchronized (this) {
            /* Something newer has been asked for while this was written. */
            if (!id.equals(talking)) { f.delete(); tell("error", id); return; }
        }
        silence();
        try {
            MediaPlayer mp = new MediaPlayer();
            player = mp;
            playing = id;
            mp.setAudioAttributes(GUIDANCE);
            mp.setDataSource(f.getPath());
            mp.prepare();
            try {
                louder = new LoudnessEnhancer(mp.getAudioSessionId());
                louder.setTargetGain(gain);
                louder.setEnabled(true);
            } catch (RuntimeException e) {
                /* A phone without the effect says it at the media volume
                   rather than not at all. */
                louder = null;
            }
            mp.setOnCompletionListener(m -> ended(id, true));
            mp.setOnErrorListener((m, what, extra) -> { ended(id, false); return true; });
            mp.start();
            tell("start", id);
        } catch (Exception e) {
            ended(id, false);
        }
    }

    /* Main thread. The line that was playing has finished or failed. */
    private void ended(String id, boolean ok) {
        if (!id.equals(playing)) return;
        release();
        clip(id).delete();
        finish(id);
        tell(ok ? "end" : "error", id);
    }

    /* Main thread. Cuts off a louder line that is still playing. */
    private void silence() {
        if (player == null) return;
        String was = playing;
        release();
        if (was != null) {
            clip(was).delete();
            tell("error", was);
        }
    }

    private void release() {
        if (louder != null) { try { louder.release(); } catch (RuntimeException e) { } louder = null; }
        if (player != null) { try { player.release(); } catch (RuntimeException e) { } player = null; }
        playing = null;
    }

    private void finish(String id) {
        synchronized (this) {
            if (id == null || !id.equals(talking)) return;
            talking = null;
        }
        letGo();
    }

    private synchronized void hold() {
        int gain = pauseMusic ? AudioManager.AUDIOFOCUS_GAIN_TRANSIENT : AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK;
        if (Build.VERSION.SDK_INT >= 26) {
            /* Asked for again with the other gain, the old request is let go
               first, or the music would be left paused under a ducking line. */
            if (focus != null && focusGain != gain) { audio.abandonAudioFocusRequest(focus); focus = null; }
            if (focus == null) {
                focus = new AudioFocusRequest.Builder(gain)
                    .setAudioAttributes(GUIDANCE)
                    .setOnAudioFocusChangeListener(ignore)
                    .build();
                focusGain = gain;
            }
            audio.requestAudioFocus(focus);
        } else {
            audio.requestAudioFocus(ignore, AudioManager.STREAM_MUSIC, gain);
        }
    }

    private synchronized void letGo() {
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
        release();
        letGo();
    }
}
