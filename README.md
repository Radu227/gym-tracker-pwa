# Gym Tracker

Aplicație Ionic + Angular standalone, pregătită pentru instalare ca PWA și pentru dezvoltare incrementală.

## Structură

```text
src/
  app/
    core/                 # servicii partajate: auth, offline, sync, notificări
    features/
      onboarding/
      workouts/
      progress/
      goals/
      achievements/
      profile/
    shared/               # componente, modele și pipes reutilizabile
    shell/                 # navigație și layout-ul aplicației
  environments/            # configurare publică per mediu
  theme/variables.scss     # tema Ionic dark și token-urile aplicației
supabase/
  migrations/              # schema PostgreSQL și politicile RLS
  functions/               # Edge Functions pentru notificări push
```

## Comenzi

- `npm start` pornește serverul local.
- `npm run build` verifică build-ul de producție; acesta include service worker-ul Angular.
- `npx cap add ios` / `npx cap add android` adaugă proiectele native Capacitor, dacă vor fi necesare ulterior.

PWA-ul se testează printr-un build servit pe HTTPS (sau localhost); service worker-ul nu este activ în build-ul de dezvoltare.

## Conectarea la Supabase

1. Copiază `.env.example` în `.env.local` și completează `SUPABASE_URL` (de forma `https://proiectul-tau.supabase.co`, fără `/rest/v1`), `SUPABASE_PUBLISHABLE_KEY` și `VAPID_PUBLIC_KEY`.
2. `npm start`, `npm run build` și `npm run test:unit` generează `public/runtime-config.json` înainte de execuție.
3. În Vercel, setează aceleași două nume ca Environment Variables pentru build. Cheia `service_role`/`secret` și parola bazei de date nu se folosesc în frontend.

Configurația runtime este un fișier public și include numai cheia publishable; accesul la date este protejat de autentificare și politicile RLS din Supabase.

Obiectivele personale sunt create după rularea migrației `supabase/migrations/20261115140000_exercise_goals.sql`. Progresul este calculat pentru fiecare obiectiv din cel mai bun 1RM estimat al exercițiului, folosind formula Epley.

## Notificarea după 3 zile de inactivitate

1. Rulează migrațiile în ordine, inclusiv `supabase/migrations/20261115130000_inactivity_notifications.sql`.
2. Generează o pereche VAPID și setează cheia publică în `VAPID_PUBLIC_KEY` pentru build-ul Vercel.
3. Pentru Edge Function setează `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` și `VAPID_SUBJECT`, apoi publică `supabase/functions/inactivity-notifications`.
4. Programează Edge Function să ruleze zilnic din Supabase Dashboard (Edge Functions → Schedules). Utilizatorii activează notificările din Profil, printr-o acțiune explicită care permite browserului să ceară permisiunea.

Dacă aplicația este deschisă, verificarea locală poate afișa reminderul la următoarea deschidere. Edge Function este componenta care permite notificarea când PWA-ul este închis.

## Istoricul seriilor

Fiecare serie efectuată aparține unei sesiuni noi. Corectarea unei serii deja salvate adaugă un eveniment care îl păstrează pe cel anterior. `workout_set_current` expune valoarea efectivă cea mai recentă pentru interfață și statistici; seriile anulate rămân marcate, nu dispar din jurnal. Astfel, o serie nu este numărată de două ori, iar valoarea inițială rămâne disponibilă în `workout_set_events` pentru audit și comparații.

Schema Supabase inițială este în `supabase/migrations/20261114190000_initial_schema.sql`. Nu include chei sau secrete de proiect; acestea se configurează separat când conectăm aplicația la Supabase.
