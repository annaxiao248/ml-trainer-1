import ModelTrainer, { TrainingData } from '../domain/ModelTrainer';
import KNNMLModel from './KNNMLModel';

type KNNModelTrainingSettings = {
  k: number;
};

class KNNModelTrainer implements ModelTrainer<KNNMLModel> {
  constructor(private settings: KNNModelTrainingSettings) {}

  public async trainModel(trainingData: TrainingData): Promise<KNNMLModel> {
    const features: number[][] = [];
    const labels: number[] = [];

    trainingData.classes.forEach((gestureClass, index) => {
      gestureClass.samples.forEach(sample => {
        features.push(sample.value);
        labels.push(index);
      });
    });

    return Promise.resolve(new KNNMLModel(features, labels, this.settings.k));
  }
}

export default KNNModelTrainer;