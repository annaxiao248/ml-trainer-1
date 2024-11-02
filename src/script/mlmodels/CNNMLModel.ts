/**
 * (c) 2023, Center for Computational Thinking and Design at Aarhus University and contributors
 *
 * SPDX-License-Identifier: MIT
 */
import { LayersModel } from '@tensorflow/tfjs';
import MLModel from '../domain/MLModel';
import * as tf from '@tensorflow/tfjs';

class CNNMLModel implements MLModel {
  constructor(private neuralNet: LayersModel) {}

  public async predict(filteredData: number[]): Promise<number[]> {
    // Reshape the 1D array into proper format for CNN
    const timesteps = filteredData.length / 3;
    const reshapedData = [];
    for (let i = 0; i < timesteps; i++) {
      reshapedData.push([
        filteredData[i * 3],     // x
        filteredData[i * 3 + 1], // y
        filteredData[i * 3 + 2]  // z
      ]);
    }
    
    // Create tensor3d with shape [batch_size, timesteps, channels]
    const reshapedInput = tf.tensor3d([reshapedData]); // Shape will be [1, timesteps, 3]
    
    const prediction: tf.Tensor = this.neuralNet.predict(reshapedInput) as tf.Tensor;
    try {
      const predictionOutput = (await prediction.data()) as Float32Array;
      return Array.from(predictionOutput);
    } catch (err) {
      console.error('Prediction error:', err);
      return Promise.reject(err);
    } finally {
      reshapedInput.dispose();
      prediction.dispose();
    }
  }
}

export default CNNMLModel;