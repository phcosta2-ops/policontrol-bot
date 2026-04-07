// Policontrol Bot v5 — Claude AI + Upstash (dados sincronizados com app)
const TELEGRAM_TOKEN = "8619850108:AAFk2alsfSQLocua9jPOkzgUD33XPFsIrdc";
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const UPSTASH_URL = process.env.UPSTASH_URL || "https://smooth-dingo-93735.upstash.io";
const UPSTASH_TOKEN = process.env.UPSTASH_TOKEN || "gQAAAAAAAW4nAAIncDIwYzk0ODBlZmViOTY0ODZkYTAyN2JhYzJjNmNjMmUxMXAyOTM3MzU";

const PROJECTS = [
  "Placa AP2000 (024/2024) [Des. Industrial] — turbidímetro, Maurício",
  "FlocControl Display (002/2025) [Des. Industrial] — retroiluminado",
  "MPN Reader (005/2025) [Des. Industrial] — idexx, cartela",
  "Medidor Presença (006/2025) [Des. Industrial] — oxitop",
  "AquaColor Flúor (007/2025) [Des. Industrial] — LED",
  "CL Track Online (010/2025) [Des. Industrial] — cloro online",
  "Medidor Cloro Pocket (005/2021) [Contratado] — Fiore, placa",
  "Poli Sealer (014/2022) [Contratado] — Unicorp, firmware",
  "Dispenser Powder Pillow (009/2023) [Contratado] — Victum, molde",
  "OxiPoli (009/2025) [Contratado] — sensor pressão",
  "Monitor Coagulante [Contratado] — AEGEA",
  "Poli Viewer [Des. Industrial] — gabinete, LEDs",
  "Reagente Cloro Online (039/2022) [Des. Químico] — Blue-i",
  "Alumínio Hach (004/2023) [Des. Químico]",
  "Reagente Manganês (001/2024) [Des. Químico] — sachê",
  "Cloro DPD Pastilha (010/2024) [Des. Químico]",
  "Padrão NTU Hach (014/2024) [Des. Químico]",
  "Stabgel Cloro (008/2025) [Des. Químico]",
  "Nitrogênio Total (011/2025) [Des. Químico]",
  "Fósforo Total (012/2025) [Des. Químico]",
  "Padrão DQO (006/2026) [Des. Químico]",
].join("\n• ");

// ========== UPSTASH ==========
async function saveToUpstash(update) {
  await fetch(`${UPSTASH_URL}/lpush/policontrol_updates/${encodeURIComponent(JSON.stringify(update))}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
}

// ========== CLAUDE ==========
async function callClaude(sysPrompt, userMsg) {
  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) throw new Error("CLAUDE_API_KEY não configurada");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system: sysPrompt, messages: [{ role: "user", content: userMsg }] })
  });
  const d = await res.json();
  if (d.error) throw new Error(d.error.message);
  return d.content.map(i => i.text || "").join("").replace(/```json|```/g, "").trim();
}

// ========== TELEGRAM ==========
async function sendTG(chatId, text, replyTo, buttons) {
  const body = { chat_id: chatId, text, parse_mode: "Markdown", reply_to_message_id: replyTo };
  if (buttons) body.reply_markup = JSON.stringify({ inline_keyboard: buttons });
  await fetch(`${TG_API}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function editTG(chatId, msgId, text) {
  await fetch(`${TG_API}/editMessageText`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, message_id: msgId, text, parse_mode: "Markdown" }) });
}

// ========== HANDLER ==========
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("Bot Policontrol v5");
  const update = req.body;
  try {
    if (update.callback_query) { await handleCallback(update.callback_query); return res.status(200).send("OK"); }
    const msg = update.message;
    if (!msg) return res.status(200).send("OK");
    if (msg.photo) { await handlePhoto(msg); return res.status(200).send("OK"); }
    if (!msg.text) return res.status(200).send("OK");
    if (msg.text.startsWith("/")) { await handleCommand(msg); return res.status(200).send("OK"); }
    if (msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0]) {
      await handleReply(msg); return res.status(200).send("OK");
    }
    await classifyMessage(msg);
  } catch (e) { console.error("Error:", e.message); }
  return res.status(200).send("OK");
}

// ========== CLASSIFICAR ==========
async function classifyMessage(msg) {
  if (msg.text.length < 8) return;
  const userName = msg.from?.first_name || "Alguém";

  const sysPrompt = `Analise mensagem de grupo Policontrol. Projetos:\n• ${PROJECTS}\n\nCLASSIFIQUE (JSON puro):\n- Conversa casual/pergunta/opinião → {"type":"skip"}\n- FATO concreto sobre projeto → {"type":"update","project":"nome","category":"shipping|testing|development|approval|purchase|other","whatDid":"o que fez"}`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);
    if (result.type === "skip") return;

    let rules = "";
    if (result.category === "shipping") rules = `ENVIO — peça: 📅 Data, 📦 Rastreio ou foto comprovante, ⏰ Previsão entrega, ⚡ Próximo passo. Diga "manda foto ou rastreio se tiver"`;
    else if (result.category === "testing") rules = `TESTE — OBRIGATÓRIO evidência! Peça: 📅 Data, 🔬 Dados/leituras/foto do teste (OBRIGATÓRIO!), ✅ Passou?, ⚡ Próximo passo. Diga "Preciso dos dados do teste para registrar"`;
    else if (result.category === "approval") rules = `APROVAÇÃO — peça: 📅 Data, 👤 Quem aprovou, 📄 Documento, ⚡ Próximo passo`;
    else rules = `GERAL — peça: 📅 Data, ⏰ Previsão, ⚡ Próximo passo, 📷 Foto se tiver`;

    const askPrompt = `Atualização do projeto "${result.project}": "${msg.text}"\n${rules}\n\nComece com "📋 *${result.project}* — anotei, ${userName}!" + entendeu + peça falta. Máx 5 linhas. Texto, não JSON.`;
    const followUp = await callClaude(askPrompt, msg.text);
    await sendTG(msg.chat.id, followUp, msg.message_id);
  } catch (e) { console.error("Classify:", e.message); }
}

// ========== REPLY ==========
async function handleReply(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const botQuestion = msg.reply_to_message.text || "";
  const originalMsg = msg.reply_to_message.reply_to_message?.text || "";
  const isTest = /teste|leitura|resultado|evidência|validação/i.test(botQuestion);

  const sysPrompt = `Compile atualização Policontrol.\nOriginal: "${originalMsg}"\nBot: "${botQuestion}"\nResposta: "${msg.text}"\n${isTest ? "TESTE: sem dados/foto = evidenceOk=false, NÃO complete!" : ""}\n\nJSON: {"project":"nome","summary":{"action":"","date":"","evidence":"","nextStep":"","deadline":""},"evidenceOk":true/false,"complete":true/false,"followUp":"pergunta ou null"}`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);

    if (!result.complete && result.followUp) {
      await sendTG(msg.chat.id, result.followUp, msg.message_id);
      return;
    }

    const s = result.summary;
    // Encode summary in callback data for Upstash save
    const updateData = JSON.stringify({ p: result.project, a: s.action, d: s.date, e: s.evidence, n: s.nextStep, dl: s.deadline, u: userName });
    const encodedData = Buffer.from(updateData).toString("base64").substring(0, 60);

    let text = `📋 *Atualização: ${result.project}*\n\n`;
    text += `✅ *O quê:* ${s.action}\n📅 *Quando:* ${s.date}\n`;
    if (s.evidence && s.evidence !== "N/A" && s.evidence !== "pendente") text += `🔬 *Evidência:* ${s.evidence}\n`;
    text += `⚡ *Próximo:* ${s.nextStep}\n⏰ *Previsão:* ${s.deadline}\n`;
    if (!result.evidenceOk) text += `\n⚠️ _Evidência pendente_\n`;
    text += `\n👤 _${userName}_\n\n_Registro no sistema?_`;

    await sendTG(msg.chat.id, text, msg.message_id, [[
      { text: "✅ Registrar", callback_data: `reg_${encodedData}` },
      { text: "❌ Descartar", callback_data: "del" }
    ]]);
  } catch (e) { console.error("Reply:", e.message); }
}

// ========== FOTO ==========
async function handlePhoto(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const caption = msg.caption || "";
  const isReply = msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0];

  if (isReply) {
    const botQuestion = msg.reply_to_message.text || "";
    const sysPrompt = `Foto enviada como evidência. Contexto: "${botQuestion}" Legenda: "${caption}"\nCompile JSON: {"project":"nome","summary":{"action":"","date":"","evidence":"📷 Foto${caption ? ' — '+caption : ''}","nextStep":"a definir","deadline":"a definir"}}`;
    try {
      const raw = await callClaude(sysPrompt, `Foto de ${userName}`);
      const result = JSON.parse(raw);
      const s = result.summary;
      const updateData = JSON.stringify({ p: result.project, a: s.action, d: s.date, e: s.evidence, n: s.nextStep, dl: s.deadline, u: userName });
      const encodedData = Buffer.from(updateData).toString("base64").substring(0, 60);

      let text = `📋 *${result.project}*\n✅ ${s.action}\n📷 Foto recebida${caption ? ' — '+caption : ''}\n👤 _${userName}_\n\n_Registro?_`;
      await sendTG(msg.chat.id, text, msg.message_id, [[
        { text: "✅ Registrar", callback_data: `reg_${encodedData}` },
        { text: "❌ Descartar", callback_data: "del" }
      ]]);
    } catch (e) { await sendTG(msg.chat.id, `📷 Foto recebida, ${userName}!`, msg.message_id); }
  }
}

// ========== CALLBACKS ==========
async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id, msgId = cb.message?.message_id, text = cb.message?.text || "";

  if (cb.data.startsWith("reg_")) {
    // Parse update from message text (more reliable than callback data)
    const lines = text.split("\n");
    const project = (lines.find(l => l.includes("Atualização:")) || lines[0] || "").replace(/[📋*]/g, "").replace("Atualização:", "").trim();
    const getField = (emoji) => { const l = lines.find(l => l.includes(emoji)); return l ? l.split(":").slice(1).join(":").replace(/\*/g, "").trim() : ""; };

    const update = {
      id: Date.now().toString(36),
      project: project,
      action: getField("O quê"),
      date: getField("Quando"),
      evidence: getField("Evidência"),
      nextStep: getField("Próximo"),
      deadline: getField("Previsão"),
      userName: (lines.find(l => l.includes("👤")) || "").replace(/[👤_]/g, "").trim(),
      timestamp: new Date().toISOString(),
      source: "telegram"
    };

    // Salva no Upstash
    try {
      await saveToUpstash(update);
      await editTG(chatId, msgId, text.replace("_Registro no sistema?_", "✅ *REGISTRADO NO SISTEMA*\n_Sincronizado com o app_"));
      console.log("[SAVED]", update.project, update.action);
    } catch (e) {
      await editTG(chatId, msgId, text.replace("_Registro no sistema?_", "✅ *REGISTRADO* ⚠️ _Erro ao sincronizar_"));
      console.error("Upstash:", e.message);
    }
  } else if (cb.data === "del") {
    await editTG(chatId, msgId, "❌ _Descartado._");
  }

  await fetch(`${TG_API}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id }) });
}

// ========== COMANDOS ==========
async function handleCommand(msg) {
  const cmd = msg.text?.split("@")[0];
  if (cmd === "/start") {
    await sendTG(msg.chat.id, `🤖 *Bot Policontrol v5*\n\n📱 Atualizações registradas aqui aparecem automaticamente no app!\n\n*Regras:*\n🔬 Testes → OBRIGATÓRIO evidência\n📦 Envios → Peço rastreio/foto\n\n*Como:*\n1️⃣ Mencione um projeto\n2️⃣ Responda meus pedidos com *reply*\n3️⃣ Mande fotos como evidência\n4️⃣ Confirme → aparece no app\n\n/projetos — lista`, msg.message_id);
  } else if (cmd === "/projetos") {
    await sendTG(msg.chat.id, `📋 *Projetos:*\n\n• ${PROJECTS}`, msg.message_id);
  }
}
