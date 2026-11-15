import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import webpush from 'https://esm.sh/web-push@3.6.7';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const vapidSubject = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com';
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')!;
webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

async function sendInactivityNotifications(): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - 3);
  const cutoffDate = cutoff.toISOString().slice(0, 10);
  const { data: users, error } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (error) {
    throw error;
  }

  let sent = 0;
  for (const user of users.users) {
    const [{ data: attendance }, { data: set }] = await Promise.all([
      supabase
        .from('workout_attendance')
        .select('attendance_date')
        .eq('user_id', user.id)
        .order('attendance_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('workout_set_current')
        .select('performed_at')
        .eq('user_id', user.id)
        .eq('is_voided', false)
        .order('performed_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const lastActivity = [attendance?.attendance_date, set?.performed_at?.slice(0, 10)].filter(Boolean).sort().at(-1);
    if (!lastActivity || lastActivity > cutoffDate) {
      continue;
    }

    const { data: alreadySent } = await supabase
      .from('inactivity_notification_log')
      .select('user_id')
      .eq('user_id', user.id)
      .eq('activity_date', lastActivity)
      .maybeSingle();
    if (alreadySent) {
      continue;
    }

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id,endpoint,p256dh,auth')
      .eq('user_id', user.id);
    for (const subscription of subscriptions ?? []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            notification: {
              title: 'Gym Tracker',
              body: 'Au trecut 3 zile de la ultima ta activitate. Hai să revii la antrenament!',
              icon: '/favicon.ico',
              data: {
                onActionClick: {
                  default: { operation: 'openWindow', url: '/home' },
                },
              },
            },
          }),
        );
        sent += 1;
      } catch (sendError) {
        if (sendError instanceof Error && sendError.message.includes('410')) {
          await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
        } else {
          console.error(sendError);
        }
      }
    }

    await supabase.from('inactivity_notification_log').insert({
      user_id: user.id,
      activity_date: lastActivity,
    });
  }

  return sent;
}

Deno.serve(async () => {
  try {
    return Response.json({ sent: await sendInactivityNotifications() });
  } catch (error) {
    console.error(error);
    return Response.json({ error: 'Notification job failed.' }, { status: 500 });
  }
});
