import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Estas claves de Firebase para web son públicas. Tus datos los protegen
// el inicio de sesión con Google y las reglas de Firestore.
const cfg = {
  apiKey: "AIzaSyD_ZSY757ehuYzCVHG5aKP573nUQyOMINM",
  authDomain: "mi-cartera-86e5a.firebaseapp.com",
  projectId: "mi-cartera-86e5a",
  storageBucket: "mi-cartera-86e5a.firebasestorage.app",
  messagingSenderId: "819013617643",
  appId: "1:819013617643:web:0063c80222db06c6ae7bae",
};

export function getFb() {
  const app = getApps().length ? getApp() : initializeApp(cfg);
  return { auth: getAuth(app), db: getFirestore(app) };
}
