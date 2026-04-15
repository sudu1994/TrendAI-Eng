const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// 1. Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_GENAI_API_KEY);

async function fetchTrendData(keyword) {
  const params = {
    engine: "google_trends",
    q: keyword,
    date: "today 12-m",
    geo: "US",
    hl: "en",
    api_key: process.env.SERPAPI_KEY,
  };

  const res = await axios.get("https://serpapi.com/search.json", { params });
  const timeline = res.data?.interest_over_time?.timeline_data ?? [];
  if (timeline.length === 0) throw new Error("No trend data found for this keyword.");

  const values = timeline.map((d) => ({
    date: d.date,
    value: Number(d.values?.[0]?.extracted_value ?? 0),
  }));

  const avg = values.reduce((s, d) => s + d.value, 0) / values.length;
  const recent = values.slice(-4);
  const recentAvg = recent.reduce((s, d) => s + d.value, 0) / recent.length;
  const trend =
    recentAvg > avg * 1.1 ? "📈 Rising" :
    recentAvg < avg * 0.9 ? "📉 Declining" : "➡️ Stable";

  const rising = res.data?.related_queries?.rising?.slice(0, 5).map((q) => q.query) ?? [];
  const top    = res.data?.related_queries?.top?.slice(0, 5).map((q) => q.query) ?? [];

  return {
    keyword,
    values,
    avg: Math.round(avg),
    recentAvg: Math.round(recentAvg),
    trend,
    score: Math.round(recentAvg),
    rising,
    top,
  };
}

async function generatePlanAndSite(trendData) {
  const { keyword, trend, score, avg, recentAvg, rising, top } = trendData;

  const model = genAI.getGenerativeModel({ 
    model: "gemini-3-flash-preview",
    generationConfig: { 
      responseMimeType: "application/json",
      temperature: 0.7 
    }
  });

  const systemPrompt = `You are an analyst for TrendBaseAI.
Based on Google Trends data, you generate a business plan and an HTML website using Tailwind CSS in English.
Always respond in pure JSON format only. No explanations or extra commentary.`;

  const userPrompt = `
Keyword: "${keyword}"
Trend: ${trend}
Score: ${score}

Generate the following JSON:
{
  "businessPlan": {
    "title": "Business name",
    "tagline": "Catchy slogan",
    "opportunity": "Reason for opportunity",
    "target": "Target customer profile",
    "service": "Service overview",
    "differentiation": ["Point 1", "Point 2", "Point 3"],
    "seoKeywords": ["Keyword 1", "Keyword 2"],
    "revenueModel": "Revenue model description",
    "actionPlan": ["Step 1", "Step 2"],
    "risk": "Risks and mitigation strategy"
  },
  "websiteHTML": "Complete HTML document (from <!DOCTYPE html> to </html>). Use Tailwind CDN and Alpine.js CDN. All buttons (Get Started, etc.) must trigger modal displays, alerts, or other actions via JavaScript inside <script> tags. No external JS files — everything self-contained in one HTML file."
}
Important: Always end your response with the closing JSON brace '}'.`;

  const result = await model.generateContent(systemPrompt + "\n\n" + userPrompt);
  const response = await result.response;
  const fullText = response.text();
  
  let cleaned = fullText.replace(/^```json\s*/m, "").replace(/```\s*$/m, "").trim();
  const lastBraceIndex = cleaned.lastIndexOf("}");
  if (lastBraceIndex !== -1) {
    cleaned = cleaned.substring(0, lastBraceIndex + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("JSON Parse Error:", err);
    throw new Error("The AI response was not valid JSON. Please try again.");
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const keyword = req.query.keyword?.trim();
  if (!keyword) {
    return res.status(400).json({ error: "Please enter a keyword." });
  }

  try {
    const trendData = await fetchTrendData(keyword);
    const aiResult  = await generatePlanAndSite(trendData);
    return res.status(200).json({ trend: trendData, result: aiResult });
  } catch (err) {
    console.error("API Error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};
