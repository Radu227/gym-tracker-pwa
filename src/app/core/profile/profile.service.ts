import { inject, Injectable } from '@angular/core';

import { SupabaseClientService } from '../supabase/supabase-client.service';

export type AvatarStyle = 'male' | 'female';
export type FitnessGoal = 'hypertrophy' | 'strength' | 'fat_loss' | 'maintenance';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export interface Profile {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  avatar_style: AvatarStyle | null;
  age: number | null;
  weight_kg: number | null;
  height_cm: number | null;
  weekly_goal: number;
  fitness_goal: FitnessGoal | null;
  experience_level: ExperienceLevel | null;
  onboarding_completed_at: string | null;
}

export interface OnboardingInput {
  weeklyGoal: number;
  fitnessGoal: FitnessGoal;
  experienceLevel: ExperienceLevel;
}

export interface ProfileDetailsInput {
  firstName: string;
  lastName: string;
  avatarStyle: AvatarStyle;
  age: number | null;
  weightKg: number | null;
  heightCm: number | null;
}

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly supabase = inject(SupabaseClientService);

  async getCurrentProfile(userId: string): Promise<Profile> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .select(
        'user_id,first_name,last_name,avatar_style,age,weight_kg,height_cm,weekly_goal,fitness_goal,experience_level,onboarding_completed_at',
      )
      .eq('user_id', userId)
      .single();

    if (error) {
      throw error;
    }

    return data as Profile;
  }

  async completeOnboarding(userId: string, input: OnboardingInput): Promise<Profile> {
    if (!Number.isInteger(input.weeklyGoal) || input.weeklyGoal < 1 || input.weeklyGoal > 7) {
      throw new Error('Alege între 1 și 7 zile pe săptămână.');
    }

    const { data, error } = await this.supabase.client
      .from('profiles')
      .update({
        weekly_goal: input.weeklyGoal,
        fitness_goal: input.fitnessGoal,
        experience_level: input.experienceLevel,
        onboarding_completed_at: new Date().toISOString(),
      })
      .eq('user_id', userId)
      .select(
        'user_id,first_name,last_name,avatar_style,age,weight_kg,height_cm,weekly_goal,fitness_goal,experience_level,onboarding_completed_at',
      )
      .single();

    if (error) {
      throw error;
    }

    return data as Profile;
  }

  async updateDetails(userId: string, input: ProfileDetailsInput): Promise<Profile> {
    const { data, error } = await this.supabase.client
      .from('profiles')
      .update({
        first_name: input.firstName.trim() || null,
        last_name: input.lastName.trim() || null,
        avatar_style: input.avatarStyle,
        age: input.age,
        weight_kg: input.weightKg,
        height_cm: input.heightCm,
      })
      .eq('user_id', userId)
      .select(
        'user_id,first_name,last_name,avatar_style,age,weight_kg,height_cm,weekly_goal,fitness_goal,experience_level,onboarding_completed_at',
      )
      .single();

    if (error) {
      throw error;
    }

    return data as Profile;
  }
}
