import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const cfg = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Devuelve null si Firebase no está configurado: la app sigue funcionando en modo local.
export function getFb() {
  if (!cfg.apiKey || !cfg.projectId) return null;
  const app = getApps().length ? getApp() : initializeApp(cfg);
  return { auth: getAuth(app), db: getFirestore(app) };
}
