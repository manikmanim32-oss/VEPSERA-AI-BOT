require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const supabaseReady = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
const baseSupabase = supabaseReady
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  : null;

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json({ limit: "8mb" }));
app.use(express.static("public", { extensions: ["html"] }));

const agentPrompts = {
  general: "You are VESPERA, a helpful, accurate AI assistant. Reply in the user's language, including Tamil or Tanglish. Be clear, practical, and honest about uncertainty.",
  coder: "You are VESPERA Code, an expert programming assistant. Debug carefully, explain changes, and prioritize secure working code.",
  researcher: "You are VESPERA Research. Research carefully, distinguish facts from uncertainty, and cite supplied source URLs.",
  writer: "You are VESPERA Writer. Create polished writing that follows the user's requested tone and format.",
  tutor: "You are VESPERA Tutor. Teach step by step, encourage understanding, and adapt to the learner."
};

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

async function auth(req, res, next) {
  if (!baseSupabase) return res.status(503).json({ error: "Account login is not configured. Set Supabase project values first." });
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Please sign in to VESPERA first." });
  const { data, error } = await baseSupabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: "Your session expired. Please sign in again." });
  req.user = data.user;
  req.db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  next();
}

app.get("/api/config", (_req, res) => res.json({
  supabaseConfigured: supabaseReady,
  providers: {
    anthropic: !!process.env.ANTHROPIC_API_KEY,
    openai: !!process.env.OPENAI_API_KEY,
    gemini: !!process.env.GEMINI_API_KEY,
    search: !!process.env.TAVILY_API_KEY,
    media: !!process.env.FAL_KEY
  }
}));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "VESPERA AI BOT", accountsConfigured: supabaseReady }));

async function tavilySearch(query) {
  if (!process.env.TAVILY_API_KEY) throw new Error("Web search is not configured yet. Add TAVILY_API_KEY.");
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query, search_depth: "advanced", max_results: 6 })
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data.message || "Web search failed.");
  return (data.results || []).map(x => ({ title: x.title, url: x.url, content: x.content }));
}
async function anthropic(messages, system) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || "claude-haiku-5-5", max_tokens: 2000, system, messages })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Anthropic request failed (${r.status})`);
  return (d.content || []).filter(x => x.type === "text").map(x => x.text).join("\n");
}
async function openai(messages, system) {
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4.1-mini", messages: [{ role: "system", content: system }, ...messages] })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `OpenAI request failed (${r.status})`);
  return d.choices?.[0]?.message?.content || "";
}
async function gemini(messages, system) {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Gemini request failed (${r.status})`);
  return d.candidates?.[0]?.content?.parts?.map(p => p.text || "").join("") || "";
}

function cleanMessages(input) {
  if (!Array.isArray(input)) return [];
  return input.slice(-40).filter(m => m && ["user","assistant"].includes(m.role) && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 14000) }));
}
function scoreDoc(query, content) {
  const terms = query.toLowerCase().split(/\W+/).filter(x => x.length > 2);
  const text = content.toLowerCase();
  return terms.reduce((n, term) => n + (text.split(term).length - 1), 0);
}

app.post("/api/chat", auth, async (req, res) => {
  try {
    const messages = cleanMessages(req.body?.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") return res.status(400).json({ error: "Please enter a message." });
    const provider = ["anthropic","openai","gemini"].includes(req.body.model) ? req.body.model : "anthropic";
    let system = agentPrompts[req.body.agent] || agentPrompts.general;
    const lastQuestion = messages[messages.length - 1].content;

    // Lightweight per-user document retrieval. Documents are private via Supabase RLS.
    const { data: docs } = await req.db.from("knowledge_documents").select("filename,content").limit(100);
    if (docs?.length) {
      const relevant = docs.map(d => ({...d, score: scoreDoc(lastQuestion, d.content || "")}))
        .filter(d => d.score > 0).sort((a,b) => b.score-a.score).slice(0,3);
      if (relevant.length) system += "\n\nRelevant private knowledge-base excerpts:\n" +
        relevant.map(d => `Document: ${d.filename}\n${d.content.slice(0,7000)}`).join("\n\n");
    }

    if (req.body.webSearch) {
      const results = await tavilySearch(lastQuestion);
      system += "\n\nCurrent web search results. Use them carefully and include the URLs in your answer:\n" +
        results.map(x => `${x.title}\n${x.url}\n${x.content}`).join("\n\n");
    }
    let answer;
    if (provider === "openai") {
      if (!process.env.OPENAI_API_KEY) throw new Error("OpenAI is not configured. Add OPENAI_API_KEY to server environment.");
      answer = await openai(messages, system);
    } else if (provider === "gemini") {
      if (!process.env.GEMINI_API_KEY) throw new Error("Gemini is not configured. Add GEMINI_API_KEY to server environment.");
      answer = await gemini(messages, system);
    } else {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error("Claude is not configured. Add ANTHROPIC_API_KEY to server environment.");
      answer = await anthropic(messages, system);
    }
    res.json({ text: answer, provider });
  } catch (e) {
    console.error("chat error:", e.message);
    res.status(502).json({ error: e.message || "AI request failed." });
  }
});

app.get("/api/conversations", auth, async (req, res) => {
  const { data, error } = await req.db.from("conversations").select("id,title,messages,updated_at").order("updated_at",{ascending:false}).limit(100);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversations: data || [] });
});
app.post("/api/conversations", auth, async (req, res) => {
  const title = String(req.body.title || "New chat").slice(0,120);
  const messages = cleanMessages(req.body.messages);
  const { data, error } = await req.db.from("conversations").insert({ user_id:req.user.id,title,messages,updated_at:new Date().toISOString() }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ conversation:data });
});
app.put("/api/conversations/:id", auth, async (req, res) => {
  const { data, error } = await req.db.from("conversations").update({ title:String(req.body.title || "Chat").slice(0,120),messages:cleanMessages(req.body.messages),updated_at:new Date().toISOString() }).eq("id",req.params.id).select().single();
  if (error) return res.status(500).json({ error:error.message });
  res.json({ conversation:data });
});
app.delete("/api/conversations/:id", auth, async (req, res) => {
  const { error } = await req.db.from("conversations").delete().eq("id",req.params.id);
  if (error) return res.status(500).json({ error:error.message });
  res.json({ ok:true });
});

app.post("/api/knowledge", auth, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error:"Choose a .txt or .md file." });
    const filename = req.file.originalname || "document.txt";
    if (!/\.(txt|md)$/i.test(filename)) return res.status(400).json({ error:"This starter currently accepts .txt and .md documents." });
    const content = req.file.buffer.toString("utf8").slice(0,150000);
    const { data, error } = await req.db.from("knowledge_documents").insert({user_id:req.user.id,filename,content}).select("id,filename,created_at").single();
    if (error) throw error;
    res.json({ document:data });
  } catch(e) { res.status(500).json({ error:e.message || "Document upload failed." }); }
});
app.get("/api/knowledge", auth, async (req,res)=>{
  const {data,error}=await req.db.from("knowledge_documents").select("id,filename,created_at").order("created_at",{ascending:false});
  if(error)return res.status(500).json({error:error.message});
  res.json({documents:data||[]});
});
app.delete("/api/knowledge/:id", auth, async (req,res)=>{
  const {error}=await req.db.from("knowledge_documents").delete().eq("id",req.params.id);
  if(error)return res.status(500).json({error:error.message});
  res.json({ok:true});
});

async function falRequest(model, body) {
  const r=await fetch(`https://queue.fal.run/${model}`,{method:"POST",headers:{"content-type":"application/json",authorization:`Key ${process.env.FAL_KEY}`},body:JSON.stringify(body)});
  const d=await r.json();
  if(!r.ok)throw new Error(d.detail||d.message||`Media provider error (${r.status})`);
  return d;
}
app.post("/api/media/:kind",auth,upload.single("image"),async(req,res)=>{
  try{
    if(!process.env.FAL_KEY)return res.status(503).json({error:"Image/video generation provider is not configured. Add FAL_KEY."});
    const kind=req.params.kind, prompt=String(req.body.prompt||"").trim();
    if(!["image","video"].includes(kind))return res.status(404).json({error:"Unknown media type."});
    if(!prompt)return res.status(400).json({error:"Enter a prompt."});
    let model,body={prompt};
    if(kind==="image")model=process.env.FAL_IMAGE_MODEL||"fal-ai/flux/dev";
    else{
      const imageUrl=String(req.body.image_url||"").trim();
      if(imageUrl){model=process.env.FAL_IMAGE_VIDEO_MODEL||"fal-ai/wan-i2v";body.image_url=imageUrl;}
      else model=process.env.FAL_TEXT_VIDEO_MODEL||"fal-ai/wan-t2v";
    }
    const data=await falRequest(model,body);
    res.status(202).json({request_id:data.request_id,status_url:data.status_url,response_url:data.response_url,model});
  }catch(e){console.error("media error:",e.message);res.status(502).json({error:e.message});}
});
app.get("/api/media-status",auth,async(req,res)=>{
  try{
    const url=String(req.query.url||"");
    if(!process.env.FAL_KEY||!url.startsWith("https://queue.fal.run/"))return res.status(400).json({error:"Invalid media status URL."});
    const r=await fetch(url,{headers:{authorization:`Key ${process.env.FAL_KEY}`}});
    const d=await r.json();res.status(r.status).json(d);
  }catch(e){res.status(502).json({error:e.message});}
});
app.get("/api/media-result",auth,async(req,res)=>{
  try{
    const url=String(req.query.url||"");
    if(!process.env.FAL_KEY||!url.startsWith("https://queue.fal.run/"))return res.status(400).json({error:"Invalid media result URL."});
    const r=await fetch(url,{headers:{authorization:`Key ${process.env.FAL_KEY}`}});
    const d=await r.json();res.status(r.status).json(d);
  }catch(e){res.status(502).json({error:e.message});}
});

app.get("*",(_req,res)=>res.sendFile(require("path").join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log(`VESPERA AI BOT listening on port ${PORT}`));
