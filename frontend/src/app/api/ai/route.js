export async function POST(request) {
  try {
    const { imageBase64 } = await request.json();
    if (!imageBase64) return Response.json({ error: "No image provided" }, { status: 400 });

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return Response.json({ error: "GEMINI_API_KEY is missing in Vercel Environment Variables." }, { status: 500 });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    
    const prompt = `
      You are an expert astronomer analyzing an infrared astronomical image.
      Provide a brief 1-sentence summary of the image.
      Then, identify up to 3 distinct objects (stars, galaxies, or artifacts). 
      For each object, provide a label and an approximate bounding box.
      The bounding box coordinates must be percentages from 0 to 100: [ymin, xmin, ymax, xmax].
      Return ONLY a JSON object with this exact structure:
      {
        "summary": "A short description here.",
        "objects": [
          { "label": "Star", "box": [20, 30, 25, 35] }
        ]
      }
    `;

    const payload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/png", data: base64Data } }
        ]
      }],
      generationConfig: { response_mime_type: "application/json" }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("Google API Error:", data);
      // Return the exact error so the frontend can display it
      return Response.json({ 
        error: data.error?.message || "Google API rejected the request.",
      });
    }

    let text = data.candidates[0].content.parts[0].text;
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();
    
    return Response.json(JSON.parse(text));

  } catch (error) {
    console.error("AI API Error:", error.message);
    return Response.json({ error: error.message });
  }
}