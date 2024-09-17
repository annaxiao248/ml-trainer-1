/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import {
  Readable,
  Subscriber,
  Unsubscriber,
  Writable,
  derived,
  get,
  writable,
} from 'svelte/store';
import { GestureData, GestureOutput, RecordingData } from '../stores/mlStore';
import Gesture, { GestureID } from './Gesture';
import GestureRepository from '../repository/GestureRepository';

export type PersistantGestureData = {
  name: string;
  ID: GestureID;
  recordings: RecordingData[];
  output: GestureOutput;
};

class Gestures implements Readable<GestureData[]> {
  private static subscribableGestures: Writable<Gesture[]>;
  private repository: GestureRepository;

  constructor(repository: GestureRepository) {
    this.repository = repository;
    Gestures.subscribableGestures = writable();
    this.repository.subscribe(storeArray => {
      Gestures.subscribableGestures.set(storeArray);
    });
  }

  public subscribe(
    run: Subscriber<GestureData[]>,
    invalidate?: ((value?: GestureData[] | undefined) => void) | undefined,
  ): Unsubscriber {
    return derived(Gestures.subscribableGestures, gestures =>
      gestures.map(gesture => this.gestureToGestureData(gesture)),
    ).subscribe(run, invalidate);
  }

  public clearGestures() {
    this.repository.clearGestures();
  }

  public getGesture(gestureID: number): Gesture {
    return this.repository.getGesture(gestureID);
  }

  public getGestures(): Gesture[] {
    return get(Gestures.subscribableGestures);
  }

  public createGesture(name = ''): Gesture {
    const newId = Date.now();
    return this.addGestureFromPersistedData({
      ID: newId,
      recordings: [],
      output: {}, //TODO: ADD DEFAULT VALUES HERE
      name: name,
    });
  }

  public removeGesture(gestureId: number): void {
    this.repository.removeGesture(gestureId);
  }

  public importFrom(gestureData: PersistantGestureData[]) {
    this.clearGestures();
    gestureData.forEach(data => this.addGestureFromPersistedData(data));
  }

  public getNumberOfGestures(): number {
    return get(Gestures.subscribableGestures).length;
  }

  private addGestureFromPersistedData(gestureData: PersistantGestureData): Gesture {
    return this.repository.addGesture(gestureData);
  }

  private gestureToGestureData(gesture: Gesture): GestureData {
    return {
      ID: gesture.getId(),
      name: gesture.getName(),
      recordings: gesture.getRecordings(),
      output: gesture.getOutput(),
      confidence: {
        currentConfidence: gesture.getConfidence().getCurrentConfidence(),
        requiredConfidence: gesture.getConfidence().getRequiredConfidence(),
        isConfident: gesture.getConfidence().isConfident(),
      },
    };
  }
}

export default Gestures;
