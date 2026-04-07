// Policontrol Bot v7 — Máx 2 perguntas, datas relativas
const TELEGRAM_TOKEN = "8619850108:AAFk2alsfSQLocua9jPOkzgUD33XPFsIrdc";
const TG_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const UPSTASH_URL = process.env.UPSTASH_URL || "https://smooth-dingo-93735.upstash.io";
const UPSTASH_TOKEN = process.env.UPSTASH_TOKEN || "";

const PROJECTS = [
  "Placa AP2000 (024/2024) [Des. Industrial]",
  "FlocControl Display (002/2025) [Des. Industrial]",
  "MPN Reader (005/2025) [Des. Industrial]",
  "Medidor Presença (006/2025) [Des. Industrial]",
  "AquaColor Flúor (007/2025) [Des. Industrial]",
  "CL Track Online (010/2025) [Des. Industrial]",
  "Medidor Cloro Pocket (005/2021) [Contratado] — Fiore",
  "Poli Sealer (014/2022) [Contratado] — Unicorp",
  "Dispenser Powder Pillow (009/2023) [Contratado] — Victum",
  "OxiPoli (009/2025) [Contratado]",
  "Monitor Coagulante [Contratado] — AEGEA",
  "Poli Viewer [Des. Industrial]",
  "Reagente Cloro Online (039/2022) [Des. Químico]",
  "Alumínio Hach (004/2023) [Des. Químico]",
  "Reagente Manganês Sachê (001/2024) [Des. Químico]",
  "Cloro DPD Pastilha (010/2024) [Des. Químico]",
  "Padrão NTU Hach (014/2024) [Des. Químico]",
  "Stabgel Cloro (008/2025) [Des. Químico]",
  "Nitrogênio Total (011/2025) [Des. Químico]",
  "Fósforo Total (012/2025) [Des. Químico]",
  "Cloro DPD Sachê China (013/2025) [Des. Químico]",
  "Cloro DPD Sachê Shaanxi (001/2026) [Des. Químico]",
  "Reagente Cloro DPD Total Pó Online (002/2026) [Des. Químico]",
  "Padrão DQO 1000 mg/L (006/2026) [Des. Químico]",
  "Reagente Cloro DPD Líquido China (007/2026) [Des. Químico]",
].join("\n• ");

const TODAY = () => new Date().toISOString().slice(0, 10);

const DATE_CONTEXT = `
DATAS RELATIVAS — converta para YYYY-MM-DD baseado em hoje (${TODAY()}):
- "hoje" → ${TODAY()}
- "amanhã" → calcule +1 dia
- "daqui X dias" / "em X dias" → calcule +X dias
- "semana que vem" → +7 dias
- "mês que vem" → +30 dias
- "até dia 25" ou "dia 25" → 2026-04-25 (mês atual ou próximo)
- "25/04" ou "25/04/2026" → 2026-04-25
- "final de abril" → 2026-04-30
- "meados de maio" → 2026-05-15`;

async function saveToUpstash(update) {
  const entry = JSON.stringify(update);
  await fetch(`${UPSTASH_URL}/lpush/poli-telegram-updates/${encodeURIComponent(entry)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  console.log("[SAVED]", update.project, update.action);
}

async function callClaude(sysPrompt, userMsg) {
  const CLAUDE_KEY = process.env.CLAUDE_API_KEY;
  if (!CLAUDE_KEY) throw new Error("CLAUDE_API_KEY não configurada");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": CLAUDE_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800, system: sysPrompt, messages: [{ role: "user", content: userMsg }] })
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
  if (req.method !== "POST") return res.status(200).send("Bot v7");
  const update = req.body;
  try {
    if (update.callback_query) { await handleCallback(update.callback_query); return res.status(200).send("OK"); }
    const msg = update.message;
    if (!msg) return res.status(200).send("OK");
    if (msg.photo) { await handlePhoto(msg); return res.status(200).send("OK"); }
    if (!msg.text) return res.status(200).send("OK");
    if (msg.text.startsWith("/")) { await handleCommand(msg); return res.status(200).send("OK"); }

    // Reply ao bot
    if (msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0]) {
      await handleReply(msg);
      return res.status(200).send("OK");
    }

    await classifyMessage(msg);
  } catch (e) { console.error("Error:", e.message); }
  return res.status(200).send("OK");
}

// ========== CLASSIFICAR ==========
async function classifyMessage(msg) {
  if (msg.text.length < 8) return;
  const userName = msg.from?.first_name || "Alguém";

  const sysPrompt = `Analise mensagem de grupo Policontrol.
Projetos:\n• ${PROJECTS}

JSON puro:
- Casual/pergunta/opinião → {"type":"skip"}
- Fato concreto sobre projeto → {"type":"update","project":"nome EXATO da lista","category":"shipping|testing|development|approval|purchase|other","summary":"o que aconteceu"}

O campo "project" DEVE ser exatamente um nome da lista. Não invente.`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);
    if (result.type === "skip") return;

    // Primeira pergunta
    let q = `📋 *${result.project}* — anotei, ${userName}!\n✅ ${result.summary}\n\n`;

    if (result.category === "testing") {
      q += `🔬 *Teste precisa de evidência!* Manda foto ou dados.\n\n`;
    } else if (result.category === "shipping") {
      q += `📦 Se tiver rastreio ou foto, manda junto.\n\n`;
    }

    q += `Responda por *reply*:\n`;
    q += `⚡ Próximo passo?\n`;
    q += `⏰ Prazo? (pode ser "até dia 25", "daqui 10 dias", "amanhã")\n`;
    q += `[rodada:1]`;

    await sendTG(msg.chat.id, q, msg.message_id);
  } catch (e) { console.error("Classify:", e.message); }
}

// ========== REPLY ==========
async function handleReply(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const botMsg = msg.reply_to_message.text || "";

  // Detectar rodada pela tag no texto do bot
  const isRound1 = botMsg.includes("[rodada:1]");
  const isRound2 = botMsg.includes("[rodada:2]");

  // Coletar todo o contexto (mensagem do bot + original se tiver)
  const originalUserMsg = msg.reply_to_message.reply_to_message?.text || "";
  const fullContext = `Contexto do bot: "${botMsg}"\nMensagem original: "${originalUserMsg}"\nResposta do usuário: "${msg.text}"`;

  const sysPrompt = `Compile atualização de projeto Policontrol.
${DATE_CONTEXT}

PROJETOS:\n• ${PROJECTS}

Analise o contexto e a resposta do usuário. Extraia o projeto da mensagem do bot (após 📋).

Retorne JSON:
{
  "project": "nome EXATO do projeto da lista",
  "action": "o que foi feito",
  "date": "YYYY-MM-DD (quando foi feito)",
  "evidence": "evidência/dados ou null",
  "nextStep": "próximo passo ou null",
  "deadline": "YYYY-MM-DD do prazo do próximo passo ou null",
  "missing": ["lista do que ainda falta — vazia se tiver action + nextStep"]
}

REGRAS:
- Converta TODAS as datas relativas para YYYY-MM-DD
- Se já tem "action" + "nextStep" → missing vazio
- Se falta só prazo mas tem nextStep → aceite (missing vazio)
- Se não tem nextStep → missing = ["próximo passo"]
- Máximo 2 itens em missing
- O campo project DEVE ser da lista. Se o bot disse "Fósforo Total" use "Fósforo Total (012/2025) [Des. Químico]"`;

  try {
    const raw = await callClaude(sysPrompt, fullContext);
    const result = JSON.parse(raw);

    // Rodada 1 e falta info → faz UMA pergunta a mais
    if (isRound1 && result.missing && result.missing.length > 0) {
      let followUp = `👍 Anotei! Só mais uma coisa:\n`;
      result.missing.forEach(m => { followUp += `❓ ${m}\n`; });
      followUp += `\n_Responda por reply_\n[rodada:2]`;
      await sendTG(msg.chat.id, followUp, msg.message_id);
      return;
    }

    // Rodada 2 OU tudo completo → confirmação direto
    let text = `📋 *${result.project}*\n\n`;
    text += `✅ *O quê:* ${result.action || "atualização registrada"}\n`;
    text += `📅 *Quando:* ${result.date || TODAY()}\n`;
    if (result.evidence) text += `🔬 *Evidência:* ${result.evidence}\n`;
    if (result.nextStep) text += `⚡ *Próximo passo:* ${result.nextStep}\n`;
    if (result.deadline) text += `⏰ *Prazo:* ${result.deadline}\n`;
    text += `\n👤 _${userName}_\n\n_Confirma?_`;

    await sendTG(msg.chat.id, text, msg.message_id, [[
      { text: "✅ Registrar", callback_data: "reg" },
      { text: "❌ Descartar", callback_data: "del" }
    ]]);
  } catch (e) { console.error("Reply:", e.message); }
}

// ========== FOTO ==========
async function handlePhoto(msg) {
  const userName = msg.from?.first_name || "Alguém";
  const isReply = msg.reply_to_message && String(msg.reply_to_message.from?.id) === TELEGRAM_TOKEN.split(":")[0];
  if (isReply) {
    await sendTG(msg.chat.id, `📷 Foto recebida, ${userName}! Agora responda por *reply* com próximo passo e prazo.`, msg.message_id);
  }
}

// ========== BOTÕES ==========
async function handleCallback(cb) {
  const chatId = cb.message?.chat?.id, msgId = cb.message?.message_id;
  const msgText = cb.message?.text || "";
  const userName = cb.from?.first_name || "Alguém";

  if (cb.data === "del") {
    await editTG(chatId, msgId, "❌ _Descartado._");
  } else if (cb.data === "reg") {
    try {
      const lines = msgText.split("\n");
      const getField = (label) => {
        const line = lines.find(l => l.includes(label));
        if (!line) return "";
        return line.replace(/[*✅📅🔬⚡⏰📋👤]/g, "").replace(label, "").trim();
      };

      const project = (lines[0] || "").replace(/[*📋]/g, "").trim();
      const action = getField("O quê:");
      const date = getField("Quando:");
      const evidence = getField("Evidência:");
      const nextStep = getField("Próximo passo:");
      const deadline = getField("Prazo:");

      const updateEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        project, action, date: date || TODAY(),
        evidence: evidence || null,
        nextStep: nextStep || null,
        deadline: deadline || null,
        userName,
        timestamp: new Date().toISOString(),
        source: "telegram"
      };

      await saveToUpstash(updateEntry);
      await editTG(chatId, msgId, msgText.replace("_Confirma?_", "✅ *REGISTRADO*"));

      // Confirmação visível
      let confirm = `✅ *Registrado!*\n\n🏷 *${project}*\n📝 ${action}\n`;
      if (nextStep) confirm += `⚡ *Nova ação:* ${nextStep}\n`;
      if (deadline) confirm += `⏰ *Prazo:* ${deadline}\n`;
      confirm += `\n👤 _${userName}_ · 📱 _No app_`;

      await sendTG(chatId, confirm);
    } catch (e) {
      console.error("Save:", e.message);
      await editTG(chatId, msgId, msgText.replace("_Confirma?_", "⚠ _Erro ao salvar_"));
    }
  }

  await fetch(`${TG_API}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id }) });
}

// ========== COMANDOS ==========
async function handleCommand(msg) {
  const cmd = msg.text?.split("@")[0];
  if (cmd === "/start") {
    await sendTG(msg.chat.id, `🤖 *Bot Policontrol v7*\n\n📱 Atualizações vão direto pro app!\n\n*Como usar:*\n1️⃣ Diga o que fez ("materiais chegaram pro fósforo")\n2️⃣ Eu peço próximo passo e prazo\n3️⃣ Responda por *reply* ("fabricar lote até dia 25")\n4️⃣ Confirma ✅ → no app!\n\n💡 Aceito datas tipo "amanhã", "daqui 10 dias", "até dia 25"\n💡 Use o 🎤 do teclado para ditar\n🔬 Testes precisam de foto/dados\n\n/projetos — ver projetos`, msg.message_id);
  } else if (cmd === "/projetos") {
    await sendTG(msg.chat.id, `📋 *Projetos:*\n\n• ${PROJECTS}`, msg.message_id);
  }
}
