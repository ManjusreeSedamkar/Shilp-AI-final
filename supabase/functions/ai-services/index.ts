import "@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface AIServiceRequest {
  task: "artisan_bio" | "product_description" | "shilpsaathi" | "analyze_image";
  prompt?: string;
  language?: string;
  data?: Record<string, any>;
  imageInput?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method Not Allowed. Only POST requests are supported." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Read key server-side from Supabase secrets ONLY — never expose or log
    const openrouterApiKey = Deno.env.get("OPENROUTER_API_KEY");
    if (!openrouterApiKey || openrouterApiKey.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "OPENROUTER_API_KEY secret is not configured in Supabase Edge Functions." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: AIServiceRequest;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body provided." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { task, prompt, language = "en", data = {}, imageInput } = body;

    if (!task || !["artisan_bio", "product_description", "shilpsaathi", "analyze_image"].includes(task)) {
      return new Response(
        JSON.stringify({ error: "Field 'task' must be one of: 'artisan_bio', 'product_description', 'shilpsaathi', 'analyze_image'." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let finalPrompt = "";
    let systemPrompt = "";

    if (task === "artisan_bio") {
      const name = data.name || "the artisan";
      const state = data.state || "India";
      const craftCluster = data.craftCluster || "traditional handloom & craft";
      systemPrompt = "You are a warm, helpful cultural handicraft biographer for the Indian Ministry of Social Justice and Empowerment (MoSJE) Shilp-AI marketplace.";
      finalPrompt = prompt || `Write a short, warm 2-sentence artisan bio (max 60 words) for an Indian craftsperson named "${name}" from ${state}, specialising in "${craftCluster}". Write in first person. Highlight authentic craftsmanship, heritage preservation, and dedication to quality. Keep it suitable for a government handicraft marketplace profile. Respond in ${language} language.`;
    } else if (task === "product_description") {
      systemPrompt = "You are an expert cultural handicraft cataloger and visual product analyst for the MoSJE Shilp-AI platform.";
      finalPrompt = prompt || `Generate a culturally grounded description for a ${data.category || 'heritage'} handicraft product made of ${data.primaryMaterial || 'authentic materials'} using ${data.craftTechnique || 'traditional'} technique in ${language} language. Respond ONLY with a valid JSON object: { "titleEn": "...", "titleHi": "...", "descriptionEn": "...", "descriptionHi": "...", "seoKeywords": [] }`;
    } else if (task === "shilpsaathi") {
      systemPrompt = `You are SHILP-AI Copilot (SHILP Saathi), a friendly business assistant for Indian artisans and buyers on the MoSJE handicraft marketplace. Respond in ${language} language. Keep answers concise, clear, and encouraging. Use emojis where helpful.`;
      finalPrompt = prompt || "How can I help you grow your artisan business today?";
    } else if (task === "analyze_image") {
      systemPrompt = "You are an expert computer vision cataloger for Indian handicrafts for the MoSJE Shilp-AI marketplace.";
      finalPrompt = prompt || `Analyze this Indian handicraft product image and identify its visual attributes.
Respond ONLY with a valid raw JSON object (no markdown, no backticks):
{
  "visualObjectType": "Specific product type (e.g. Nandi metal sculpture, Pochampally saree, Terracotta urn, Madhubani painting, Wooden carving, Kashmiri shawl)",
  "craftCategorySuggestion": "One of: Textiles & Handloom, Clay & Terracotta, Metalcraft & Dhokra, Traditional Painting, Woodcraft & Carving, Leather & Footwear, Handmade Jewelry, Other Heritage Craft",
  "apparentMaterial": "Apparent surface material (e.g. brass/bell metal, clay, silk, pashmina wool, paper/canvas, teakwood)",
  "visibleColors": "Dominant visible colors (e.g. cream, antique golden bronze, crimson red and mustard, terracotta red)",
  "visiblePatternsMotifs": "Visible patterns and motifs (e.g. tribal lost-wax ornamentations, geometric ikat grid, pink and gold floral motifs)",
  "visibleBorderColor": "Visible border/edge colors if present, otherwise null (e.g. pink and gold, maroon gold, null)",
  "confidence": "high or medium or low",
  "keywords": ["keyword1", "keyword2", "keyword3"]
}`;
    }

    // Construct messages array for OpenRouter
    let userContent: string | any[] = finalPrompt;
    if (imageInput) {
      const formattedUrl = imageInput.startsWith("data:")
        ? imageInput
        : `data:image/jpeg;base64,${imageInput}`;
      userContent = [
        { type: "text", text: finalPrompt },
        { type: "image_url", image_url: { url: formattedUrl } }
      ];
    }

    const openrouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openrouterApiKey.trim()}`,
        "HTTP-Referer": "https://shilpai.app",
        "X-Title": "SHILP-AI Marketplace",
      },
      body: JSON.stringify({
        models: [
          "google/gemma-4-26b-a4b-it:free",
          "nvidia/nemotron-3-ultra-550b-a55b:free",
          "inclusionai/ling-3.0-flash-sante:free"
        ],
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!openrouterResponse.ok) {
      const errText = await openrouterResponse.text();
      return new Response(
        JSON.stringify({ error: `OpenRouter API error: ${openrouterResponse.status}`, details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const openrouterData = await openrouterResponse.json();
    const resultText = openrouterData?.choices?.[0]?.message?.content || "";

    return new Response(
      JSON.stringify({
        success: true,
        task,
        result: resultText.trim(),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return new Response(
      JSON.stringify({ error: `Internal error in ai-services edge function: ${errorMsg}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
