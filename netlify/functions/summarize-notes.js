exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Anthropic API key is not configured." }),
    };
  }

  let notes;
  try {
    ({ notes } = JSON.parse(event.body ?? "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid request body." }) };
  }

  if (!notes || !notes.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "No notes provided." }) };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        system:
          "You are helping a private tutor write a short update for a student's parent. " +
          "Turn the tutor's rough lesson notes into a warm, parent-friendly summary of 2–4 sentences. " +
          "Write as if the tutor is speaking directly to the parent — no jargon, encouraging tone. " +
          "Mention what was covered in the lesson and highlight any areas worth practising at home. " +
          "Do not use bullet points. Keep it concise and positive.",
        messages: [{ role: "user", content: notes.trim() }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Anthropic API error:", err);
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "AI service returned an error. Please try again." }),
      };
    }

    const data = await response.json();
    const summary = data.content?.[0]?.text ?? "";

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary }),
    };
  } catch (err) {
    console.error("summarize-notes error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Couldn't generate summary, please try again." }),
    };
  }
};
