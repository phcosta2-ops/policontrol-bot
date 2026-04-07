// Policontrol Bot v7.1 — Contexto via Upstash, reply obrigatório removido
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
const DATE_CONTEXT = `Converta datas relativas para YYYY-MM-DD (hoje=${TODAY()}): "hoje"=${TODAY()}, "amanhã"=+1d, "daqui X dias"=+Xd, "até dia 25"=2026-04-25, "semana que vem"=+7d, "final de abril"=2026-04-30`;

// ========== UPSTASH HELPERS ==========
async function upstashGet(key) {
  const r = await fetch(`${UPSTASH_URL}/get/${key}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
  const d = await r.json();
  return d.result ? JSON.parse(d.result) : null;
}

async function upstashSet(key, value, exSeconds) {
  await fetch(`${UPSTASH_URL}/set/${key}/${encodeURIComponent(JSON.stringify(value))}${exSeconds ? `/ex/${exSeconds}` : ""}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
}

async function upstashDel(key) {
  await fetch(`${UPSTASH_URL}/del/${key}`, { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` } });
}

async function saveUpdate(update) {
  await fetch(`${UPSTASH_URL}/lpush/poli-telegram-updates/${encodeURIComponent(JSON.stringify(update))}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  console.log("[SAVED]", update.project, update.action);
}

// ========== CLAUDE ==========
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
  if (req.method !== "POST") return res.status(200).send("Bot v7.1");
  const update = req.body;
  try {
    if (update.callback_query) { await handleCallback(update.callback_query); return res.status(200).send("OK"); }
    const msg = update.message;
    if (!msg) return res.status(200).send("OK");
    if (msg.photo) { await handlePhoto(msg); return res.status(200).send("OK"); }
    if (!msg.text) return res.status(200).send("OK");
    if (msg.text.startsWith("/")) { await handleCommand(msg); return res.status(200).send("OK"); }

    const userId = msg.from?.id;
    const chatId = msg.chat?.id;

    // Checar se esse usuário tem conversa pendente
    const pendingKey = `poli-pending-${chatId}-${userId}`;
    const pending = await upstashGet(pendingKey);

    if (pending) {
      // Continua conversa existente
      await handleFollowUp(msg, pending, pendingKey);
    } else {
      // Mensagem nova
      await classifyMessage(msg);
    }
  } catch (e) { console.error("Error:", e.message); }
  return res.status(200).send("OK");
}

// ========== CLASSIFICAR MENSAGEM NOVA ==========
async function classifyMessage(msg) {
  if (msg.text.length < 8) return;
  const userName = msg.from?.first_name || "Alguém";
  const userId = msg.from?.id;
  const chatId = msg.chat?.id;

  const sysPrompt = `Analise mensagem de grupo Policontrol.
Projetos:\n• ${PROJECTS}

JSON puro:
- Casual/pergunta/opinião → {"type":"skip"}
- Fato concreto sobre projeto → {"type":"update","project":"nome EXATO da lista","category":"shipping|testing|other","summary":"o que aconteceu"}

O campo "project" DEVE ser exatamente um nome da lista.`;

  try {
    const raw = await callClaude(sysPrompt, `${userName}: "${msg.text}"`);
    const result = JSON.parse(raw);
    if (result.type === "skip") return;

    // Salvar contexto pendente no Upstash (expira em 10 min)
    const pending = {
      project: result.project,
      category: result.category,
      summary: result.summary,
      round: 1,
      userName
    };
    await upstashSet(`poli-pending-${chatId}-${userId}`, pending, 600);

    // Primeira pergunta
    let q = `📋 *${result.project}* — anotei, ${userName}!\n✅ ${result.summary}\n\n`;

    if (result.category === "testing") {
      q += `🔬 *Teste precisa de evidência!* Manda foto ou dados.\n\n`;
    } else if (result.category === "shipping") {
      q += `📦 Se tiver rastreio ou foto, manda junto.\n\n`;
    }

    q += `Me conta:\n⚡ Qual o *próximo passo*?\n⏰ *Prazo*? (ex: "até dia 25", "daqui 10 dias", "amanhã")`;

    await sendTG(chatId, q, msg.message_id);
  } catch (e) { console.error("Classify:", e.message); }
}

// ========== FOLLOW-UP (sem precisar de reply!) ==========
async function handleFollowUp(msg, pending, pendingKey) {
  const userName = msg.from?.first_name || "Alguém";

  const sysPrompt = `Compile atualização de projeto Policontrol.
${DATE_CONTEXT}

Projeto: "${pending.project}"
Fato original: "${pending.summary}"
Rodada: ${pending.round}
Resposta do usuário agora: "${msg.text}"
${pending.round2context ? "Contexto adicional: " + pending.round2context : ""}

Retorne JSON:
{
  "action": "o que foi feito",
  "date": "YYYY-MM-DD quando foi feito",
  "evidence": "evidência ou null",
  "nextStep": "próximo passo",
  "deadline": "YYYY-MM-DD prazo do próximo passo ou null",
  "complete": true/false,
  "missingQuestion": "se complete=false, UMA pergunta curta do que falta. Se complete=true, null"
}

REGRAS:
- Se tem ação + próximo passo → complete=true (prazo é bonus, aceite sem)
- Se só falta prazo → complete=true (registre sem prazo)
- Máximo 2 rodadas. Se round=2 → SEMPRE complete=true
- Converta datas relativas: "até dia 25"=2026-04-25, "daqui 10 dias"=+10d, "amanhã"=+1d`;

  try {
    const raw = await callClaude(sysPrompt, msg.text);
    const result = JSON.parse(raw);

    // Rodada 1 e falta info → UMA pergunta mais
    if (pending.round === 1 && !result.complete && result.missingQuestion) {
      pending.round = 2;
      pending.round2context = `Resposta rodada 1: "${msg.text}"`;
      await upstashSet(pendingKey, pending, 600);

      await sendTG(msg.chat.id, `👍 Anotei! Só mais uma:\n❓ ${result.missingQuestion}`, msg.message_id);
      return;
    }

    // Tudo completo OU rodada 2 → mostra confirmação
    await upstashDel(pendingKey);

    let text = `📋 *${pending.project}*\n\n`;
    text += `✅ *O quê:* ${result.action || pending.summary}\n`;
    text += `📅 *Quando:* ${result.date || TODAY()}\n`;
    if (result.evidence) text += `🔬 *Evidência:* ${result.evidence}\n`;
    if (result.nextStep) text += `⚡ *Próximo passo:* ${result.nextStep}\n`;
    if (result.deadline) text += `⏰ *Prazo:* ${result.deadline}\n`;
    text += `\n👤 _${userName}_\n\n_Confirma?_`;

    await sendTG(msg.chat.id, text, msg.message_id, [[
      { text: "✅ Registrar", callback_data: "reg" },
      { text: "❌ Descartar", callback_data: "del" }
    ]]);
  } catch (e) {
    console.error("FollowUp:", e.message);
    await upstashDel(pendingKey);
  }
}

// ========== FOTO ==========
async function handlePhoto(msg) {
  const userName = msg.from?.first_name || "Alguém";
  await sendTG(msg.chat.id, `📷 Foto recebida, ${userName}! Agora me diz o próximo passo e prazo.`, msg.message_id);
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

      await saveUpdate(updateEntry);
      await editTG(chatId, msgId, msgText.replace("_Confirma?_", "✅ *REGISTRADO*"));

      // Confirmação visível
      let confirm = `✅ *Registrado!*\n\n🏷 *${project}*\n📝 ${action}\n`;
      if (nextStep) confirm += `⚡ *Nova ação:* ${nextStep}\n`;
      if (deadline) confirm += `⏰ *Prazo:* ${deadline}\n`;
      confirm += `\n👤 _${userName}_ · 📱 _No app_`;

      await sendTG(chatId, confirm);
    } catch (e) {
      console.error("Save:", e.message);
      await editTG(chatId, msgId, msgText.replace("_Confirma?_", "⚠ _Erro_"));
    }
  }

  await fetch(`${TG_API}/answerCallbackQuery`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: cb.id }) });
}

// ========== COMANDOS ==========
async function handleCommand(msg) {
  const cmd = msg.text?.split("@")[0];
  if (cmd === "/start") {
    await sendTG(msg.chat.id, `🤖 *Bot Policontrol*\n\n📱 Atualizações vão direto pro app!\n\n*Como usar:*\n1️⃣ Diga o que fez ("materiais chegaram pro fósforo")\n2️⃣ Eu peço próximo passo e prazo\n3️⃣ Responda normalmente (não precisa de reply!)\n4️⃣ Confirma ✅ → no app!\n\n💡 Aceito: "amanhã", "daqui 10 dias", "até dia 25"\n💡 Use o 🎤 do teclado para ditar\n🔬 Testes precisam de foto/dados\n\n/projetos — ver projetos`, msg.message_id);
  } else if (cmd === "/projetos") {
    await sendTG(msg.chat.id, `📋 *Projetos:*\n\n• ${PROJECTS}`, msg.message_id);
  }
}
