import type { Routes } from '@angular/router';

import { authGuard, guestGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  {
    path: 'auth',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./features/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'login',
    loadComponent: () => import('./features/auth/auth.page').then((m) => m.AuthPage),
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'onboarding',
    canActivate: [authGuard],
    loadComponent: () => import('./features/onboarding/onboarding.page').then((m) => m.OnboardingPage),
  },
  {
    path: 'workouts/:routineId',
    canActivate: [authGuard],
    loadComponent: () => import('./features/workouts/workout-detail.page').then((m) => m.WorkoutDetailPage),
  },
  {
    path: 'workout-session/:routineId/:exerciseId',
    canActivate: [authGuard],
    loadComponent: () => import('./features/workout-session/workout-session.page').then((m) => m.WorkoutSessionPage),
  },
  {
    path: 'history',
    canActivate: [authGuard],
    loadComponent: () => import('./features/history/history.page').then((m) => m.HistoryPage),
  },
  {
    path: 'profile',
    canActivate: [authGuard],
    loadComponent: () => import('./features/profile/profile.page').then((m) => m.ProfilePage),
  },
  {
    path: 'achievements',
    canActivate: [authGuard],
    loadComponent: () => import('./features/achievements/achievements.page').then((m) => m.AchievementsPage),
  },
  {
    path: 'progress',
    canActivate: [authGuard],
    loadComponent: () => import('./features/progress/progress.page').then((m) => m.ProgressPage),
  },
  {
    path: 'graphs',
    canActivate: [authGuard],
    loadComponent: () => import('./features/graphs/graphs.page').then((m) => m.GraphsPage),
  },
  {
    path: 'goals',
    canActivate: [authGuard],
    loadComponent: () => import('./features/goals/goals.page').then((m) => m.GoalsPage),
  },
  {
    path: '',
    redirectTo: 'auth',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'auth',
  },
];
