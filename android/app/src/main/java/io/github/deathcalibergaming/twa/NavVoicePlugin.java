package io.github.deathcalibergaming.twa;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
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
 * And it says where the line goes, with a car's head unit connected over
 * Bluetooth, rather than leaving that to the phone. Guidance is meant to go
 * where the music goes, and on paper it does; the report from the road was
 * that over Bluetooth it did not work. So with a Bluetooth audio device connected
 * every line is played by this, not by the engine, and the player is told
 * to use that device. A link that has been carrying nothing is given half a
 * second of silence first, because a head unit takes about that long to
 * open up and the first word of a line is the one that says which way. And
 * the page is told what the line was actually routed to, which it shows in
 * the settings - so "sent to the car and not heard" and "never sent to the
 * car" can be told apart from the driver's seat.
 *
 * That was not enough: the next report was the same. So two things more. A
 * line going to a Bluetooth device is played as media, plain and simple -
 * the attributes music has - so that whatever the phone and the car do with
 * music they do with it; it still asks for the focus as guidance, and the
 * music is still turned down for it. And the page can ask what is connected
 * before anything is said (routes), because one answer is a car paired for
 * calls and not for sound, which no amount of routing reaches and which the
 * settings can simply say.
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
    /* A line sent to a Bluetooth device: what music is, saying what it is. */
    private static final AudioAttributes MEDIA = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
        .build();
    /* Milliseconds of silence sent down a Bluetooth link that was carrying
       nothing, before the line; and how long after a line starts the player
       is asked where it ended up. Neither has been timed in a car. */
    private static final int WAKE_MS = 500, WHERE_MS = 250;

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
       engine - louder, or to a Bluetooth device - and the gain each asked
       for in millibels. The engine's callbacks come on its own thread, so
       this is a map that can be read from any of them. */
    private final Map<String, Integer> boosted = new ConcurrentHashMap<>();
    /* The line being played back, and what is playing it. Touched on the
       main thread only - every change to them is posted there. */
    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private LoudnessEnhancer louder;
    private String playing;
    private AudioTrack hush;         /* the silence that opens a Bluetooth link */

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

    /* What is connected over Bluetooth: the name of a device sound can be
       sent to, and of one that takes calls. Either may be missing. A car
       with the second and not the first is paired for calls only. */
    @PluginMethod
    public void routes(PluginCall call) {
        AudioDeviceInfo media = bluetooth(), calls = handsfree();
        JSObject r = new JSObject();
        r.put("media", media == null ? "" : String.valueOf(media.getProductName()));
        r.put("calls", calls == null ? "" : String.valueOf(calls.getProductName()));
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
        int gain = boost == null ? 0 : boost;
        /* With a Bluetooth device connected the line is played by this, so
           that it can be sent there - see play. */
        if (gain > 0 || bluetooth() != null) {
            boosted.put(id, gain);
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

    /* The Bluetooth device sound can be sent to, if one is connected: a car's
       head unit, a speaker, a pair of earbuds. Null when there is none. */
    private AudioDeviceInfo bluetooth() {
        try {
            for (AudioDeviceInfo d : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (isBluetooth(d.getType())) return d;
            }
        } catch (RuntimeException e) { /* none that can be asked for */ }
        return null;
    }

    /* A Bluetooth device that takes calls - a head unit's hands-free, a
       headset. Looked for among the outputs and, from Android 12, among the
       devices a call could be sent to, which is where some phones list it. */
    private AudioDeviceInfo handsfree() {
        try {
            for (AudioDeviceInfo d : audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS)) {
                if (d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return d;
            }
            if (Build.VERSION.SDK_INT >= 31) {
                for (AudioDeviceInfo d : audio.getAvailableCommunicationDevices()) {
                    if (d.getType() == AudioDeviceInfo.TYPE_BLUETOOTH_SCO) return d;
                }
            }
        } catch (RuntimeException e) { /* none that can be asked for */ }
        return null;
    }

    private static boolean isBluetooth(int type) {
        if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return true;
        return Build.VERSION.SDK_INT >= 31
            && (type == AudioDeviceInfo.TYPE_BLE_HEADSET || type == AudioDeviceInfo.TYPE_BLE_SPEAKER);
    }

    /* Main thread. Plays a line the engine has written - louder, or to the
       Bluetooth device that is connected, or both. */
    private void play(String id, int gain) {
        File f = clip(id);
        synchronized (this) {
            /* Something newer has been asked for while this was written. */
            if (!id.equals(talking)) { f.delete(); tell("error", id); return; }
        }
        silence();
        try {
            final MediaPlayer mp = new MediaPlayer();
            player = mp;
            playing = id;
            /* Told where to go, not left to find its way - Android 9 on; on
               an older phone it goes where the phone sends it - and sent as
               what the car is certain to play. */
            final AudioDeviceInfo car = bluetooth();
            mp.setAudioAttributes(car != null ? MEDIA : GUIDANCE);
            mp.setDataSource(f.getPath());
            if (car != null && Build.VERSION.SDK_INT >= 28) mp.setPreferredDevice(car);
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
            /* A link with music on it is already open. One with nothing on
               it is opened with silence, and the line follows. */
            if (car != null && !audio.isMusicActive() && wake(car)) {
                main.postDelayed(() -> begin(id, mp, true), WAKE_MS);
            } else {
                begin(id, mp, car != null);
            }
        } catch (Exception e) {
            ended(id, false);
        }
    }

    /* Main thread. Starts a line that is ready, unless it has been cut off
       or overtaken while the link was being opened for it. */
    private void begin(String id, MediaPlayer mp, boolean wanted) {
        if (player != mp || !id.equals(playing)) return;
        try {
            mp.start();
            tell("start", id);
            main.postDelayed(() -> where(id, mp, wanted), WHERE_MS);
        } catch (RuntimeException e) {
            ended(id, false);
        }
    }

    /* Main thread. Silence, sent to the Bluetooth device, for as long as it
       takes to open up. False if it could not be played, and then the line
       is not kept waiting for it. */
    private boolean wake(AudioDeviceInfo car) {
        try {
            int rate = 22050, frames = rate * (WAKE_MS + 200) / 1000;
            AudioTrack t = new AudioTrack.Builder()
                .setAudioAttributes(MEDIA)
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(rate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build())
                .setTransferMode(AudioTrack.MODE_STATIC)
                .setBufferSizeInBytes(frames * 2)
                .build();
            hush = t;
            t.write(new short[frames], 0, frames);
            t.setPreferredDevice(car);
            t.play();
            return true;
        } catch (RuntimeException e) {
            if (hush != null) { try { hush.release(); } catch (RuntimeException x) { } hush = null; }
            return false;
        }
    }

    /* Main thread. What the line is actually coming out of, told to the
       page - which is the only way a driver, or anyone reading a report from
       one, can know whether the car was sent it. Android 9 on. */
    private void where(String id, MediaPlayer mp, boolean wanted) {
        if (player != mp || Build.VERSION.SDK_INT < 28) return;
        AudioDeviceInfo d = null;
        try { d = mp.getRoutedDevice(); } catch (RuntimeException e) { /* not saying */ }
        if (d == null) return;
        JSObject o = new JSObject();
        o.put("type", "route");
        o.put("id", id);
        /* whether there was a Bluetooth device to send it to, and whether
           that is where it went */
        o.put("wanted", wanted);
        o.put("bluetooth", isBluetooth(d.getType()));
        o.put("name", String.valueOf(d.getProductName()));
        notifyListeners("speech", o);
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
        if (hush != null) { try { hush.release(); } catch (RuntimeException e) { } hush = null; }
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
