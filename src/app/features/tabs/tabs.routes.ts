import type { Routes } from '@angular/router';

export const tabsRoutes: Routes = [
  { path: 'home', redirectTo: '/home', pathMatch: 'full' },
  { path: 'progress', redirectTo: '/progress', pathMatch: 'full' },
  { path: 'graphs', redirectTo: '/graphs', pathMatch: 'full' },
  { path: 'history', redirectTo: '/history', pathMatch: 'full' },
  { path: 'achievements', redirectTo: '/achievements', pathMatch: 'full' },
  { path: 'goals', redirectTo: '/goals', pathMatch: 'full' },
];
