/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import ModelTrainer, { TrainingData } from '../domain/ModelTrainer';
import LayersMLModel from './LayersMLModel';
import * as tf from '@tensorflow/tfjs';
type LayersModelTrainingSettings = { noOfEpochs: number };
class LayersModelTrainer implements ModelTrainer<LayersMLModel> {
  constructor(private settings: LayersModelTrainingSettings) {}
  public async trainModel(trainingData: TrainingData): Promise<LayersMLModel> {
    // Fetch data
    const features: Array<number[]> = [];
    const labels: Array<number[]> = [];
    const numberOfClasses = trainingData.classes.length;

    trainingData.classes.forEach((gestureClass, index) => {
      gestureClass.samples.forEach(sample => {
        features.push(sample.value);

        const label: number[] = new Array(numberOfClasses) as number[];
        label.fill(0, 0, numberOfClasses);
        label[index] = 1;
        labels.push(label);
      });
    });

    const tensorFeatures = tf.tensor(features);
    const tensorLabels = tf.tensor(labels);

    // Find the shape by looking at the first data point
    const inputShape = [trainingData.classes[0].samples[0].value.length];

    const input = tf.input({ shape: inputShape });
    const normalizer = tf.layers.batchNormalization().apply(input);
    const dense = tf.layers.dense({ units: 16, activation: 'relu' }).apply(normalizer);
    const softmax = tf.layers
      .dense({ units: numberOfClasses, activation: 'softmax' })
      .apply(dense) as tf.SymbolicTensor;

    const model = tf.model({ inputs: input, outputs: softmax });

    model.compile({
      loss: 'categoricalCrossentropy',
      optimizer: tf.train.sgd(0.5),
      metrics: ['accuracy'],
    });

    await model
      .fit(tensorFeatures, tensorLabels, {
        epochs: this.settings.noOfEpochs,
        batchSize: 16,
        validationSplit: 0.1,
      })
      .catch(err => {
        console.error('tensorflow training process failed:', err);
        return Promise.reject(err);
      });
    return Promise.resolve(new LayersMLModel(model));
  }
}

export default LayersModelTrainer;
