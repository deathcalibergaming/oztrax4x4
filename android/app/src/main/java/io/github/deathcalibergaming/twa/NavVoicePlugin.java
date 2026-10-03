package io.github.deathcalibergaming.twa;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.audiofx.LoudnessEnhancer;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;
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
 * It can reach a car that is not listening. Guidance goes where music goes,
 * so with the phone paired to a head unit it goes out over Bluetooth as
 * media audio - and a head unit plays that only while its source is
 * Bluetooth audio. On the radio, or paired for calls and nothing else, the
 * line is sent and nobody hears it. The other thing every head unit will
 * play, whatever it is doing, is a phone call. So a line can be sent as one:
 * the hands-free channel is opened, the line is played down it with the
 * attributes of a call, and it is closed again. The car treats it as a
 * call - the radio is muted for it, it comes at the call volume, in a call's
 * narrow sound - and the channel takes a second or two to open, which the
 * page allows for by starting its lines that much sooner (see lag in
 * nativeSpeech). A choice, off until it is made, and only from Android 12:
 * before that the same thing is done through calls Android has since
 * withdrawn, and there is no phone here to try them on.
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
    /* A line sent to the car as a call. */
    private static final AudioAttributes CALL = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build();
    /* Milliseconds. How long the hands-free channel is given to open before
       the line is said the ordinary way instead; how long after Android says
       it is open the car is given to switch over to it, or the first word is
       lost; how long Android's own account of where calls are going is left
       before it is believed without the channel being reported up; and how
       long the channel is kept after a line, in case another is on its heels
       - "turn right" and then the street it is onto. None of these has been
       timed in a car yet. */
    private static final long CALL_WAIT = 4000, CALL_SETTLE = 400, CALL_TRUST = 1500, CALL_LINGER = 1500;

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

    /* Lines being written to a file to be played by this rather than by the
       engine - louder, or to the car as a call - and the gain each asked for
       in millibels. The engine's callbacks come on its own thread, so this is
       a map that can be read from any of them. */
    private final Map<String, Integer> boosted = new ConcurrentHashMap<>();
    /* The line being played back, and what is playing it. Touched on the
       main thread only - every change to them is posted there. */
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private LoudnessEnhancer louder;
    private String playing;

    /* The lines that are to go to the car as a call, and the channel they go
       down: whether it has been asked for, when, and when it was first seen
       open. Main thread, but for the set. */
    private final Set<String> viaCall = ConcurrentHashMap.newKeySet();
    private boolean callAsked = false;
    private long callSince = 0;
    private long callLive = 0;
    private final Runnable closeCall = this::hangUpIfIdle;
    /* Whether the hands-free link is carrying sound, as Android announces it.
       A sticky broadcast, so the answer as it stands arrives on registering. */
    private volatile boolean scoUp = false;
    private boolean listening = false;
    private final BroadcastReceiver sco = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            scoUp = i.getIntExtra(AudioManager.EXTRA_SCO_AUDIO_STATE, AudioManager.SCO_AUDIO_STATE_DISCONNECTED)
                    == AudioManager.SCO_AUDIO_STATE_CONNECTED;
        }
    };

    @Override
    public void load() {
        audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        try {
            ContextCompat.registerReceiver(getContext(), sco,
                new IntentFilter(AudioManager.ACTION_SCO_AUDIO_STATE_UPDATED), ContextCompat.RECEIVER_NOT_EXPORTED);
            listening = true;
        } catch (RuntimeException e) { /* then Android's own account of the route has to do */ }
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

    /* Whether a line can be sent to a car as a call on this phone at all, and
       whether there is a hands-free device connected to take one now. */
    @PluginMethod
    public void routes(PluginCall call) {
        boolean can = Build.VERSION.SDK_INT >= 31;
        JSObject r = new JSObject();
        r.put("call", can);
        r.put("handsfree", can && CallRoute.device(audio) != null);
        call.resolve(r);
    }

    /* text, id, voice, rate - and boost, in millibels over the media volume
       (0 speaks as the engine does); pause, to stop the music for the line
       rather than turn it down; and call, to send it to a car as a phone call
       where there is one connected to take it. */
    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text");
        String id = call.getString("id");
        String want = call.getString("voice");
        Float rate = call.getFloat("rate", 1f);
        Integer boost = call.getInt("boost", 0);
        Boolean pause = call.getBoolean("pause", false);
        Boolean asCall = call.getBoolean("call", false);
        if (!ready || text == null || id == null) { call.reject("the voice is not ready"); return; }
        if (want != null) {
            try {
                for (Voice v : tts.getVoices()) {
                    if (want.equals(v.getName())) { tts.setVoice(v); break; }
                }
            } catch (Exception e) { /* the engine's own voice, then */ }
        }
        tts.setSpeechRate(rate == null ? 1f : rate);
        /* As a call only where something is connected that takes calls. With
           nothing there the line is said as it always was. */
        final boolean car = asCall != null && asCall && Build.VERSION.SDK_INT >= 31 && CallRoute.device(audio) != null;
        synchronized (this) {
            talking = id;
            /* Music going to the same car is cut off by the call whatever is
               asked for, so it is asked to pause rather than left playing to
               nobody and coming back several seconds further on. */
            pauseMusic = (pause != null && pause) || car;
        }
        /* A louder line still playing from before is cut off, as the engine
           cuts off its own when told to flush. */
        main.post(this::silence);
        /* The channel is asked for now, so it is opening while the line is
           being written. */
        main.post(car ? this::dial : this::hangUp);
        hold();
        int said;
        int gain = boost == null ? 0 : boost;
        if (car || gain > 0) {
            boosted.put(id, gain);
            if (car) viaCall.add(id);
            /* Written to a file, which goes to the back of the engine's queue
               rather than flushing it - so whatever it is still saying or
               writing is stopped first. */
            tts.stop();
            said = tts.synthesizeToFile(text, new Bundle(), clip(id), id);
            if (said != TextToSpeech.SUCCESS) { boosted.remove(id); viaCall.remove(id); }
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
        main.post(this::hangUpSoon);
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
        viaCall.remove(id);
        clip(id).delete();
        finish(id);
        tell("error", id);
    }

    /* Main thread. Plays a line the engine has written - louder, or down the
       hands-free channel, or both. */
    private void play(String id, int gain) {
        File f = clip(id);
        synchronized (this) {
            /* Something newer has been asked for while this was written. */
            if (!id.equals(talking)) { viaCall.remove(id); f.delete(); tell("error", id); return; }
        }
        boolean car = callAsked && viaCall.contains(id);
        if (car) {
            /* Not until the channel is carrying sound, and the car has had a
               moment to switch to it. Looked at again every tenth of a second
               until it is, or until it has plainly not come. */
            long now = SystemClock.elapsedRealtime();
            boolean live = scoUp || ((!listening || now - callSince >= CALL_TRUST)
                                     && Build.VERSION.SDK_INT >= 31 && CallRoute.live(audio));
            if (live && callLive == 0) callLive = now;
            if (!live && now - callSince >= CALL_WAIT) {
                /* The car never took it. Said the ordinary way, late, which
                   is better than not said. */
                hangUp();
                car = false;
            } else if (!live || now - callLive < CALL_SETTLE) {
                main.postDelayed(() -> play(id, gain), 100);
                return;
            }
        }
        viaCall.remove(id);
        silence();
        try {
            MediaPlayer mp = new MediaPlayer();
            player = mp;
            playing = id;
            mp.setAudioAttributes(car ? CALL : GUIDANCE);
            mp.setDataSource(f.getPath());
            mp.prepare();
            if (gain > 0) {
                try {
                    louder = new LoudnessEnhancer(mp.getAudioSessionId());
                    louder.setTargetGain(gain);
                    louder.setEnabled(true);
                } catch (RuntimeException e) {
                    /* A phone without the effect says it at the media volume
                       rather than not at all. */
                    louder = null;
                }
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
        main.post(this::hangUpSoon);
    }

    /* Main thread. Opens the hands-free channel, or keeps the one still open
       from the line before. */
    private void dial() {
        main.removeCallbacks(closeCall);
        if (callAsked || Build.VERSION.SDK_INT < 31) return;
        callAsked = CallRoute.open(audio);
        callSince = SystemClock.elapsedRealtime();
        callLive = 0;
    }

    /* Main thread. Gives the car back to whatever it was playing. */
    private void hangUp() {
        main.removeCallbacks(closeCall);
        if (!callAsked) return;
        callAsked = false;
        callLive = 0;
        if (Build.VERSION.SDK_INT >= 31) CallRoute.close(audio);
    }

    /* Main thread. Hangs up shortly, unless another line gets there first. */
    private void hangUpSoon() {
        if (!callAsked) return;
        main.removeCallbacks(closeCall);
        main.postDelayed(closeCall, CALL_LINGER);
    }

    /* Main thread. A line that began while the last was being let go keeps
       the channel; dial takes this off the queue, and this checks as well. */
    private void hangUpIfIdle() {
        synchronized (this) { if (talking != null) return; }
        hangUp();
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
        main.removeCallbacks(closeCall);
        /* Left open, the car would sit on a call nobody is making until the
           app's process is gone. */
        if (callAsked && Build.VERSION.SDK_INT >= 31) CallRoute.close(audio);
        callAsked = false;
        if (listening) {
            try { getContext().unregisterReceiver(sco); } catch (RuntimeException e) { }
            listening = false;
        }
    }

    /*
     * The hands-free channel, as Android 12 and later offer it: say which
     * device calls should go to, and take that back afterwards. In a class of
     * its own so that an older phone, which has none of these, never loads it.
     *
     * The audio mode goes with it. Android gives the choice of device to
     * whichever app last put the phone in communication mode, and without
     * the mode the request is taken and nothing is routed.
     */
    @RequiresApi(31)
    private static final class CallRoute {

        /* Something connected that takes calls over Bluetooth: a head unit,
           or a headset. Null when there is none. */
        static AudioDeviceInfo device(AudioManager audio) {
            try {
                for (AudioDeviceInfo d : audio.getAvailableCommunicationDevices()) {
                    if (d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return d;
                }
            } catch (RuntimeException e) { /* none that can be asked for */ }
            return null;
        }

        static boolean open(AudioManager audio) {
            AudioDeviceInfo d = device(audio);
            if (d == null) return false;
            try {
                audio.setMode(AudioManager.MODE_IN_COMMUNICATION);
                if (audio.setCommunicationDevice(d)) return true;
            } catch (RuntimeException e) { /* refused; said the ordinary way */ }
            close(audio);
            return false;
        }

        /* Whether calls are going to that device now, as Android tells it. */
        static boolean live(AudioManager audio) {
            try {
                AudioDeviceInfo d = audio.getCommunicationDevice();
                return d != null && d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO;
            } catch (RuntimeException e) {
                return false;
            }
        }

        static void close(AudioManager audio) {
            try { audio.clearCommunicationDevice(); } catch (RuntimeException e) { }
            try { audio.setMode(AudioManager.MODE_NORMAL); } catch (RuntimeException e) { }
        }
    }
}
