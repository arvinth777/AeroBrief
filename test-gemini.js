const { GoogleGenAI } = require("@google/genai");

async function testModel(modelName) {
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const res = await ai.models.generateContent({
      model: modelName,
      contents: "hello",
    });
    console.log(`SUCCESS: ${modelName} -> ${res.text}`);
  } catch (e) {
    console.log(`FAILED: ${modelName} -> ${e.message}`);
  }
}

async function run() {
  await testModel("gemini-2.5-flash");
  await testModel("gemini-2.0-flash");
  await testModel("gemini-1.5-flash");
  await testModel("gemini-1.5-pro");
}
run();
