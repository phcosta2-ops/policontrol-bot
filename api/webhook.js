// Policontrol Bot v5.1 — Actions + Deadlines + Confirmation
const TELEGRAM_TOKEN = "8619850108:AAFk2alsfSQLocua9jPOkzgUD33XPFsIrdc";
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const UPSTASH_URL = process.env.UPSTASH_URL || "https://smooth-dingo-93735.upstash.io";
const UPSTASH_TOKEN = process.env.UPSTASH_TOKEN || "";

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

async function saveToUpstash(update) {
  const entry = JSON.stringify(update);
  const res = await fetch(`${UPSTASH_URL}/lpush/poli-telegram-updates/${encodeURIComponent(entry)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const d = await res.json();
  console.log("[UPSTASH]", d.result ? "OK" : "FAIL");
}

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
  if (req.method !== "POST") return res.status(200).send("Bot Policontrol v5.1");
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

  const sysPrompt = `Analise mensagem de grupo Policontrol. Projetos:\n• ${PROJECTS}\n\nJSON puro:\n- Casual/pergunta/opinião → {"type":"skip"}\n- FATO concreto → {"type":"update","project":"nome","category":"shipping|testing|development|approval|purchase|other","whatDid":"resumo"}`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);
    if (result.type === "skip") return;

    let rules = "";
    if (result.category === "shipping") rules = "ENVIO — Peça: 📅 data, 📦 rastreio/foto, ⏰ previsão entrega, ⚡ próximo passo + prazo do próximo passo. Diga: 'Se tiver, manda foto ou rastreio'";
    else if (result.category === "testing") rules = "TESTE — OBRIGATÓRIO evidência! Peça: 📅 data, 🔬 dados/leituras/foto (SEM ISSO NÃO REGISTRO!), ⚡ próximo passo + prazo. Diga: 'Preciso dos dados do teste para registrar'";
    else rules = "GERAL — Peça: 📅 data, ⚡ próximo passo, ⏰ prazo do próximo passo (data limite YYYY-MM-DD), 📷 foto se tiver";

    const askPrompt = `Projeto "${result.project}", atualização: "${msg.text}"
${rules}

IMPORTANTE: Sempre pergunte qual é o PRÓXIMO PASSO e o PRAZO desse próximo passo (data limite no formato DD/MM/YYYY). Isso vai criar uma ação no app.

Comece: "📋 *${result.project}* — anotei, ${userName}!" + o que entendeu + peça o que falta. Máx 5 linhas. Texto direto.`;

    const followUp = await callClaude(askPrompt, msg.text);
    await sendTG(msg.chat.id, followUp, msg.message_id);
  } catch (e) { console.error("Classify:", e.message); }
}

// ========== REPLY ==========
async function handleReply(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const botQ = msg.reply_to_message.text || "";
  const origMsg = msg.reply_to_message.reply_to_message?.text || "";
  const isTesting = /teste|leitura|resultado|evidência|dados/i.test(botQ);

  const sysPrompt = `Compile atualização Policontrol.
Original: "${origMsg}"
Bot: "${botQ}"
Resposta: "${msg.text}"
${isTesting ? "TESTE: sem dados/foto = evidenceOk:false, NÃO complete!" : ""}

IMPORTANTE: Extraia o PRÓXIMO PASSO e seu PRAZO (formato YYYY-MM-DD). Se a pessoa disse um prazo como "até dia 20" ou "semana que vem", converta para YYYY-MM-DD.

JSON: {
  "project":"nome",
  "summary":{
    "action":"o que fez",
    "date":"quando fez",
    "evidence":"dados/rastreio ou N/A",
    "nextStep":"próximo passo concreto",
    "nextStepDeadline":"YYYY-MM-DD ou null",
    "deadline":"previsão geral"
  },
  "evidenceOk":true/false,
  "complete":true/false,
  "followUp":"se incompleto, pergunta. Se completo, null"
}

Se não informou próximo passo ou prazo, marque complete=false e pergunte especificamente.`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);

    if (!result.complete && result.followUp) {
      await sendTG(msg.chat.id, result.followUp, msg.message_id);
      return;
    }

    const s = result.summary;
    let text = `📋 *Atualização: ${result.project}*\n\n`;
    text += `✅ *O quê:* ${s.action}\n`;
    text += `📅 *Quando:* ${s.date}\n`;
    if (s.evidence && s.evidence !== "N/A") text += `🔬 *Evidência:* ${s.evidence}\n`;
    if (s.nextStep) text += `⚡ *Próximo passo:* ${s.nextStep}\n`;
    if (s.nextStepDeadline) text += `⏰ *Prazo do próximo passo:* ${s.nextStepDeadline}\n`;
    if (!result.evidenceOk) text += `\n⚠️ _Evidência pendente_\n`;
    text += `\n👤 _${userName}_\n\n_Registro no app e abro ação?_`;

    await sendTG(msg.chat.id, text, msg.message_id, [[
      { text: "✅ Registrar + Abrir ação", callback_data: "reg" },
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
    await sendTG(msg.chat.id, `📷 *Foto recebida, ${userName}!* Registrada como evidência.\n\n_Agora responda com os outros dados que pedi (por reply)._`, msg.message_id);
  } else if (caption && caption.length > 10) {
    await classifyMessage({ ...msg, text: caption });
  }
}

// ========== CALLBACKS ==========
async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id, msgId = cb.message?.message_id;
  const msgText = cb.message?.text || "";
  const userName = cb.from?.first_name || "Alguém";

  if (cb.data === "del") {
    await editTG(chatId, msgId, "❌ _Descartado._");
  } else if (cb.data === "reg") {
    try {
      const lines = msgText.split("\n");
      const project = (lines.find(l => l.includes("Atualização:")) || "").replace(/[*📋]/g, "").replace("Atualização:", "").trim();
      const action = (lines.find(l => l.includes("O quê:")) || "").replace(/[*✅]/g, "").replace("O quê:", "").trim();
      const date = (lines.find(l => l.includes("Quando:")) || "").replace(/[*📅]/g, "").replace("Quando:", "").trim();
      const evidence = (lines.find(l => l.includes("Evidência:")) || "").replace(/[*🔬]/g, "").replace("Evidência:", "").trim();
      const nextStep = (lines.find(l => l.includes("Próximo passo:")) || "").replace(/[*⚡]/g, "").replace("Próximo passo:", "").trim();
      const nextDeadline = (lines.find(l => l.includes("Prazo do próximo")) || "").replace(/[*⏰]/g, "").replace("Prazo do próximo passo:", "").trim();

      const updateEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        project,
        action,
        date,
        evidence: evidence || null,
        nextStep: nextStep || null,
        deadline: nextDeadline || null,
        userName,
        timestamp: new Date().toISOString(),
        source: "telegram"
      };

      await saveToUpstash(updateEntry);
      console.log("[SAVED]", project, action, "| Next:", nextStep, "| Deadline:", nextDeadline);

      // Edit original message
      await editTG(chatId, msgId, msgText.replace("_Registro no app e abro ação?_", "✅ *REGISTRADO NO APP*"));

      // Send visible confirmation to group
      let confirm = `✅ *Atualização registrada!*\n\n`;
      confirm += `🏷 *${project}*\n`;
      confirm += `📝 ${action}\n`;
      if (nextStep) confirm += `\n⚡ *Nova ação criada:* ${nextStep}`;
      if (nextDeadline) confirm += `\n⏰ *Prazo:* ${nextDeadline}`;
      confirm += `\n\n👤 _Por ${userName} via Telegram_`;
      confirm += `\n📱 _Visível no app para toda equipe_`;

      await sendTG(chatId, confirm);

    } catch (e) {
      console.error("Save:", e.message);
      await editTG(chatId, msgId, msgText.replace("_Registro no app e abro ação?_", "✅ *REGISTRADO* _(erro ao salvar)_"));
    }
  }

  await fetch(`${TG_API}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id }) });
}

// ========== COMANDOS ==========
async function handleCommand(msg) {
  const cmd = msg.text?.split("@")[0];
  if (cmd === "/start") {
    await sendTG(msg.chat.id, `🤖 *Bot Policontrol v5.1*\n\n📱 Atualizações registradas aqui aparecem no app!\n⚡ Próximos passos viram ações com prazo!\n\n*Regras:*\n🔬 Testes → OBRIGATÓRIO evidência\n📦 Envios → Peço rastreio/foto\n\n*Como usar:*\n1️⃣ Mencione algo sobre um projeto\n2️⃣ Respondo pedindo detalhes (use *reply*)\n3️⃣ Confirme → registro + ação criada\n\n/projetos — ver projetos`, msg.message_id);
  } else if (cmd === "/projetos") {
    await sendTG(msg.chat.id, `📋 *Projetos:*\n\n• ${PROJECTS}`, msg.message_id);
  }
}
