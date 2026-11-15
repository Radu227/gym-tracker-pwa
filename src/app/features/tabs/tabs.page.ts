import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IonIcon, IonLabel, IonTabBar, IonTabButton } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  barChartOutline,
  calendarOutline,
  homeOutline,
  radioButtonOnOutline,
  timeOutline,
  trophyOutline,
} from 'ionicons/icons';

@Component({
  selector: 'app-tabs',
  templateUrl: './tabs.page.html',
  styleUrl: './tabs.page.scss',
  imports: [IonIcon, IonLabel, IonTabBar, IonTabButton, RouterLink],
})
export class TabsPage {
  constructor() {
    addIcons({ barChartOutline, calendarOutline, homeOutline, radioButtonOnOutline, timeOutline, trophyOutline });
  }
}
