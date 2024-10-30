import MLModel from '../domain/MLModel';

class KNNMLModel implements MLModel {
  constructor(
    private trainingFeatures: number[][],
    private trainingLabels: number[],
    private k: number
  ) {}

  predict(inputData: number[]): Promise<number[]> {
    const distances = this.trainingFeatures.map((feature, index) => ({
      distance: this.euclideanDistance(inputData, feature),
      label: this.trainingLabels[index],
    }));

    distances.sort((a, b) => a.distance - b.distance);
    const kNearest = distances.slice(0, this.k);

    const voteCounts = kNearest.reduce((acc, neighbor) => {
      acc[neighbor.label] = (acc[neighbor.label] || 0) + 1;
      return acc;
    }, {} as Record<number, number>);

    const totalClasses = Math.max(...this.trainingLabels) + 1;
    const prediction = new Array(totalClasses).fill(0);

    for (let i = 0; i < totalClasses; i++) {
      prediction[i] = (voteCounts[i] || 0) / this.k;
    }

    return Promise.resolve(prediction);
  }

  private euclideanDistance(a: number[], b: number[]): number {
    return Math.sqrt(
      a.reduce((sum, value, index) => sum + Math.pow(value - b[index], 2), 0)
    );
  }
}

export default KNNMLModel;