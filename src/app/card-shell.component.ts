import {ChangeDetectionStrategy,Component,inject} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {CardStore} from './state/card.store';
import {MediaStreamDirective} from './shared/media-stream.directive';
@Component({selector:'app-root',standalone:true,imports:[CommonModule,FormsModule,MediaStreamDirective],templateUrl:'./app.component.html',styleUrl:'./app.component.css',changeDetection:ChangeDetectionStrategy.OnPush})
export class CardShellComponent{readonly store=inject(CardStore);}
