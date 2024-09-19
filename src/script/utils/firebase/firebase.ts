// firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: "tiilt-ml-trainer.firebaseapp.com",
    projectId: "tiilt-ml-trainer",
    storageBucket: "tiilt-ml-trainer.appspot.com",
    messagingSenderId: "655806169567",
    appId: "1:655806169567:web:935531afedfdb95888046a",
    measurementId: "G-W668YRYND2"
  };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };
