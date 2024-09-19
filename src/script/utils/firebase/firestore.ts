// firestore.ts
import { collection, addDoc } from 'firebase/firestore';
import { db } from './firebase';

export const addGestureToFirestore = async (gestureId: string, gestureName: string, data: { x: number[]; y: number[]; z: number[] }) => {
  try {
    const docRef = await addDoc(collection(db, "gestures"), {
      id: gestureId,
      name: gestureName,
      data: data,
      timestamp: new Date()
    });
    console.log("Document written with ID: ", docRef.id);
  } catch (e) {
    console.error("Error adding document: ", e);
  }
};