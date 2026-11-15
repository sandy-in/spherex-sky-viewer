import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(request) {
  try {
    const { imageBase64 } = await request.json();
    if (!imageBase64) return Response.json({ error: "No image provided" }, { status: 400 });

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

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

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Data, mimeType: "image/png" } }
    ]);
    
    return Response.json(JSON.parse(result.response.text()));
  } catch (error) {
    console.error("AI Error:", error);
    return Response.json({ error: "Failed to analyze image." }, { status: 500 });
  }
}