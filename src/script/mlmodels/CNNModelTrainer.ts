/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import ModelTrainer, { TrainingData } from '../domain/ModelTrainer';
import CNNMLModel from './CNNMLModel';
import * as tf from '@tensorflow/tfjs';

type CNNModelTrainingSettings = { 
  noOfEpochs: number;
  learningRate: number;
};

class CNNModelTrainer implements ModelTrainer<CNNMLModel> {
  constructor(private settings: CNNModelTrainingSettings) {}

  public async trainModel(trainingData: TrainingData): Promise<CNNMLModel> {
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

    // Reshape features for CNN input (batch_size, timesteps, channels)
    const sampleLength = features[0].length;
    const timesteps = sampleLength / 3; // Divide by 3 for x,y,z channels
    const tensorFeatures = tf.tensor3d(
      features.map(f => {
        const reshapedSample = [];
        for (let i = 0; i < timesteps; i++) {
          reshapedSample.push([
            f[i * 3],     // x
            f[i * 3 + 1], // y
            f[i * 3 + 2]  // z
          ]);
        }
        return reshapedSample;
      })
    );
    
    const tensorLabels = tf.tensor2d(labels);

    // Create CNN model
    const input = tf.input({shape: [timesteps, 3]});
    
    // First convolutional block
    const conv1 = tf.layers.conv1d({
      filters: 64,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same'
    }).apply(input);
    
    const pool1 = tf.layers.maxPooling1d({
      poolSize: 2
    }).apply(conv1);
    
    // Second convolutional block
    const conv2 = tf.layers.conv1d({
      filters: 128,
      kernelSize: 3,
      activation: 'relu',
      padding: 'same'
    }).apply(pool1);
    
    const pool2 = tf.layers.maxPooling1d({
      poolSize: 2
    }).apply(conv2);
    
    // Flatten and dense layers
    const flatten = tf.layers.flatten().apply(pool2);
    const dropout = tf.layers.dropout({ rate: 0.5 }).apply(flatten);
    const dense = tf.layers.dense({ units: 128, activation: 'relu' }).apply(dropout);
    const output = tf.layers.dense({
      units: numberOfClasses,
      activation: 'softmax'
    }).apply(dense) as tf.SymbolicTensor;

    const model = tf.model({ inputs: input, outputs: output });

    model.compile({
      optimizer: tf.train.adam(this.settings.learningRate),
      loss: 'categoricalCrossentropy',
      metrics: ['accuracy']
    });

    await model.fit(tensorFeatures, tensorLabels, {
      epochs: this.settings.noOfEpochs,
      batchSize: 32,
      validationSplit: 0.2,
      shuffle: true
    }).catch(err => {
      console.error('CNN training process failed:', err);
      return Promise.reject(err);
    });

    // Clean up tensors
    tensorFeatures.dispose();
    tensorLabels.dispose();

    return Promise.resolve(new CNNMLModel(model));
  }
}

export default CNNModelTrainer;