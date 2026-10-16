# ChopeAndPay native app experiment (Capacitor, Android first)

This branch wraps the live web app in a native Android shell. The shell **loads
the website from a URL** (default `https://chopeandpay.com`), so login,
Supabase and the `/.netlify/functions/*` calls behave exactly like the website.
No web code was changed.

## Run it on your computer (Windows or Mac)

1. Install **Android Studio** (https://developer.android.com/studio). On first
   launch let it install the Android SDK.
2. In a terminal inside the project:
   ```
   git fetch
   git checkout capacitor-experiment
   npm install
   npm run android:sync
   npm run android:open
   ```
   The last command opens the `android/` folder in Android Studio.
3. Wait for Android Studio to finish "Gradle sync" (first time takes a while).
4. Press the green **Run** button.
   - **Emulator:** Device Manager > Create device > pick any Pixel.
   - **Your phone:** turn on Developer options + USB debugging, plug in USB.

### Test a Netlify preview instead of production

```
# Mac/Linux
CAP_SERVER_URL=https://YOUR-PREVIEW-URL.netlify.app npm run android:sync
# Windows PowerShell
$env:CAP_SERVER_URL="https://YOUR-PREVIEW-URL.netlify.app"; npm run android:sync
```
Then press Run again.

## What to test (and what I expect)

| Test | Expectation |
|---|---|
| Sign in, Dashboard, Students, Payments | Should work like the website |
| Mark a lesson Done | Should work |
| Request Payment / Remind > Open WhatsApp | **Unknown**: may open WhatsApp, may do nothing |
| Settings > Connect Google Calendar | **Likely blocked**: Google refuses sign-in inside embedded WebViews |
| Subscribe / checkout (Stripe) | Opens in the same window; returning to the app may be awkward |
| Lesson reminder notifications | **Won't work**: web notifications don't run in a native shell |
| Install banner | Should be hidden in the app (not done yet) |

## Known limits of this first experiment

- Needs internet (nothing is bundled). Offline shows a browser error page.
- No native push notifications yet (needs `@capacitor/push-notifications`,
  Firebase, and a server that sends them).
- `appId` is `com.chopeandpay.app` in `capacitor.config.ts`. It becomes
  permanent once published. Change it before any store upload if you want another.
- iOS is not set up. It needs a Mac with Xcode and an Apple Developer account.
- **Store policy:** the Subscribe / plan-management screens sell digital
  subscriptions. Google Play and the App Store have rules about how that must
  be done. Check current rules for Singapore before publishing.
