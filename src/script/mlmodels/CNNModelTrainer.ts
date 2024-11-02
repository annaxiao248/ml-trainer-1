/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import ModelTrainer, { TrainingData } from '../domain/ModelTrainer';
import LayersMLModel from './LayersMLModel';
import * as tf from '@tensorflow/tfjs';

type CNNModelTrainingSettings = { noOfEpochs: number };

class CNNModelTrainer implements ModelTrainer<LayersMLModel> {
  constructor(private settings: CNNModelTrainingSettings) {}

  public async trainModel(trainingData: TrainingData): Promise<LayersMLModel> {
    // Prepare data
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

    const tensorFeatures = tf.tensor(features).reshape([-1, 28, 28, 1]); // Assuming 28x28 input size
    const tensorLabels = tf.tensor(labels);

    // Define CNN model architecture
    const inputShape = [28, 28, 1];
    const input = tf.input({ shape: inputShape });

    const conv1 = tf.layers
      .conv2d({ filters: 32, kernelSize: 3, activation: 'relu', padding: 'same' })
      .apply(input) as tf.SymbolicTensor;
    const pool1 = tf.layers.maxPooling2d({ poolSize: [2, 2] }).apply(conv1);

    const conv2 = tf.layers
      .conv2d({ filters: 64, kernelSize: 3, activation: 'relu', padding: 'same' })
      .apply(pool1) as tf.SymbolicTensor;
    const pool2 = tf.layers.maxPooling2d({ poolSize: [2, 2] }).apply(conv2);

    const flatten = tf.layers.flatten().apply(pool2) as tf.SymbolicTensor;

    const dense1 = tf.layers.dense({ units: 128, activation: 'relu' }).apply(flatten);
    const output = tf.layers
      .dense({ units: numberOfClasses, activation: 'softmax' })
      .apply(dense1) as tf.SymbolicTensor;

    const model = tf.model({ inputs: input, outputs: output });

    model.compile({
      loss: 'categoricalCrossentropy',
      optimizer: tf.train.adam(),
      metrics: ['accuracy'],
    });

    // Train the model
    await model
      .fit(tensorFeatures, tensorLabels, {
        epochs: this.settings.noOfEpochs,
        batchSize: 32,
        validationSplit: 0.1,
      })
      .catch(err => {
        console.error('CNN training process failed:', err);
        return Promise.reject(err);
      });
      
    return Promise.resolve(new LayersMLModel(model));
  }
}

export default CNNModelTrainer;
