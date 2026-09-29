package io.github.deathcalibergaming.twa;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import java.util.ArrayList;
import java.util.List;

/*
 * The track, logged by the phone while the screen is off.
 *
 * With the screen dark Android pauses the WebView, and the page's GPS watch
 * goes with it - a recording in the browser simply stopped at the power
 * button, and the most a page could do was keep the screen from sleeping.
 * This is the thing only a native app can do: a foreground service, running
 * from Record to Pause or Stop, that takes every GPS fix itself and keeps it.
 * When the driver comes back to the app the page asks for the fixes it
 * missed and records them through its own recorder, in order, as if it had
 * been awake for them - so the line has no hole and the distance counts the
 * whole drive. See Keeper in index.html.
 *
 * GPS only, a fix a second, as the page asks for. Location is used while the
 * app is in use and the service is started from the app in front, so it needs
 * no background-location permission: Android lets a foreground service begun
 * that way go on using location. The notification is required, and it is
 * also the truth - it says the GPS is on, and a tap on it goes back to the
 * map.
 *
 * The fixes are held in memory in the service. A fix is seven doubles, and a
 * day's driving at one a second is a few megabytes; past CAP the oldest go,
 * which is more than a day with the screen off.
 */
public class TrackService extends Service {

    static final String CHANNEL = "recording";
    static final int NOTE = 7;
    static final int CAP = 150000;

    /* t, lat, lng, alt, acc, spd, hdg - NaN where the fix did not say */
    private static final List<double[]> fixes = new ArrayList<>();
    private static volatile boolean running = false;

    private LocationManager gps;
    private final LocationListener heard = new LocationListener() {
        @Override public void onLocationChanged(Location l) { keep(l); }
        @Override public void onProviderEnabled(String p) { }
        @Override public void onProviderDisabled(String p) { }
        @Override public void onStatusChanged(String p, int s, Bundle b) { }
    };

    static boolean isRunning() { return running; }

    /* The fixes after time `after`, oldest first, at most max of them. */
    static List<double[]> since(double after, int max) {
        List<double[]> out = new ArrayList<>();
        synchronized (fixes) {
            for (double[] f : fixes) {
                if (f[0] > after) {
                    out.add(f);
                    if (out.size() >= max) break;
                }
            }
        }
        return out;
    }

    private static void keep(Location l) {
        double[] f = new double[] {
            l.getTime(), l.getLatitude(), l.getLongitude(),
            l.hasAltitude() ? l.getAltitude() : Double.NaN,
            l.hasAccuracy() ? l.getAccuracy() : Double.NaN,
            l.hasSpeed() ? l.getSpeed() : Double.NaN,
            l.hasBearing() ? l.getBearing() : Double.NaN
        };
        synchronized (fixes) {
            fixes.add(f);
            if (fixes.size() > CAP) fixes.subList(0, fixes.size() - CAP).clear();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            ServiceCompat.startForeground(this, NOTE, note(),
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0);
        } catch (Exception e) {
            /* no location permission, most likely: nothing can be logged */
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running) {
            synchronized (fixes) { fixes.clear(); }
            gps = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            try {
                gps.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, heard, Looper.getMainLooper());
                running = true;
            } catch (SecurityException | IllegalArgumentException e) {
                stopSelf();
            }
        }
        /* Not restarted by Android if it is ever killed: a service logging
           for a page that is no longer there to collect it is a GPS left on
           for nothing. */
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (gps != null) {
            try { gps.removeUpdates(heard); } catch (Exception e) { /* already off */ }
        }
        running = false;
        synchronized (fixes) { fixes.clear(); }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private Notification note() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Track recording", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while a track is being recorded, screen on or off.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Intent back = new Intent(this, MainActivity.class);
        back.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(this, 0, back,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_rec)
            .setContentTitle("Recording a track")
            .setContentText("Carries on with the screen off. Tap to go back to the map.")
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build();
    }
}
