import { inject, isDevMode, provideAppInitializer } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  RouteReuseStrategy,
  provideRouter,
  withComponentInputBinding,
  withPreloading,
  PreloadAllModules,
} from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { IonicRouteStrategy, provideIonicAngular } from '@ionic/angular';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';

import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { AuthService } from './app/core/auth/auth.service';
import { NotificationService } from './app/core/notifications/notification.service';
import { RuntimeConfigService } from './app/core/supabase/runtime-config.service';
import { WorkoutSyncService } from './app/core/sync/workout-sync.service';

bootstrapApplication(AppComponent, {
  providers: [
    { provide: RouteReuseStrategy, useClass: IonicRouteStrategy },
    provideIonicAngular(),
    provideCharts(withDefaultRegisterables()),
    provideRouter(routes, withPreloading(PreloadAllModules), withComponentInputBinding()),
    provideAppInitializer(() => {
      const runtimeConfig = inject(RuntimeConfigService);
      const auth = inject(AuthService);
      const workoutSync = inject(WorkoutSyncService);
      const notifications = inject(NotificationService);

      return runtimeConfig.load().then(async () => {
        await auth.initialize();
        workoutSync.initialize();
        await notifications.initialize();
      });
    }),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
});
