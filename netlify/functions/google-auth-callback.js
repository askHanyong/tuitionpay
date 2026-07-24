// Exchanges a Google OAuth authorization code (or refresh token) for access
// tokens. Runs server-side only so VITE_GOOGLE_CLIENT_SECRET never reaches
// the frontend bundle -- this file is never processed by Vite's client build.
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REDIRECT_URI = "https://chopeandpay.com/auth/google/callback";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const clientId = process.env.VITE_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.VITE_GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Google OAuth is not configured." }),
    };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON body." }),
    };
  }

  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  if (payload.refresh_token) {
    params.set("refresh_token", payload.refresh_token);
    params.set("grant_type", "refresh_token");
  } else if (payload.code) {
    params.set("code", payload.code);
    params.set("grant_type", "authorization_code");
    params.set("redirect_uri", GOOGLE_REDIRECT_URI);
  } else {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing code or refresh_token." }),
    };
  }

  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const tokenBody = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    return {
      statusCode: tokenRes.status,
      body: JSON.stringify({
        error:
          tokenBody.error_description ||
          tokenBody.error ||
          "Token exchange failed.",
      }),
    };
  }

  const result = {
    access_token: tokenBody.access_token,
    refresh_token: tokenBody.refresh_token ?? null,
    expiry_date: Date.now() + Number(tokenBody.expires_in ?? 0) * 1000,
  };

  // Only the authorization_code flow needs the account email (to show
  // "Connected as ..." in Settings) -- refresh doesn't return id_token info.
  if (payload.code && tokenBody.access_token) {
    const userInfoRes = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      { headers: { Authorization: `Bearer ${tokenBody.access_token}` } },
    );
    if (userInfoRes.ok) {
      const userInfo = await userInfoRes.json();
      result.email = userInfo.email ?? null;
    }
  }

  return { statusCode: 200, body: JSON.stringify(result) };
};
