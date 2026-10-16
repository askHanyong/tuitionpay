import type { CapacitorConfig } from "@capacitor/cli";

// EXPERIMENT: the native shell loads the live web app from a URL instead of
// bundling the files. This means the app behaves exactly like the website
// (login, Supabase, the /.netlify/functions/* calls) with no code changes.
//
// Point it at a different deployment (e.g. a Netlify branch preview) with:
//   CAP_SERVER_URL=https://your-preview-url.netlify.app npx cap sync android
const serverUrl = process.env.CAP_SERVER_URL || "https://chopeandpay.com";

const config: CapacitorConfig = {
  // Reverse-domain app ID. NOTE: this becomes permanent once the app is
  // published on Google Play / the App Store -- change it now if you want a
  // different one.
  appId: "com.chopeandpay.app",
  appName: "ChopeAndPay",
  webDir: "dist",
  server: {
    url: serverUrl,
    androidScheme: "https",
    cleartext: false,
  },
};

export default config;
