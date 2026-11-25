// Used by `pnpm dev`: the local Firebase Auth Emulator ("demo-" projects never
// reach real Firebase). Set FIREBASE_EMULATOR=false in frontend/.env to use
// your own firebase-config.ts instead.
export const firebaseConfig = {
  apiKey: "demo-key",
  authDomain: "demo-beavertype.firebaseapp.com",
  projectId: "demo-beavertype",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};
